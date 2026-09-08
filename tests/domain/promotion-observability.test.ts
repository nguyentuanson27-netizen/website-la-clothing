import assert from "node:assert/strict";
import test from "node:test";

import type { PromotionAdminFailure } from "../../src/commerce/promotion-admin-feedback.ts";
import type { RenderedQuoteProofRejection } from "../../src/commerce/checkout-quote-proof.ts";
import { MAX_PROMOTION_IDENTIFIER_LENGTH } from "../../src/commerce/promotion-activation.ts";
import {
  MAX_REPORTED_ACTIVATION_ERRORS,
  MAX_REPORTED_SIGNAL_IDENTIFIERS,
  MAX_REPORTED_HEALTH_SAMPLE,
  describeActivationGate,
  describeActivationRejection,
  describeCampaignRuntimeHealth,
  describeRenderedQuoteProofRejection,
  emitPromotionSignal,
} from "../../src/operations/promotion-observability.ts";

test("the activation gate signal carries only its boolean state", () => {
  assert.deepEqual(describeActivationGate({ operation: "publish", enabled: false }), {
    name: "promotion.activation_gate",
    operation: "publish",
    enabled: false,
  });
  assert.deepEqual(describeActivationGate({ operation: "edit", enabled: true }), {
    name: "promotion.activation_gate",
    operation: "edit",
    enabled: true,
  });
});

test("a rejection keeps its categorical reason", () => {
  for (const failure of [
    { reason: "ACTIVATION_DISABLED" },
    { reason: "CAMPAIGN_NOT_FOUND" },
    { reason: "TARGET_EXPANSION_LIMIT_EXCEEDED" },
    { reason: "DUPLICATE_TARGET" },
  ] as const satisfies readonly PromotionAdminFailure[]) {
    assert.deepEqual(describeActivationRejection({ operation: "publish", failure }), {
      name: "promotion.activation_rejected",
      operation: "publish",
      reason: failure.reason,
    });
  }
});

test("validation error codes survive because their vocabulary is bounded", () => {
  // These are a closed set of reason codes, not identifiers, and they are the whole diagnostic
  // value of the signal — dropping them would leave an operator with "something was invalid".
  assert.deepEqual(
    describeActivationRejection({
      operation: "publish",
      failure: {
        reason: "INVALID_CAMPAIGN",
        errors: ["NO_TARGETS", "WINDOW_ALREADY_ENDED"],
      },
    }),
    {
      name: "promotion.activation_rejected",
      operation: "publish",
      reason: "INVALID_CAMPAIGN",
      errors: ["NO_TARGETS", "WINDOW_ALREADY_ENDED"],
    },
  );

  assert.deepEqual(
    describeActivationRejection({
      operation: "edit",
      failure: { reason: "INVALID_DRAFT_INPUT", errors: ["IDENTIFIER_TOO_LONG"] },
    }),
    {
      name: "promotion.activation_rejected",
      operation: "edit",
      reason: "INVALID_DRAFT_INPUT",
      errors: ["IDENTIFIER_TOO_LONG"],
    },
  );
});

test("the lifecycle status a transition came from is categorical and kept", () => {
  assert.deepEqual(
    describeActivationRejection({
      operation: "publish",
      failure: { reason: "ILLEGAL_TRANSITION", from: "DISABLED" },
    }),
    {
      name: "promotion.activation_rejected",
      operation: "publish",
      reason: "ILLEGAL_TRANSITION",
      from: "DISABLED",
    },
  );
});

test("identifier arrays are sampled and counted, never emitted whole", () => {
  // `docs/specs/promotions-flash-sale-v1.md` §Observability names campaign, target and variant ids
  // as useful context, so what has to be bounded is volume, not existence: a refusal that named no
  // campaign at all would leave an operator with nowhere to start looking. The count is the real
  // total so the sample is never mistaken for the whole set.
  const variantIds = Array.from({ length: 250 }, (_, index) => `variant-${index}`);
  const signal = describeActivationRejection({
    operation: "publish",
    campaignId: "campaign-7",
    failure: { reason: "NO_EFFECTIVE_DISCOUNT", invalidVariantIds: variantIds },
  });

  assert.deepEqual(signal, {
    name: "promotion.activation_rejected",
    operation: "publish",
    campaignId: "campaign-7",
    reason: "NO_EFFECTIVE_DISCOUNT",
    affectedCount: 250,
    invalidVariantIds: variantIds.slice(0, MAX_REPORTED_SIGNAL_IDENTIFIERS),
  });

  assert.deepEqual(
    describeActivationRejection({
      operation: "publish",
      failure: { reason: "UNUSABLE_BASE_PRICE", variantIds: ["v-1", "v-2"] },
    }),
    {
      name: "promotion.activation_rejected",
      operation: "publish",
      reason: "UNUSABLE_BASE_PRICE",
      affectedCount: 2,
      variantIds: ["v-1", "v-2"],
    },
  );

  assert.deepEqual(
    describeActivationRejection({
      operation: "edit",
      campaignId: "campaign-7",
      failure: { reason: "OVERLAPPING_CAMPAIGN", conflictingCampaignIds: ["c-9"] },
    }),
    {
      name: "promotion.activation_rejected",
      operation: "edit",
      campaignId: "campaign-7",
      reason: "OVERLAPPING_CAMPAIGN",
      affectedCount: 1,
      conflictingCampaignIds: ["c-9"],
    },
  );
});

