import assert from "node:assert/strict";
import test from "node:test";

import { AuthorizationError } from "../../src/auth/authorization.ts";
import { createCompositeComponentAdminService } from "../../src/commerce/composite-component-admin.ts";

const adminSession = {
  user: { id: "admin-1", role: "ADMIN" },
  session: { id: "session-admin" },
} as const;

const customerSession = {
  user: { id: "customer-1", role: "CUSTOMER" },
  session: { id: "session-customer" },
} as const;

function validInput() {
  return {
    productId: "child-product-1",
    variantId: "child-variant-1",
    isActive: true,
  };
}

test("composite component activation requires ADMIN before relation lookup or write", async () => {
  let dependencyCalls = 0;
  const service = createCompositeComponentAdminService({
    async setRelationLinkedVariantActive() {
      dependencyCalls += 1;
      throw new Error("must not write");
    },
  });

  await assert.rejects(
    () => service.setVariantActive(customerSession, validInput()),
    (error: unknown) => {
      assert.ok(error instanceof AuthorizationError);
      assert.equal(error.code, "FORBIDDEN");
      return true;
    },
  );
  assert.equal(dependencyCalls, 0);
});

test("composite component activation rejects malformed untrusted input before database access", async () => {
  let dependencyCalls = 0;
  const service = createCompositeComponentAdminService({
    async setRelationLinkedVariantActive() {
      dependencyCalls += 1;
      throw new Error("must not write");
    },
  });

  const invalidInputs = [
    null,
    [],
    { ...validInput(), productId: "" },
    { ...validInput(), productId: " child-product-1" },
    { ...validInput(), productId: "x".repeat(129) },
    { ...validInput(), variantId: "" },
    { ...validInput(), variantId: "child-variant-1 " },
    { ...validInput(), variantId: "x".repeat(201) },
    { ...validInput(), isActive: "true" },
    { ...validInput(), isActive: 1 },
    { ...validInput(), isActive: null },
  ];

  for (const input of invalidInputs) {
    assert.deepEqual(await service.setVariantActive(adminSession, input), {
      ok: false,
      reason: "INVALID_INPUT",
    });
  }
  assert.equal(dependencyCalls, 0);
});

test("composite component activation fails closed when the current child relation is not eligible", async () => {
  const calls: unknown[] = [];
  const service = createCompositeComponentAdminService({
    async setRelationLinkedVariantActive(input) {
      calls.push(input);
      return null;
    },
  });

  assert.deepEqual(await service.setVariantActive(adminSession, validInput()), {
    ok: false,
    reason: "VARIANT_NOT_ELIGIBLE",
  });
  assert.deepEqual(calls, [validInput()]);
});

test("composite component activation persists only the reviewed relation-linked variant state", async () => {
  const calls: unknown[] = [];
  const service = createCompositeComponentAdminService({
    async setRelationLinkedVariantActive(input) {
      calls.push(input);
      return input;
    },
  });

  assert.deepEqual(await service.setVariantActive(adminSession, validInput()), {
    ok: true,
    variant: validInput(),
  });
  assert.deepEqual(calls, [validInput()]);

  const deactivate = { ...validInput(), isActive: false };
  assert.deepEqual(await service.setVariantActive(adminSession, deactivate), {
    ok: true,
    variant: deactivate,
  });
  assert.deepEqual(calls, [validInput(), deactivate]);
});
