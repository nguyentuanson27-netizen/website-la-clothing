import assert from "node:assert/strict";
import test from "node:test";

import { AuthorizationError } from "../../src/auth/authorization.ts";
import {
  createProductContentBulkCollectionAdminService,
  type BulkProductCollectionUpdate,
} from "../../src/commerce/product-content-admin.ts";

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
    collectionSlug: "mua-thu",
    operation: "add",
  };
}

type Recorder = {
  resolvedSlugs: string[][];
  updates: BulkProductCollectionUpdate[];
};

function createService(
  recorder: Recorder,
  options: Readonly<{ knownSlugs?: readonly string[]; throwOnUpdate?: boolean }> = {},
) {
  const knownSlugs = new Set(options.knownSlugs ?? ["mua-thu", "ao-khoac"]);
  return createProductContentBulkCollectionAdminService({
    async resolveCollectionSlugs(collectionSlugs) {
      recorder.resolvedSlugs.push([...collectionSlugs]);
      return collectionSlugs.every((slug) => knownSlugs.has(slug)) ? [...collectionSlugs] : null;
    },
    async updateCollectionMembershipAtomically(input) {
      recorder.updates.push(input);
      if (options.throwOnUpdate) throw new Error("database unavailable");
      return { ok: true, matchedCount: input.productIds.length, changedCount: 1 } as const;
    },
  });
}

function recorder(): Recorder {
  return { resolvedSlugs: [], updates: [] };
}

test("bulk collection membership requires ADMIN before any dependency call", async () => {
  const calls = recorder();
  const service = createService(calls);

  await assert.rejects(
    () => service.update(customerSession, validInput()),
    (error: unknown) => {
      assert.ok(error instanceof AuthorizationError);
      assert.equal(error.code, "FORBIDDEN");
      return true;
    },
  );
  await assert.rejects(() => service.update(null, validInput()), AuthorizationError);
  assert.deepEqual(calls.resolvedSlugs, []);
  assert.deepEqual(calls.updates, []);
});

test("bulk collection membership rejects malformed input before any dependency call", async () => {
  const calls = recorder();
  const service = createService(calls);

  const tooManyIds = Array.from({ length: 101 }, (_, index) => `product-${index}`);
  const invalidInputs = [
    null,
    "add",
    [],
    { productIds: [], collectionSlug: "mua-thu", operation: "add" },
    { productIds: tooManyIds, collectionSlug: "mua-thu", operation: "add" },
    { productIds: ["product-1", "product-1"], collectionSlug: "mua-thu", operation: "add" },
    { productIds: [" product-1"], collectionSlug: "mua-thu", operation: "add" },
    { productIds: [""], collectionSlug: "mua-thu", operation: "add" },
    { productIds: ["x".repeat(129)], collectionSlug: "mua-thu", operation: "add" },
    { productIds: [42], collectionSlug: "mua-thu", operation: "add" },
    { productIds: ["product-1"], collectionSlug: "", operation: "add" },
    { productIds: ["product-1"], collectionSlug: "Mua-Thu", operation: "add" },
    { productIds: ["product-1"], collectionSlug: "mua thu", operation: "add" },
    { productIds: ["product-1"], collectionSlug: "mua-thu-", operation: "add" },
    { productIds: ["product-1"], collectionSlug: "a".repeat(49), operation: "add" },
    { productIds: ["product-1"], collectionSlug: ["mua-thu"], operation: "add" },
    { productIds: ["product-1"], collectionSlug: "mua-thu", operation: "replace" },
    { productIds: ["product-1"], collectionSlug: "mua-thu", operation: "ADD" },
    { productIds: ["product-1"], collectionSlug: "mua-thu" },
  ];

  for (const input of invalidInputs) {
    assert.deepEqual(await service.update(adminSession, input), {
      ok: false,
      reason: "INVALID_INPUT",
    });
  }
  assert.deepEqual(calls.resolvedSlugs, []);
  assert.deepEqual(calls.updates, []);
});

test("bulk collection membership rejects a collection that is not defined", async () => {
  const calls = recorder();
  const service = createService(calls, { knownSlugs: ["ao-khoac"] });

  assert.deepEqual(await service.update(adminSession, validInput()), {
    ok: false,
    reason: "COLLECTION_NOT_FOUND",
  });
  assert.deepEqual(calls.resolvedSlugs, [["mua-thu"]]);
  assert.deepEqual(calls.updates, []);
});

test("bulk collection membership forwards exactly one validated slug and operation", async () => {
  const calls = recorder();
  const service = createService(calls);

  assert.deepEqual(await service.update(adminSession, validInput()), {
    ok: true,
    matchedCount: 2,
    changedCount: 1,
  });
  assert.deepEqual(await service.update(adminSession, { ...validInput(), operation: "remove" }), {
    ok: true,
    matchedCount: 2,
    changedCount: 1,
  });

  assert.deepEqual(calls.updates, [
    { productIds: ["product-1", "product-2"], collectionSlug: "mua-thu", operation: "add" },
    { productIds: ["product-1", "product-2"], collectionSlug: "mua-thu", operation: "remove" },
  ]);
});

test("bulk collection membership reports an unavailable repository without leaking internals", async () => {
  const calls = recorder();
  const service = createService(calls, { throwOnUpdate: true });

  assert.deepEqual(await service.update(adminSession, validInput()), {
    ok: false,
    reason: "UNAVAILABLE",
  });
  assert.equal(calls.updates.length, 1);
});
