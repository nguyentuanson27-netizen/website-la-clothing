import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPurchaseEvent,
  buildVariantItem,
} from "../../src/tracking/commerce-events.ts";

test("T1 Purchase rejects merchandise value that disagrees with the canonical item sum", () => {
  const item = buildVariantItem({
    variantExternalId: "pancake-variation-1",
    productExternalId: "pancake-product-1",
    itemName: "Áo Oxford Relaxed",
    unitPriceVnd: 890_000,
    quantity: 2,
  });

  assert.throws(
    () =>
      buildPurchaseEvent({
        publicCode: "LA-2026-0001",
        merchandiseValueVnd: 890_000,
        shippingVnd: 30_000,
        totalVnd: 1_810_000,
        items: [item],
      }),
    /merchandise value.*item sum/i,
  );
});
