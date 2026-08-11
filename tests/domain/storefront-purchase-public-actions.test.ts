import assert from "node:assert/strict";
import test from "node:test";

import { createStorefrontPurchasePublicActions } from "../../src/commerce/storefront-purchase-public-actions.ts";

test("storefront public action passes only parsed slug and variant identity to the purchase runtime", async () => {
  const calls: Array<{ slug: string; variantId: string }> = [];
  const actions = createStorefrontPurchasePublicActions({
    async purchase(input) {
      calls.push(input);
      return { ok: true as const };
    },
  });

  assert.deepEqual(
    await actions.add({ slug: "linen-shirt", variantId: "variant-1", ignored: "browser-data" }),
    { ok: true },
  );
  assert.deepEqual(calls, [{ slug: "linen-shirt", variantId: "variant-1" }]);
});

test("storefront public action owns its response shape instead of leaking downstream fields", async () => {
  const successActions = createStorefrontPurchasePublicActions({
    async purchase() {
      return {
        ok: true as const,
        cartId: "internal-cart-capability",
        item: { variantId: "variant-1", quantity: 1 },
      };
    },
  });
  assert.deepEqual(await successActions.add({ slug: "linen-shirt", variantId: "variant-1" }), {
    ok: true,
  });

  const failureActions = createStorefrontPurchasePublicActions({
    async purchase() {
      return { ok: false as const, reason: "CART_LINE_LIMIT", internal: "do-not-expose" };
    },
  });
  assert.deepEqual(await failureActions.add({ slug: "linen-shirt", variantId: "variant-1" }), {
    ok: false,
    reason: "PURCHASE_FAILED",
  });
});

test("storefront public action rejects malformed browser input before runtime assembly", async () => {
  let calls = 0;
  const actions = createStorefrontPurchasePublicActions({
    async purchase() {
      calls += 1;
      return { ok: true as const };
    },
  });

  for (const input of [
    null,
    undefined,
    "linen-shirt",
    {},
    { slug: 42, variantId: "variant-1" },
    { slug: "linen-shirt", variantId: 42 },
  ]) {
    assert.deepEqual(await actions.add(input), { ok: false, reason: "INVALID_SELECTION" });
  }

  assert.equal(calls, 0);
});
