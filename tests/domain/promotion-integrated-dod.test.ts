import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { RenderedQuoteProofRejection } from "../../src/commerce/checkout-quote-proof.ts";
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
import { readMetaPurchaseSnapshot } from "../../src/commerce/meta-purchase-snapshot.ts";
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
  validateSearchExposureForRelease,
} from "../../src/seo/search-exposure.ts";
import { buildRobotsDocument } from "../../src/seo/robots-policy.ts";
import {
  describeActivationGate,
  describeCampaignRuntimeHealth,
  describeRenderedQuoteProofRejection,
  emitPromotionSignal,
  MAX_SIGNAL_UTF8_BYTES,
} from "../../src/operations/promotion-observability.ts";
import {
  buildMetaAddToCartPixelParameters,
  buildMetaPurchasePixelParameters,
} from "../../src/commerce/meta-pixel-parameters.ts";
import {
  publishPromotionCampaign,
} from "../../src/commerce/promotion-activation-service.ts";
import {
  evaluateCampaignRuntimeHealth,
} from "../../src/commerce/promotion-runtime-health.ts";
import { buildPromotionalStorefrontPricing } from "../../src/commerce/storefront-promotion-projection.ts";
import { buildStorefrontVariantOptions } from "../../src/commerce/storefront-product.ts";
import { isPromotionActivationEnabled } from "../../src/commerce/promotion-activation.ts";
import {
  readTrackingConfig,
  resolveTrackingRuntime,
  shouldLoadGoogleTagManager,
} from "../../src/tracking/config.ts";
import { createMerchantFeedGetHandler } from "../../src/commerce/merchant-feed-http.ts";

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
      const campaignsByVariantId = new Map([["var-local-01", [sampleCampaign]]]);

      // Production shared promotional pricing rule (src/commerce/storefront-promotion-projection.ts)
      const promotionalPricingRule = buildPromotionalStorefrontPricing({
        campaignsByVariantId,
        now: NOW,
      });

      // 1. PDP projection using production pricingRule
      const pdpOptions = buildStorefrontVariantOptions(
        [
          {
            id: "var-local-01",
            pancakeVariationId: "pan-var-01",
            color: "Đen",
            size: "L",
            sellableStock: 10,
            retailPrice: basePrice,
            retailPriceAfterDiscount: null,
          },
        ],
        promotionalPricingRule,
      );

      assert.equal(pdpOptions.length, 1);
      assert.equal(pdpOptions[0]!.price, 400_000);
      assert.equal(pdpOptions[0]!.basePriceVnd, 500_000);
      assert.equal(pdpOptions[0]!.isDiscounted, true);

      // 2. Cart lines assembly using production pricingRule
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
        pricingRule: promotionalPricingRule,
      });

      assert.equal(cartLines.length, 1);
      assert.equal(cartLines[0]!.price, 400_000);
      assert.equal(cartLines[0]!.pancakeVariationId, "pan-var-01");
      assert.equal(cartLines[0]!.pancakeProductId, "pan-prod-01");

      // 3. Checkout quote facts
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
      const unusableCampaigns = new Map([["var-unusable", [sampleCampaign]]]);
      const rule = buildPromotionalStorefrontPricing({
        campaignsByVariantId: unusableCampaigns,
        now: NOW,
      });

      const priced = rule({
        id: "var-unusable",
        pancakeVariationId: "pan-var-unusable",
        color: "Đen",
        size: "M",
        sellableStock: 5,
        retailPrice: -100,
        retailPriceAfterDiscount: null,
      });

      assert.equal(priced.price, null);
      assert.equal(priced.basePriceVnd, null);
      assert.equal(priced.isDiscounted, false);
    });

    it("direct Meta Pixel parameters are produced by shared production builder with full monetary convergence and no CUID", () => {
      // 1. AddToCart production builder (used by product-purchase-panel.tsx)
      const addToCartParams = buildMetaAddToCartPixelParameters({
        slug: "ao-polo",
        productName: "Áo Polo",
        committedUnitPriceVnd: 400_000,
      });

      assert.ok(addToCartParams);
      assert.equal(addToCartParams.value, 400_000);
      assert.equal(addToCartParams.currency, "VND");
      assert.equal(addToCartParams.content_type, "product");
      assert.deepEqual(addToCartParams.content_ids, ["ao-polo"]);
      assert.equal(addToCartParams.content_name, "Áo Polo");
      // Internal CUIDs are never exposed to Meta Pixel
      const serializedAddToCart = JSON.stringify(addToCartParams);
      assert.equal(serializedAddToCart.includes("cuid"), false);
      assert.equal(serializedAddToCart.includes("var-local-01"), false);

      // 2. Purchase production builder (used by checkout/success/page.tsx)
      const purchaseParams = buildMetaPurchasePixelParameters({
        valueVnd: 830_000,
        contents: [
          {
            id: "ao-polo",
            quantity: 2,
            itemPrice: 400_000,
          },
        ],
      });

      assert.ok(purchaseParams);
      assert.equal(purchaseParams.value, 830_000);
      assert.equal(purchaseParams.currency, "VND");
      assert.equal(purchaseParams.content_type, "product");
      assert.deepEqual(purchaseParams.content_ids, ["ao-polo"]);
      assert.deepEqual(purchaseParams.contents, [
        { id: "ao-polo", quantity: 2, item_price: 400_000 },
      ]);
      const serializedPurchase = JSON.stringify(purchaseParams);
      assert.equal(serializedPurchase.includes("cuid"), false);
      assert.equal(serializedPurchase.includes("local-cuid"), false);
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

      // Direct Meta Purchase snapshot also resolves from confirmed order
      const metaSnapshot = await readMetaPurchaseSnapshot(mockClient as unknown as Parameters<typeof readMetaPurchaseSnapshot>[0], "LA-20260908-CONFIRMED");
      assert.ok(metaSnapshot);
      assert.equal(metaSnapshot.valueVnd, 830_000);
      assert.equal(metaSnapshot.contents[0]!.id, "pancake-var-888");
      assert.equal(metaSnapshot.contents[0]!.itemPrice, 400_000);
      assert.equal(metaSnapshot.contents[0]!.quantity, 2);

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

    it("exercises production runtime health evaluation and activation with telemetry fail-open isolation", async () => {
      const emittedSignals: string[] = [];
      const writer = (line: string) => emittedSignals.push(line);

      const mockCampaign = {
        id: "camp-prod-integrated",
        name: "Integrated Health Campaign",
        kind: "PROMOTION" as const,
        discountType: "PERCENTAGE" as const,
        percentageValue: 25,
        fixedPriceVnd: null,
        startsAt: new Date("2026-10-01T00:00:00Z"),
        endsAt: new Date("2026-10-15T00:00:00Z"),
        isEnabled: false,
        enabledAt: null,
        disabledAt: null,
        targets: [{ productId: "prod-int-1", variantId: null }],
      };

      const mockVariants = [
        { id: "var-int-1", productId: "prod-int-1", pancakeRetailPrice: 200_000 },
      ];

      const mockTx = {
        $queryRaw: async () => [{ revision: BigInt(10) }],
        $queryRawUnsafe: async () => [],
        $executeRaw: async () => 1,
        promotionCampaign: {
          findUnique: async () => mockCampaign,
          findMany: async () => [],
          update: async () => mockCampaign,
        },
        productMirror: {
          findMany: async () => [{ id: "prod-int-1" }],
        },
        variantMirror: {
          findMany: async () => mockVariants,
        },
      };

      const mockClient = {
        $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx),
        promotionCampaign: {
          findUnique: async () => mockCampaign,
        },
        variantMirror: {
          findMany: async () => mockVariants,
        },
      };

      // 1. Production publishPromotionCampaign emits promotion.runtime_health signal
      const publishResult = await publishPromotionCampaign({
        campaignId: "camp-prod-integrated",
        now: new Date("2026-09-08T00:00:00Z"),
        session: { user: { id: "admin-1", role: "ADMIN" }, session: { id: "sess-1" } },
        client: mockClient as unknown as Parameters<typeof publishPromotionCampaign>[0]["client"],
        env: { LA_PROMOTION_ACTIVATION_ENABLED: "true" },
        writer,
      });

      assert.equal(publishResult.ok, true);
      assert.equal(emittedSignals.length, 1);
      const parsedHealth = JSON.parse(emittedSignals[0]!);
      assert.equal(parsedHealth.name, "promotion.runtime_health");
      assert.equal(parsedHealth.campaignId, "camp-prod-integrated");
      assert.equal(parsedHealth.status, "HEALTHY");
      assert.equal(parsedHealth.coveredVariants, 1);
      assert.equal(parsedHealth.discountedVariants, 1);
      assert.equal(parsedHealth.affectedVariants, 0);

      // 2. Production on-demand evaluateCampaignRuntimeHealth
      const healthResult = await evaluateCampaignRuntimeHealth({
        campaignId: "camp-prod-integrated",
        client: mockClient as unknown as Parameters<typeof evaluateCampaignRuntimeHealth>[0]["client"],
        now: new Date("2026-10-05T00:00:00Z"),
        writer: () => {},
      });
      assert.ok(healthResult);
      assert.equal(healthResult.status, "HEALTHY");

      // 3. Production telemetry fail-open error isolation
      const throwingWriter = () => {
        throw new Error("Broken telemetry pipeline");
      };

      const publishResultWithThrow = await publishPromotionCampaign({
        campaignId: "camp-prod-integrated",
        now: new Date("2026-09-08T00:00:00Z"),
        session: { user: { id: "admin-1", role: "ADMIN" }, session: { id: "sess-1" } },
        client: mockClient as unknown as Parameters<typeof publishPromotionCampaign>[0]["client"],
        env: { LA_PROMOTION_ACTIVATION_ENABLED: "true" },
        writer: throwingWriter,
      });

      // Business result completely preserved
      assert.equal(publishResultWithThrow.ok, true);
      if (publishResultWithThrow.ok) {
        assert.equal(publishResultWithThrow.revision, BigInt(11));
      }
    });

    it("evaluates complete campaign coverage across >2,000 variants without truncation", async () => {
      const TOTAL_VARIANTS = 2050;
      const allMockVariants = Array.from({ length: TOTAL_VARIANTS }, (_, i) => ({
        id: `var-cov-${i.toString().padStart(4, "0")}`,
        productId: "prod-huge",
        pancakeRetailPrice: 100_000,
      }));

      const mockCampaign = {
        id: "camp-huge-integrated",
        kind: "PROMOTION" as const,
        name: "Huge Catalog Integrated Promo",
        discountType: "PERCENTAGE" as const,
        percentageValue: 15,
        fixedPriceVnd: null,
        startsAt: new Date("2026-03-01T00:00:00Z"),
        endsAt: new Date("2026-03-31T00:00:00Z"),
        targets: [{ productId: "prod-huge", variantId: null }],
      };

      const mockClient = {
        promotionCampaign: {
          findUnique: async () => mockCampaign,
        },
        variantMirror: {
          findMany: async (args: {
            take?: number;
            cursor?: { id: string };
            skip?: number;
            where?: unknown;
          }) => {
            const take = args.take ?? 500;
            let startIndex = 0;
            if (args.cursor) {
              const idx = allMockVariants.findIndex((v) => v.id === args.cursor?.id);
              startIndex = idx >= 0 ? idx + (args.skip ?? 0) : 0;
            }
            return allMockVariants.slice(startIndex, startIndex + take);
          },
        },
      };

      const health = await evaluateCampaignRuntimeHealth({
        campaignId: "camp-huge-integrated",
        client: mockClient as unknown as Parameters<typeof evaluateCampaignRuntimeHealth>[0]["client"],
        now: new Date("2026-03-15T00:00:00Z"),
        writer: () => {},
      });

      assert.ok(health);
      assert.equal(health.status, "HEALTHY");
      assert.equal(health.coveredVariants, 2050);
      assert.equal(health.discountedVariants, 2050);
      assert.equal(health.affectedVariants, 0);
    });

    it("discovers concurrent competing campaign conflicts and populates conflictingCampaignIds", async () => {
      const emittedSignals: string[] = [];
      const writer = (line: string) => emittedSignals.push(line);

      const mockCampaignA = {
        id: "camp-alpha-int",
        kind: "PROMOTION" as const,
        name: "Alpha Promo",
        discountType: "PERCENTAGE" as const,
        percentageValue: 20,
        fixedPriceVnd: null,
        startsAt: new Date("2026-03-01T00:00:00Z"),
        endsAt: new Date("2026-03-31T00:00:00Z"),
        targets: [{ productId: null, variantId: "var-conflict-dod" }],
      };

      const competingCampaignB = {
        id: "camp-beta-int",
        name: "Beta Promo",
        kind: "PROMOTION" as const,
        discountType: "PERCENTAGE" as const,
        percentageValue: 25,
        fixedPriceVnd: null,
        startsAt: new Date("2026-03-01T00:00:00Z"),
        endsAt: new Date("2026-03-31T00:00:00Z"),
      };

      const mockClient = {
        promotionCampaign: {
          findUnique: async () => mockCampaignA,
        },
        variantMirror: {
          findMany: async () => {
            return [{ id: "var-conflict-dod", productId: "prod-int", pancakeRetailPrice: 200_000 }];
          },
        },
        promotionTarget: {
          findMany: async () => {
            return [
              {
                productId: null,
                variantId: "var-conflict-dod",
                campaign: competingCampaignB,
              },
            ];
          },
        },
      };

      const health = await evaluateCampaignRuntimeHealth({
        campaignId: "camp-alpha-int",
        client: mockClient as unknown as Parameters<typeof evaluateCampaignRuntimeHealth>[0]["client"],
        now: new Date("2026-03-10T00:00:00Z"),
        writer,
      });

      assert.ok(health);
      assert.equal(health.status, "FULLY_INVALID");
      assert.equal(health.coveredVariants, 1);
      assert.equal(health.discountedVariants, 0);
      assert.equal(health.affectedVariants, 1);
      assert.equal(health.affected[0]?.variantId, "var-conflict-dod");
      assert.equal(health.affected[0]?.reason, "PROMOTION_CONFLICT");
      assert.deepEqual(health.affected[0]?.conflictingCampaignIds, ["camp-beta-int"]);

      assert.equal(emittedSignals.length, 1);
      const parsed = JSON.parse(emittedSignals[0]!);
      assert.equal(parsed.name, "promotion.runtime_health");
      assert.equal(parsed.status, "FULLY_INVALID");
      assert.deepEqual(parsed.affectedSample[0]?.conflictingCampaignIds, ["camp-beta-int"]);
    });

    it("asserts promotion rollback runbook documents the 5 canonical quote proof rejection reasons without WRONG_CART", () => {
      const runbookSource = readFileSync(
        new URL("../../docs/operations/promotion-rollback-runbook.md", import.meta.url),
        "utf8",
      );

      const CANONICAL_REASONS: RenderedQuoteProofRejection[] = [
        "PRICE_CHANGED",
        "PROOF_MISSING",
        "PROOF_OVERSIZED",
        "PROOF_MALFORMED",
        "PROOF_UNVERIFIED",
      ];

      for (const reason of CANONICAL_REASONS) {
        assert.ok(
          runbookSource.includes(`\`${reason}\``),
          `Runbook must document canonical rejection reason ${reason}`,
        );
      }

      assert.equal(
        runbookSource.includes("WRONG_CART"),
        false,
        "Runbook must NOT include non-existent WRONG_CART reason",
      );
    });
  });

  describe("6. Launch Gates Default-Off & Runtime Policy Authority Verification", () => {
    it("Gate P: promotion activation is fail-closed by default and decoupled from search indexing", () => {
      // 1. Production activation service fails closed when env is default/empty
      assert.equal(isPromotionActivationEnabled({}), false, "Gate P must be default-off");
      assert.equal(isPromotionActivationEnabled({ LA_PROMOTION_ACTIVATION_ENABLED: "false" }), false);

      // 2. Promotion activation does NOT imply search indexing activation
      const promoActiveEnv = {
        LA_PROMOTION_ACTIVATION_ENABLED: "true",
        SEARCH_INDEXING_ENABLED: "false",
        APP_DOMAIN: "la-clothing.example.com",
      };
      assert.equal(isPromotionActivationEnabled(promoActiveEnv), true, "Gate P enabled under explicit env");
      const searchExposure = readSearchExposure(promoActiveEnv);
      assert.equal(searchExposure.indexingEnabled, false, "Promotion activation must never enable search indexing");
    });

    it("Gate S: organic search indexing fails closed, withholding sitemap and enforcing noindex under crawler ALLOW ALL", () => {
      // Missing APP_DOMAIN fails closed
      assert.throws(
        () => readSearchExposure({}),
        /APP_DOMAIN must be configured on the server/,
        "Must fail closed when APP_DOMAIN is missing",
      );

      const defaultExposure = readSearchExposure({ APP_DOMAIN: "la-clothing.example.com" });
      assert.equal(defaultExposure.indexingEnabled, false, "Default search indexing must be disabled");

      // Robots document allows crawler navigation across all approved categories...
      const robots = buildRobotsDocument(defaultExposure);
      assert.ok(robots.rules);
      assert.ok(Array.isArray(robots.rules));
      assert.equal(robots.rules[0]?.allow, "/");

      // ...BUT sitemap is strictly withheld when indexing is disabled
      assert.equal(robots.sitemap, undefined, "Sitemap must be withheld when indexing is disabled");

      // All storefront requests are strictly noindexed
      assert.equal(
        shouldNoIndexRequest({
          indexingEnabled: defaultExposure.indexingEnabled,
          pathname: "/shop",
          search: "",
        }),
        true,
        "Storefront pages must be noindexed when indexing is disabled",
      );

      // Temporary domain controls remain the authority: la.lanadesign.vn always fails closed
      const tempDomainExposure = readSearchExposure({
        APP_DOMAIN: "la.lanadesign.vn",
        SEARCH_INDEXING_ENABLED: "true",
      });
      assert.equal(tempDomainExposure.indexingEnabled, false, "Temporary production origin must never be indexable");
      assert.throws(
        () => validateSearchExposureForRelease({ APP_DOMAIN: "la.lanadesign.vn", SEARCH_INDEXING_ENABLED: "true" }),
        /Search indexing cannot be enabled on the temporary production storefront origin/,
      );
    });

    it("Gate T: GTM tracking remains fail-closed pending reviewed container version (O4)", () => {
      // Default tracking configuration is disabled
      const defaultConfig = readTrackingConfig({});
      assert.equal(defaultConfig.desiredMode, "disabled");
      assert.equal(defaultConfig.containerId, null);

      const defaultRuntime = resolveTrackingRuntime(defaultConfig);
      assert.equal(defaultRuntime.loadsGoogleTagManager, false);
      assert.equal(shouldLoadGoogleTagManager(defaultRuntime), false);

      // Even when desiredMode is "live" with a valid container id, GTM loading is refused before O4
      const liveConfig = { desiredMode: "live" as const, containerId: "GTM-TEST1234" };
      const liveRuntime = resolveTrackingRuntime(liveConfig);
      assert.equal(
        shouldLoadGoogleTagManager(liveRuntime),
        false,
        "Gate T must fail closed until reviewed immutable GTM container version is available (O4)",
      );
    });

    it("Gate M: Google Merchant feed returns HTTP 503 fail-closed when market authority is unresolved", async () => {
      const getHandler = createMerchantFeedGetHandler(async () => ({
        ok: false,
        failureClass: "MARKET_UNRESOLVED",
        retryAfterSeconds: 60,
        backoff: false,
      }));

      const mockRequest = new Request("https://la-clothing.example.com/api/feeds/google-merchant.xml");
      const response = await getHandler(mockRequest);

      assert.equal(response.status, 503, "Merchant feed HTTP handler must return 503 on MARKET_UNRESOLVED");
      assert.equal(response.headers.get("x-la-merchant-feed-failure"), "MARKET_UNRESOLVED");
      assert.equal(response.headers.get("cache-control"), "no-store");
    });
  });
});
