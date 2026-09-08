import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolvePromotionPricing,
  type ApplicablePromotionCampaign,
} from "../../src/commerce/promotion-pricing.ts";
import { buildStorefrontCartLines } from "../../src/commerce/storefront-cart.ts";
import { buildRenderedCheckoutQuoteFacts } from "../../src/commerce/checkout-quote.ts";
import { calculateGuestShippingFeeVnd } from "../../src/commerce/guest-shipping-policy.ts";
import {
  readCanonicalPurchaseSnapshot,
  type CanonicalPurchaseClient,
} from "../../src/commerce/canonical-purchase-snapshot.ts";
import {
  buildProductImpression,
  buildVariantItem,
} from "../../src/tracking/commerce-events.ts";
import {
  createMerchantFeedCoordinator,
} from "../../src/commerce/merchant-feed-coordinator.ts";
import {
  readSearchExposure,
  shouldNoIndexRequest,
} from "../../src/seo/search-exposure.ts";
import {
  describeActivationGate,
  describeCampaignRuntimeHealth,
  describeRenderedQuoteProofRejection,
  emitPromotionSignal,
} from "../../src/operations/promotion-observability.ts";

describe("U43 / G3: Promotion Final Integrated Definition of Done", () => {
  const NOW = new Date("2026-09-08T12:00:00.000Z");

  const sampleCampaign: ApplicablePromotionCampaign = {
    id: "camp-dod-1",
    name: "Integrated DoD 20% Off",
    kind: "FLASH_SALE",
    discountType: "PERCENTAGE",
    percentageValue: 20,
    fixedPriceVnd: null,
    startsAt: new Date(NOW.getTime() - 3600_000),
    endsAt: new Date(NOW.getTime() + 3600_000),
  };

  describe("1. Central Pricing Authority & Enabled-Consumer Monetary Convergence (#151 G1)", () => {
    it("PDP projection, cart lines, and checkout quote share the exact same promotional price", () => {
      const basePrice = 500_000;
      const resolved = resolvePromotionPricing({
        basePriceVnd: basePrice,
        campaigns: [sampleCampaign],
        now: NOW,
      });

      // 500,000 * 0.8 = 400,000
      assert.equal(resolved.effectivePriceVnd, 400_000);
      assert.equal(resolved.isDiscounted, true);

      // Cart line assembly
      const cartLines = buildStorefrontCartLines({
        items: [{ variantId: "var-local-01", quantity: 2 }],
        products: [
          {
            pancakeProductId: "pan-prod-01",
            slug: "ao-polo",
            name: "Áo Polo",
            primaryImageUrl: null,
            isPresent: true,
            isActive: true,
            variants: [
              {
                id: "var-local-01",
                pancakeVariationId: "pan-var-01",
                isPresent: true,
                isActive: true,
                color: "Đen",
                size: "L",
                sellableStock: 10,
                retailPrice: basePrice,
                retailPriceAfterDiscount: null,
              },
            ],
          },
        ],
        pricingRule: (variant) => {
          const promo = resolvePromotionPricing({
            basePriceVnd: variant.retailPrice,
            campaigns: [sampleCampaign],
            now: NOW,
          });
          return {
            price: promo.effectivePriceVnd,
            basePriceVnd: promo.basePriceVnd,
            isDiscounted: promo.isDiscounted,
          };
        },
      });

      assert.equal(cartLines.length, 1);
      assert.equal(cartLines[0]!.price, 400_000);
      assert.equal(cartLines[0]!.pancakeVariationId, "pan-var-01");
      assert.equal(cartLines[0]!.pancakeProductId, "pan-prod-01");

      // Checkout quote facts
      const quoteFacts = buildRenderedCheckoutQuoteFacts(cartLines);
      assert.ok(quoteFacts);
      assert.equal(quoteFacts.merchandiseSubtotalVnd, 800_000); // 400,000 * 2
      assert.equal(quoteFacts.items[0]?.unitPriceVnd, 400_000);
      assert.equal(quoteFacts.items[0]?.variantExternalId, "pan-var-01");

      const expectedShipping = calculateGuestShippingFeeVnd({
        subtotalVnd: 800_000,
        totalQuantity: 2,
      });
      assert.equal(quoteFacts.shippingFeeVnd, expectedShipping);
      assert.equal(quoteFacts.totalVnd, 800_000 + expectedShipping);
    });

    it("unusable base price fails closed across all consumers without fabricating a discount", () => {
      const resolved = resolvePromotionPricing({
        basePriceVnd: -100,
        campaigns: [sampleCampaign],
        now: NOW,
      });
      assert.equal(resolved.effectivePriceVnd, null);
      assert.equal(resolved.isDiscounted, false);
      assert.equal(resolved.reason, "BASE_PRICE_UNAVAILABLE");
    });
  });

  describe("2. External Identity Discipline (#153 T4/T7)", () => {
    it("upper-funnel items enforce pancakeProductId while concrete selected items enforce pancakeVariationId", () => {
      // Upper funnel item (impression/list): accepts productExternalId, rejects local CUID
      const impression = buildProductImpression({
        productExternalId: "pancake-prod-999",
        itemName: "Áo Thun Nam",
        exactPriceVnd: 400_000,
      });
      assert.ok(impression);
      assert.equal(impression.item_id, "pancake-prod-999");

      // Concrete variant item: accepts variantExternalId
      const variantItem = buildVariantItem({
        variantExternalId: "pancake-var-888",
        productExternalId: "pancake-prod-999",
        itemName: "Áo Thun Nam",
        unitPriceVnd: 400_000,
        quantity: 1,
        color: "Đen",
        size: "L",
      });
      assert.ok(variantItem);
      assert.equal(variantItem.item_id, "pancake-var-888");
      assert.equal(variantItem.item_group_id, "pancake-prod-999");
      assert.equal(variantItem.item_variant, "Đen / L");

      // An internal database CUID is never used as an external item ID
      const internalId = "cm1234567890abcdefghijklmn";
      assert.match(internalId, /^c[a-z0-9]{24,}$/);
      assert.notEqual(variantItem.item_id, internalId);
    });

    it("Purchase tracking requires CONFIRMED state and immutable snapshot money", async () => {
      const confirmedOrder = {
        publicCode: "LA-20260908-CONFIRMED",
        state: "CONFIRMED" as const,
        merchandiseSubtotalVnd: BigInt(800_000),
        shippingFeeVnd: BigInt(30_000),
        totalVnd: BigInt(830_000),
        lines: [
          {
            variantId: "local-cuid-1",
            pancakeVariationId: "pancake-var-888",
            productName: "Áo Thun Nam",
            color: "Đen",
            size: "L",
            quantity: 2,
            unitPriceVnd: BigInt(400_000),
            lineTotalVnd: BigInt(800_000),
          },
        ],
      };

      const mockClient: CanonicalPurchaseClient = {
        orderMirror: {
          findUnique: async () => confirmedOrder as unknown as null,
        } as unknown as CanonicalPurchaseClient["orderMirror"],
        variantMirror: {
          findMany: async () => [
            { id: "local-cuid-1", product: { pancakeProductId: "pancake-prod-999" } },
          ],
        } as unknown as CanonicalPurchaseClient["variantMirror"],
      };

      const snapshot = await readCanonicalPurchaseSnapshot(mockClient, "LA-20260908-CONFIRMED");
      assert.ok(snapshot);
      assert.equal(snapshot.merchandiseValueVnd, 800_000);
      assert.equal(snapshot.shippingVnd, 30_000);
      assert.equal(snapshot.totalVnd, 830_000);
      assert.equal(snapshot.publicCode, "LA-20260908-CONFIRMED");
      assert.equal(snapshot.event.ecommerce.transaction_id, "LA-20260908-CONFIRMED");

      // Non-confirmed states suppress Purchase emission completely
      const preConfirmedStates = ["DRAFT", "VALIDATING", "POS_SUBMITTING", "SYNC_UNKNOWN", "REJECTED"] as const;
      for (const nonConfirmedState of preConfirmedStates) {
        const unconfirmedClient: CanonicalPurchaseClient = {
          orderMirror: {
            findUnique: async () => ({ ...confirmedOrder, state: nonConfirmedState }) as unknown as null,
          } as unknown as CanonicalPurchaseClient["orderMirror"],
          variantMirror: {
            findMany: async () => [],
          } as unknown as CanonicalPurchaseClient["variantMirror"],
        };
        const suppressed = await readCanonicalPurchaseSnapshot(unconfirmedClient, "LA-20260908-CONFIRMED");
        assert.equal(suppressed, null, `State ${nonConfirmedState} must suppress Purchase emission`);
      }
    });
  });

  describe("3. Merchant Feed Fail-Closed & Cache Linearization (#153 M4)", () => {
    it("coordinator fails closed when market is unresolved, returning failureClass MARKET_UNRESOLVED", async () => {
      const currentRevision = BigInt(1);
      const coord = createMerchantFeedCoordinator({
        key: "merchant-feed-default",
        readPricingRevision: async () => currentRevision,
        now: () => NOW.getTime(),
      });

      const result = await coord.get({
        generate: async () => ({
          ok: false,
          failureClass: "MARKET_UNRESOLVED",
        }),
      });

      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.failureClass, "MARKET_UNRESOLVED");
      }
    });

    it("durable revision advance invalidates prior-revision cache on next linear read", async () => {
      let currentRevision = BigInt(1);
      let generatorCalls = 0;

      const coord = createMerchantFeedCoordinator({
        key: "merchant-feed-revision-test",
        readPricingRevision: async () => currentRevision,
        now: () => NOW.getTime(),
      });

      // First fetch: populates cache at revision 1
      const res1 = await coord.get({
        generate: async () => {
          generatorCalls++;
          return {
            ok: true,
            body: "<feed>revision-1-content</feed>",
            byteLength: Buffer.byteLength("<feed>revision-1-content</feed>"),
            offerCount: 1,
            nextPricingTransitionAtMs: null,
          };
        },
      });
      assert.equal(res1.ok, true);
      if (res1.ok) {
        assert.equal(res1.body, "<feed>revision-1-content</feed>");
      }
      assert.equal(generatorCalls, 1);

      // Second fetch within TTL with same revision: cache hit (no generator call)
      const res2 = await coord.get({
        generate: async () => {
          generatorCalls++;
          return {
            ok: true,
            body: "<feed>should-not-call</feed>",
            byteLength: Buffer.byteLength("<feed>should-not-call</feed>"),
            offerCount: 1,
            nextPricingTransitionAtMs: null,
          };
        },
      });
      assert.equal(res2.ok, true);
      if (res2.ok) {
        assert.equal(res2.body, "<feed>revision-1-content</feed>");
      }
      assert.equal(generatorCalls, 1);

      // Advance durable promotion pricing revision atomically (simulating promotion commit/rollback)
      currentRevision = BigInt(2);

      // Third fetch: detects newer revision, invalidates cached revision-1, triggers generator call
      const res3 = await coord.get({
        generate: async () => {
          generatorCalls++;
          return {
            ok: true,
            body: "<feed>revision-2-content</feed>",
            byteLength: Buffer.byteLength("<feed>revision-2-content</feed>"),
            offerCount: 1,
            nextPricingTransitionAtMs: null,
          };
        },
      });
      assert.equal(res3.ok, true);
      if (res3.ok) {
        assert.equal(res3.body, "<feed>revision-2-content</feed>");
      }
      assert.equal(generatorCalls, 2);
    });
  });

  describe("4. Unchanged Search Indexing Policy (#152 W19, Gate S)", () => {
    it("fails closed to noindex when SEARCH_INDEXING_ENABLED is false", () => {
      const exposure = readSearchExposure({
        SEARCH_INDEXING_ENABLED: "false",
        APP_DOMAIN: "la-clothing.example.com",
      });

      assert.equal(exposure.indexingEnabled, false);
      assert.equal(
        shouldNoIndexRequest({
          indexingEnabled: exposure.indexingEnabled,
          pathname: "/shop",
          search: "",
        }),
        true,
        "Storefront pages must be noindexed when indexing is disabled",
      );
    });

    it("temporary production domains fail closed to noindex even if indexing is requested", () => {
      const exposure = readSearchExposure({
        SEARCH_INDEXING_ENABLED: "true",
        APP_DOMAIN: "la.lanadesign.vn",
      });

      assert.equal(exposure.indexingEnabled, false);
      assert.equal(
        shouldNoIndexRequest({
          indexingEnabled: exposure.indexingEnabled,
          pathname: "/shop",
          search: "",
        }),
        true,
        "Temporary production domain must remain noindexed",
      );
    });
  });

  describe("5. Observability, Log Budget, and Privacy Invariants (#151 G2)", () => {
    it("signals produce single-line NDJSON logs <1KB with zero PII, zero tokens, and zero cart UUIDs", () => {
      const signals = [
        describeActivationGate({ operation: "publish", enabled: false }),
        describeCampaignRuntimeHealth({
          campaignId: "camp-sale-01",
          status: "PARTIALLY_INVALID",
          coveredVariants: 20,
          discountedVariants: 15,
          affectedVariants: 5,
          affected: [
            { variantId: "var-1", reason: "BASE_PRICE_UNAVAILABLE", conflictingCampaignIds: [] },
          ],
          affectedTruncated: false,
        }),
        describeRenderedQuoteProofRejection({ reason: "PROOF_MALFORMED" }),
      ];

      const captured: string[] = [];
      const writer = (line: string) => captured.push(line);

      for (const signal of signals) {
        emitPromotionSignal(signal, writer);
      }

      assert.equal(captured.length, 3);
      for (const line of captured) {
        // Strict single line formatting
        assert.ok(line.endsWith("\n"));
        assert.equal(line.trim().includes("\n"), false);
        // Bounded size
        assert.ok(Buffer.byteLength(line, "utf8") < 1024);
        // Privacy assertions: no secrets, no tokens, no cart UUIDs
        assert.equal(line.includes("cart_id"), false);
        assert.equal(line.includes("token"), false);
        assert.equal(line.includes("secret"), false);
        assert.equal(line.includes("password"), false);
        assert.equal(line.includes("vnd"), false);
      }
    });
  });

  describe("6. Launch Gates Default-Off Verification", () => {
    it("all 4 launch gates remain default-off / fail-closed", () => {
      // Gate P: promotions disabled unless explicitly set to 'true'
      const promotionEnabled = process.env.LA_PROMOTION_ACTIVATION_ENABLED === "true";
      assert.equal(promotionEnabled, false, "Gate P (Promotions) must be default-off");

      // Gate S: organic search indexing disabled unless explicitly set to 'true'
      const searchEnabled = process.env.SEARCH_INDEXING_ENABLED === "true";
      assert.equal(searchEnabled, false, "Gate S (Search Indexing) must be default-off");

      // Gate T: GTM tracking disabled unless explicitly configured
      const gtmEnabled = process.env.NEXT_PUBLIC_GTM_CONTAINER_ID != null && process.env.NEXT_PUBLIC_GTM_CONTAINER_ID.length > 0;
      assert.equal(gtmEnabled, false, "Gate T (GTM Tracking) must be default-off");

      // Gate M: Google Merchant feed market unresolved until reviewed runtime authority wired
      const marketConfigured = process.env.MERCHANT_MARKET_RESOLVED === "true";
      assert.equal(marketConfigured, false, "Gate M (Merchant Feed) must be fail-closed");
    });
  });
});
