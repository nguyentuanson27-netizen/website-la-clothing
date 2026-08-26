import assert from "node:assert/strict";
import test from "node:test";

import { AuthorizationError } from "../../src/auth/authorization.ts";
import {
  COMPOSITE_COMPONENT_ADMIN_LIMITS,
  createCompositeComponentAdminService,
  createCompositeParentVariantAdminService,
} from "../../src/commerce/composite-component-admin.ts";

const adminSession = {
  user: { id: "admin-1", role: "ADMIN" },
  session: { id: "session-admin" },
} as const;

const customerSession = {
  user: { id: "customer-1", role: "CUSTOMER" },
  session: { id: "session-customer" },
} as const;

const validInput = {
  productId: "child-product-1",
  variantId: "child-variant-1",
  isActive: true,
} as const;

const validParentInput = {
  productId: "parent-product-1",
  variantId: "parent-variant-1",
  isActive: true,
} as const;

test("composite component activation requires authentication and ADMIN before dependency access", async () => {
  let dependencyCalls = 0;
  const service = createCompositeComponentAdminService({
    async setLinkedVariantActivation() {
      dependencyCalls += 1;
      return true;
    },
  });

  for (const [session, expectedCode] of [
    [null, "UNAUTHENTICATED"],
    [customerSession, "FORBIDDEN"],
  ] as const) {
    await assert.rejects(
      () => service.setActivation(session, validInput),
      (error: unknown) => {
        assert.ok(error instanceof AuthorizationError);
        assert.equal(error.code, expectedCode);
        return true;
      },
    );
  }
  assert.equal(dependencyCalls, 0);
});

test("composite component activation rejects malformed untrusted input before dependency access", async () => {
  let dependencyCalls = 0;
  const service = createCompositeComponentAdminService({
    async setLinkedVariantActivation() {
      dependencyCalls += 1;
      return true;
    },
  });

  const invalidInputs: unknown[] = [
    null,
    [],
    { ...validInput, productId: "" },
    { ...validInput, productId: " child-product-1" },
    { ...validInput, productId: "p".repeat(COMPOSITE_COMPONENT_ADMIN_LIMITS.productId + 1) },
    { ...validInput, variantId: "" },
    { ...validInput, variantId: "child-variant-1 " },
    { ...validInput, variantId: "v".repeat(COMPOSITE_COMPONENT_ADMIN_LIMITS.variantId + 1) },
    { ...validInput, isActive: "true" },
    { ...validInput, isActive: 1 },
  ];

  for (const input of invalidInputs) {
    assert.deepEqual(await service.setActivation(adminSession, input), {
      ok: false,
      reason: "INVALID_INPUT",
    });
  }
  assert.equal(dependencyCalls, 0);
});

test("composite component activation fails closed when the exact linked component is unavailable", async () => {
  const calls: unknown[] = [];
  const service = createCompositeComponentAdminService({
    async setLinkedVariantActivation(input) {
      calls.push(input);
      return false;
    },
  });

  assert.deepEqual(await service.setActivation(adminSession, validInput), {
    ok: false,
    reason: "COMPONENT_NOT_AVAILABLE",
  });
  assert.deepEqual(calls, [validInput]);
});

test("composite component activation passes only the validated child ownership and target state", async () => {
  const calls: unknown[] = [];
  const service = createCompositeComponentAdminService({
    async setLinkedVariantActivation(input) {
      calls.push(input);
      return true;
    },
  });

  assert.deepEqual(
    await service.setActivation(adminSession, {
      productId: "child-product-1",
      variantId: "child-variant-1",
      isActive: false,
      forgedParentVariantId: "parent-variant-attacker-controlled",
      forgedProductActive: true,
    }),
    {
      ok: true,
      variantId: "child-variant-1",
      isActive: false,
    },
  );
  assert.deepEqual(calls, [
    {
      productId: "child-product-1",
      variantId: "child-variant-1",
      isActive: false,
    },
  ]);
});

test("composite parent variant activation requires authentication and ADMIN before dependency access", async () => {
  let dependencyCalls = 0;
  const service = createCompositeParentVariantAdminService({
    async setParentVariantActivation() {
      dependencyCalls += 1;
      return true;
    },
  });

  for (const [session, expectedCode] of [
    [null, "UNAUTHENTICATED"],
    [customerSession, "FORBIDDEN"],
  ] as const) {
    await assert.rejects(
      () => service.setActivation(session, validParentInput),
      (error: unknown) => {
        assert.ok(error instanceof AuthorizationError);
        assert.equal(error.code, expectedCode);
        return true;
      },
    );
  }
  assert.equal(dependencyCalls, 0);
});

test("composite parent variant activation rejects malformed untrusted input before dependency access", async () => {
  let dependencyCalls = 0;
  const service = createCompositeParentVariantAdminService({
    async setParentVariantActivation() {
      dependencyCalls += 1;
      return true;
    },
  });

  for (const input of [
    { ...validParentInput, productId: "" },
    { ...validParentInput, variantId: " parent-variant-1" },
    { ...validParentInput, isActive: "true" },
  ]) {
    assert.deepEqual(await service.setActivation(adminSession, input), {
      ok: false,
      reason: "INVALID_INPUT",
    });
  }
  assert.equal(dependencyCalls, 0);
});

test("composite parent variant activation fails closed when the exact parent is unavailable", async () => {
  const calls: unknown[] = [];
  const service = createCompositeParentVariantAdminService({
    async setParentVariantActivation(input) {
      calls.push(input);
      return false;
    },
  });

  assert.deepEqual(await service.setActivation(adminSession, validParentInput), {
    ok: false,
    reason: "PARENT_VARIANT_NOT_AVAILABLE",
  });
  assert.deepEqual(calls, [validParentInput]);
});

test("composite parent variant activation passes only route-owned product, variant, and target state", async () => {
  const calls: unknown[] = [];
  const service = createCompositeParentVariantAdminService({
    async setParentVariantActivation(input) {
      calls.push(input);
      return true;
    },
  });

  assert.deepEqual(
    await service.setActivation(adminSession, {
      productId: "parent-product-1",
      variantId: "parent-variant-1",
      isActive: false,
      forgedComponentVariantId: "child-variant-attacker-controlled",
      forgedProductActive: false,
    }),
    {
      ok: true,
      variantId: "parent-variant-1",
      isActive: false,
    },
  );
  assert.deepEqual(calls, [
    {
      productId: "parent-product-1",
      variantId: "parent-variant-1",
      isActive: false,
    },
  ]);
});