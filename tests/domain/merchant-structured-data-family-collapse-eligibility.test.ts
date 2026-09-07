import assert from "node:assert/strict";
import test from "node:test";

import {
  mapMerchantOffers,
  type MerchantCandidateProduct,
  type MerchantExclusionReason,
} from "../../src/commerce/merchant-offer-mapper.ts";
import type { StorefrontVariantFacts } from "../../src/commerce/storefront-product.ts";
import { buildStorefrontProductProjection } from "../../src/commerce/storefront-projection.ts";
import { buildPromotionalStorefrontPricing } from "../../src/commerce/storefront-promotion-projection.ts";
import { buildStorefrontProductStructuredData } from "../../src/seo/storefront-product-structured-data.ts";

const ORIGIN = "https://shop.example.test";
const NOW = new Date("2026-09-07T09:00:00.000Z");
const PRODUCT_ID = "pancake-product-1";

type VariantFixture = Readonly<{
  variantId: string;
  pancakeVariationId: string;
  pancakeDisplayId: string;
  color: string | null;
  size: string | null;
  stockQuantity: number;
  priceVnd: number | null;
}>;

const SURVIVOR: VariantFixture = Object.freeze({
  variantId: "cuid-black-m",
  pancakeVariationId: "pv-black-m",
  pancakeDisplayId: "LA-OXF-BLK-M",
  color: "Đen",
  size: "M",
  stockQuantity: 7,
  priceVnd: 890_000,
});

type CaseResult = Readonly<{
  merchantOfferIds: readonly string[];
  siblingReasons: readonly MerchantExclusionReason[] | undefined;
  productNode: Record<string, unknown>;
}>;

function runCase(
  siblingOverrides: Partial<VariantFixture>,
  productId = PRODUCT_ID,
): CaseResult {
  const sibling: VariantFixture = {
    variantId: "cuid-black-l",
    pancakeVariationId: "pv-black-l",
    pancakeDisplayId: "LA-OXF-BLK-L",
    color: "Đen",
    size: "L",
    stockQuantity: 5,
    priceVnd: 890_000,
    ...siblingOverrides,
  };
  const rows = [SURVIVOR, sibling] as const;

  const parentVariants: StorefrontVariantFacts[] = rows.map((row) => ({
    id: row.variantId,
    pancakeVariationId: row.pancakeVariationId,
    color: row.color,
    size: row.size,
    sellableStock: row.stockQuantity,
    retailPrice: row.priceVnd,
    retailPriceAfterDiscount: null,
  }));
  const projection = buildStorefrontProductProjection({
    parentVariants,
    componentGroups: [],
    hasCompositeGraph: false,
    pricingRule: buildPromotionalStorefrontPricing({ campaignsByVariantId: new Map(), now: NOW }),
  });

  const gallery = [
    { url: "https://cdn.example.test/oxford-black-m.jpg", alt: "Áo Oxford Relaxed M" },
    { url: "https://cdn.example.test/oxford-black-l.jpg", alt: "Áo Oxford Relaxed L" },
  ] as const;

  const merchantProduct: MerchantCandidateProduct = {
    pancakeProductId: productId,
    slug: "ao-oxford-relaxed",
    name: "Áo Oxford Relaxed",
    publishedDescription: "Áo sơ mi cotton dáng suông.",
    media: { primary: gallery[0], gallery } as MerchantCandidateProduct["media"],
    galleryIndexByVariantId: new Map(rows.map((row, index) => [row.variantId, index])),
    projection,
    apparelOverrides: { gender: "male", ageGroup: "adult", condition: "new" },
    variations: rows.map((row) => ({
      variantId: row.variantId,
      pancakeVariationId: row.pancakeVariationId,
      pancakeDisplayId: row.pancakeDisplayId,
      isComposite: false,
      stockQuantity: row.stockQuantity,
    })),
  };
  const merchant = mapMerchantOffers({ products: [merchantProduct], origin: ORIGIN });

  const document = buildStorefrontProductStructuredData({
    origin: ORIGIN,
    product: {
      pancakeProductId: productId,
      slug: "ao-oxford-relaxed",
      name: "Áo Oxford Relaxed",
      editorialDescription: "Áo sơ mi cotton dáng suông.",
      media: { gallery },
      galleryIndexByVariantId: Object.fromEntries(rows.map((row, index) => [row.variantId, index])),
      variantMpnById: Object.fromEntries(rows.map((row) => [row.variantId, row.pancakeDisplayId])),
      variantSkuById: {},
      variantAvailabilityResolvedById: Object.fromEntries(rows.map((row) => [row.variantId, true])),
      projection,
    },
  });

  return {
    merchantOfferIds: merchant.offers.map((offer) => offer.id),
    siblingReasons: merchant.excluded.find(
      (candidate) => candidate.pancakeVariationId === sibling.pancakeVariationId,
    )?.reasons,
    productNode: document["@graph"][0] as Record<string, unknown>,
  };
}

for (const [label, siblingOverrides, expectedReason] of [
  ["missing size", { size: null }, "SIZE_UNRESOLVED"],
  ["zero price", { priceVnd: 0 }, "PRICE_UNRESOLVED"],
  [
    "overlong Merchant offer id",
    { pancakeVariationId: "v".repeat(51) },
    "OFFER_ID_UNRESOLVED",
  ],
] as const) {
  test(`U27 uses Merchant eligibility before family collapse for ${label}`, () => {
    const { merchantOfferIds, siblingReasons, productNode } = runCase(siblingOverrides);

    assert.deepEqual(merchantOfferIds, [SURVIVOR.pancakeVariationId]);
    assert.deepEqual(siblingReasons, [expectedReason]);
    assert.equal(productNode["@type"], "Product");
    assert.equal("hasVariant" in productNode, false);
    assert.equal(
      productNode.url,
      `${ORIGIN}/shop/ao-oxford-relaxed?variant=${SURVIVOR.pancakeVariationId}`,
    );
    assert.equal(productNode.mpn, SURVIVOR.pancakeDisplayId);

    const offer = productNode.offers as Record<string, unknown>;
    assert.equal(offer.url, productNode.url);
    assert.equal(offer.price, SURVIVOR.priceVnd);
    assert.equal(offer.availability, "https://schema.org/InStock");
  });
}

test("U27 emits no exact standalone variant when Merchant rejects the product identity", () => {
  const invalidProductId = "p".repeat(51);
  const { merchantOfferIds, productNode } = runCase({}, invalidProductId);

  assert.deepEqual(merchantOfferIds, []);
  assert.equal(productNode["@type"], "Product");
  assert.equal("hasVariant" in productNode, false);
  assert.equal("mpn" in productNode, false, "generic fallback must not impersonate an exact survivor");
  assert.equal(
    new URL(String(productNode.url)).searchParams.has("variant"),
    false,
    "generic fallback URL must not become an exact variant deep-link",
  );
});
