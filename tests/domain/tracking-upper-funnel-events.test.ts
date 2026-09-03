import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductListViewEvent,
  buildProductSelectEvent,
  buildProductViewEvent,
  buildVariantViewEvent,
} from "../../src/tracking/upper-funnel-events.ts";

const impression = {
  productExternalId: "pancake-product-1",
  itemName: "Linen Shirt",
  exactPriceVnd: 490_000,
};

test("T5 view_item_list carries one item per card with its list context", () => {
  const event = buildProductListViewEvent({
    impressions: [
      { ...impression, index: 0, listId: "shop", listName: "Cửa hàng" },
      {
        productExternalId: "pancake-product-2",
        itemName: "Wool Coat",
        minimumPriceVnd: 900_000,
        maximumPriceVnd: 1_200_000,
        index: 1,
        listId: "shop",
        listName: "Cửa hàng",
      },
    ],
    list: { listId: "shop", listName: "Cửa hàng" },
  });

  assert.equal(event?.event, "view_item_list");
  const ecommerce = event?.ecommerce as { items: Array<Record<string, unknown>> };
  assert.deepEqual(ecommerce.items.map((item) => item.item_id), [
    "pancake-product-1",
    "pancake-product-2",
  ]);
  assert.equal(ecommerce.items[0]?.price, 490_000);
  // A range never becomes a vendor price.
  assert.equal(ecommerce.items[1]?.price, undefined);
  assert.deepEqual(
    { minimum: ecommerce.items[1]?.la_minimum_price_vnd, maximum: ecommerce.items[1]?.la_maximum_price_vnd },
    { minimum: 900_000, maximum: 1_200_000 },
  );
});

test("T5 an empty or unusable list produces no event rather than an empty one", () => {
  assert.equal(buildProductListViewEvent({ impressions: [] }), null);
  assert.equal(
    buildProductListViewEvent({
      impressions: [{ productExternalId: "", itemName: "Linen Shirt" }],
    }),
    null,
  );
  assert.equal(
    buildProductListViewEvent({
      impressions: [
        {
          productExternalId: "pancake-product-1",
          itemName: "Linen Shirt",
          minimumPriceVnd: 900_000,
          maximumPriceVnd: 100_000,
        },
      ],
    }),
    null,
    "an inverted range fails closed instead of being silently reordered",
  );
});

test("T5 select_item describes the clicked product card at product identity", () => {
  const event = buildProductSelectEvent({
    impression,
    list: { listId: "shop", listName: "Cửa hàng" },
  });

  assert.equal(event?.event, "select_item");
  const ecommerce = event?.ecommerce as { items: Array<Record<string, unknown>>; item_list_id: string };
  assert.equal(ecommerce.items.length, 1);
  assert.equal(ecommerce.items[0]?.item_id, "pancake-product-1");
  assert.equal(ecommerce.item_list_id, "shop");
  assert.equal(ecommerce.items[0]?.quantity, undefined, "a click is not a committed quantity");
});

test("T5 an unselected product page reports view_item at product identity", () => {
  const event = buildProductViewEvent(impression);
  const ecommerce = event?.ecommerce as { items: Array<Record<string, unknown>> };

  assert.equal(event?.event, "view_item");
  assert.equal(ecommerce.items[0]?.item_id, "pancake-product-1");
  assert.equal(ecommerce.items[0]?.quantity, undefined);
});

test("T5 a route-preselected variation reports view_item at variation identity", () => {
  const event = buildVariantViewEvent({
    variantExternalId: "pancake-variation-1",
    productExternalId: "pancake-product-1",
    itemName: "Linen Shirt",
    unitPriceVnd: 450_000,
    quantity: 1,
    color: "Navy",
    size: "M",
  });
  const ecommerce = event?.ecommerce as { items: Array<Record<string, unknown>> };

  assert.equal(event?.event, "view_item");
  assert.equal(ecommerce.items[0]?.item_id, "pancake-variation-1");
  assert.equal(ecommerce.items[0]?.item_group_id, "pancake-product-1");
  assert.equal(ecommerce.items[0]?.price, 450_000);
  assert.equal(ecommerce.items[0]?.item_variant, "Navy / M");
});

test("T5 an unusable variation view fails closed rather than reporting a fabricated item", () => {
  assert.equal(
    buildVariantViewEvent({
      variantExternalId: "",
      itemName: "Linen Shirt",
      unitPriceVnd: 450_000,
      quantity: 1,
    }),
    null,
  );
  assert.equal(
    buildVariantViewEvent({
      variantExternalId: "pancake-variation-1",
      itemName: "Linen Shirt",
      unitPriceVnd: 450_000.5,
      quantity: 1,
    }),
    null,
  );
});
