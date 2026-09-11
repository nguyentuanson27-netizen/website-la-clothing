import assert from "node:assert/strict";
import test from "node:test";

import { resolveStorefrontDiscountPresentation } from "../../src/commerce/storefront-discount-presentation.ts";

test("storefront sale presentation keeps base price, current price, and percent on one variant", () => {
  const presentation = resolveStorefrontDiscountPresentation([
    {
      id: "variant-90",
      price: 90_000,
      basePriceVnd: 100_000,
      isDiscounted: true,
    },
    {
      id: "variant-100",
      price: 100_000,
      basePriceVnd: 200_000,
      isDiscounted: true,
    },
  ]);

  assert.deepEqual(presentation, {
    representativeVariantId: "variant-90",
    basePriceVnd: 100_000,
    effectivePriceVnd: 90_000,
    discountPercent: 10,
    hasCheaperCurrentVariant: false,
  });
});

test("storefront sale presentation marks a cheaper current variant without mixing its price into the sale", () => {
  const presentation = resolveStorefrontDiscountPresentation([
    {
      id: "regular-80",
      price: 80_000,
      basePriceVnd: null,
      isDiscounted: false,
    },
    {
      id: "sale-90",
      price: 90_000,
      basePriceVnd: 100_000,
      isDiscounted: true,
    },
  ]);

  assert.deepEqual(presentation, {
    representativeVariantId: "sale-90",
    basePriceVnd: 100_000,
    effectivePriceVnd: 90_000,
    discountPercent: 10,
    hasCheaperCurrentVariant: true,
  });
});

test("storefront sale presentation ignores unavailable or incoherent discount metadata", () => {
  assert.equal(
    resolveStorefrontDiscountPresentation([
      { id: "regular", price: 100_000, basePriceVnd: null, isDiscounted: false },
      { id: "invalid", price: 100_000, basePriceVnd: 90_000, isDiscounted: true },
    ]),
    null,
  );
});
