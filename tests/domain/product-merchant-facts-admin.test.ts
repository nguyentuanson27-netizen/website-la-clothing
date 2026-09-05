/**
 * U25 / #153 M3 — the admin surface for ADR 0007 apparel overrides.
 *
 * The service is the authority. A `<select>` on the page is a convenience; every submission is
 * re-validated here against the reviewed allowlist, behind the existing admin authorization
 * boundary, before it is allowed anywhere near the database.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { AuthorizationError } from "../../src/auth/authorization.ts";
import { createProductMerchantFactsAdminService } from "../../src/commerce/product-merchant-facts-admin.ts";
import type { MerchantApparelOverrides } from "../../src/commerce/merchant-apparel-facts.ts";

const ADMIN = { user: { id: "user-1", role: "ADMIN" }, session: { id: "session-1" } };
const EDITOR = { user: { id: "user-2", role: "EDITOR" }, session: { id: "session-2" } };

function createService(options: Readonly<{ productExists?: boolean }> = {}) {
  const saved: { productId: string; overrides: MerchantApparelOverrides }[] = [];
  const service = createProductMerchantFactsAdminService({
    productExists: async () => options.productExists ?? true,
    saveOverrides: async (productId, overrides) => {
      saved.push({ productId, overrides });
    },
  });
  return { service, saved };
}

const INHERIT_ALL = {
  productId: "product-1",
  gender: "USE_SHOP_DEFAULT",
  ageGroup: "USE_SHOP_DEFAULT",
  condition: "USE_SHOP_DEFAULT",
};

test("M3 an unauthenticated caller cannot write apparel overrides", async () => {
  const { service, saved } = createService();
  await assert.rejects(() => service.update(null, INHERIT_ALL), AuthorizationError);
  assert.deepEqual(saved, []);
});

test("M3 a signed-in non-admin cannot write apparel overrides", async () => {
  const { service, saved } = createService();
  await assert.rejects(() => service.update(EDITOR, INHERIT_ALL), (error: unknown) => {
    assert.ok(error instanceof AuthorizationError);
    assert.equal(error.code, "FORBIDDEN");
    return true;
  });
  assert.deepEqual(saved, []);
});

test("M3 an admin saves each override independently", async () => {
  const { service, saved } = createService();

  const result = await service.update(ADMIN, {
    productId: "product-1",
    gender: "unisex",
    ageGroup: "USE_SHOP_DEFAULT",
    condition: "used",
  });

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(saved, [
    {
      productId: "product-1",
      overrides: { gender: "unisex", ageGroup: null, condition: "used" },
    },
  ]);
});

test("M3 choosing the shop default clears the override rather than storing a copy of it", async () => {
  const { service, saved } = createService();

  await service.update(ADMIN, INHERIT_ALL);

  assert.deepEqual(saved, [
    { productId: "product-1", overrides: { gender: null, ageGroup: null, condition: null } },
  ]);
  // Explicitly not the resolved default values: persisting `male/adult/new` here would freeze this
  // product against a future change to the approved shop policy.
  assert.notDeepEqual(saved[0]!.overrides, {
    gender: "male",
    ageGroup: "adult",
    condition: "new",
  });
});

test("M3 a value outside the reviewed allowlist is refused server-side and nothing is written", async () => {
  const { service, saved } = createService();

  for (const patch of [
    { gender: "nam" },
    { gender: "MALE" },
    { ageGroup: "senior" },
    { condition: "vintage" },
    { gender: ["unisex"] },
    { condition: 3 },
  ]) {
    assert.deepEqual(
      await service.update(ADMIN, { ...INHERIT_ALL, ...patch }),
      { ok: false, reason: "INVALID_APPAREL_OVERRIDE" },
      `expected ${JSON.stringify(patch)} to be refused`,
    );
  }

  assert.deepEqual(saved, []);
});

test("M3 a malformed product identity is refused before any lookup or write", async () => {
  const { service, saved } = createService();

  for (const productId of [undefined, "", "  padded  ", 42, "x".repeat(129)]) {
    assert.deepEqual(await service.update(ADMIN, { ...INHERIT_ALL, productId }), {
      ok: false,
      reason: "INVALID_APPAREL_OVERRIDE",
    });
  }
  assert.deepEqual(await service.update(ADMIN, null), {
    ok: false,
    reason: "INVALID_APPAREL_OVERRIDE",
  });

  assert.deepEqual(saved, []);
});

test("M3 overrides cannot be attached to a product that does not exist", async () => {
  const { service, saved } = createService({ productExists: false });

  assert.deepEqual(await service.update(ADMIN, { ...INHERIT_ALL, gender: "female" }), {
    ok: false,
    reason: "PRODUCT_NOT_FOUND",
  });
  assert.deepEqual(saved, []);
});
