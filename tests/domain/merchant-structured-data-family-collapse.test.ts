import assert from "node:assert/strict";
import test from "node:test";

import {
  mapMerchantOffers,
  type MerchantCandidateProduct,
  type MerchantCandidateVariation,
} from "../../src/commerce/merchant-offer-mapper.ts";
import type { StorefrontVariantFacts } from "../../src/commerce/storefront-product.ts";
import { buildStorefrontProductProjection } from "../../src/commerce/storefront-projection.ts";
import { buildPromotionalStorefrontPricing } from "../../src/commerce/storefront-promotion-projection.ts";
import { buildStorefrontProductStructuredData } from "../../src/seo/storefront-product-structured-data.ts";

const ORIGIN = "https://shop.example.test";
const NOW = new Date("2026-09-07T09:00:00.000Z");

const SURVIVOR = Object.freeze({
  variantId: "cuid-black-m",
  pancakeVariationId: "pv-black-m",
  pancakeDisplayId: "LA-OXF-BLK-M",
  color: "Đen",
  size: "M",
  sellableStock: 7,
  priceVnd: 890_000,
});

const EXCLUDED = Object.freeze({
  variantId: "cuid-black-l",
  pancakeVariationId: "pv-black-l",
  pancakeDisplayId: "LA-OXF-BLK-L",
  color: "Đen",
  size: "L",
  // Shopper projection can still reduce the malformed rows arithmetically to 3,
  // while Merchant/U27 machine-readable availability must refuse the exact claim.
  sellableStock: 3,
  priceVnd: 890_000,
});

function buildProjection() {
  const parentVariants: StorefrontVariantFacts[] = [SURVIVOR, EXCLUDED].map((row) => ({
    id: row.variantId,
    pancakeVariationId: row.pancakeVariationId,
    color: row.color,
    size: row.size,
    sellableStock: row.sellableStock,
    retailPrice: row.priceVnd,
    retailPriceAfterDiscount: null,
  }));

  return buildStorefrontProductProjection({
    parentVariants,
    componentGroups: [],
    hasCompositeGraph: false,
    pricingRule: buildPromotionalStorefrontPricing({
      campaignsByVariantId: new Map(),
      now: NOW,
    }),
  });
}

test("U27 family collapse keeps Merchant exact survivor and emits the same survivor as standalone Product", () => {
  const projection = buildProjection();
  const gallery = [
    { url: "https://cdn.example.test/oxford-black-m.jpg", alt: "Áo Oxford Relaxed M" },
    { url: "https://cdn.example.test/oxford-black-l.jpg", alt: "Áo Oxford Relaxed L" },
  ] as const;

  const variations: MerchantCandidateVariation[] = [
    {
      variantId: SURVIVOR.variantId,
      pancakeVariationId: SURVIVOR.pancakeVariationId,
      pancakeDisplayId: SURVIVOR.pancakeDisplayId,
      isComposite: false,
      stockQuantity: SURVIVOR.sellableStock,
    },
    {
      variantId: EXCLUDED.variantId,
      pancakeVariationId: EXCLUDED.pancakeVariationId,
      pancakeDisplayId: EXCLUDED.pancakeDisplayId,
      isComposite: false,
      stockQuantity: Number.NaN,
    },
  ];

  const merchantProduct: MerchantCandidateProduct = {
    pancakeProductId: "pancake-product-1",
    slug: "ao-oxford-relaxed",
    name: "Áo Oxford Relaxed",
    publishedDescription: "Áo sơ mi cotton dáng suông.",
    media: {
      primary: gallery[0],
      gallery,
    } as MerchantCandidateProduct["media"],
    galleryIndexByVariantId: new Map([
      [SURVIVOR.variantId, 0],
      [EXCLUDED.variantId, 1],
    ]),
    projection,
    apparelOverrides: {
      gender: "male",
      ageGroup: "adult",
      condition: "new",
    },
    variations,
  };

  const merchant = mapMerchantOffers({
    products: [merchantProduct],
    origin: ORIGIN,
  });

  assert.equal(merchant.offers.length, 1, "Merchant must keep the one valid survivor");
  const offer = merchant.offers[0]!;
  assert.equal(offer.id, SURVIVOR.pancakeVariationId);
  assert.equal(offer.itemGroupId, "pancake-product-1");
  assert.equal(offer.mpn, SURVIVOR.pancakeDisplayId);
  assert.equal(offer.link, `${ORIGIN}/shop/ao-oxford-relaxed?variant=${SURVIVOR.pancakeVariationId}`);
  assert.equal(offer.priceVnd, SURVIVOR.priceVnd);
  assert.equal(offer.availability, "in_stock");
  assert.deepEqual(
    merchant.excluded.find((candidate) => candidate.pancakeVariationId === EXCLUDED.pancakeVariationId)?.reasons,
    ["AVAILABILITY_UNRESOLVED"],
  );

  const document = buildStorefrontProductStructuredData({
    origin: ORIGIN,
    product: {
      pancakeProductId: "pancake-product-1",
      slug: "ao-oxford-relaxed",
      name: "Áo Oxford Relaxed",
      editorialDescription: "Áo sơ mi cotton dáng suông.",
      media: { gallery },
      galleryIndexByVariantId: {
        [SURVIVOR.variantId]: 0,
        [EXCLUDED.variantId]: 1,
      },
      variantMpnById: {
        [SURVIVOR.variantId]: SURVIVOR.pancakeDisplayId,
        [EXCLUDED.variantId]: EXCLUDED.pancakeDisplayId,
      },
      variantSkuById: {
        [SURVIVOR.variantId]: "SKU-OXF-BLK-M",
        [EXCLUDED.variantId]: "SKU-OXF-BLK-L",
      },
      variantAvailabilityResolvedById: {
        [SURVIVOR.variantId]: true,
        [EXCLUDED.variantId]: false,
      },
      projection,
    },
  });

  const productNode = document["@graph"][0] as Record<string, unknown>;
  assert.equal(productNode["@type"], "Product", "one survivor must not become a one-member ProductGroup");
  assert.equal("hasVariant" in productNode, false);
  assert.equal("productGroupID" in productNode, false);
  assert.equal("variesBy" in productNode, false);

  assert.equal(productNode.url, offer.link, "standalone Product must use the exact U12 survivor URL");
  assert.equal(productNode.mpn, offer.mpn, "standalone Product must publish the same manufacturer MPN");
  assert.equal(productNode.sku, "SKU-OXF-BLK-M");
  assert.equal(productNode.color, offer.color);
  assert.equal(productNode.size, offer.size);
  assert.deepEqual(productNode.image, [gallery[0].url]);

  const productOffer = productNode.offers as Record<string, unknown>;
  assert.equal(productOffer.url, offer.link, "Offer.url must remain the exact survivor URL");
  assert.equal(productOffer.priceCurrency, "VND");
  assert.equal(productOffer.price, offer.priceVnd);
  assert.equal(productOffer.availability, "https://schema.org/InStock");
});

