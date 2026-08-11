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
