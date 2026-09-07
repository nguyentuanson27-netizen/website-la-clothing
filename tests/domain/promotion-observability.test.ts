import assert from "node:assert/strict";
import test from "node:test";

import type { PromotionAdminFailure } from "../../src/commerce/promotion-admin-feedback.ts";
import { MAX_PROMOTION_IDENTIFIER_LENGTH } from "../../src/commerce/promotion-activation.ts";
import {
  MAX_REPORTED_ACTIVATION_ERRORS,
  MAX_REPORTED_SIGNAL_IDENTIFIERS,
  describeActivationGate,
  describeActivationRejection,
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
