import assert from "node:assert/strict";
import test from "node:test";

import {
  isUsableBasePriceVnd,
  resolvePromotionPricing,
  type ApplicablePromotionCampaign,
} from "../../src/commerce/promotion-pricing.ts";

const NOW = new Date("2026-09-15T10:00:00.000Z");

function percentageCampaign(
  overrides: Partial<ApplicablePromotionCampaign> = {},
): ApplicablePromotionCampaign {
  return {
    id: "campaign-percentage",
    name: "Khuyến mãi tháng 9",
    kind: "PROMOTION",
    discountType: "PERCENTAGE",
    percentageValue: 10,
    fixedPriceVnd: null,
    startsAt: null,
    endsAt: null,
    ...overrides,
  };
}

function fixedCampaign(
  overrides: Partial<ApplicablePromotionCampaign> = {},
): ApplicablePromotionCampaign {
  return {
    id: "campaign-fixed",
    name: "Flash Sale tháng 9",
    kind: "FLASH_SALE",
    discountType: "FIXED_PRICE",
    percentageValue: null,
    fixedPriceVnd: BigInt(499_000),
    startsAt: new Date("2026-09-15T00:00:00.000Z"),
    endsAt: new Date("2026-09-16T00:00:00.000Z"),
    ...overrides,
  };
}

