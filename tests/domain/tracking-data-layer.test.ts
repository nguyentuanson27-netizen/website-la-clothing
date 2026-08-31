import assert from "node:assert/strict";
import test from "node:test";

import { buildCommerceItemsEvent, buildVariantItem } from "../../src/tracking/commerce-events.ts";
import {
  DATA_LAYER_NAME,
  ensureDataLayer,
  publishTrackingEvent,
} from "../../src/tracking/data-layer.ts";

type TestWindow = { dataLayer?: unknown };

const variantItem = {
  variantExternalId: "pancake-variation-1",
  itemName: "Áo Oxford Relaxed",
  unitPriceVnd: 890_000,
  quantity: 1,
} as const;

function addToCartEvent() {
  return buildCommerceItemsEvent("add_to_cart", { items: [buildVariantItem(variantItem)] });
}

test("T1 the publisher targets the canonical dataLayer name", () => {
  assert.equal(DATA_LAYER_NAME, "dataLayer");
});

test("T1 the publisher initializes a missing dataLayer without replacing an initialized one", () => {
  const win: TestWindow = {};
  const created = ensureDataLayer(win);
  assert.ok(Array.isArray(created));

  const existing = [{ event: "gtm.js" }];
  const withExisting: TestWindow = { dataLayer: existing };
  assert.equal(ensureDataLayer(withExisting), existing);
  assert.equal(withExisting.dataLayer, existing);
});

test("T1 the publisher fails closed rather than overwriting a hostile dataLayer value", () => {
  for (const hostile of [{}, "dataLayer", 7, null]) {
    const win: TestWindow = { dataLayer: hostile };
    assert.equal(ensureDataLayer(win), null, `${JSON.stringify(hostile)} must fail closed`);
    assert.equal(win.dataLayer, hostile, "an existing value must never be replaced");
  }
});

test("T1 every commerce push resets the previous ecommerce object first", () => {
  const win: TestWindow = {};
  assert.equal(publishTrackingEvent(win, addToCartEvent()), true);

  assert.deepEqual(win.dataLayer, [
    { ecommerce: null },
    {
      event: "add_to_cart",
      ecommerce: {
        items: [
          {
            item_id: "pancake-variation-1",
            item_name: "Áo Oxford Relaxed",
            price: 890_000,
            quantity: 1,
          },
        ],
      },
    },
  ]);
});

test("T1 sequential events stay isolated so stale ecommerce keys cannot bleed into the next event", () => {
  const win: TestWindow = {};
  publishTrackingEvent(win, buildCommerceItemsEvent("view_cart", { items: [buildVariantItem(variantItem)] }));
  publishTrackingEvent(win, { event: "page_view", page_path: "/cart" });

  const pushed = win.dataLayer as Array<Record<string, unknown>>;
  assert.deepEqual(pushed.map((entry) => entry.event ?? "reset"), [
    "reset",
    "view_cart",
    "reset",
    "page_view",
  ]);
  assert.equal(pushed[2]?.ecommerce, null);
  assert.equal("ecommerce" in (pushed[3] ?? {}), false);
});

test("T1 tracking is a no-op when the browser is unavailable", () => {
  assert.equal(publishTrackingEvent(undefined, addToCartEvent()), false);
  assert.equal(ensureDataLayer(undefined), null);
});

test("T1 a malformed event or a throwing dataLayer never throws into commerce", () => {
  const throwing: TestWindow = {
    dataLayer: Object.assign([], {
      push() {
        throw new Error("blocked by an extension");
      },
    }),
  };
  assert.equal(publishTrackingEvent(throwing, addToCartEvent()), false);

  const win: TestWindow = {};
  for (const malformed of [null, undefined, 7, "add_to_cart", {}, { event: "" }, { event: 7 }]) {
    assert.equal(
      publishTrackingEvent(win, malformed as never),
      false,
      `${JSON.stringify(malformed)} must fail closed`,
    );
  }
  assert.equal(win.dataLayer, undefined, "a malformed event must not even initialize the dataLayer");
});