test("an identifier that was never legal input cannot ride into a log line", () => {
  // The bound is the same one the admin surface applies before any lookup, so a value that could
  // not have survived the front door cannot arrive inside a failure payload either. It is dropped
  // rather than truncated: a truncated identifier reads like a real one.
  const oversized = "x".repeat(MAX_PROMOTION_IDENTIFIER_LENGTH + 1);

  const signal = describeActivationRejection({
    operation: "publish",
    campaignId: oversized,
    failure: {
      reason: "OVERLAPPING_CAMPAIGN",
      conflictingCampaignIds: [oversized, "c-1", "", oversized],
    },
  });

  assert.deepEqual(signal, {
    name: "promotion.activation_rejected",
    operation: "publish",
    reason: "OVERLAPPING_CAMPAIGN",
    affectedCount: 4,
    conflictingCampaignIds: ["c-1"],
  });
});

test("no failure shape can write an unbounded line", () => {
  // Asserted over the serialized form rather than the object, because serialization is what a log
  // line actually carries — a nested array that no assertion happens to read would still ship.
  const many = Array.from({ length: 4000 }, (_, index) => `id-${index}`);
  const failures: readonly PromotionAdminFailure[] = [
    { reason: "ACTIVATION_DISABLED" },
    { reason: "CAMPAIGN_NOT_FOUND" },
    { reason: "ILLEGAL_TRANSITION", from: "SCHEDULED" },
    { reason: "INVALID_CAMPAIGN", errors: Array.from({ length: 400 }, () => "NO_TARGETS") },
    { reason: "INVALID_DRAFT_INPUT", errors: Array.from({ length: 400 }, () => "NAME_TOO_LONG") },
    { reason: "TARGET_EXPANSION_LIMIT_EXCEEDED" },
    { reason: "NO_EFFECTIVE_DISCOUNT", invalidVariantIds: many },
    { reason: "UNUSABLE_BASE_PRICE", variantIds: many },
    { reason: "OVERLAPPING_CAMPAIGN", conflictingCampaignIds: many },
    { reason: "DUPLICATE_TARGET" },
  ];

  for (const failure of failures) {
    const serialized = JSON.stringify(
      describeActivationRejection({
        operation: "publish",
        campaignId: "campaign-7",
        failure,
      }),
    );

    assert.ok(
      serialized.length < 1024,
      `${failure.reason} produced a ${serialized.length}-byte line: ${serialized.slice(0, 200)}`,
    );
  }
});

test("an oversized error list is truncated so one bad input cannot flood the log", () => {
  const errors = Array.from(
    { length: MAX_REPORTED_ACTIVATION_ERRORS + 5 },
    () => "NO_TARGETS" as const,
  );

  const signal = describeActivationRejection({
    operation: "publish",
    failure: { reason: "INVALID_CAMPAIGN", errors },
  });

  assert.equal(
    signal.reason === "INVALID_CAMPAIGN" && signal.errors.length,
    MAX_REPORTED_ACTIVATION_ERRORS,
  );
});

test("every PromotionAdminFailure reason produces a signal, so a new one cannot go unreported", () => {
  // A reason added to the union without a case here should fail to typecheck rather than silently
  // emit nothing; this asserts the runtime half of that.
  const failures: readonly PromotionAdminFailure[] = [
    { reason: "ACTIVATION_DISABLED" },
    { reason: "CAMPAIGN_NOT_FOUND" },
    { reason: "ILLEGAL_TRANSITION", from: "ACTIVE" },
    { reason: "INVALID_CAMPAIGN", errors: [] },
    { reason: "INVALID_DRAFT_INPUT", errors: [] },
    { reason: "TARGET_EXPANSION_LIMIT_EXCEEDED" },
    { reason: "NO_EFFECTIVE_DISCOUNT", invalidVariantIds: [] },
    { reason: "UNUSABLE_BASE_PRICE", variantIds: [] },
    { reason: "OVERLAPPING_CAMPAIGN", conflictingCampaignIds: [] },
    { reason: "DUPLICATE_TARGET" },
    { reason: "MALFORMED_FIXED_PRICE" },
    { reason: "INVALID_PERCENTAGE" },
    { reason: "INVALID_CAMPAIGN_KIND" },
    { reason: "INVALID_DISCOUNT_TYPE" },
    { reason: "INVALID_DATE_TIME" },
    { reason: "FORBIDDEN" },
  ];

  for (const failure of failures) {
    const signal = describeActivationRejection({ operation: "publish", failure });
    assert.equal(signal.name, "promotion.activation_rejected");
    assert.equal(signal.reason, failure.reason);
  }
});