test("U27 collapses to Merchant's exact survivor when a sibling lacks a required apparel dimension", () => {
  const invalidSibling = {
    ...EXCLUDED,
    size: null,
  } as const;
  const parentVariants: StorefrontVariantFacts[] = [SURVIVOR, invalidSibling].map((row) => ({
    id: row.variantId,
    pancakeVariationId: row.pancakeVariationId,
    color: row.color,
    size: row.size,
    sellableStock: row.sellableStock,
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
    { url: "https://cdn.example.test/oxford-black-l.jpg", alt: "Áo Oxford Relaxed sibling" },
  ] as const;

  const merchantProduct: MerchantCandidateProduct = {
    pancakeProductId: "pancake-product-1",
    slug: "ao-oxford-relaxed",
    name: "Áo Oxford Relaxed",
    publishedDescription: "Áo sơ mi cotton dáng suông.",
    media: { primary: gallery[0], gallery } as MerchantCandidateProduct["media"],
    galleryIndexByVariantId: new Map([
      [SURVIVOR.variantId, 0],
      [invalidSibling.variantId, 1],
    ]),
    projection,
    apparelOverrides: { gender: "male", ageGroup: "adult", condition: "new" },
    variations: [SURVIVOR, invalidSibling].map((row) => ({
      variantId: row.variantId,
      pancakeVariationId: row.pancakeVariationId,
      pancakeDisplayId: row.pancakeDisplayId,
      isComposite: false,
      stockQuantity: row.sellableStock,
    })),
  };
  const merchant = mapMerchantOffers({ products: [merchantProduct], origin: ORIGIN });

  assert.deepEqual(merchant.offers.map((offer) => offer.id), [SURVIVOR.pancakeVariationId]);
  assert.deepEqual(
    merchant.excluded.find((candidate) => candidate.pancakeVariationId === invalidSibling.pancakeVariationId)?.reasons,
    ["OPTION_NOT_ADDRESSABLE"],
  );

  const document = buildStorefrontProductStructuredData({
    origin: ORIGIN,
    product: {
      pancakeProductId: "pancake-product-1",
      slug: "ao-oxford-relaxed",
      name: "Áo Oxford Relaxed",
      editorialDescription: "Áo sơ mi cotton dáng suông.",
      media: { gallery },
      galleryIndexByVariantId: {
        [SURVIVOR.variantId]: 0,
        [invalidSibling.variantId]: 1,
      },
      variantMpnById: {
        [SURVIVOR.variantId]: SURVIVOR.pancakeDisplayId,
        [invalidSibling.variantId]: invalidSibling.pancakeDisplayId,
      },
      variantSkuById: {},
      variantAvailabilityResolvedById: {
        [SURVIVOR.variantId]: true,
        [invalidSibling.variantId]: true,
      },
      projection,
    },
  });

  const productNode = document["@graph"][0] as Record<string, unknown>;
  const merchantSurvivor = merchant.offers[0]!;
  assert.equal(productNode["@type"], "Product");
  assert.equal("hasVariant" in productNode, false, "a Merchant one-survivor family must not stay grouped");
  assert.equal(productNode.url, merchantSurvivor.link);
  assert.equal(productNode.mpn, merchantSurvivor.mpn);
  assert.equal(productNode.color, merchantSurvivor.color);
  assert.equal(productNode.size, merchantSurvivor.size);

  const productOffer = productNode.offers as Record<string, unknown>;
  assert.equal(productOffer.url, merchantSurvivor.link);
  assert.equal(productOffer.price, merchantSurvivor.priceVnd);
  assert.equal(productOffer.availability, "https://schema.org/InStock");
});
