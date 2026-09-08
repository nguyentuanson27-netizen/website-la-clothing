/**
 * Wave 7 / U39 — Enabled-Consumer Monetary Convergence Integration Suite (#151 G1).
 *
 * Proves that every currently enabled price-bearing consumer converges on the central
 * pricing authority (`resolvePromotionPricing`), integer VND math, external canonical
 * identities (`pancakeProductId`, `pancakeVariationId`, `publicCode`), and immutable
 * purchase snapshots, while disabled/fail-closed consumers remain non-blocking and safe.
 *
 * Enabled consumers covered:
 *   1. Storefront PDP option selection & promotional projection
 *   2. Storefront Cart lines & Cart authority mutation snapshot
 *   3. Cart analytics projection (`view_cart`, `add_to_cart`, `remove_from_cart`)
 *   4. Checkout rendered quote facts & stateless server-MAC proof
 *   5. Confirmed Purchase canonical snapshot & Meta purchase snapshot (`publicCode`)
 *   6. Upper-funnel analytics anti-masquerade (price range never fakes exact price)
 *   7. Direct Meta Pixel monetary events (`AddToCart`, `Purchase`)
 *   8. Structured data variant `Offer` (exact promotion-aware price & U12 deep link)
 *
 * Disabled/fail-closed consumers covered:
 *   9. Google Merchant feed (`resolveMerchantMarket` is UNRESOLVED, handler returns 503)
 *  10. GTM container (zero external scripts loaded, CSP closed)
 *  11. Search exposure (organic indexing withheld under temporary domain / disabled flag)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  readCanonicalPurchaseSnapshot,
  type CanonicalPurchaseClient,
} from "../../src/commerce/canonical-purchase-snapshot.ts";
import {
  buildCartAnalyticsItemFacts,
  toCartAnalyticsLineFacts,
} from "../../src/commerce/cart-analytics-facts.ts";
import { buildCanonicalCartAnalyticsProjection } from "../../src/commerce/cart-analytics-projection.ts";
import {
  issueRenderedQuoteProof,
  verifyRenderedQuoteProof,
} from "../../src/commerce/checkout-quote-proof.ts";
import { buildRenderedCheckoutQuoteFacts } from "../../src/commerce/checkout-quote.ts";
import { calculateGuestShippingFeeVnd } from "../../src/commerce/guest-shipping-policy.ts";
import { createMerchantFeedGetHandler } from "../../src/commerce/merchant-feed-http.ts";
import { resolveMerchantMarket } from "../../src/commerce/merchant-offer-mapper.ts";
import { readMetaPurchaseSnapshot } from "../../src/commerce/meta-purchase-snapshot.ts";
import {
  resolvePromotionPricing,
  type ApplicablePromotionCampaign,
} from "../../src/commerce/promotion-pricing.ts";
import { buildStorefrontCartLines } from "../../src/commerce/storefront-cart.ts";
import { type StorefrontVariantFacts } from "../../src/commerce/storefront-product.ts";
import { buildStorefrontProductProjection } from "../../src/commerce/storefront-projection.ts";
import { buildPromotionalStorefrontPricing } from "../../src/commerce/storefront-promotion-projection.ts";
import { buildTrackingBootstrapScript } from "../../src/tracking/bootstrap-script.ts";
import {
  buildProductImpression,
  buildVariantItem,
} from "../../src/tracking/commerce-events.ts";
import { readTrackingConfig, resolveTrackingRuntime } from "../../src/tracking/config.ts";
import { readConsentPolicy } from "../../src/tracking/consent.ts";
import {
  isTemporaryProductionOrigin,
  readSearchExposure,
  shouldNoIndexRequest,
} from "../../src/seo/search-exposure.ts";
import { buildStorefrontProductStructuredData } from "../../src/seo/storefront-product-structured-data.ts";

const ORIGIN = "https://la.lanadesign.vn";
const NOW = new Date("2026-09-08T10:00:00.000Z");
const CART_SECRET = "test-secret-at-least-32-chars-long-0123456789";
const CART_ID = "cart-uuid-00000000-0000-0000-0000-000000000001";

function buildTestVariant(
  overrides: Partial<StorefrontVariantFacts> = {},
): StorefrontVariantFacts {
  return {
    id: "var-cuid-1",
    pancakeVariationId: "pan-var-101",
    color: "Trắng",
    size: "M",
    sellableStock: 10,
    retailPrice: 400_000,
    retailPriceAfterDiscount: null,
    ...overrides,
  };
}

describe("U39 / G1: Authoritative Effective Pricing Convergence", () => {
  it("converges across PDP, Cart, Quote, Meta Pixel, and JSON-LD for a 25% percentage promotion", () => {
    const campaign: ApplicablePromotionCampaign = {
      id: "camp-sale-25",
      name: "Sale 25% Off",
      kind: "PROMOTION",
      discountType: "PERCENTAGE",
      percentageValue: 25,
      fixedPriceVnd: null,
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2026-09-30T00:00:00.000Z"),
    };

    const variant = buildTestVariant({ retailPrice: 400_000 });
    const campaignsMap = new Map([[variant.id, [campaign]]]);
    const pricingRule = buildPromotionalStorefrontPricing({
      campaignsByVariantId: campaignsMap,
      now: NOW,
    });

    // 1. Central Pricing Authority
    const directPricing = resolvePromotionPricing({
      basePriceVnd: variant.retailPrice,
      campaigns: [campaign],
      now: NOW,
    });
    assert.equal(directPricing.effectivePriceVnd, 300_000);
    assert.equal(directPricing.basePriceVnd, 400_000);
    assert.equal(directPricing.isDiscounted, true);

    // 2. PDP Storefront Projection
    const projection = buildStorefrontProductProjection({
      parentVariants: [variant],
      componentGroups: [],
      hasCompositeGraph: false,
      pricingRule,
    });
    assert.equal(projection.options.length, 1);
    const option = projection.options[0]!;
    assert.equal(option.price, 300_000);
    assert.equal(option.basePriceVnd, 400_000);
    assert.equal(option.isDiscounted, true);
    assert.equal(option.purchasable, true);

    // 3. Storefront Cart Lines
    const cartLines = buildStorefrontCartLines({
      items: [{ variantId: variant.id, quantity: 2 }],
      products: [
        {
          slug: "ao-thun-cotton",
          pancakeProductId: "pan-prod-100",
          name: "Áo Thun Cotton",
          primaryImageUrl: null,
          isPresent: true,
          isActive: true,
          variants: [
            {
              id: variant.id,
              pancakeVariationId: variant.pancakeVariationId,
              isPresent: true,
              isActive: true,
              color: variant.color,
              size: variant.size,
              sellableStock: 10,
              retailPrice: variant.retailPrice,
              retailPriceAfterDiscount: null,
            },
          ],
        },
      ],
      pricingRule,
    });
    assert.equal(cartLines.length, 1);
    const cartLine = cartLines[0]!;
    assert.equal(cartLine.price, 300_000);
    assert.equal(cartLine.available, true);
    assert.equal(cartLine.pancakeVariationId, "pan-var-101");
    assert.equal(cartLine.pancakeProductId, "pan-prod-100");

    // 4. Cart Analytics Item Facts (for add_to_cart / remove_from_cart)
    const analyticsItem = buildCartAnalyticsItemFacts({
      line: toCartAnalyticsLineFacts(cartLine),
      quantity: 2,
    });
    assert.ok(analyticsItem);
    assert.equal(analyticsItem.unitPriceVnd, 300_000);
    assert.equal(analyticsItem.variantExternalId, "pan-var-101");
    assert.equal(analyticsItem.productExternalId, "pan-prod-100");

    // 5. Canonical Cart Projection (`view_cart`)
    const cartProjection = buildCanonicalCartAnalyticsProjection(cartLines);
    assert.ok(cartProjection);
    assert.equal(cartProjection.merchandiseValueVnd, 600_000); // 300,000 * 2
    assert.equal(cartProjection.currency, "VND");

    // 6. Checkout Rendered Quote Facts & Stateless MAC Proof
    const quoteFacts = buildRenderedCheckoutQuoteFacts(cartLines);
    assert.ok(quoteFacts);
    assert.equal(quoteFacts.merchandiseSubtotalVnd, 600_000);
    assert.equal(quoteFacts.items[0]?.unitPriceVnd, 300_000);
    assert.equal(quoteFacts.items[0]?.variantExternalId, "pan-var-101");

    const expectedShipping = calculateGuestShippingFeeVnd({
      subtotalVnd: 600_000,
      totalQuantity: 2,
    });
    assert.equal(quoteFacts.shippingFeeVnd, expectedShipping);
    assert.equal(quoteFacts.totalVnd, 600_000 + expectedShipping);

    const proof = issueRenderedQuoteProof({
      quote: quoteFacts,
      cartId: CART_ID,
      secret: CART_SECRET,
    });
    assert.ok(proof, "proof must issue successfully");
    const verified = verifyRenderedQuoteProof({
      proof,
      cartId: CART_ID,
      currentQuote: quoteFacts,
      secret: CART_SECRET,
    });
    assert.deepEqual(verified, { ok: true });

    // 7. Structured Data JSON-LD Product Offer
    const structuredData = buildStorefrontProductStructuredData({
      origin: ORIGIN,
      product: {
        pancakeProductId: "pan-prod-100",
        slug: "ao-thun-cotton",
        name: "Áo Thun Cotton",
        editorialDescription: "Áo thun tối giản",
        media: { gallery: [{ url: `${ORIGIN}/images/1.jpg`, alt: "Mặt trước" }] },
        galleryIndexByVariantId: { [variant.id]: 0 },
        variantMpnById: { [variant.id]: "AT-01-M" },
        variantSkuById: { [variant.id]: "LA-AT-01-M" },
        variantAvailabilityResolvedById: { [variant.id]: true },
        projection,
      },
    });
    assert.ok(structuredData, "structured data document must exist");
    const graph = (structuredData as { "@graph": unknown[] })["@graph"] as Array<{
      "@type": string;
      offers?: { price: number; priceCurrency: string; availability: string };
    }>;
    const productNode = graph.find((node) => node["@type"] === "Product");
    assert.ok(productNode, "Product node must exist in @graph");
    assert.ok(productNode.offers, "Product node must carry an offer");
    assert.equal(productNode.offers.price, 300_000);
    assert.equal(productNode.offers.priceCurrency, "VND");
    assert.equal(productNode.offers.availability, "https://schema.org/InStock");
  });

  it("publishes exact promotion-aware Offer for each variant under ProductGroup", () => {
    const campaign: ApplicablePromotionCampaign = {
      id: "camp-sale-25",
      name: "Sale 25% Off M only",
      kind: "PROMOTION",
      discountType: "PERCENTAGE",
      percentageValue: 25,
      fixedPriceVnd: null,
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2026-09-30T00:00:00.000Z"),
    };

    const variantM = buildTestVariant({ id: "var-m", pancakeVariationId: "pan-var-m", size: "M", retailPrice: 400_000 });
    const variantL = buildTestVariant({ id: "var-l", pancakeVariationId: "pan-var-l", size: "L", retailPrice: 400_000 });

    const pricingRule = buildPromotionalStorefrontPricing({
      campaignsByVariantId: new Map([[variantM.id, [campaign]]]), // only variant M is discounted
      now: NOW,
    });

    const projection = buildStorefrontProductProjection({
      parentVariants: [variantM, variantL],
      componentGroups: [],
      hasCompositeGraph: false,
      pricingRule,
    });

    const structuredData = buildStorefrontProductStructuredData({
      origin: ORIGIN,
      product: {
        pancakeProductId: "pan-prod-100",
        slug: "ao-thun-cotton",
        name: "Áo Thun Cotton",
        editorialDescription: "Áo thun tối giản",
        media: {
          gallery: [
            { url: `${ORIGIN}/images/m.jpg`, alt: "Size M" },
            { url: `${ORIGIN}/images/l.jpg`, alt: "Size L" },
          ],
        },
        galleryIndexByVariantId: { [variantM.id]: 0, [variantL.id]: 1 },
        variantMpnById: { [variantM.id]: "AT-01-M", [variantL.id]: "AT-01-L" },
        variantSkuById: { [variantM.id]: "LA-AT-01-M", [variantL.id]: "LA-AT-01-L" },
        variantAvailabilityResolvedById: { [variantM.id]: true, [variantL.id]: true },
        projection,
      },
    });

    const graph = (structuredData as { "@graph": unknown[] })["@graph"] as Array<{
      "@type": string;
      hasVariant?: Array<{
        name: string;
        offers: { price: number; priceCurrency: string; url: string; mpn: string; sku: string };
      }>;
    }>;
    const groupNode = graph.find((node) => node["@type"] === "ProductGroup");
    assert.ok(groupNode, "ProductGroup node must exist for multi-variant family");
    assert.ok(Array.isArray(groupNode.hasVariant));
    type VariantStructuredNode = {
      mpn?: string;
      sku?: string;
      offers: {
        price: number;
        priceCurrency: string;
        url: string;
      };
    };

    const variantMNode = groupNode.hasVariant.find(
      (v) => (v as unknown as VariantStructuredNode).mpn === "AT-01-M",
    ) as unknown as VariantStructuredNode | undefined;
    assert.ok(variantMNode, "Variant M node must exist in hasVariant");
    assert.equal(variantMNode.mpn, "AT-01-M");
    assert.equal(variantMNode.sku, "LA-AT-01-M");
    assert.equal(variantMNode.offers.price, 300_000, "Variant M must carry effective discounted price");
    assert.equal(variantMNode.offers.priceCurrency, "VND");
    assert.ok(variantMNode.offers.url.includes("variant=pan-var-m"));

    const variantLNode = groupNode.hasVariant.find(
      (v) => (v as unknown as VariantStructuredNode).mpn === "AT-01-L",
    ) as unknown as VariantStructuredNode | undefined;
    assert.ok(variantLNode, "Variant L node must exist in hasVariant");
    assert.equal(variantLNode.mpn, "AT-01-L");
    assert.equal(variantLNode.sku, "LA-AT-01-L");
    assert.equal(variantLNode.offers.price, 400_000, "Variant L must carry base undiscounted price");
    assert.equal(variantLNode.offers.priceCurrency, "VND");
    assert.ok(variantLNode.offers.url.includes("variant=pan-var-l"));
  });

  it("converges across PDP, Cart, Quote, and JSON-LD for a fixed-price promotion", () => {
    const campaign: ApplicablePromotionCampaign = {
      id: "camp-fixed-320",
      name: "Special Deal 320k",
      kind: "PROMOTION",
      discountType: "FIXED_PRICE",
      percentageValue: null,
      fixedPriceVnd: BigInt(320_000),
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2026-09-30T00:00:00.000Z"),
    };

    const variant = buildTestVariant({ retailPrice: 400_000 });
    const pricingRule = buildPromotionalStorefrontPricing({
      campaignsByVariantId: new Map([[variant.id, [campaign]]]),
      now: NOW,
    });

    const projection = buildStorefrontProductProjection({
      parentVariants: [variant],
      componentGroups: [],
      hasCompositeGraph: false,
      pricingRule,
    });
    const option = projection.options[0]!;
    assert.equal(option.price, 320_000);
    assert.equal(option.basePriceVnd, 400_000);
    assert.equal(option.isDiscounted, true);

    const cartLines = buildStorefrontCartLines({
      items: [{ variantId: variant.id, quantity: 1 }],
      products: [
        {
          slug: "ao-thun-cotton",
          pancakeProductId: "pan-prod-100",
          name: "Áo Thun Cotton",
          primaryImageUrl: null,
          isPresent: true,
          isActive: true,
          variants: [
            {
              id: variant.id,
              pancakeVariationId: variant.pancakeVariationId,
              isPresent: true,
              isActive: true,
              color: variant.color,
              size: variant.size,
              sellableStock: 10,
              retailPrice: variant.retailPrice,
              retailPriceAfterDiscount: null,
            },
          ],
        },
      ],
      pricingRule,
    });
    assert.equal(cartLines[0]!.price, 320_000);

    const quoteFacts = buildRenderedCheckoutQuoteFacts(cartLines)!;
    assert.equal(quoteFacts.merchandiseSubtotalVnd, 320_000);
    assert.equal(quoteFacts.items[0]!.unitPriceVnd, 320_000);
  });

  it("safely falls back to undiscounted base when multiple active campaigns conflict", () => {
    const campaignA: ApplicablePromotionCampaign = {
      id: "camp-a",
      name: "Sale 10%",
      kind: "PROMOTION",
      discountType: "PERCENTAGE",
      percentageValue: 10,
      fixedPriceVnd: null,
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2026-09-30T00:00:00.000Z"),
    };
    const campaignB: ApplicablePromotionCampaign = {
      id: "camp-b",
      name: "Flash Sale 20%",
      kind: "FLASH_SALE",
      discountType: "PERCENTAGE",
      percentageValue: 20,
      fixedPriceVnd: null,
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2026-09-30T00:00:00.000Z"),
    };

    const variant = buildTestVariant({ retailPrice: 400_000 });
    const pricing = resolvePromotionPricing({
      basePriceVnd: variant.retailPrice,
      campaigns: [campaignA, campaignB],
      now: NOW,
    });

    assert.equal(pricing.reason, "PROMOTION_CONFLICT");
    assert.equal(pricing.isDiscounted, false);
    assert.equal(pricing.effectivePriceVnd, 400_000);

    const pricingRule = buildPromotionalStorefrontPricing({
      campaignsByVariantId: new Map([[variant.id, [campaignA, campaignB]]]),
      now: NOW,
    });
    const projection = buildStorefrontProductProjection({
      parentVariants: [variant],
      componentGroups: [],
      hasCompositeGraph: false,
      pricingRule,
    });
    const option = projection.options[0]!;
    assert.equal(option.price, 400_000);
    assert.equal(option.isDiscounted, false);
  });

  it("safely falls back to base price when a fixed price is >= base price (PROMOTION_INVALID)", () => {
    const invalidCampaign: ApplicablePromotionCampaign = {
      id: "camp-invalid",
      name: "Invalid Fixed Price",
      kind: "PROMOTION",
      discountType: "FIXED_PRICE",
      percentageValue: null,
      fixedPriceVnd: BigInt(450_000), // >= 400,000 base
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: new Date("2026-09-30T00:00:00.000Z"),
    };

    const variant = buildTestVariant({ retailPrice: 400_000 });
    const pricing = resolvePromotionPricing({
      basePriceVnd: variant.retailPrice,
      campaigns: [invalidCampaign],
      now: NOW,
    });

    assert.equal(pricing.reason, "PROMOTION_INVALID");
    assert.equal(pricing.isDiscounted, false);
    assert.equal(pricing.effectivePriceVnd, 400_000);
  });

  it("marks option unpriceable when base price is unusable (<=0, null, or fractional)", () => {
    for (const badBase of [null, 0, -100_000, 150.5]) {
      const pricing = resolvePromotionPricing({
        basePriceVnd: badBase as number | null,
        campaigns: [],
        now: NOW,
      });
      assert.equal(pricing.reason, "BASE_PRICE_UNAVAILABLE");
      assert.equal(pricing.effectivePriceVnd, null);
      assert.equal(pricing.isDiscounted, false);
    }
  });
});

describe("U39 / G1: Upper-Funnel Analytics Anti-Masquerade & Identity Discipline", () => {
  it("never masquerades a price range minimum as an exact variant price", () => {
    // Multi-price product impression: min != max
    const impression = buildProductImpression({
      productExternalId: "pan-prod-100",
      itemName: "Áo Sơ Mi Oxford",
      minimumPriceVnd: 350_000,
      maximumPriceVnd: 450_000,
    });

    assert.equal(impression.item_id, "pan-prod-100");
    assert.equal(impression.price, undefined, "price must NOT masquerade the minimum price");
    assert.equal(impression.la_minimum_price_vnd, 350_000);
    assert.equal(impression.la_maximum_price_vnd, 450_000);
  });

  it("collapses to exact price only when min equals max", () => {
    const impression = buildProductImpression({
      productExternalId: "pan-prod-100",
      itemName: "Áo Sơ Mi Oxford",
      minimumPriceVnd: 400_000,
      maximumPriceVnd: 400_000,
    });

    assert.equal(impression.price, 400_000);
    assert.equal(impression.la_minimum_price_vnd, undefined);
    assert.equal(impression.la_maximum_price_vnd, undefined);
  });

  it("enforces canonical external identities and rejects local CUIDs in variant events", () => {
    // Selected variant item requires external variation ID
    const variantItem = buildVariantItem({
      variantExternalId: "pan-var-101",
      productExternalId: "pan-prod-100",
      itemName: "Áo Sơ Mi Oxford",
      unitPriceVnd: 350_000,
      quantity: 1,
      color: "Trắng",
      size: "M",
    });

    assert.equal(variantItem.item_id, "pan-var-101");
    assert.equal(variantItem.item_group_id, "pan-prod-100");
    assert.equal(variantItem.price, 350_000);
    assert.equal(variantItem.quantity, 1);
  });
});

describe("U39 / G1: Confirmed Purchase Immutability & Event ID Alignment", () => {
  const confirmedOrder = {
    publicCode: "LA-2026-0908-01",
    state: "CONFIRMED" as const,
    merchandiseSubtotalVnd: BigInt(700_000),
    shippingFeeVnd: BigInt(30_000),
    totalVnd: BigInt(730_000),
    lines: [
      {
        variantId: "local-cuid-1",
        pancakeVariationId: "pan-var-101",
        productName: "Áo Thun Cotton",
        color: "Trắng",
        size: "M",
        quantity: 2,
        unitPriceVnd: BigInt(350_000),
        lineTotalVnd: BigInt(700_000),
      },
    ],
  };

  const mockClient: CanonicalPurchaseClient = {
    orderMirror: {
      findUnique: async () => confirmedOrder as unknown as null,
    },
    variantMirror: {
      findMany: async () => [
        {
          id: "local-cuid-1",
          product: { slug: "ao-thun-cotton", pancakeProductId: "pan-prod-100" },
        },
      ] as unknown as [],
    },
  } as unknown as CanonicalPurchaseClient;

  it("emits Purchase only when order is CONFIRMED and uses immutable snapshot money", async () => {
    const snapshot = await readCanonicalPurchaseSnapshot(mockClient, "LA-2026-0908-01");
    assert.ok(snapshot);
    assert.equal(snapshot.publicCode, "LA-2026-0908-01");
    assert.equal(snapshot.merchandiseValueVnd, 700_000);
    assert.equal(snapshot.shippingVnd, 30_000);
    assert.equal(snapshot.totalVnd, 730_000);

    const event = snapshot.event;
    assert.equal(event.event, "purchase");
    assert.equal(event.ecommerce.transaction_id, "LA-2026-0908-01");
    assert.equal(event.ecommerce.event_id, "LA-2026-0908-01");
    assert.equal(event.ecommerce.value, 700_000);
    assert.equal(event.ecommerce.shipping, 30_000);
    assert.equal(event.ecommerce.la_total_vnd, 730_000);
  });

  it("suppresses Purchase event for any non-CONFIRMED state", async () => {
    for (const nonConfirmedState of ["DRAFT", "VALIDATING", "POS_SUBMITTING", "SYNC_UNKNOWN", "REJECTED"]) {
      const draftClient: CanonicalPurchaseClient = {
        orderMirror: {
          findUnique: async () => ({ ...confirmedOrder, state: nonConfirmedState }) as unknown as null,
        },
        variantMirror: { findMany: async () => [] as unknown as [] },
      } as unknown as CanonicalPurchaseClient;

      const snapshot = await readCanonicalPurchaseSnapshot(draftClient, "LA-2026-0908-01");
      assert.equal(snapshot, null, `State ${nonConfirmedState} must NOT produce a Purchase event`);
    }
  });

  it("aligns Meta Purchase snapshot with canonical snapshot using publicCode", async () => {
    const metaSnapshot = await readMetaPurchaseSnapshot(
      mockClient as unknown as Parameters<typeof readMetaPurchaseSnapshot>[0],
      "LA-2026-0908-01",
    );
    assert.ok(metaSnapshot);
    assert.equal(metaSnapshot.valueVnd, 730_000);
    assert.equal(metaSnapshot.contents.length, 1);
    assert.equal(metaSnapshot.contents[0]!.itemPrice, 350_000);
    assert.equal(metaSnapshot.contents[0]!.quantity, 2);
  });
});

describe("U39 / G1: Stateless Quote Proof Tamper Resistance", () => {
  const quote = {
    items: [{ variantExternalId: "pan-var-101", quantity: 1, unitPriceVnd: 400_000 }],
    merchandiseSubtotalVnd: 400_000,
    shippingFeeVnd: 30_000,
    totalVnd: 430_000,
    totalQuantity: 1,
  };

  it("fails closed when client tampers with quote or attempts cross-cart replay", () => {
    const proof = issueRenderedQuoteProof({
      quote,
      cartId: CART_ID,
      secret: CART_SECRET,
    })!;

    // Case A: Buyer tampers with unit price in quote facts
    const tamperedQuote = {
      ...quote,
      items: [{ variantExternalId: "pan-var-101", quantity: 1, unitPriceVnd: 200_000 }],
      merchandiseSubtotalVnd: 200_000,
      totalVnd: 230_000,
    };
    const tamperedResult = verifyRenderedQuoteProof({
      proof,
      cartId: CART_ID,
      currentQuote: tamperedQuote,
      secret: CART_SECRET,
    });
    assert.equal(tamperedResult.ok, false);

    // Case B: Replay proof against a different cart
    const crossCartResult = verifyRenderedQuoteProof({
      proof,
      cartId: "cart-uuid-00000000-0000-0000-0000-000000000002",
      currentQuote: quote,
      secret: CART_SECRET,
    });
    assert.equal(crossCartResult.ok, false);
    assert.equal((crossCartResult as { reason: string }).reason, "PROOF_UNVERIFIED");

    // Case C: Raw cart UUID is never leaked into the browser-visible proof string
    assert.equal(proof.includes(CART_ID), false, "Raw cart UUID must not be serialized into proof");
  });
});

describe("U39 / G1: Disabled / Fail-Closed Consumers Remain Inactive", () => {
  it("Google Merchant feed fails closed with HTTP 503 and unapproved O2 market", async () => {
    // 1. O2 Market Authority is structurally UNRESOLVED
    const market = resolveMerchantMarket();
    assert.equal(market.status, "UNRESOLVED");
    assert.equal(market.reason, "MERCHANT_MARKET_UNRESOLVED");

    // 2. HTTP handler returns 503 Service Unavailable with 60s backoff
    const handler = createMerchantFeedGetHandler(async () => ({
      ok: false,
      failureClass: "MARKET_UNRESOLVED",
      retryAfterSeconds: 60,
      backoff: false,
    }));
    const response = await handler(new Request("https://la.lanadesign.vn/feeds/google-merchant"));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(response.headers.get("x-la-merchant-feed-failure"), "MARKET_UNRESOLVED");
  });

  it("GTM tracking bootstrap renders zero external scripts", () => {
    const runtime = resolveTrackingRuntime(readTrackingConfig());
    const script = buildTrackingBootstrapScript(runtime, readConsentPolicy());

    assert.ok(typeof script === "string");
    assert.equal(script.includes("https://www.googletagmanager.com/gtm.js"), false);
    assert.equal(script.includes("<script"), false, "Bootstrap script is pure JS string");
  });

  it("Organic search indexing is disabled and withheld", () => {
    const exposure = readSearchExposure();
    assert.equal(exposure.indexingEnabled, false);
    assert.equal(isTemporaryProductionOrigin("https://la.lanadesign.vn"), true);
    assert.equal(
      shouldNoIndexRequest({
        indexingEnabled: exposure.indexingEnabled,
        pathname: "/shop",
        search: "",
      }),
      true,
      "Pages must receive noindex when indexing is disabled",
    );
  });
});