test("emission writes one JSON line per signal", () => {
  const lines: string[] = [];

  emitPromotionSignal(describeActivationGate({ operation: "publish", enabled: false }), (line) =>
    lines.push(line),
  );
  emitPromotionSignal(
    describeActivationRejection({
      operation: "edit",
      failure: { reason: "OVERLAPPING_CAMPAIGN", conflictingCampaignIds: ["c-1", "c-2"] },
    }),
    (line) => lines.push(line),
  );

  assert.deepEqual(lines, [
    '{"name":"promotion.activation_gate","operation":"publish","enabled":false}\n',
    '{"name":"promotion.activation_rejected","operation":"edit","reason":"OVERLAPPING_CAMPAIGN","affectedCount":2,"conflictingCampaignIds":["c-1","c-2"]}\n',
  ]);
});

test("a failing writer never propagates out of emission", () => {
  // Observability must not turn a refused promotion into a crashed Server Action.
  assert.doesNotThrow(() =>
    emitPromotionSignal(describeActivationGate({ operation: "publish", enabled: true }), () => {
      throw new Error("stdout is gone");
    }),
  );
});

test("describeCampaignRuntimeHealth maps status and bounds affected variant samples", () => {
  const health = {
    campaignId: "campaign-sale-1",
    status: "PARTIALLY_INVALID" as const,
    coveredVariants: 50,
    discountedVariants: 35,
    affectedVariants: 15,
    affected: Array.from({ length: 15 }, (_, i) => ({
      variantId: `var-${i}`,
      reason: "PROMOTION_INVALID" as const,
      conflictingCampaignIds: [`conf-${i}`],
    })),
    affectedTruncated: false,
  };

  const signal = describeCampaignRuntimeHealth(health);
  assert.equal(signal.name, "promotion.runtime_health");
  assert.equal(signal.campaignId, "campaign-sale-1");
  assert.equal(signal.status, "PARTIALLY_INVALID");
  assert.equal(signal.coveredVariants, 50);
  assert.equal(signal.discountedVariants, 35);
  assert.equal(signal.affectedVariants, 15);
  assert.equal(signal.affectedTruncated, true);
  assert.equal(signal.affectedSample.length, MAX_REPORTED_HEALTH_SAMPLE);
  assert.equal(signal.affectedSample[0]?.variantId, "var-0");
  assert.equal(signal.affectedSample[0]?.reason, "PROMOTION_INVALID");
  assert.deepEqual(signal.affectedSample[0]?.conflictingCampaignIds, ["conf-0"]);

  // Serialized signal is compact and contains no price money fields or PII
  const serialized = JSON.stringify(signal);
  assert.ok(serialized.length < 1024, "signal must stay below 1KB");
  assert.equal(serialized.includes("price"), false, "never log prices");
  assert.equal(serialized.includes("vnd"), false, "never log money");
});

test("describeCampaignRuntimeHealth handles healthy and zero-coverage states cleanly", () => {
  const healthy = describeCampaignRuntimeHealth({
    campaignId: "healthy-1",
    status: "HEALTHY",
    coveredVariants: 20,
    discountedVariants: 20,
    affectedVariants: 0,
    affected: [],
    affectedTruncated: false,
  });
  assert.equal(healthy.status, "HEALTHY");
  assert.equal(healthy.affectedVariants, 0);
  assert.equal(healthy.affectedSample.length, 0);
  assert.equal(healthy.affectedTruncated, false);

  const noCoverage = describeCampaignRuntimeHealth({
    campaignId: "empty-1",
    status: "NO_COVERAGE",
    coveredVariants: 0,
    discountedVariants: 0,
    affectedVariants: 0,
    affected: [],
    affectedTruncated: false,
  });
  assert.equal(noCoverage.status, "NO_COVERAGE");
  assert.equal(noCoverage.coveredVariants, 0);
});

test("describeRenderedQuoteProofRejection records exact reason and phase with zero secrets or tokens", () => {
  const reasons: readonly RenderedQuoteProofRejection[] = [
    "PROOF_MISSING",
    "PROOF_OVERSIZED",
    "PROOF_MALFORMED",
    "PROOF_UNVERIFIED",
    "PRICE_CHANGED",
  ];

  for (const reason of reasons) {
    const signal = describeRenderedQuoteProofRejection({ reason });
    assert.deepEqual(signal, {
      name: "checkout.quote_proof_rejected",
      phase: "rendered_quote_verification",
      reason,
    });

    const serialized = JSON.stringify(signal);
    assert.ok(serialized.length < 200);
    assert.equal(serialized.includes("cart_id"), false);
    assert.equal(serialized.includes("token"), false);
    assert.equal(serialized.includes("secret"), false);
  }
});
