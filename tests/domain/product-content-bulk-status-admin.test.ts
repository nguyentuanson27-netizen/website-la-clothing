import assert from "node:assert/strict";
import test from "node:test";

import { AuthorizationError } from "../../src/auth/authorization.ts";
import { createProductContentBulkStatusAdminService } from "../../src/commerce/product-content-admin.ts";

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
    productIds: ["product-1", "product-2"],
    status: "PUBLISHED",
  };
}

test("bulk product status updates require ADMIN before repository access", async () => {
  let dependencyCalls = 0;
  const service = createProductContentBulkStatusAdminService({
    async updateStatusesAtomically() {
      dependencyCalls += 1;
      return { ok: true, updatedCount: 2 } as const;
    },
  });

  await assert.rejects(
    () => service.update(customerSession, validInput()),
    (error: unknown) => {
      assert.ok(error instanceof AuthorizationError);
      assert.equal(error.code, "FORBIDDEN");
      return true;
    },
  );
  assert.equal(dependencyCalls, 0);
});

test("bulk product status updates reject malformed input before repository access", async () => {
  let dependencyCalls = 0;
  const service = createProductContentBulkStatusAdminService({
    async updateStatusesAtomically() {
      dependencyCalls += 1;
      return { ok: true, updatedCount: 1 } as const;
    },
  });

  const tooManyIds = Array.from({ length: 101 }, (_, index) => `product-${index}`);
  const invalidInputs = [
    null,
    [],
    { productIds: [], status: "DRAFT" },
    { productIds: ["product-1", "product-1"], status: "DRAFT" },
    { productIds: [" product-1"], status: "DRAFT" },
    { productIds: [""], status: "DRAFT" },
    { productIds: ["x".repeat(129)], status: "DRAFT" },
    { productIds: [123], status: "DRAFT" },
    { productIds: tooManyIds, status: "DRAFT" },
    { productIds: ["product-1"], status: "published" },
    { productIds: ["product-1"], status: "ARCHIVED" },
    { productIds: ["product-1"], status: 123 },
  ];

  for (const input of invalidInputs) {
    assert.deepEqual(await service.update(adminSession, input), {
      ok: false,
      reason: "INVALID_INPUT",
    });
  }
  assert.equal(dependencyCalls, 0);
});

test("bulk product status updates pass only canonical ids and status to one atomic dependency", async () => {
  const calls: unknown[] = [];
  const service = createProductContentBulkStatusAdminService({
    async updateStatusesAtomically(input) {
      calls.push(input);
      return { ok: true, updatedCount: input.productIds.length } as const;
    },
  });

  const result = await service.update(adminSession, {
    ...validInput(),
    sourceDescription: "forged source data",
    collectionSlugs: ["must-not-write"],
    isActive: false,
  });

  assert.deepEqual(calls, [validInput()]);
  assert.deepEqual(result, { ok: true, updatedCount: 2 });
});

test("bulk product status updates preserve repository not-found failure", async () => {
  const service = createProductContentBulkStatusAdminService({
    async updateStatusesAtomically() {
      return { ok: false, reason: "PRODUCT_NOT_FOUND" } as const;
    },
  });

  assert.deepEqual(await service.update(adminSession, validInput()), {
    ok: false,
    reason: "PRODUCT_NOT_FOUND",
  });
});
