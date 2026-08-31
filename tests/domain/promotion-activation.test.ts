import assert from "node:assert/strict";
import test from "node:test";

import {
  isPromotionActivationEnabled,
  MAX_TARGETS_PER_CAMPAIGN,
  validateCampaignForActivation,
  type CampaignActivationInput,
} from "../../src/commerce/promotion-activation.ts";

const NOW = new Date("2026-09-15T00:00:00.000Z");
const START = new Date("2026-09-20T00:00:00.000Z");
const END = new Date("2026-09-21T00:00:00.000Z");

function input(overrides: Partial<CampaignActivationInput> = {}): CampaignActivationInput {
  return {
    kind: "PROMOTION",
    name: "Khuyến mãi tháng 9",
    discountType: "PERCENTAGE",
    percentageValue: 10,
    fixedPriceVnd: null,
    startsAt: START,
    endsAt: END,
    targets: [{ productId: "product-1", variantId: null }],
    now: NOW,
    ...overrides,
  };
}

test("P4 the activation gate is off unless a deployment turns it on explicitly", () => {
  assert.equal(isPromotionActivationEnabled({}), false);
  assert.equal(isPromotionActivationEnabled({ LA_PROMOTION_ACTIVATION_ENABLED: "" }), false);
  assert.equal(isPromotionActivationEnabled({ LA_PROMOTION_ACTIVATION_ENABLED: "false" }), false);
  assert.equal(isPromotionActivationEnabled({ LA_PROMOTION_ACTIVATION_ENABLED: "TRUE" }), false);
  assert.equal(isPromotionActivationEnabled({ LA_PROMOTION_ACTIVATION_ENABLED: "1" }), false);
  assert.equal(isPromotionActivationEnabled({ LA_PROMOTION_ACTIVATION_ENABLED: "true" }), true);
});

test("P4 the gate cannot be turned on by client or public build input", () => {
  assert.equal(
    isPromotionActivationEnabled({
      NEXT_PUBLIC_LA_PROMOTION_ACTIVATION_ENABLED: "true",
      HOST: "shop.example.com",
    }),
    false,
  );
});

test("P4 a complete campaign passes activation validation", () => {
  assert.deepEqual(validateCampaignForActivation(input()), { ok: true });
});

test("P4 the economic rules the database no longer enforces are enforced here", () => {
  for (const [overrides, error] of [
    [{ percentageValue: 0 }, "PERCENTAGE_OUT_OF_RANGE"],
    [{ percentageValue: 100 }, "PERCENTAGE_OUT_OF_RANGE"],
    [{ percentageValue: 10.5 }, "PERCENTAGE_OUT_OF_RANGE"],
    [{ percentageValue: null }, "DISCOUNT_VALUE_MISSING"],
    [
      { discountType: "FIXED_PRICE" as const, percentageValue: null, fixedPriceVnd: null },
      "DISCOUNT_VALUE_MISSING",
    ],
    [
      { discountType: "FIXED_PRICE" as const, percentageValue: null, fixedPriceVnd: BigInt(0) },
      "FIXED_PRICE_NOT_POSITIVE",
    ],
    [
      { discountType: "FIXED_PRICE" as const, percentageValue: null, fixedPriceVnd: BigInt(-1) },
      "FIXED_PRICE_NOT_POSITIVE",
    ],
  ] as const) {
    assert.deepEqual(
      validateCampaignForActivation(input(overrides)),
      { ok: false, errors: [error] },
      `${JSON.stringify(overrides, (_, v) => (typeof v === "bigint" ? String(v) : v))} must fail`,
    );
  }
});

