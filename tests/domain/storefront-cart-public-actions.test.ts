import assert from "node:assert/strict";
import test from "node:test";

import { createStorefrontCartPublicActions } from "../../src/commerce/storefront-cart-public-actions.ts";

const lines = [
  { variantId: "available", available: true },
  { variantId: "unavailable", available: false },
];

test("cart update accepts only an existing currently available line and owns its response shape", async () => {
  const calls: Array<{ variantId: string; quantity: number }> = [];
  const actions = createStorefrontCartPublicActions({
    async getLines() {
      return lines;
    },
    async setQuantity(input) {
      calls.push(input);
      return { ok: true as const, cartId: "internal", item: input };
    },
    async remove() {
      throw new Error("remove should not be called");
    },
  });

  assert.deepEqual(
    await actions.update({ variantId: "available", quantity: 3, ignored: "browser-data" }),
    { ok: true },
  );
  assert.deepEqual(calls, [{ variantId: "available", quantity: 3 }]);

  assert.deepEqual(await actions.update({ variantId: "unavailable", quantity: 2 }), {
    ok: false,
    reason: "LINE_UNAVAILABLE",
  });
  assert.deepEqual(await actions.update({ variantId: "missing", quantity: 2 }), {
    ok: false,
    reason: "LINE_UNAVAILABLE",
  });
  assert.equal(calls.length, 1);
});

test("cart remove allows an existing unavailable line but not an unknown line", async () => {
  const calls: Array<{ variantId: string }> = [];
  const actions = createStorefrontCartPublicActions({
    async getLines() {
      return lines;
    },
    async setQuantity() {
      throw new Error("setQuantity should not be called");
    },
    async remove(input) {
      calls.push(input);
      return { ok: true as const, internal: "do-not-expose" };
    },
  });

  assert.deepEqual(await actions.remove({ variantId: "unavailable", ignored: "browser-data" }), {
    ok: true,
  });
  assert.deepEqual(calls, [{ variantId: "unavailable" }]);
  assert.deepEqual(await actions.remove({ variantId: "missing" }), {
    ok: false,
    reason: "LINE_UNAVAILABLE",
  });
  assert.equal(calls.length, 1);
});

test("cart public actions reject malformed input and normalize downstream failures", async () => {
  let lineReads = 0;
  const actions = createStorefrontCartPublicActions({
    async getLines() {
      lineReads += 1;
      return lines;
    },
    async setQuantity() {
      return { ok: false as const, reason: "VARIANT_UNAVAILABLE", internal: "do-not-expose" };
    },
    async remove() {
      return { ok: false as const, reason: "CART_UNAVAILABLE", internal: "do-not-expose" };
    },
  });

  for (const input of [
    null,
    {},
    { variantId: "", quantity: 1 },
    { variantId: " available", quantity: 1 },
    { variantId: "available", quantity: 0 },
    { variantId: "available", quantity: 1.5 },
    { variantId: "available", quantity: 2_147_483_648 },
    { variantId: "available", quantity: "2" },
  ]) {
    assert.deepEqual(await actions.update(input), { ok: false, reason: "INVALID_INPUT" });
  }
  assert.equal(lineReads, 0);

  assert.deepEqual(await actions.update({ variantId: "available", quantity: 2 }), {
    ok: false,
    reason: "UPDATE_FAILED",
  });
  assert.deepEqual(await actions.remove({ variantId: "available" }), {
    ok: false,
    reason: "REMOVE_FAILED",
  });
});
