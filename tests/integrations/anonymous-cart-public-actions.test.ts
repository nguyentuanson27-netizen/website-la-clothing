import assert from "node:assert/strict";
import test from "node:test";

import { createAnonymousCartPublicActions } from "../../src/commerce/anonymous-cart-public-actions.ts";

const now = new Date("2026-08-10T00:00:00.000Z");
const secretCartId = "018f7f64-8d58-7a3d-8af3-3dbf50ec3e3f";

function mutationService() {
  return {
    async setItemQuantity({ variantId, quantity }: { variantId: string; quantity: number; now: Date }) {
      return {
        ok: true,
        cartId: secretCartId,
        expiresAt: new Date("2026-09-09T00:00:00.000Z"),
        item: { variantId, quantity },
      } as const;
    },
    async removeItem() {
      return { ok: true } as const;
    },
  };
}

test("public set action returns the item without exposing the anonymous-cart capability", async () => {
  const actions = createAnonymousCartPublicActions({
    mutationService: async () => mutationService(),
    now: () => now,
  });

  const result = await actions.setItemQuantity({ variantId: "variant-1", quantity: 2 });

  assert.deepEqual(result, {
    ok: true,
    item: { variantId: "variant-1", quantity: 2 },
  });
  assert.equal("cartId" in result, false);
  assert.equal("expiresAt" in result, false);
});

test("public set action rejects invalid browser input before resolving the mutation service", async () => {
  let mutationServiceCalls = 0;
  const actions = createAnonymousCartPublicActions({
    mutationService: async () => {
      mutationServiceCalls += 1;
      return mutationService();
    },
    now: () => now,
  });

  assert.deepEqual(await actions.setItemQuantity({ variantId: " variant-1", quantity: 2 }), {
    ok: false,
    reason: "INVALID_INPUT",
  });
  assert.equal(mutationServiceCalls, 0);
});
