import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBeginCheckoutEvent,
  buildCommerceItemsEvent,
  buildPageViewEvent,
  buildProductImpression,
  buildPurchaseEvent,
  buildVariantItem,
  buildViewCartEvent,
  COMMERCE_EVENT_NAMES,
  MAX_COMMERCE_IDENTIFIER_LENGTH,
} from "../../src/tracking/commerce-events.ts";

const impression = {
  productExternalId: "pancake-product-1",
  itemName: "Áo Oxford Relaxed",
} as const;

const variantItem = {
  variantExternalId: "pancake-variation-1",
  productExternalId: "pancake-product-1",
  itemName: "Áo Oxford Relaxed",
  unitPriceVnd: 890_000,
  quantity: 2,
} as const;

test("T1 the supported event vocabulary is exactly the reviewed baseline", () => {
  assert.deepEqual([...COMMERCE_EVENT_NAMES], [
    "page_view",
    "view_item_list",
    "select_item",
    "view_item",
    "add_to_cart",
    "remove_from_cart",
    "view_cart",
    "begin_checkout",
    "purchase",
  ]);
});

test("T1 upper-funnel product impressions carry product identity without a fabricated variant", () => {
  const item = buildProductImpression({
    ...impression,
    listId: "shop",
    listName: "catalog-listing",
    index: 3,
  });

  assert.deepEqual(item, {
    item_id: "pancake-product-1",
    item_name: "Áo Oxford Relaxed",
    item_list_id: "shop",
    item_list_name: "catalog-listing",
    index: 3,
  });
  assert.equal("item_variant" in item, false);
  assert.equal("price" in item, false);
});

test("T1 a product impression maps one exact common price and never a range minimum", () => {
  assert.equal(
    buildProductImpression({ ...impression, exactPriceVnd: 890_000 }).price,
    890_000,
  );

  const ranged = buildProductImpression({
    ...impression,
    minimumPriceVnd: 690_000,
    maximumPriceVnd: 890_000,
  });
  assert.equal("price" in ranged, false);
  assert.equal(ranged.la_minimum_price_vnd, 690_000);
  assert.equal(ranged.la_maximum_price_vnd, 890_000);

  const unresolved = buildProductImpression(impression);
  assert.equal("price" in unresolved, false);
  assert.equal("la_minimum_price_vnd" in unresolved, false);
  assert.equal("la_maximum_price_vnd" in unresolved, false);
});

test("T1 a single-price range collapses to that exact price rather than staying a range", () => {
  const item = buildProductImpression({
    ...impression,
    minimumPriceVnd: 890_000,
    maximumPriceVnd: 890_000,
  });

  assert.equal(item.price, 890_000);
  assert.equal("la_minimum_price_vnd" in item, false);
});

test("T1 a product impression rejects an inverted or non-integer price range instead of guessing", () => {
  assert.throws(
    () => buildProductImpression({ ...impression, minimumPriceVnd: 900_000, maximumPriceVnd: 800_000 }),
    /price range/,
  );
  assert.throws(
    () => buildProductImpression({ ...impression, exactPriceVnd: 890_000.5 }),
    /integer VND/,
  );
  assert.throws(
    () => buildProductImpression({ ...impression, exactPriceVnd: -1 }),
    /integer VND/,
  );
});

test("T1 selected variant items require a concrete external variation identity", () => {
  for (const variantExternalId of ["", "   ", "a".repeat(MAX_COMMERCE_IDENTIFIER_LENGTH + 1)]) {
    assert.throws(
      () => buildVariantItem({ ...variantItem, variantExternalId }),
      /variant identity/,
      `${JSON.stringify(variantExternalId.slice(0, 12))} must not become a commerce identity`,
    );
  }
});

test("T1 selected variant items carry authoritative unit price, quantity and options", () => {
  assert.deepEqual(
    buildVariantItem({ ...variantItem, color: "Đen", size: "L" }),
    {
      item_id: "pancake-variation-1",
      item_name: "Áo Oxford Relaxed",
      item_group_id: "pancake-product-1",
      price: 890_000,
      quantity: 2,
      item_variant: "Đen / L",
    },
  );
});

test("T1 variant items reject a non-positive quantity or a non-integer VND price", () => {
  assert.throws(() => buildVariantItem({ ...variantItem, quantity: 0 }), /quantity/);
  assert.throws(() => buildVariantItem({ ...variantItem, quantity: 1.5 }), /quantity/);
  assert.throws(() => buildVariantItem({ ...variantItem, unitPriceVnd: 1.5 }), /integer VND/);
});