test("P4 the window rules the database no longer enforces are enforced here", () => {
  assert.deepEqual(validateCampaignForActivation(input({ startsAt: END, endsAt: START })), {
    ok: false,
    errors: ["WINDOW_NOT_POSITIVE"],
  });
  assert.deepEqual(validateCampaignForActivation(input({ startsAt: START, endsAt: START })), {
    ok: false,
    errors: ["WINDOW_NOT_POSITIVE"],
  });
  assert.deepEqual(
    validateCampaignForActivation(input({ kind: "FLASH_SALE", endsAt: null })),
    { ok: false, errors: ["FLASH_SALE_WINDOW_REQUIRED"] },
  );
  assert.deepEqual(
    validateCampaignForActivation(input({ kind: "FLASH_SALE", startsAt: null })),
    { ok: false, errors: ["FLASH_SALE_WINDOW_REQUIRED"] },
  );
  // A regular promotion may be open-ended on either side.
  assert.deepEqual(validateCampaignForActivation(input({ startsAt: null, endsAt: null })), { ok: true });
});

test("P4 an activation-capable campaign must actually target something", () => {
  assert.deepEqual(validateCampaignForActivation(input({ targets: [] })), {
    ok: false,
    errors: ["NO_TARGETS"],
  });
});

test("P4 the explicit target bound is enforced at its exact boundary", () => {
  const target = (index: number) => ({ productId: `product-${index}`, variantId: null });

  assert.deepEqual(
    validateCampaignForActivation(
      input({ targets: Array.from({ length: MAX_TARGETS_PER_CAMPAIGN }, (_, i) => target(i)) }),
    ),
    { ok: true },
  );
  assert.deepEqual(
    validateCampaignForActivation(
      input({ targets: Array.from({ length: MAX_TARGETS_PER_CAMPAIGN + 1 }, (_, i) => target(i)) }),
    ),
    { ok: false, errors: ["TOO_MANY_TARGETS"] },
  );
});

test("P4 duplicate targets are rejected", () => {
  assert.deepEqual(
    validateCampaignForActivation(
      input({
        targets: [
          { productId: "product-1", variantId: null },
          { productId: "product-1", variantId: null },
        ],
      }),
    ),
    { ok: false, errors: ["DUPLICATE_TARGET"] },
  );
});

test("P4 a target must name exactly one scope", () => {
  for (const target of [
    { productId: null, variantId: null },
    { productId: "product-1", variantId: "variant-1" },
  ]) {
    assert.deepEqual(validateCampaignForActivation(input({ targets: [target] })), {
      ok: false,
      errors: ["INVALID_TARGET_SCOPE"],
    });
  }
});

/**
 * The rule a database check cannot express: a campaign may not target a product and separately
 * target a variant that product already covers.
 */
test("P4 a variant target already covered by a product target in the same campaign is rejected", () => {
  assert.deepEqual(
    validateCampaignForActivation(
      input({
        targets: [
          { productId: "product-1", variantId: null },
          { productId: null, variantId: "variant-of-product-1" },
        ],
        variantOwnerProductIds: new Map([["variant-of-product-1", "product-1"]]),
      }),
    ),
    { ok: false, errors: ["VARIANT_ALREADY_COVERED_BY_PRODUCT"] },
  );

  // A variant belonging to a different product is fine.
  assert.deepEqual(
    validateCampaignForActivation(
      input({
        targets: [
          { productId: "product-1", variantId: null },
          { productId: null, variantId: "variant-of-product-2" },
        ],
        variantOwnerProductIds: new Map([["variant-of-product-2", "product-2"]]),
      }),
    ),
    { ok: true },
  );
});

test("P4 every failing rule is reported at once so an admin fixes one form, not five", () => {
  const result = validateCampaignForActivation(
    input({ name: "  ", percentageValue: 0, startsAt: END, endsAt: START, targets: [] }),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.ok === false ? [...result.errors].sort() : [], [
    "INVALID_NAME",
    "NO_TARGETS",
    "PERCENTAGE_OUT_OF_RANGE",
    "WINDOW_NOT_POSITIVE",
  ]);
});

test("P4 validation is pure, so a Draft can be checked without being changed", () => {
  const facts = input({ percentageValue: 0 });
  const before = JSON.stringify(facts, (_, v) => (typeof v === "bigint" ? String(v) : v));

  validateCampaignForActivation(facts);

  assert.equal(JSON.stringify(facts, (_, v) => (typeof v === "bigint" ? String(v) : v)), before);
});
