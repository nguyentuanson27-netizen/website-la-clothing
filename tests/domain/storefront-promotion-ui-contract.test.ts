import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resolveStorefrontDiscountPresentation } from "../../src/commerce/storefront-discount-presentation.ts";
import {
  buildStorefrontProductProjection,
  deriveStorefrontProjectionSelection,
  selectStorefrontProductLevelOptions,
} from "../../src/commerce/storefront-projection.ts";
import type {
  StorefrontPricingRule,
  StorefrontVariantFacts,
} from "../../src/commerce/storefront-product.ts";

function variant(id: string, size: string): StorefrontVariantFacts {
  return {
    id,
    pancakeVariationId: `pancake-${id}`,
    color: null,
    size,
    sellableStock: 2,
    retailPrice: 200_000,
    retailPriceAfterDiscount: 200_000,
  };
}

test("selected PDP variant keeps its own base price, effective price, and discount state", () => {
  const pricingRule: StorefrontPricingRule = (candidate) =>
    candidate.id === "variant-m"
      ? { price: 90_000, basePriceVnd: 100_000, isDiscounted: true }
      : { price: 100_000, basePriceVnd: 200_000, isDiscounted: true };

  const projection = buildStorefrontProductProjection({
    parentVariants: [variant("variant-m", "M"), variant("variant-l", "L")],
    componentGroups: [],
    hasCompositeGraph: false,
    pricingRule,
  });

  const medium = deriveStorefrontProjectionSelection(projection.options, {
    kindKey: null,
    color: null,
    size: "M",
  });
  assert.deepEqual(
    {
      variantId: medium.selectedVariantId,
      basePriceVnd: medium.selectedBasePriceVnd,
      price: medium.selectedPrice,
      isDiscounted: medium.selectedIsDiscounted,
    },
    {
      variantId: "variant-m",
      basePriceVnd: 100_000,
      price: 90_000,
      isDiscounted: true,
    },
  );

  const large = deriveStorefrontProjectionSelection(projection.options, {
    kindKey: null,
    color: null,
    size: "L",
  });
  assert.deepEqual(
    {
      variantId: large.selectedVariantId,
      basePriceVnd: large.selectedBasePriceVnd,
      price: large.selectedPrice,
      isDiscounted: large.selectedIsDiscounted,
    },
    {
      variantId: "variant-l",
      basePriceVnd: 200_000,
      price: 100_000,
      isDiscounted: true,
    },
  );
});

test("unselected composite PDP sale presentation is owned by the parent set, not a component", () => {
  const pricingRule: StorefrontPricingRule = (candidate) =>
    candidate.id === "set-m"
      ? { price: 180_000, basePriceVnd: 200_000, isDiscounted: true }
      : { price: 50_000, basePriceVnd: 100_000, isDiscounted: true };

  const projection = buildStorefrontProductProjection({
    parentVariants: [variant("set-m", "M")],
    componentGroups: [{ label: "Áo", variants: [variant("shirt-m", "M")] }],
    hasCompositeGraph: true,
    pricingRule,
  });

  assert.deepEqual(
    resolveStorefrontDiscountPresentation(selectStorefrontProductLevelOptions(projection)),
    {
      representativeVariantId: "set-m",
      basePriceVnd: 200_000,
      effectivePriceVnd: 180_000,
      discountPercent: 10,
      hasCheaperCurrentVariant: false,
    },
  );
});

test("PDP wires product-level options into its unselected price presentation", async () => {
  const pageSource = await readFile(
    new URL("../../src/app/shop/[slug]/page.tsx", import.meta.url),
    "utf8",
  );
  const panelSource = await readFile(
    new URL("../../src/components/commerce/product-purchase-panel.tsx", import.meta.url),
    "utf8",
  );

  assert.match(pageSource, /selectStorefrontProductLevelOptions/);
  assert.match(pageSource, /productLevelOptions=\{productLevelOptions\}/);
  assert.match(
    panelSource,
    /resolveStorefrontDiscountPresentation\(productLevelOptions\)/,
  );
});

test("every promotion-aware storefront surface mounts the shared server-relative refresher", async () => {
  const surfaces = [
    "../../src/app/page.tsx",
    "../../src/app/collections/[slug]/page.tsx",
    "../../src/app/lookbook/page.tsx",
    "../../src/app/shop/[slug]/page.tsx",
  ] as const;

  for (const path of surfaces) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /StorefrontPromotionRefresher/, `${path} must mount the shared refresher`);
    assert.match(source, /refreshAfterMs/, `${path} must use a server-relative refresh duration`);
  }
});