test("T1 the generic commerce payload carries no customer PII", () => {
  const forbidden = ["nguyen van a", "0900000000", "buyer@example.com", "12 Le Loi", "giao gio hanh chinh"];
  const event = buildCommerceItemsEvent("add_to_cart", {
    items: [buildVariantItem(variantItem)],
    // @ts-expect-error the contract must ignore any caller-supplied checkout facts
    guestName: "Nguyen Van A",
    guestPhone: "0900000000",
    email: "buyer@example.com",
    addressDetail: "12 Le Loi",
    note: "giao gio hanh chinh",
  });

  const serialized = JSON.stringify(event).toLowerCase();
  for (const value of forbidden) {
    assert.equal(serialized.includes(value), false, `${value} must never reach the dataLayer`);
  }
  for (const key of ["guestname", "guestphone", "email", "addressdetail", "note"]) {
    assert.equal(serialized.includes(key), false, `${key} must never reach the dataLayer`);
  }
});

test("T1 committed-stage events reject upper-funnel product impressions", () => {
  for (const name of ["add_to_cart", "remove_from_cart"] as const) {
    assert.throws(
      () => buildCommerceItemsEvent(name, { items: [buildProductImpression(impression)] }),
      /variant identity/,
      `${name} must require concrete variant identity`,
    );
  }

  assert.throws(
    () => buildViewCartEvent({ items: [buildProductImpression(impression)] }),
    /variant identity/,
  );
  assert.throws(
    () => buildBeginCheckoutEvent({ items: [buildProductImpression(impression)] }),
    /variant identity/,
  );
  assert.throws(
    () =>
      buildPurchaseEvent({
        publicCode: "LA-2026-0001",
        merchandiseValueVnd: 1_000,
        shippingVnd: 0,
        totalVnd: 1_000,
        items: [buildProductImpression(impression)],
      }),
    /variant identity/,
  );
});

test("T1 upper-funnel events accept product impressions and require at least one item", () => {
  assert.deepEqual(
    buildCommerceItemsEvent("view_item_list", {
      items: [buildProductImpression({ ...impression, listId: "shop", listName: "catalog-listing" })],
      itemListId: "shop",
      itemListName: "catalog-listing",
    }),
    {
      event: "view_item_list",
      ecommerce: {
        item_list_id: "shop",
        item_list_name: "catalog-listing",
        items: [
          {
            item_id: "pancake-product-1",
            item_name: "Áo Oxford Relaxed",
            item_list_id: "shop",
            item_list_name: "catalog-listing",
          },
        ],
      },
    },
  );

  assert.throws(() => buildCommerceItemsEvent("view_item_list", { items: [] }), /at least one item/);
});

test("T1 begin_checkout reports currency and merchandise value from committed items", () => {
  assert.deepEqual(
    buildBeginCheckoutEvent({ items: [buildVariantItem(variantItem)] }),
    {
      event: "begin_checkout",
      ecommerce: {
        currency: "VND",
        value: 1_780_000,
        items: [
          {
            item_id: "pancake-variation-1",
            item_name: "Áo Oxford Relaxed",
            item_group_id: "pancake-product-1",
            price: 890_000,
            quantity: 2,
          },
        ],
      },
    },
  );
});

test("T1 Purchase uses the public order code as both transaction and event identity", () => {
  const event = buildPurchaseEvent({
    publicCode: "LA-2026-0001",
    merchandiseValueVnd: 1_780_000,
    shippingVnd: 30_000,
    totalVnd: 1_810_000,
    items: [buildVariantItem(variantItem)],
  });

  assert.equal(event.event, "purchase");
  assert.equal(event.ecommerce.transaction_id, "LA-2026-0001");
  assert.equal(event.ecommerce.event_id, "LA-2026-0001");
  assert.equal(event.ecommerce.currency, "VND");
  assert.equal(event.ecommerce.value, 1_780_000);
  assert.equal(event.ecommerce.shipping, 30_000);
  assert.equal(event.ecommerce.la_total_vnd, 1_810_000);
});

test("T1 Purchase refuses a slug or local identifier in place of the public order code", () => {
  for (const publicCode of ["", "   ", "a".repeat(MAX_COMMERCE_IDENTIFIER_LENGTH + 1)]) {
    assert.throws(
      () =>
        buildPurchaseEvent({
          publicCode,
          merchandiseValueVnd: 1_000,
          shippingVnd: 0,
          totalVnd: 1_000,
          items: [buildVariantItem(variantItem)],
        }),
      /transaction identity/,
    );
  }
});

test("T3 page_view is a deterministic first-party fact without query state", () => {
  assert.deepEqual(buildPageViewEvent({ pathname: "/shop/ao-oxford", search: "?variant=1" }), {
    event: "page_view",
    page_path: "/shop/ao-oxford",
  });
  assert.throws(() => buildPageViewEvent({ pathname: "shop", search: "" }), /page path/);
});

