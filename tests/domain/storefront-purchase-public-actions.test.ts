import assert from "node:assert/strict";
import test from "node:test";

import { createStorefrontPurchasePublicActions } from "../../src/commerce/storefront-purchase-public-actions.ts";

const committedSnapshot = {
  variantExternalId: "pancake-variation-1",
  productExternalId: "pancake-product-1",
  itemName: "Linen Shirt",
  unitPriceVnd: 490_000,
  quantity: 1,
  color: "Navy",
  size: "M",
};

test("storefront public action passes only parsed slug and variant identity to the purchase runtime", async () => {
  const calls: Array<{ slug: string; variantId: string }> = [];
  const actions = createStorefrontPurchasePublicActions({
    async purchase(input) {
      calls.push(input);
      return {
        ok: true as const,
        previousQuantity: 0,
        quantity: 1,
        addedQuantity: 1 as const,
        snapshot: committedSnapshot,
      };
    },
  });

  assert.deepEqual(
    await actions.add({ slug: "linen-shirt", variantId: "variant-1", ignored: "browser-data" }),
    {
      ok: true,
      transition: { previousQuantity: 0, quantity: 1, addedQuantity: 1 },
      analyticsItem: committedSnapshot,
    },
  );
  assert.deepEqual(calls, [{ slug: "linen-shirt", variantId: "variant-1" }]);
});

test("T5 an accepted PDP add reports the committed transition with addedQuantity one", async () => {
  for (const [previousQuantity, quantity] of [[0, 1], [1, 2], [4, 5]] as const) {
    const actions = createStorefrontPurchasePublicActions({
      async purchase() {
        return {
          ok: true as const,
          previousQuantity,
          quantity,
          addedQuantity: 1 as const,
          snapshot: { ...committedSnapshot, quantity: 1 },
        };
      },
    });

    const result = await actions.add({ slug: "linen-shirt", variantId: "variant-1" });
    assert.equal(result.ok, true);
    assert.ok(result.ok);
    assert.deepEqual(result.transition, { previousQuantity, quantity, addedQuantity: 1 });
    // The event quantity is the committed delta, never the line total the cart now holds.
    assert.equal(result.analyticsItem?.quantity, 1);
  }
});

test("T5 a success that is not a plus-one transition is never reported as an AddToCart", async () => {
  for (const success of [
    { previousQuantity: 4, quantity: 4, addedQuantity: 1 as const },
    { previousQuantity: 4, quantity: 1, addedQuantity: 1 as const },
    { previousQuantity: 1, quantity: 3, addedQuantity: 1 as const },
    { previousQuantity: 0, quantity: 1, addedQuantity: 2 },
    { previousQuantity: -1, quantity: 0, addedQuantity: 1 as const },
    { previousQuantity: 0, quantity: 1.5, addedQuantity: 1 as const },
    { previousQuantity: 0 },
  ]) {
    const actions = createStorefrontPurchasePublicActions({
      async purchase() {
        return { ok: true as const, ...success, snapshot: committedSnapshot };
      },
    });

    assert.deepEqual(await actions.add({ slug: "linen-shirt", variantId: "variant-1" }), {
      ok: false,
      reason: "PURCHASE_FAILED",
    });
  }
});

test("T5 commerce success survives an unusable analytics snapshot and emits nothing", async () => {
  for (const snapshot of [
    undefined,
    null,
    "not-an-object",
    { variantExternalId: "", itemName: "Linen Shirt", unitPriceVnd: 1, quantity: 1 },
    { variantExternalId: "v", itemName: "Linen Shirt", unitPriceVnd: "490000", quantity: 1 },
    { itemName: "Linen Shirt", unitPriceVnd: 490_000, quantity: 1 },
  ]) {
    const actions = createStorefrontPurchasePublicActions({
      async purchase() {
        return {
          ok: true as const,
          previousQuantity: 1,
          quantity: 2,
          addedQuantity: 1 as const,
          snapshot,
        };
      },
    });

    const result = await actions.add({ slug: "linen-shirt", variantId: "variant-1" });
    assert.ok(result.ok, "an unusable snapshot must never roll back a committed cart mutation");
    assert.equal(result.analyticsItem, undefined);
    assert.equal(result.analyticsUnavailable, true);
  }
});

test("storefront public action owns its response shape instead of leaking downstream fields", async () => {
  const successActions = createStorefrontPurchasePublicActions({
    async purchase() {
      return {
        ok: true as const,
        cartId: "internal-cart-capability",
        previousQuantity: 0,
        quantity: 1,
        addedQuantity: 1 as const,
        item: { variantId: "variant-mirror-cuid", quantity: 1 },
        snapshot: {
          ...committedSnapshot,
          variantId: "variant-mirror-cuid",
          guestPhone: "0900000000",
          internal: "do-not-expose",
        },
      };
    },
  });
  const success = await successActions.add({ slug: "linen-shirt", variantId: "variant-1" });
  assert.deepEqual(success, {
    ok: true,
    transition: { previousQuantity: 0, quantity: 1, addedQuantity: 1 },
    analyticsItem: committedSnapshot,
  });
  const serialized = JSON.stringify(success);
  for (const forbidden of [
    "internal-cart-capability",
    "variant-mirror-cuid",
    "0900000000",
    "do-not-expose",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must not cross the boundary`);
  }

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
      return {
        ok: true as const,
        previousQuantity: 0,
        quantity: 1,
        addedQuantity: 1 as const,
        snapshot: committedSnapshot,
      };
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
