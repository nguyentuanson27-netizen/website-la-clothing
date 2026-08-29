import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateGuestShippingFeeVnd,
  describeGuestShippingPromotion,
  describeGuestShippingPromotionHeadline,
  readGuestShippingPolicy,
} from "../../src/commerce/guest-shipping-policy.ts";

test("guest shipping charges 30,000 VND when no freeship condition is met", () => {
  assert.equal(
    calculateGuestShippingFeeVnd({ subtotalVnd: 1_000_000, totalQuantity: 2 }),
    30_000,
  );
});

test("guest shipping is free when authoritative subtotal is over 1,000,000 VND", () => {
  assert.equal(
    calculateGuestShippingFeeVnd({ subtotalVnd: 1_000_001, totalQuantity: 1 }),
    0,
  );
});

test("guest shipping is free from three products regardless of subtotal", () => {
  assert.equal(
    calculateGuestShippingFeeVnd({ subtotalVnd: 300_000, totalQuantity: 3 }),
    0,
  );
});

test("guest shipping stops at the first qualifying freeship condition", () => {
  assert.equal(
    calculateGuestShippingFeeVnd({ subtotalVnd: 1_500_000, totalQuantity: 4 }),
    0,
  );
});

test("guest shipping rejects malformed authoritative totals", () => {
  for (const input of [
    { subtotalVnd: -1, totalQuantity: 1 },
    { subtotalVnd: Number.NaN, totalQuantity: 1 },
    { subtotalVnd: 300_000.5, totalQuantity: 1 },
    { subtotalVnd: Number.MAX_SAFE_INTEGER + 1, totalQuantity: 1 },
    { subtotalVnd: 300_000, totalQuantity: 0 },
    { subtotalVnd: 300_000, totalQuantity: 1.5 },
  ]) {
    assert.throws(() => calculateGuestShippingFeeVnd(input), RangeError);
  }
});

test("shipping policy defaults to the approved 30k / over-1m / quantity-3 rule", () => {
  assert.deepEqual(readGuestShippingPolicy({}), {
    feeVnd: 30_000,
    freeShippingSubtotalVnd: 1_000_000,
    freeShippingMinQuantity: 3,
  });
});

test("shipping policy accepts bounded server-owned configuration and drives calculation", () => {
  const policy = readGuestShippingPolicy({
    LA_SHIPPING_FEE_VND: "25000",
    LA_FREE_SHIPPING_SUBTOTAL_VND: "750000",
    LA_FREE_SHIPPING_MIN_QUANTITY: "4",
  });

  assert.deepEqual(policy, {
    feeVnd: 25_000,
    freeShippingSubtotalVnd: 750_000,
    freeShippingMinQuantity: 4,
  });
  assert.equal(
    calculateGuestShippingFeeVnd({ subtotalVnd: 750_001, totalQuantity: 1 }, policy),
    0,
  );
  assert.equal(
    calculateGuestShippingFeeVnd({ subtotalVnd: 750_000, totalQuantity: 3 }, policy),
    25_000,
  );
});

test("shipping policy fails closed on malformed, signed, fractional or unsafe configuration", () => {
  for (const env of [
    { LA_SHIPPING_FEE_VND: "-1" },
    { LA_SHIPPING_FEE_VND: "+30000" },
    { LA_SHIPPING_FEE_VND: "30000.5" },
    { LA_FREE_SHIPPING_SUBTOTAL_VND: " 1000000" },
    { LA_FREE_SHIPPING_MIN_QUANTITY: "0" },
    { LA_FREE_SHIPPING_MIN_QUANTITY: "3e0" },
    { LA_SHIPPING_FEE_VND: String(Number.MAX_SAFE_INTEGER + 1) },
  ]) {
    assert.throws(() => readGuestShippingPolicy(env), RangeError);
  }
});

test("verified free-shipping promotion copy is derived from the same policy", () => {
  assert.deepEqual(
    describeGuestShippingPromotion({
      feeVnd: 30_000,
      freeShippingSubtotalVnd: 1_000_000,
      freeShippingMinQuantity: 3,
    }),
    {
      title: "Miễn phí vận chuyển",
      detail: "Đơn trên 1.000.000 ₫ hoặc từ 3 sản phẩm.",
    },
  );
});

test("promotion bar headline states the same policy on one line", () => {
  assert.equal(
    describeGuestShippingPromotionHeadline({
      feeVnd: 30_000,
      freeShippingSubtotalVnd: 1_000_000,
      freeShippingMinQuantity: 3,
    }),
    "Free ship từ 3 sản phẩm hoặc đơn trên 1 triệu",
  );
});

test("headline shortens a threshold only when the short form is exact", () => {
  const base = { feeVnd: 30_000, freeShippingMinQuantity: 2 } as const;

  // Whole millions and whole thousands have exact short forms.
  assert.match(
    describeGuestShippingPromotionHeadline({ ...base, freeShippingSubtotalVnd: 2_000_000 }),
    /đơn trên 2 triệu$/,
  );
  assert.match(
    describeGuestShippingPromotionHeadline({ ...base, freeShippingSubtotalVnd: 500_000 }),
    /đơn trên 500 nghìn$/,
  );

  // Anything else keeps the full amount rather than rounding into a claim the policy never makes.
  assert.match(
    describeGuestShippingPromotionHeadline({ ...base, freeShippingSubtotalVnd: 1_250_500 }),
    /đơn trên 1\.250\.500\s₫$/,
  );
});

test("headline rejects a policy the fee calculation would reject", () => {
  assert.throws(
    () =>
      describeGuestShippingPromotionHeadline({
        feeVnd: 30_000,
        freeShippingSubtotalVnd: 1_000_000,
        freeShippingMinQuantity: 0,
      }),
    RangeError,
  );
});
