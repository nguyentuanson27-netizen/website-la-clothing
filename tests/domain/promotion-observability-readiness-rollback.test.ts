import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assessCampaignRuntimeHealth,
  type VariantPricingOutcome,
} from "../../src/commerce/promotion-runtime-health.ts";
import {
  createGuestCheckoutSubmitService,
  type GuestCheckoutSubmitDependencies,
} from "../../src/commerce/guest-checkout-submit.ts";
import type { RenderedQuoteProofRejection } from "../../src/commerce/checkout-quote-proof.ts";
import {
  describeActivationGate,
  describeActivationRejection,
  describeCampaignRuntimeHealth,
  describeRenderedQuoteProofRejection,
  emitPromotionSignal,
  MAX_REPORTED_HEALTH_CONFLICTS,
  MAX_REPORTED_HEALTH_SAMPLE,
  MAX_REPORTED_SIGNAL_IDENTIFIERS,
  type PromotionObservabilitySignal,
} from "../../src/operations/promotion-observability.ts";
import {
  runPromotionAdminOperation,
} from "../../src/operations/promotion-admin-operation.ts";
import { createMerchantFeedCoordinator } from "../../src/commerce/merchant-feed-coordinator.ts";

describe("U40 / G2: Observability, Readiness & Rollback Invariants", () => {
  describe("1. PRICE_CHANGED phase and quote-proof rejection reason observability", () => {
    it("notifies onQuoteProofRejection with the exact reason during checkout submission (P9a)", async () => {
      const recordedReasons: RenderedQuoteProofRejection[] = [];

      const mockSnapshotService: GuestCheckoutSubmitDependencies["snapshot"] = {
        create: async () => ({
          ok: false,
          reason: "QUOTE_UNPROVEN",
          quoteReason: "PROOF_MALFORMED",
          refreshedQuote: {
            merchandiseSubtotalVnd: 500_000,
            shippingFeeVnd: 30_000,
            totalVnd: 530_000,
            totalQuantity: 1,
            items: [],
          },
        }),
      };

      const mockOrderSubmission: GuestCheckoutSubmitDependencies["orderSubmission"] = {
        submit: async () => {
          throw new Error("should not reach POS submission");
        },
      };

      const submitService = createGuestCheckoutSubmitService({
        snapshot: mockSnapshotService,
        orderSubmission: mockOrderSubmission,
        generatePublicCode: () => "LA-2026-TEST-01",
        onQuoteProofRejection: (reason) => {
          recordedReasons.push(reason);
        },
      });

      const outcome = await submitService.submit({
        cartId: "test-cart-uuid",
        shopId: 1,
        checkoutInput: {},
        now: new Date(),
      });

      // Buyer sees PRICE_CHANGED handshake with refreshed quote
      assert.equal(outcome.ok, false);
      assert.equal(outcome.status, "PRICE_CHANGED");
      if (outcome.status === "PRICE_CHANGED") {
        assert.equal(outcome.priceChange.totalVnd, 530_000);
      }

      // Telemetry records exact rejection reason
      assert.equal(recordedReasons.length, 1);
      assert.equal(recordedReasons[0], "PROOF_MALFORMED");

      // Signal descriptor formats accurately with phase and reason
      const signal = describeRenderedQuoteProofRejection({ reason: recordedReasons[0]! });
      assert.deepEqual(signal, {
        name: "checkout.quote_proof_rejected",
        phase: "rendered_quote_verification",
        reason: "PROOF_MALFORMED",
      });
    });

    it("distinguishes P9a rendered-quote proof rejection from downstream P9b catalog submission repricing", () => {
      // P9a: rendered quote proof rejection
      const p9aSignal = describeRenderedQuoteProofRejection({ reason: "PRICE_CHANGED" });
      assert.equal(p9aSignal.name, "checkout.quote_proof_rejected");
      assert.equal(p9aSignal.phase, "rendered_quote_verification");
      assert.equal(p9aSignal.reason, "PRICE_CHANGED");

      // P9b: catalog drift during POS submission (follows pancake_order event convention)
      const p9bEvent = {
        name: "pancake_order.quote_repriced" as const,
        correlationId: "LA-2026-ORDER-99",
        state: "DRAFT" as const,
        reason: "PRICE_CHANGED" as const,
      };
      assert.equal(p9bEvent.name, "pancake_order.quote_repriced");
      assert.equal(p9bEvent.state, "DRAFT");
      assert.equal(p9bEvent.reason, "PRICE_CHANGED");

      // They operate in distinct phases and carry distinct event names
      assert.notEqual(p9aSignal.name, p9bEvent.name);
      assert.notEqual(p9aSignal.phase, p9bEvent.state);
    });
  });

  describe("2. Runtime campaign health, PARTIALLY_INVALID, and recovery telemetry", () => {
    it("emits promotion.runtime_health signal through production call path with bounded samples", () => {
      const emittedLines: string[] = [];
      const writer = (line: string) => emittedLines.push(line);

      const outcomes: VariantPricingOutcome[] = [
        { variantId: "var-ok-1", isDiscounted: true, reason: null, conflictingCampaignIds: [] },
        { variantId: "var-ok-2", isDiscounted: true, reason: null, conflictingCampaignIds: [] },
        {
          variantId: "var-unusable",
          isDiscounted: false,
          reason: "BASE_PRICE_UNAVAILABLE",
          conflictingCampaignIds: [],
        },
        {
          variantId: "var-conflict",
          isDiscounted: false,
          reason: "PROMOTION_CONFLICT",
          conflictingCampaignIds: ["other-camp-1"],
        },
      ];

      const health = assessCampaignRuntimeHealth({
        campaignId: "camp-summer",
        outcomes,
        writer,
      });

      assert.equal(health.status, "PARTIALLY_INVALID");
      assert.equal(health.coveredVariants, 4);
      assert.equal(health.discountedVariants, 2);
      assert.equal(health.affectedVariants, 2);

      assert.equal(emittedLines.length, 1);
      const parsed = JSON.parse(emittedLines[0]!);
      assert.equal(parsed.name, "promotion.runtime_health");
      assert.equal(parsed.campaignId, "camp-summer");
      assert.equal(parsed.status, "PARTIALLY_INVALID");
      assert.equal(parsed.affectedVariants, 2);
      assert.equal(parsed.affectedSample.length, 2);
      assert.equal(parsed.affectedSample[0]?.variantId, "var-unusable");
      assert.equal(parsed.affectedSample[0]?.reason, "BASE_PRICE_UNAVAILABLE");
      assert.equal(parsed.affectedSample[1]?.variantId, "var-conflict");
      assert.deepEqual(parsed.affectedSample[1]?.conflictingCampaignIds, ["other-camp-1"]);
    });

    it("automatically recovers to HEALTHY and emits healthy signal without state writes", () => {
      const emittedLines: string[] = [];
      const writer = (line: string) => emittedLines.push(line);

      // Offending variant was fixed (e.g. catalog base price corrected)
      const resolvedOutcomes: VariantPricingOutcome[] = [
        { variantId: "var-ok-1", isDiscounted: true, reason: null, conflictingCampaignIds: [] },
        { variantId: "var-ok-2", isDiscounted: true, reason: null, conflictingCampaignIds: [] },
        { variantId: "var-unusable", isDiscounted: true, reason: null, conflictingCampaignIds: [] },
        { variantId: "var-conflict", isDiscounted: true, reason: null, conflictingCampaignIds: [] },
      ];

      const recoveredHealth = assessCampaignRuntimeHealth({
        campaignId: "camp-summer",
        outcomes: resolvedOutcomes,
        writer,
      });

      assert.equal(recoveredHealth.status, "HEALTHY");
      assert.equal(recoveredHealth.affectedVariants, 0);
      assert.equal(recoveredHealth.discountedVariants, 4);

      assert.equal(emittedLines.length, 1);
      const parsed = JSON.parse(emittedLines[0]!);
      assert.equal(parsed.status, "HEALTHY");
      assert.equal(parsed.affectedVariants, 0);
      assert.equal(parsed.affectedSample.length, 0);
    });

    it("bounds affected sample to 5 and conflicts to 10 with NDJSON strictly below 1KB", () => {
      const emittedLines: string[] = [];
      const writer = (line: string) => emittedLines.push(line);

      const outcomes: VariantPricingOutcome[] = Array.from({ length: 200 }, (_, i) => ({
        variantId: `var-bad-${i}`,
        isDiscounted: false,
        reason: "PROMOTION_INVALID",
        conflictingCampaignIds: Array.from({ length: 50 }, (_, c) => `camp-conf-${i}-${c}`),
      }));

      const health = assessCampaignRuntimeHealth({
        campaignId: "camp-huge",
        outcomes,
        writer,
      });

      assert.equal(health.status, "FULLY_INVALID");
      assert.equal(health.affectedVariants, 200);

      assert.equal(emittedLines.length, 1);
      const line = emittedLines[0]!;
      assert.ok(line.length < 1024, `Emitted NDJSON line (${line.length} bytes) must stay below 1KB`);

      const parsed = JSON.parse(line);
      assert.equal(parsed.affectedVariants, 200);
      assert.equal(parsed.affectedSample.length, MAX_REPORTED_HEALTH_SAMPLE);
      assert.equal(parsed.affectedTruncated, true);
      assert.equal(parsed.affectedSample[0]?.conflictingCampaignIds.length, MAX_REPORTED_HEALTH_CONFLICTS);
    });

    it("contains zero customer PII, secrets, quote proof, cart UUID, or monetary values", () => {
      const emittedLines: string[] = [];
      const writer = (line: string) => emittedLines.push(line);

      const outcomes: VariantPricingOutcome[] = [
        {
          variantId: "var-fail-1",
          isDiscounted: false,
          reason: "PROMOTION_CONFLICT",
          conflictingCampaignIds: ["camp-other"],
        },
      ];

      assessCampaignRuntimeHealth({
        campaignId: "camp-diagnose",
        outcomes,
        writer,
      });

      assert.equal(emittedLines.length, 1);
      const rawJson = emittedLines[0]!;
      const parsed = JSON.parse(rawJson);

      // Structural checks
      assert.equal("price" in parsed, false);
      assert.equal("unitPriceVnd" in parsed, false);
      assert.equal("basePriceVnd" in parsed, false);
      assert.equal("proof" in parsed, false);
      assert.equal("cartId" in parsed, false);

      // Text scan checks
      assert.equal(/price|vnd|retail|discount_value/i.test(rawJson), false);
      assert.equal(/proof|mac|secret|token/i.test(rawJson), false);
      assert.equal(/phone|email|address|customer|guest/i.test(rawJson), false);
      assert.equal(/cart-[0-9a-f-]{36}/i.test(rawJson), false);
    });

    it("swallows writer errors and protects assessment return value", () => {
      const throwingWriter = () => {
        throw new Error("Disk full or broken stdout stream");
      };

      const outcomes: VariantPricingOutcome[] = [
        { variantId: "var-1", isDiscounted: false, reason: "PROMOTION_INVALID", conflictingCampaignIds: [] },
      ];

      assert.doesNotThrow(() => {
        const health = assessCampaignRuntimeHealth({
          campaignId: "camp-throwing",
          outcomes,
          writer: throwingWriter,
        });
        assert.equal(health.status, "FULLY_INVALID");
        assert.equal(health.affectedVariants, 1);
      });
    });
  });

  describe("3. Conflict telemetry with bounded identifiers", () => {
    it("bounds conflicting campaign identifiers and filters oversized IDs", () => {
      const manyIds = Array.from({ length: 50 }, (_, i) => `conflict-camp-${i}`);
      manyIds.push("x".repeat(100)); // oversized ID

      const signal = describeActivationRejection({
        operation: "publish",
        campaignId: "target-camp",
        failure: {
          reason: "OVERLAPPING_CAMPAIGN",
          conflictingCampaignIds: manyIds,
        },
      });

      assert.equal(signal.reason, "OVERLAPPING_CAMPAIGN");
      if (signal.reason === "OVERLAPPING_CAMPAIGN") {
        assert.equal(signal.affectedCount, 51);
        assert.equal(signal.conflictingCampaignIds.length, MAX_REPORTED_SIGNAL_IDENTIFIERS);
        assert.equal(signal.conflictingCampaignIds[0], "conflict-camp-0");
        // oversized ID cannot appear in sample
        assert.ok(!signal.conflictingCampaignIds.includes("x".repeat(100)));
      }
    });
  });

  describe("4. Merchant durable-revision mismatch / rebuild observability", () => {
    const FEED_KEY = "merchant-feed:rss-v1:shop:1";

    it("emits pricing_revision_changed when revision advances during generation", async () => {
      const observedEvents: string[] = [];
      let currentRevision = BigInt(1);

      const coord = createMerchantFeedCoordinator({
        key: FEED_KEY,
        now: () => 1_000_000,
        observe: (event) => observedEvents.push(event),
        readPricingRevision: async () => currentRevision,
      });

      // Advance revision during generator execution
      const result = await coord.get({
        generate: async () => {
          currentRevision = BigInt(2); // mutation / rollback occurred
          return {
            ok: true,
            body: "<feed>stale-promo</feed>",
            byteLength: 24,
            offerCount: 1,
            nextPricingTransitionAtMs: null,
          };
        },
      });

      // Stale generation rejected with pricing_revision_changed event
      assert.equal(result.ok, false);
      assert.equal(observedEvents.includes("pricing_revision_changed"), true);
    });

    it("invalidates cached sale XML when durable revision advances", async () => {
      const observedEvents: string[] = [];
      let currentRevision = BigInt(1);

      const coord = createMerchantFeedCoordinator({
        key: FEED_KEY,
        now: () => 1_000_000,
        observe: (event) => observedEvents.push(event),
        readPricingRevision: async () => currentRevision,
      });

      // 1. Initial generation under revision 1
      const first = await coord.get({
        generate: async () => ({
          ok: true,
          body: "<feed>sale-bytes</feed>",
          byteLength: 23,
          offerCount: 1,
          nextPricingTransitionAtMs: null,
        }),
      });
      assert.equal(first.ok, true);

      // 2. Cache hit under revision 1
      const hit = await coord.get({
        generate: async () => {
          throw new Error("should not generate on cache hit");
        },
      });
      assert.equal(hit.ok, true);
      assert.equal(observedEvents.includes("success_cache_hit"), true);

      // 3. Rollback advances durable revision to 2
      currentRevision = BigInt(2);

      // 4. Next get cannot serve cached revision 1 bytes -> cold_generation rebuilds
      const afterRollback = await coord.get({
        generate: async () => ({
          ok: true,
          body: "<feed>reverted-base-bytes</feed>",
          byteLength: 32,
          offerCount: 1,
          nextPricingTransitionAtMs: null,
        }),
      });
      assert.equal(afterRollback.ok, true);
      if (afterRollback.ok) {
        assert.equal(afterRollback.body, "<feed>reverted-base-bytes</feed>");
      }
    });
  });

  describe("5. Rollback properties & kill switch", () => {
    it("kill switch LA_PROMOTION_ACTIVATION_ENABLED=false halts activation and emits gate telemetry", async () => {
      const emittedSignals: PromotionObservabilitySignal[] = [];

      const outcome = await runPromotionAdminOperation({
        operation: "publish",
        campaignId: "camp-01",
        authorize: async () => ({ user: { id: "admin-1" } }),
        env: { LA_PROMOTION_ACTIVATION_ENABLED: "false" },
        emit: (signal) => emittedSignals.push(signal),
        onCommitted: () => {},
        run: async (_session, context) => {
          context.reportActivationGate();
          return {
            ok: false,
            failure: { reason: "ACTIVATION_DISABLED" },
          };
        },
      });

      assert.equal(outcome.ok, false);
      if (!outcome.ok) {
        assert.equal(outcome.failure.reason, "ACTIVATION_DISABLED");
      }

      // Emitted activation_gate signal
      assert.deepEqual(emittedSignals[0], {
        name: "promotion.activation_gate",
        operation: "publish",
        enabled: false,
      });

      // Emitted activation_rejected signal
      assert.deepEqual(emittedSignals[1], {
        name: "promotion.activation_rejected",
        operation: "publish",
        campaignId: "camp-01",
        reason: "ACTIVATION_DISABLED",
      });
    });
  });

  describe("6. Complete sanitization and privacy of all telemetry signals", () => {
    it("serializes all signals as single-line JSON under 1KB with no PII, tokens, or raw secrets", () => {
      const signals: PromotionObservabilitySignal[] = [
        describeActivationGate({ operation: "disable", enabled: false }),
        describeActivationRejection({
          operation: "edit",
          campaignId: "camp-01",
          failure: {
            reason: "OVERLAPPING_CAMPAIGN",
            conflictingCampaignIds: ["camp-02", "camp-03"],
          },
        }),
        describeCampaignRuntimeHealth({
          campaignId: "camp-01",
          status: "PARTIALLY_INVALID",
          coveredVariants: 10,
          discountedVariants: 8,
          affectedVariants: 2,
          affected: [
            { variantId: "var-1", reason: "PROMOTION_INVALID", conflictingCampaignIds: [] },
            { variantId: "var-2", reason: "PROMOTION_CONFLICT", conflictingCampaignIds: ["camp-02"] },
          ],
          affectedTruncated: false,
        }),
        describeRenderedQuoteProofRejection({ reason: "PROOF_UNVERIFIED" }),
      ];

      const capturedLines: string[] = [];
      const writer = (line: string) => capturedLines.push(line);

      for (const signal of signals) {
        emitPromotionSignal(signal, writer);
      }

      assert.equal(capturedLines.length, 4);

      for (const line of capturedLines) {
        // Ends with newline
        assert.ok(line.endsWith("\n"));
        // Single line (no embedded newlines)
        assert.equal(line.trim().includes("\n"), false);
        // Size under 1024 bytes
        assert.ok(Buffer.byteLength(line, "utf8") < 1024);

        // Forbidden terms: customer PII, secrets, cart UUIDs
        const lower = line.toLowerCase();
        assert.equal(lower.includes("bearer"), false);
        assert.equal(lower.includes("secret"), false);
        assert.equal(lower.includes("cookie"), false);
        assert.equal(lower.includes("la_cart"), false);
        assert.equal(lower.includes("phone"), false);
        assert.equal(lower.includes("address"), false);
      }
    });
  });
});
