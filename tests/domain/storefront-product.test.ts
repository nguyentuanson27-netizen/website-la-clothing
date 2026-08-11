import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStorefrontVariantOptions,
  getStorefrontResolvedPriceRange,
  resolveStorefrontPrice,
} from "../../src/commerce/storefront-product.ts";

test("storefront price resolves only when mirrored raw price fields agree", () => {
  assert.equal(
    resolveStorefrontPrice({ retailPrice: 590_000, retailPriceAfterDiscount: 590_000 }),
    590_000,
  );
  assert.equal(
    resolveStorefrontPrice({ retailPrice: 590_000, retailPriceAfterDiscount: 490_000 }),
    null,
  );
  assert.equal(
    resolveStorefrontPrice({ retailPrice: 590_000, retailPriceAfterDiscount: null }),
    null,
  );
  assert.equal(
    resolveStorefrontPrice({ retailPrice: Number.NaN, retailPriceAfterDiscount: Number.NaN }),
    null,
  );
});

test("storefront variants fail closed on mapping, stock, price, and duplicate Color x Size pairs", () => {
  const options = buildStorefrontVariantOptions([
    {
      id: "available",
      color: "Black",
      size: "M",
      sellableStock: 3,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
    {
      id: "sold-out",
      color: "Black",
      size: "L",
      sellableStock: 0,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
    {
      id: "unresolved-price",
      color: "Stone",
      size: "M",
      sellableStock: 2,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 490_000,
    },
    {
      id: "missing-size",
      color: "Olive",
      size: null,
      sellableStock: 2,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
    {
      id: "duplicate-a",
      color: "Navy",
      size: "XL",
      sellableStock: 2,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
    {
      id: "duplicate-b",
      color: "Navy",
      size: "XL",
      sellableStock: 1,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
  ]);

  const byId = new Map(options.map((option) => [option.id, option]));
  assert.equal(byId.get("available")?.purchasable, true);
  assert.equal(byId.get("available")?.unavailableReason, null);
  assert.equal(byId.get("sold-out")?.unavailableReason, "OUT_OF_STOCK");
  assert.equal(byId.get("unresolved-price")?.unavailableReason, "PRICE_UNRESOLVED");
  assert.equal(byId.get("missing-size")?.unavailableReason, "MAPPING_REQUIRED");
  assert.equal(byId.get("duplicate-a")?.unavailableReason, "AMBIGUOUS_OPTION");
  assert.equal(byId.get("duplicate-b")?.unavailableReason, "AMBIGUOUS_OPTION");
});

test("storefront price range keeps resolved sold-out prices separate from purchase availability", () => {
  const options = buildStorefrontVariantOptions([
    {
      id: "sold-out-low",
      color: "Black",
      size: "S",
      sellableStock: 0,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
    {
      id: "available-high",
      color: "Stone",
      size: "M",
      sellableStock: 2,
      retailPrice: 620_000,
      retailPriceAfterDiscount: 620_000,
    },
    {
      id: "unresolved",
      color: "Olive",
      size: "L",
      sellableStock: 2,
      retailPrice: 650_000,
      retailPriceAfterDiscount: 600_000,
    },
  ]);

  assert.deepEqual(getStorefrontResolvedPriceRange(options), {
    minimum: 590_000,
    maximum: 620_000,
  });
  assert.equal(options.some((option) => option.purchasable), true);
});
