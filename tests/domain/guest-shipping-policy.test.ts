import assert from "node:assert/strict";
import test from "node:test";

import { calculateGuestShippingFeeVnd } from "../../src/commerce/guest-shipping-policy.ts";

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
