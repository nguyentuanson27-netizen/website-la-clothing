import assert from "node:assert/strict";
import test from "node:test";

import {
  assessCampaignRuntimeHealth,
  MAX_REPORTED_AFFECTED_VARIANTS,
  type VariantPricingOutcome,
} from "../../src/commerce/promotion-runtime-health.ts";

function outcome(
  variantId: string,
  overrides: Partial<VariantPricingOutcome> = {},
): VariantPricingOutcome {
  return {
    variantId,
    isDiscounted: true,
    reason: null,
    conflictingCampaignIds: [],
    ...overrides,
  };
}

test("P3 a campaign discounting every covered variant is healthy", () => {
  const health = assessCampaignRuntimeHealth({
    campaignId: "c-1",
    outcomes: [outcome("v-1"), outcome("v-2")],
  });

  assert.equal(health.status, "HEALTHY");
  assert.equal(health.coveredVariants, 2);
  assert.equal(health.discountedVariants, 2);
  assert.deepEqual(health.affected, []);
});

test("P3 healthy siblings continue while only the offending variant loses the promotion", () => {
  const health = assessCampaignRuntimeHealth({
    campaignId: "c-1",
    outcomes: [
      outcome("v-ok"),
      outcome("v-bad", { isDiscounted: false, reason: "PROMOTION_INVALID" }),
    ],
  });

  assert.equal(health.status, "PARTIALLY_INVALID");
  assert.equal(health.discountedVariants, 1);
  assert.deepEqual(health.affected, [{ variantId: "v-bad", reason: "PROMOTION_INVALID", conflictingCampaignIds: [] }]);
});

test("P3 a campaign where no covered variant can be discounted is fully invalid", () => {
  const health = assessCampaignRuntimeHealth({
    campaignId: "c-1",
    outcomes: [
      outcome("v-1", { isDiscounted: false, reason: "PROMOTION_INVALID" }),
      outcome("v-2", { isDiscounted: false, reason: "BASE_PRICE_UNAVAILABLE" }),
    ],
  });

  assert.equal(health.status, "FULLY_INVALID");
  assert.equal(health.discountedVariants, 0);
  assert.equal(health.affected.length, 2);
});

test("P3 an unusable base price is reported as its own reason, not as a promotion defect", () => {
  const health = assessCampaignRuntimeHealth({
    campaignId: "c-1",
    outcomes: [outcome("v-1"), outcome("v-2", { isDiscounted: false, reason: "BASE_PRICE_UNAVAILABLE" })],
  });

  assert.deepEqual(health.affected[0]?.reason, "BASE_PRICE_UNAVAILABLE");
  assert.equal(health.status, "PARTIALLY_INVALID");
});

test("P3 a conflict names every competing campaign so an admin can resolve it", () => {
  const health = assessCampaignRuntimeHealth({
    campaignId: "c-1",
    outcomes: [
      outcome("v-1", {
        isDiscounted: false,
        reason: "PROMOTION_CONFLICT",
        conflictingCampaignIds: ["c-1", "c-2"],
      }),
    ],
  });

  assert.equal(health.status, "FULLY_INVALID");
  assert.deepEqual(health.affected[0]?.conflictingCampaignIds, ["c-1", "c-2"]);
});

test("P3 recovery needs no write: the same variant turning valid returns to healthy", () => {
  const broken = assessCampaignRuntimeHealth({
    campaignId: "c-1",
    outcomes: [outcome("v-1", { isDiscounted: false, reason: "PROMOTION_INVALID" })],
  });
  const recovered = assessCampaignRuntimeHealth({
    campaignId: "c-1",
    outcomes: [outcome("v-1")],
  });

  assert.equal(broken.status, "FULLY_INVALID");
  assert.equal(recovered.status, "HEALTHY");
  assert.deepEqual(recovered.affected, [], "health is derived, so recovery is automatic");
});

test("P3 a campaign covering nothing right now is reported as such, not as healthy", () => {
  const health = assessCampaignRuntimeHealth({ campaignId: "c-1", outcomes: [] });

  assert.equal(health.status, "NO_COVERAGE");
  assert.equal(health.coveredVariants, 0);
});

test("P3 the affected list is bounded while the counts stay complete", () => {
  const outcomes = Array.from({ length: MAX_REPORTED_AFFECTED_VARIANTS + 30 }, (_, index) =>
    outcome(`v-${index}`, { isDiscounted: false, reason: "PROMOTION_INVALID" }),
  );

  const health = assessCampaignRuntimeHealth({ campaignId: "c-1", outcomes });

  assert.equal(health.coveredVariants, MAX_REPORTED_AFFECTED_VARIANTS + 30);
  assert.equal(health.affectedVariants, MAX_REPORTED_AFFECTED_VARIANTS + 30);
  assert.equal(health.affected.length, MAX_REPORTED_AFFECTED_VARIANTS);
  assert.equal(health.affectedTruncated, true);
});

test("P3 health carries no money, so an admin report cannot leak pricing detail by accident", () => {
  const health = assessCampaignRuntimeHealth({
    campaignId: "c-1",
    outcomes: [outcome("v-1", { isDiscounted: false, reason: "PROMOTION_INVALID" })],
  });

  const serialized = JSON.stringify(health);
  for (const forbidden of ["price", "Vnd", "vnd", "amount"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not appear in health`);
  }
});
