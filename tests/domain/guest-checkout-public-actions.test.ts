import assert from "node:assert/strict";
import test from "node:test";

import { submitGuestCheckoutPublicAction } from "../../src/commerce/guest-checkout-public-actions.ts";

function makeFormData() {
  const formData = new FormData();
  formData.set("name", "Nguyễn Văn A");
  formData.set("phone", "0901234567");
  formData.set("provinceRef", "province-01");
  formData.set("districtRef", "district-001");
  formData.set("communeRef", "commune-0001");
  formData.set("detail", "12 Đường A");
  formData.set("note", "Giao giờ hành chính");
  formData.set("cartId", "attacker-cart");
  formData.set("shopId", "999999");
  formData.set("publicCode", "ATTACKER-CODE");
  formData.set("price", "1");
  return formData;
}

test("browser checkout uses the HttpOnly cart identity and forwards only allowlisted guest fields", async () => {
  let submittedInput: unknown;
  const cartSession = {
    read: () => "server-cart-id",
    clear: () => undefined,
  };

  const result = await submitGuestCheckoutPublicAction(
    {
      cartSession,
      submitCheckout: async (input) => {
        submittedInput = input;
        return { ok: true as const, status: "CONFIRMED" as const, orderCode: "LA-001" };
      },
    },
    makeFormData(),
  );

  assert.deepEqual(submittedInput, {
    cartId: "server-cart-id",
    checkoutInput: {
      name: "Nguyễn Văn A",
      phone: "0901234567",
      provinceRef: "province-01",
      districtRef: "district-001",
      communeRef: "commune-0001",
      detail: "12 Đường A",
      note: "Giao giờ hành chính",
    },
  });
  assert.deepEqual(result, { ok: true, status: "CONFIRMED", orderCode: "LA-001" });
});

test("confirmed checkout clears the anonymous cart cookie but ambiguous checkout never does", async () => {
  for (const entry of [
    {
      outcome: { ok: true as const, status: "CONFIRMED" as const, orderCode: "LA-001" },
      expectedClears: 1,
    },
    {
      outcome: { ok: false as const, status: "SYNC_UNKNOWN" as const, orderCode: "LA-002" },
      expectedClears: 0,
    },
    {
      outcome: { ok: false as const, status: "PROCESSING" as const, orderCode: "LA-003" },
      expectedClears: 0,
    },
  ]) {
    let clearCalls = 0;
    const result = await submitGuestCheckoutPublicAction(
      {
        cartSession: {
          read: () => "server-cart-id",
          clear: () => {
            clearCalls += 1;
          },
        },
        submitCheckout: async () => entry.outcome,
      },
      makeFormData(),
    );

    assert.deepEqual(result, entry.outcome);
    assert.equal(clearCalls, entry.expectedClears);
  }
});

test("missing anonymous cart stops before checkout submission", async () => {
  let submitCalls = 0;
  const result = await submitGuestCheckoutPublicAction(
    {
      cartSession: { read: () => null, clear: () => undefined },
      submitCheckout: async () => {
        submitCalls += 1;
        throw new Error("must not submit");
      },
    },
    makeFormData(),
  );

  assert.deepEqual(result, {
    ok: false,
    status: "RETRYABLE",
    reason: "CART_UNAVAILABLE",
  });
  assert.equal(submitCalls, 0);
});

test("rate-limited anonymous cart stops before checkout submission", async () => {
  let limiterCalls = 0;
  let submitCalls = 0;
  const dependencies = {
    cartSession: { read: () => "server-cart-id", clear: () => undefined },
    consumeAttempt: async (cartId: string) => {
      limiterCalls += 1;
      assert.equal(cartId, "server-cart-id");
      return false;
    },
    submitCheckout: async () => {
      submitCalls += 1;
      return { ok: true as const, status: "CONFIRMED" as const, orderCode: "LA-should-not-run" };
    },
  };

  const result = await submitGuestCheckoutPublicAction(dependencies, makeFormData());

  assert.deepEqual(result, {
    ok: false,
    status: "RETRYABLE",
    reason: "CHECKOUT_UNAVAILABLE",
  });
  assert.equal(limiterCalls, 1);
  assert.equal(submitCalls, 0);
});