test("T1 begin_checkout accumulates merchandise value exactly rather than in floating point", () => {
  const half = Math.floor(Number.MAX_SAFE_INTEGER / 2);

  // Three lines that individually fit and together land exactly on the boundary.
  const event = buildBeginCheckoutEvent({
    items: [
      buildVariantItem({ ...variantItem, variantExternalId: "v-1", unitPriceVnd: half, quantity: 1 }),
      buildVariantItem({ ...variantItem, variantExternalId: "v-2", unitPriceVnd: half, quantity: 1 }),
      buildVariantItem({ ...variantItem, variantExternalId: "v-3", unitPriceVnd: 1, quantity: 1 }),
    ],
  });

  assert.equal((event.ecommerce as { value: number }).value, Number.MAX_SAFE_INTEGER);
});

test("T1 begin_checkout fails closed when one line's price times quantity leaves the safe domain", () => {
  assert.throws(
    () =>
      buildBeginCheckoutEvent({
        items: [
          buildVariantItem({
            ...variantItem,
            unitPriceVnd: Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1,
            quantity: 2,
          }),
        ],
      }),
    /safe integer VND domain/,
    "safe operands do not imply a safe product",
  );
});

test("T1 begin_checkout fails closed when the accumulated total leaves the safe domain", () => {
  assert.throws(
    () =>
      buildBeginCheckoutEvent({
        items: [
          buildVariantItem({ ...variantItem, variantExternalId: "v-1", unitPriceVnd: Number.MAX_SAFE_INTEGER, quantity: 1 }),
          buildVariantItem({ ...variantItem, variantExternalId: "v-2", unitPriceVnd: 1, quantity: 1 }),
        ],
      }),
    /safe integer VND domain/,
    "safe lines do not imply a safe sum",
  );
});

test("T1 an item that never passed a builder is still validated at the event boundary", () => {
  // The event builders accept a CommerceItem, so a caller mapping straight from a repository row
  // reaches them without going through buildVariantItem. A negative price must not become a
  // negative conversion value at a destination.
  for (const bad of [
    { item_id: "v", item_name: "n", price: -100, quantity: 1 },
    { item_id: "v", item_name: "n", price: 1.5, quantity: 1 },
    { item_id: "v", item_name: "n", price: Number.NaN, quantity: 1 },
    { item_id: "v", item_name: "n", price: 100, quantity: 0 },
    { item_id: "v", item_name: "n", price: 100, quantity: Number.POSITIVE_INFINITY },
    { item_id: "   ", item_name: "n", price: 100, quantity: 1 },
    { item_id: "v", item_name: "   ", price: 100, quantity: 1 },
  ]) {
    assert.throws(
      () => buildBeginCheckoutEvent({ items: [bad] }),
      RangeError,
      `${JSON.stringify(bad)} must be rejected at the event boundary`,
    );
    assert.throws(
      () => buildCommerceItemsEvent("add_to_cart", { items: [bad] }),
      RangeError,
      `${JSON.stringify(bad)} must be rejected for add_to_cart too`,
    );
  }
});

test("T1 upper-funnel items are validated at the boundary as well", () => {
  assert.throws(
    () => buildCommerceItemsEvent("view_item_list", { items: [{ item_id: "p", item_name: "n", price: -5 }] }),
    /item price/,
  );
  assert.throws(
    () => buildCommerceItemsEvent("select_item", { items: [{ item_id: "", item_name: "n" }] }),
    /item identity/,
  );
});

test("T1 a published event cannot be widened after it was validated", () => {
  const event = buildPurchaseEvent({
    publicCode: "LA-2026-0001",
    merchandiseValueVnd: 1_780_000,
    shippingVnd: 0,
    totalVnd: 1_780_000,
    items: [buildVariantItem(variantItem)],
  });

  // The no-PII property has to hold at publish time, not only at construction time.
  assert.throws(() => {
    (event.ecommerce.items[0] as Record<string, unknown>).guestPhone = "0900000000";
  }, TypeError);
  assert.throws(() => {
    (event.ecommerce.items as unknown[]).push({ guestName: "Nguyen Van A" });
  }, TypeError);
  assert.throws(() => {
    (event.ecommerce as Record<string, unknown>).value = 999_999;
  }, TypeError);

  assert.equal(JSON.stringify(event).includes("0900000000"), false);
});

test("T1 the caller's own array is never aliased into a published event", () => {
  const items = [buildVariantItem(variantItem)];
  const event = buildViewCartEvent({ items });

  items.push(buildVariantItem({ ...variantItem, variantExternalId: "pancake-variation-2" }));

  assert.equal((event.ecommerce as { items: readonly unknown[] }).items.length, 1);
});