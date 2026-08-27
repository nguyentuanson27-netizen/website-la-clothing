import assert from "node:assert/strict";
import test from "node:test";

import { AuthorizationError } from "../../src/auth/authorization.ts";
import {
  PRODUCT_COMMERCE_ADMIN_LIMITS,
  createProductCommerceAdminService,
} from "../../src/commerce/product-commerce-admin.ts";

const adminSession = {
  user: { id: "admin-1", role: "ADMIN" },
  session: { id: "session-admin" },
} as const;

const customerSession = {
  user: { id: "customer-1", role: "CUSTOMER" },
  session: { id: "session-customer" },
} as const;

const validInput = {
  productId: "product-1",
  variantIds: ["variant-1", "variant-2"],
  isActive: true,
} as const;

test("generic variant activation requires ADMIN before repository access", async () => {
  let calls = 0;
  const service = createProductCommerceAdminService({
    async setVariantActivation() {
      calls += 1;
      return true;
    },
  });

  for (const [session, expectedCode] of [
    [null, "UNAUTHENTICATED"],
    [customerSession, "FORBIDDEN"],
  ] as const) {
    await assert.rejects(
      () => service.setVariantActivation(session, validInput),
      (error: unknown) => {
        assert.ok(error instanceof AuthorizationError);
        assert.equal(error.code, expectedCode);
        return true;
      },
    );
  }

  assert.equal(calls, 0);
});

test("generic variant activation rejects malformed duplicate and oversized browser input", async () => {
  let calls = 0;
  const service = createProductCommerceAdminService({
    async setVariantActivation() {
      calls += 1;
      return true;
    },
  });

  const invalidInputs: unknown[] = [
    null,
    [],
    { ...validInput, productId: "" },
    { ...validInput, productId: " product-1" },
    { ...validInput, productId: "p".repeat(PRODUCT_COMMERCE_ADMIN_LIMITS.productId + 1) },
    { ...validInput, variantIds: [] },
    { ...validInput, variantIds: ["variant-1", "variant-1"] },
    {
      ...validInput,
      variantIds: Array.from(
        { length: PRODUCT_COMMERCE_ADMIN_LIMITS.variantCount + 1 },
        (_, index) => `variant-${index}`,
      ),
    },
    { ...validInput, variantIds: [""] },
    { ...validInput, variantIds: [" variant-1"] },
    {
      ...validInput,
      variantIds: ["v".repeat(PRODUCT_COMMERCE_ADMIN_LIMITS.variantId + 1)],
    },
    { ...validInput, variantIds: "variant-1" },
    { ...validInput, isActive: "true" },
  ];

  for (const input of invalidInputs) {
    assert.deepEqual(await service.setVariantActivation(adminSession, input), {
      ok: false,
      reason: "INVALID_INPUT",
    });
  }

  assert.equal(calls, 0);
});

test("generic variant activation passes only route-owned product, unique IDs, and exact boolean state", async () => {
  const calls: unknown[] = [];
  const service = createProductCommerceAdminService({
    async setVariantActivation(input) {
      calls.push(input);
      return true;
    },
  });

  assert.deepEqual(
    await service.setVariantActivation(adminSession, {
      productId: "product-1",
      variantIds: ["variant-2", "variant-1"],
      isActive: false,
      forgedProductActive: true,
      forgedStock: 999,
    }),
    {
      ok: true,
      variantIds: ["variant-2", "variant-1"],
      isActive: false,
    },
  );
  assert.deepEqual(calls, [
    {
      productId: "product-1",
      variantIds: ["variant-2", "variant-1"],
      isActive: false,
    },
  ]);
});

test("generic variant activation fails closed when any requested variant is unavailable", async () => {
  const service = createProductCommerceAdminService({
    async setVariantActivation() {
      return false;
    },
  });

  assert.deepEqual(await service.setVariantActivation(adminSession, validInput), {
    ok: false,
    reason: "VARIANT_NOT_AVAILABLE",
  });
});