test("P2 a usable website base price is a positive safe integer and nothing else", () => {
  for (const usable of [1, 890_000, Number.MAX_SAFE_INTEGER]) {
    assert.equal(isUsableBasePriceVnd(usable), true, `${usable} must be usable`);
  }
  for (const unusable of [
    null,
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.equal(isUsableBasePriceVnd(unusable), false, `${unusable} must be unusable`);
  }
});

test("P2 an unusable base price fails closed for the whole variant", () => {
  for (const basePriceVnd of [null, 0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(
      resolvePromotionPricing({ basePriceVnd, campaigns: [percentageCampaign()], now: NOW }),
      {
        basePriceVnd: null,
        effectivePriceVnd: null,
        isDiscounted: false,
        promotion: null,
        reason: "BASE_PRICE_UNAVAILABLE",
        nextTransitionAt: null,
      },
      `${basePriceVnd} must fail closed`,
    );
  }
});

test("P2 no applicable campaign leaves the effective price equal to base", () => {
  assert.deepEqual(resolvePromotionPricing({ basePriceVnd: 890_000, campaigns: [], now: NOW }), {
    basePriceVnd: 890_000,
    effectivePriceVnd: 890_000,
    isDiscounted: false,
    promotion: null,
    reason: null,
    nextTransitionAt: null,
  });
});

test("P2 percentage uses exact integer arithmetic across the mandated fixtures", () => {
  for (const [basePriceVnd, percentageValue, expected] of [
    [150, 1, 149],
    [350, 1, 347],
    [110, 5, 105],
    [9_007_199_254_740_989, 1, 8_917_127_262_193_579],
  ] as const) {
    const result = resolvePromotionPricing({
      basePriceVnd,
      campaigns: [percentageCampaign({ percentageValue })],
      now: NOW,
    });

    assert.equal(
      result.effectivePriceVnd,
      expected,
      `${basePriceVnd} @ ${percentageValue}% must be ${expected}`,
    );
    assert.equal(result.isDiscounted, true);
    assert.equal(result.reason, null);
  }
});

test("P2 rounding that cannot produce a discount invalidates only that variant", () => {
  // 50 @ 1% rounds back to 50, so there is no discount to apply.
  const result = resolvePromotionPricing({
    basePriceVnd: 50,
    campaigns: [percentageCampaign({ percentageValue: 1 })],
    now: NOW,
  });

  assert.equal(result.basePriceVnd, 50);
  assert.equal(result.effectivePriceVnd, 50);
  assert.equal(result.isDiscounted, false);
  assert.equal(result.reason, "PROMOTION_INVALID");
  assert.equal(result.promotion, null);
});

test("P2 a malformed percentage is invalid rather than silently clamped", () => {
  for (const percentageValue of [0, 100, -1, 101, 1.5, Number.NaN, null]) {
    const result = resolvePromotionPricing({
      basePriceVnd: 890_000,
      campaigns: [percentageCampaign({ percentageValue })],
      now: NOW,
    });

    assert.equal(result.reason, "PROMOTION_INVALID", `${percentageValue} must be invalid`);
    assert.equal(result.effectivePriceVnd, 890_000);
    assert.equal(result.isDiscounted, false);
  }
});

test("P2 a fixed price is the final customer unit price, not an amount off", () => {
  const result = resolvePromotionPricing({
    basePriceVnd: 890_000,
    campaigns: [fixedCampaign()],
    now: NOW,
  });

  assert.equal(result.effectivePriceVnd, 499_000);
  assert.equal(result.isDiscounted, true);
  assert.equal(result.promotion?.id, "campaign-fixed");
  assert.equal(result.promotion?.discountType, "FIXED_PRICE");
});

test("P2 a fixed price at or above base, or outside the safe integer domain, is invalid", () => {
  for (const fixedPriceVnd of [
    BigInt(890_000),
    BigInt(890_001),
    BigInt(0),
    BigInt(-1),
    BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1),
    null,
  ]) {
    const result = resolvePromotionPricing({
      basePriceVnd: 890_000,
      campaigns: [fixedCampaign({ fixedPriceVnd })],
      now: NOW,
    });

    assert.equal(result.reason, "PROMOTION_INVALID", `${fixedPriceVnd} must be invalid`);
    assert.equal(result.effectivePriceVnd, 890_000);
    assert.equal(result.isDiscounted, false);
  }
});

test("P2 campaigns are never stacked: two applicable candidates are a conflict", () => {
  const result = resolvePromotionPricing({
    basePriceVnd: 890_000,
    campaigns: [percentageCampaign(), fixedCampaign()],
    now: NOW,
  });

  assert.equal(result.reason, "PROMOTION_CONFLICT");
  assert.equal(result.effectivePriceVnd, 890_000, "a conflict means no website promotion");
  assert.equal(result.isDiscounted, false);
  assert.equal(result.promotion, null);
});

test("P2 the active interval is half-open so a boundary hands over cleanly", () => {
  const startsAt = new Date("2026-09-15T00:00:00.000Z");
  const endsAt = new Date("2026-09-16T00:00:00.000Z");
  const campaigns = [fixedCampaign({ startsAt, endsAt })];

  // start is inclusive
  assert.equal(
    resolvePromotionPricing({ basePriceVnd: 890_000, campaigns, now: startsAt }).isDiscounted,
    true,
  );
  // end is exclusive
  const atEnd = resolvePromotionPricing({ basePriceVnd: 890_000, campaigns, now: endsAt });
  assert.equal(atEnd.isDiscounted, false);
  assert.equal(atEnd.reason, null, "an ended campaign is simply not applicable");
  // one millisecond before the end is still active
  assert.equal(
    resolvePromotionPricing({
      basePriceVnd: 890_000,
      campaigns,
      now: new Date(endsAt.getTime() - 1),
    }).isDiscounted,
    true,
  );
  // before the start it is scheduled, not applicable
  assert.equal(
    resolvePromotionPricing({
      basePriceVnd: 890_000,
      campaigns,
      now: new Date(startsAt.getTime() - 1),
    }).isDiscounted,
    false,
  );
});

test("P2 B may start exactly when A ends without ever overlapping", () => {
  const boundary = new Date("2026-09-16T00:00:00.000Z");
  const campaigns = [
    fixedCampaign({ id: "a", startsAt: new Date("2026-09-15T00:00:00.000Z"), endsAt: boundary }),
    fixedCampaign({
      id: "b",
      fixedPriceVnd: BigInt(450_000),
      startsAt: boundary,
      endsAt: new Date("2026-09-17T00:00:00.000Z"),
    }),
  ];

  const before = resolvePromotionPricing({
    basePriceVnd: 890_000,
    campaigns,
    now: new Date(boundary.getTime() - 1),
  });
  assert.equal(before.promotion?.id, "a");
  assert.equal(before.reason, null, "adjacent windows must not read as a conflict");

  const after = resolvePromotionPricing({ basePriceVnd: 890_000, campaigns, now: boundary });
  assert.equal(after.promotion?.id, "b");
  assert.equal(after.reason, null);
});

test("P2 the transition fact names the next boundary that changes this variant's price", () => {
  const startsAt = new Date("2026-09-15T00:00:00.000Z");
  const endsAt = new Date("2026-09-16T00:00:00.000Z");
  const laterStart = new Date("2026-09-20T00:00:00.000Z");

  const active = resolvePromotionPricing({
    basePriceVnd: 890_000,
    campaigns: [
      fixedCampaign({ startsAt, endsAt }),
      percentageCampaign({ startsAt: laterStart, endsAt: null }),
    ],
    now: NOW,
  });
  assert.deepEqual(active.nextTransitionAt, endsAt, "the active window ends first");

  const scheduledOnly = resolvePromotionPricing({
    basePriceVnd: 890_000,
    campaigns: [percentageCampaign({ startsAt: laterStart, endsAt: null })],
    now: NOW,
  });
  assert.deepEqual(scheduledOnly.nextTransitionAt, laterStart);
  assert.equal(scheduledOnly.isDiscounted, false);

  const openEnded = resolvePromotionPricing({
    basePriceVnd: 890_000,
    campaigns: [percentageCampaign({ startsAt: null, endsAt: null })],
    now: NOW,
  });
  assert.equal(openEnded.nextTransitionAt, null, "an open-ended campaign never transitions");
});

test("P2 the resolver is pure: the same inputs always give the same answer", () => {
  const input = {
    basePriceVnd: 890_000,
    campaigns: [fixedCampaign()],
    now: NOW,
  } as const;

  assert.deepEqual(resolvePromotionPricing(input), resolvePromotionPricing(input));
});

test("P2 the promotion snapshot carries the audit facts a finalized order line needs", () => {
  const result = resolvePromotionPricing({
    basePriceVnd: 890_000,
    campaigns: [percentageCampaign({ percentageValue: 10 })],
    now: NOW,
  });

  assert.deepEqual(result.promotion, {
    id: "campaign-percentage",
    name: "Khuyến mãi tháng 9",
    kind: "PROMOTION",
    discountType: "PERCENTAGE",
    percentageValue: 10,
    fixedPriceVnd: null,
    startsAt: null,
    endsAt: null,
  });
  assert.equal(result.basePriceVnd, 890_000);
  assert.equal(result.effectivePriceVnd, 801_000);
});
