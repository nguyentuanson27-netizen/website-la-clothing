import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStorefrontVariantOptions,
  toStorefrontSelectableOptions,
} from "../../src/commerce/storefront-product.ts";

test("storefront client options omit stock and raw integration price fields", () => {
  const [fullOption] = buildStorefrontVariantOptions([
    {
      id: "variant-1",
      color: "Black",
      size: "M",
      sellableStock: 7,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
  ]);

  assert.ok(fullOption);
  assert.deepEqual(toStorefrontSelectableOptions([fullOption]), [
    {
      id: "variant-1",
      color: "Black",
      size: "M",
      price: 590_000,
      purchasable: true,
      unavailableReason: null,
    },
  ]);
});
