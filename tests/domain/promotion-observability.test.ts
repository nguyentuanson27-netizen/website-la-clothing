import assert from "node:assert/strict";
import test from "node:test";

import type { PromotionAdminFailure } from "../../src/commerce/promotion-admin-feedback.ts";
import {
  MAX_REPORTED_ACTIVATION_ERRORS,
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

test("identifier arrays are reduced to counts, never emitted", () => {
  // This is the whole point of the module. `ActivationFailure` names the exact catalog rows an
  // admin must fix, which is right for an admin screen and wrong for a log line: the arrays are
  // unbounded and are internal identifiers.
  const variantIds = Array.from({ length: 250 }, (_, index) => `variant-${index}`);

  assert.deepEqual(
    describeActivationRejection({
      operation: "publish",
      failure: { reason: "NO_EFFECTIVE_DISCOUNT", invalidVariantIds: variantIds },
    }),
    {
      name: "promotion.activation_rejected",
      operation: "publish",
      reason: "NO_EFFECTIVE_DISCOUNT",
      affectedCount: 250,
    },
  );

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
    },
  );

  assert.deepEqual(
    describeActivationRejection({
      operation: "edit",
      failure: { reason: "OVERLAPPING_CAMPAIGN", conflictingCampaignIds: ["c-9"] },
    }),
    {
      name: "promotion.activation_rejected",
      operation: "edit",
      reason: "OVERLAPPING_CAMPAIGN",
      affectedCount: 1,
    },
  );
});

test("no identifier reaches the serialized signal for any failure shape", () => {
  // Asserted over the serialized form rather than the object, because serialization is what a log
  // line actually carries — a nested identifier that no assertion happens to read would still ship.
  const failures: readonly PromotionAdminFailure[] = [
    { reason: "ACTIVATION_DISABLED" },
    { reason: "CAMPAIGN_NOT_FOUND" },
    { reason: "ILLEGAL_TRANSITION", from: "SCHEDULED" },
    { reason: "INVALID_CAMPAIGN", errors: ["NO_TARGETS"] },
    { reason: "INVALID_DRAFT_INPUT", errors: ["NAME_TOO_LONG"] },
    { reason: "TARGET_EXPANSION_LIMIT_EXCEEDED" },
    { reason: "NO_EFFECTIVE_DISCOUNT", invalidVariantIds: ["secret-variant-id"] },
    { reason: "UNUSABLE_BASE_PRICE", variantIds: ["secret-variant-id"] },
    { reason: "OVERLAPPING_CAMPAIGN", conflictingCampaignIds: ["secret-campaign-id"] },
    { reason: "DUPLICATE_TARGET" },
  ];

  for (const failure of failures) {
    const serialized = JSON.stringify(
      describeActivationRejection({ operation: "publish", failure }),
    );
    assert.equal(
      serialized.includes("secret-"),
      false,
      `identifier leaked for ${failure.reason}: ${serialized}`,
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
    '{"name":"promotion.activation_rejected","operation":"edit","reason":"OVERLAPPING_CAMPAIGN","affectedCount":2}\n',
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
