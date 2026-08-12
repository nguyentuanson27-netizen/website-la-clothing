import assert from "node:assert/strict";
import test from "node:test";

import { createGuestCheckoutSubmitService } from "../../src/commerce/guest-checkout-submit.ts";

const checkoutInput = {
  name: "Nguyễn Văn A",
  phone: "0901234567",
  provinceRef: "province-01",
  districtRef: "district-001",
  communeRef: "commune-0001",
  detail: "12 Đường A",
  note: null,
};
const now = new Date("2026-08-12T05:30:00.000Z");
const cartId = "11111111-1111-4111-8111-111111111111";
const shopId = 920_007;

function snapshotOrder(publicCode: string, state = "DRAFT" as const) {
  return {
    ok: true as const,
    order: {
      publicCode,
      state,
      merchandiseSubtotalVnd: BigInt(500_000),
      shippingFeeVnd: BigInt(30_000),
      totalVnd: BigInt(530_000),
    },
  };
}

test("snapshot failure stops before Pancake submission and exposes only a stable browser reason", async () => {
  let submitCalls = 0;
  const service = createGuestCheckoutSubmitService({
    snapshot: {
      async create() {
        return { ok: false as const, reason: "CART_LINE_UNAVAILABLE" as const };
      },
    },
    orderSubmission: {
      async submit() {
        submitCalls += 1;
        throw new Error("must not submit");
      },
    },
    generatePublicCode: () => "LA-proposed",
  });

  assert.deepEqual(await service.submit({ cartId, shopId, checkoutInput, now }), {
    ok: false,
    status: "RETRYABLE",
    reason: "CART_UNAVAILABLE",
  });
  assert.equal(submitCalls, 0);
});

test("reused active snapshot submits by the persisted order code rather than a newly proposed code", async () => {
  let submittedPublicCode = "";
  let submittedShopId = 0;
  const service = createGuestCheckoutSubmitService({
    snapshot: {
      async create(input) {
        assert.equal(input.publicCode, "LA-proposed");
        return snapshotOrder("LA-existing");
      },
    },
    orderSubmission: {
      async submit(input) {
        submittedPublicCode = input.publicCode;
        submittedShopId = input.shopId;
        return { ok: true as const, state: "CONFIRMED" as const, pancakeOrderId: "700001" };
      },
    },
    generatePublicCode: () => "LA-proposed",
  });

  assert.deepEqual(await service.submit({ cartId, shopId, checkoutInput, now }), {
    ok: true,
    status: "CONFIRMED",
    orderCode: "LA-existing",
  });
  assert.equal(submittedPublicCode, "LA-existing");
  assert.equal(submittedShopId, shopId);
});

test("ambiguous and in-flight outcomes never become browser retry instructions", async () => {
  const cases = [
    {
      submission: {
        ok: false as const,
        state: "SYNC_UNKNOWN" as const,
        reason: "CREATE_OUTCOME_UNKNOWN" as const,
      },
      expected: { ok: false, status: "SYNC_UNKNOWN", orderCode: "LA-existing" },
    },
    {
      submission: {
        ok: false as const,
        state: "POS_SUBMITTING" as const,
        reason: "SUBMISSION_ALREADY_CLAIMED" as const,
      },
      expected: { ok: false, status: "PROCESSING", orderCode: "LA-existing" },
    },
    {
      submission: {
        ok: false as const,
        state: "VALIDATING" as const,
        reason: "SUBMISSION_ALREADY_CLAIMED" as const,
      },
      expected: { ok: false, status: "PROCESSING", orderCode: "LA-existing" },
    },
  ];

  for (const entry of cases) {
    const service = createGuestCheckoutSubmitService({
      snapshot: { async create() { return snapshotOrder("LA-existing"); } },
      orderSubmission: { async submit() { return entry.submission; } },
      generatePublicCode: () => "LA-unused",
    });

    assert.deepEqual(
      await service.submit({ cartId, shopId, checkoutInput, now }),
      entry.expected,
    );
  }
});

test("only pre-write validation unavailability is presented as a safe retry for an existing order", async () => {
  const service = createGuestCheckoutSubmitService({
    snapshot: { async create() { return snapshotOrder("LA-existing"); } },
    orderSubmission: {
      async submit() {
        return {
          ok: false as const,
          state: "DRAFT" as const,
          reason: "VALIDATION_UNAVAILABLE" as const,
        };
      },
    },
    generatePublicCode: () => "LA-unused",
  });

  assert.deepEqual(await service.submit({ cartId, shopId, checkoutInput, now }), {
    ok: false,
    status: "RETRYABLE",
    reason: "SERVICE_UNAVAILABLE",
    orderCode: "LA-existing",
  });
});

test("live price or stock rejection becomes a cart-changed result while internal/config failures stay generic", async () => {
  const cases = [
    { reason: "PRICE_CHANGED" as const, expectedReason: "CART_CHANGED" },
    { reason: "STOCK_UNAVAILABLE" as const, expectedReason: "CART_CHANGED" },
    { reason: "SHOP_SCOPE_UNVERIFIED" as const, expectedReason: "CHECKOUT_UNAVAILABLE" },
    { reason: "LOCAL_ORDER_INVALID" as const, expectedReason: "CHECKOUT_UNAVAILABLE" },
  ];

  for (const entry of cases) {
    const service = createGuestCheckoutSubmitService({
      snapshot: { async create() { return snapshotOrder("LA-existing"); } },
      orderSubmission: {
        async submit() {
          return { ok: false as const, state: "REJECTED" as const, reason: entry.reason };
        },
      },
      generatePublicCode: () => "LA-unused",
    });

    assert.deepEqual(await service.submit({ cartId, shopId, checkoutInput, now }), {
      ok: false,
      status: "RETRYABLE",
      reason: entry.expectedReason,
      orderCode: "LA-existing",
    });
  }
});
