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

test("storefront variants fail closed on required size, stock, price, and duplicate Color x Size pairs", () => {
  const options = buildStorefrontVariantOptions([
    {
      id: "available",
      pancakeVariationId: "pancake-available",
      color: "Black",
      size: "M",
      sellableStock: 3,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
    {
      id: "sold-out",
      pancakeVariationId: "pancake-sold-out",
      color: "Black",
      size: "L",
      sellableStock: 0,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
    {
      id: "unresolved-price",
      pancakeVariationId: "pancake-unresolved-price",
      color: "Stone",
      size: "M",
      sellableStock: 2,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 490_000,
    },
    {
      id: "missing-size",
      pancakeVariationId: "pancake-missing-size",
      color: "Olive",
      size: null,
      sellableStock: 2,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
    {
      id: "duplicate-a",
      pancakeVariationId: "pancake-duplicate-a",
      color: "Navy",
      size: "XL",
      sellableStock: 2,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
    {
      id: "duplicate-b",
      pancakeVariationId: "pancake-duplicate-b",
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

test("storefront variants allow size-only products when no variant has a color", () => {
  const options = buildStorefrontVariantOptions([
    {
      id: "size-only-m",
      pancakeVariationId: "pancake-size-only-m",
      color: null,
      size: "M",
      sellableStock: 2,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
    {
      id: "size-only-l",
      pancakeVariationId: "pancake-size-only-l",
      color: null,
      size: "L",
      sellableStock: 1,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
  ]);

  assert.deepEqual(
    options.map(({ id, purchasable, unavailableReason }) => ({ id, purchasable, unavailableReason })),
    [
      { id: "size-only-m", purchasable: true, unavailableReason: null },
      { id: "size-only-l", purchasable: true, unavailableReason: null },
    ],
  );
});

test("storefront variants require color consistently when the product has a color dimension", () => {
  const options = buildStorefrontVariantOptions([
    {
      id: "black-m",
      pancakeVariationId: "pancake-black-m",
      color: "Black",
      size: "M",
      sellableStock: 2,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
    {
      id: "missing-color-l",
      pancakeVariationId: "pancake-missing-color-l",
      color: null,
      size: "L",
      sellableStock: 2,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
  ]);

  assert.equal(options[0]?.purchasable, true);
  assert.equal(options[1]?.unavailableReason, "MAPPING_REQUIRED");
});

test("storefront size-only variants fail closed on duplicate sizes", () => {
  const options = buildStorefrontVariantOptions([
    {
      id: "duplicate-size-a",
      pancakeVariationId: "pancake-duplicate-size-a",
      color: null,
      size: "M",
      sellableStock: 2,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
    {
      id: "duplicate-size-b",
      pancakeVariationId: "pancake-duplicate-size-b",
      color: null,
      size: "M",
      sellableStock: 1,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
  ]);

  assert.equal(options[0]?.unavailableReason, "AMBIGUOUS_OPTION");
  assert.equal(options[1]?.unavailableReason, "AMBIGUOUS_OPTION");
});

test("storefront price range keeps resolved sold-out prices separate from purchase availability", () => {
  const options = buildStorefrontVariantOptions([
    {
      id: "sold-out-low",
      pancakeVariationId: "pancake-sold-out-low",
      color: "Black",
      size: "S",
      sellableStock: 0,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
    {
      id: "available-high",
      pancakeVariationId: "pancake-available-high",
      color: "Stone",
      size: "M",
      sellableStock: 2,
      retailPrice: 620_000,
      retailPriceAfterDiscount: 620_000,
    },
    {
      id: "unresolved",
      pancakeVariationId: "pancake-unresolved",
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
