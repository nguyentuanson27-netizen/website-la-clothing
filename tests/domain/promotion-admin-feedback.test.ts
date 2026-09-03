/**
 * U14 / P5 — bounded, typed admin feedback.
 *
 * The admin surface is a thin client over the P4 service. Its job on failure is to say what an
 * operator can act on, and to say nothing an operator cannot: no SQL, no Prisma error codes, no
 * table or constraint names, no internal identifiers.
 *
 * This also resolves the observation Checkpoint A carried forward. A Draft save with duplicate
 * targets was already refused correctly — the database unique constraint rolled the transaction
 * back and left the pricing revision untouched — but it surfaced as a raw driver error. The
 * translation below turns that one known violation into a typed result, without swallowing
 * anything it does not recognise.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_TARGET_SEARCH_LIMIT,
  MAX_ADMIN_PROMOTION_PAGE_SIZE,
  describePromotionFailure,
  parseAdminPromotionPageSize,
  parseAdminTargetSearchLimit,
  translatePromotionWriteError,
} from "../../src/commerce/promotion-admin-feedback.ts";

test("P5 the reviewed admin bounds are the spec's numbers", () => {
  assert.equal(MAX_ADMIN_PROMOTION_PAGE_SIZE, 50);
  assert.equal(ADMIN_TARGET_SEARCH_LIMIT, 50);
});

test("P5 admin list and search sizes are clamped, not trusted", () => {
  for (const [requested, expected] of [
    [1, 1], [50, 50],
    // Over the bound clamps rather than throwing: a hand-edited query string is an operator
    // mistake, not an attack surface worth a 500.
    [51, 50], [10_000, 50],
    // Nonsense falls back to the bound rather than to zero, which would render an empty screen
    // that looks like "no campaigns exist".
    [0, 50], [-1, 50], [Number.NaN, 50], [1.5, 50],
  ] as const) {
    assert.equal(parseAdminPromotionPageSize(requested), expected, `page size ${requested}`);
    assert.equal(parseAdminTargetSearchLimit(requested), expected, `search limit ${requested}`);
  }
});

test("P5 every typed activation failure gets an operator-facing message", () => {
  const failures = [
    { reason: "ACTIVATION_DISABLED" },
    { reason: "CAMPAIGN_NOT_FOUND" },
    { reason: "ILLEGAL_TRANSITION", from: "ACTIVE" },
    { reason: "INVALID_CAMPAIGN", errors: ["PERCENTAGE_OUT_OF_RANGE"] },
    { reason: "INVALID_DRAFT_INPUT", errors: ["NAME_TOO_LONG"] },
    { reason: "TARGET_EXPANSION_LIMIT_EXCEEDED" },
    { reason: "NO_EFFECTIVE_DISCOUNT", invalidVariantIds: ["v1"] },
    { reason: "UNUSABLE_BASE_PRICE", variantIds: ["v1"] },
    { reason: "OVERLAPPING_CAMPAIGN", conflictingCampaignIds: ["c1"] },
    { reason: "DUPLICATE_TARGET" },
  ] as const;

  for (const failure of failures) {
    const described = describePromotionFailure(failure);
    assert.ok(described.message.length > 0, `${failure.reason} must produce a message`);
    assert.equal(described.reason, failure.reason);
  }
});

test("P5 the activation gate reads as a deliberate configuration state, not a bug", () => {
  const described = describePromotionFailure({ reason: "ACTIVATION_DISABLED" });

  assert.match(described.message, /kích hoạt/i);
  // An operator who sees this should understand nothing was written, so they do not retry blindly.
  assert.equal(described.wroteNothing, true);
});

test("P5 messages never leak identifiers, SQL or driver detail", () => {
  const described = describePromotionFailure({
    reason: "OVERLAPPING_CAMPAIGN",
    conflictingCampaignIds: ["cmt-secret-campaign-id"],
  });

  assert.equal(described.message.includes("cmt-secret-campaign-id"), false);
  for (const leak of ["PromotionTarget", "prisma", "P2002", "SELECT", "constraint", "cuid"]) {
    assert.equal(
      described.message.toLowerCase().includes(leak.toLowerCase()),
      false,
      `${leak} must not appear in an operator message`,
    );
  }
});

test("P5 a known duplicate-target violation becomes a typed failure", () => {
  // Shaped like the driver error the unique constraint raises, without importing its class.
  const duplicate = Object.assign(new Error("Unique constraint failed"), {
    code: "P2002",
    meta: { modelName: "PromotionTarget", target: ["campaignId", "productId"] },
  });

  const translated = translatePromotionWriteError(duplicate);
  assert.deepEqual(translated, { reason: "DUPLICATE_TARGET" });
});

test("P5 an unrelated database error is never swallowed", () => {
  // Swallowing anything unrecognised would turn a genuine outage into "duplicate target" and hide
  // it from whoever is on call.
  for (const unrelated of [
    Object.assign(new Error("connection refused"), { code: "P1001" }),
    Object.assign(new Error("Unique constraint failed"), {
      code: "P2002",
      meta: { modelName: "SomeOtherTable", target: ["id"] },
    }),
    new Error("something else entirely"),
    "not an error at all",
  ]) {
    assert.equal(
      translatePromotionWriteError(unrelated),
      null,
      "an unrecognised failure must be reported as unrecognised",
    );
  }
});
