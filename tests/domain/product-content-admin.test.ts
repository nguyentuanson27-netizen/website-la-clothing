import assert from "node:assert/strict";
import test from "node:test";

import { AuthorizationError } from "../../src/auth/authorization.ts";
import { createProductContentAdminService } from "../../src/commerce/product-content-admin.ts";

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
    productId: "product-1",
    editorialDescription: "  Relaxed tailoring for everyday movement.  ",
    careInstructions: " Cold wash. ",
    sizeGuide: " ",
    seoTitle: "  Relaxed Oxford Shirt  ",
    seoDescription: " Editorial menswear shirt. ",
    collectionSlugs: " essentials, city-uniform ",
  };
}

function passThroughCollections(collectionSlugs: string[]) {
  return Promise.resolve([...collectionSlugs].sort());
}

test("product editorial updates require ADMIN before reading or writing content", async () => {
  let dependencyCalls = 0;
  const service = createProductContentAdminService({
    async productExists() {
      dependencyCalls += 1;
      return true;
    },
    async resolveCollectionSlugs() {
      dependencyCalls += 1;
      return [];
    },
    async saveContent() {
      dependencyCalls += 1;
      throw new Error("must not write");
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

test("product editorial updates reject malformed browser input before database access", async () => {
  let dependencyCalls = 0;
  const service = createProductContentAdminService({
    async productExists() {
      dependencyCalls += 1;
      return true;
    },
    async resolveCollectionSlugs() {
      dependencyCalls += 1;
      return [];
    },
    async saveContent() {
      dependencyCalls += 1;
      throw new Error("must not write");
    },
  });

  for (const input of [
    { ...validInput(), productId: " product-1" },
    { ...validInput(), seoTitle: 123 },
    { ...validInput(), collectionSlugs: "../sale" },
    { ...validInput(), collectionSlugs: "city-uniform, city-uniform" },
    { ...validInput(), collectionSlugs: Array.from({ length: 9 }, (_, index) => `edit-${index}`).join(",") },
  ]) {
    assert.deepEqual(await service.update(adminSession, input), {
      ok: false,
      reason: "INVALID_INPUT",
    });
  }
  assert.equal(dependencyCalls, 0);
});

test("product editorial updates fail closed when the mirrored product does not exist", async () => {
  let collectionCalls = 0;
  let saveCalls = 0;
  const service = createProductContentAdminService({
    async productExists(productId) {
      assert.equal(productId, "product-1");
      return false;
    },
    async resolveCollectionSlugs() {
      collectionCalls += 1;
      return [];
    },
    async saveContent() {
      saveCalls += 1;
      throw new Error("must not write");
    },
  });

  assert.deepEqual(await service.update(adminSession, validInput()), {
    ok: false,
    reason: "PRODUCT_NOT_FOUND",
  });
  assert.equal(collectionCalls, 0);
  assert.equal(saveCalls, 0);
});

test("product editorial updates fail closed when collection membership is stale or unknown", async () => {
  let saveCalls = 0;
  const service = createProductContentAdminService({
    async productExists() {
      return true;
    },
    async resolveCollectionSlugs(collectionSlugs) {
      assert.deepEqual(collectionSlugs, ["essentials", "city-uniform"]);
      return null;
    },
    async saveContent() {
      saveCalls += 1;
      throw new Error("must not write");
    },
  });

  assert.deepEqual(await service.update(adminSession, validInput()), {
    ok: false,
    reason: "COLLECTION_NOT_FOUND",
  });
  assert.equal(saveCalls, 0);
});

test("product editorial updates preserve old form submissions with no collection field", async () => {
  const writes: unknown[] = [];
  let collectionCalls = 0;
  const service = createProductContentAdminService({
    async productExists() {
      return true;
    },
    async resolveCollectionSlugs(collectionSlugs) {
      collectionCalls += 1;
      return passThroughCollections(collectionSlugs);
    },
    async saveContent(content) {
      writes.push(content);
      return content;
    },
  });

  const { collectionSlugs, ...legacyInput } = validInput();
  void collectionSlugs;
  const nullFieldInput = { ...legacyInput, collectionSlugs: null };

  for (const input of [legacyInput, nullFieldInput]) {
    const result = await service.update(adminSession, input);
    assert.equal(result.ok, true);
  }

  assert.equal(collectionCalls, 0);
  assert.deepEqual(
    writes.map((write) => (write as { collectionSlugs: string[] }).collectionSlugs),
    [[], []],
  );
});

test("product editorial updates persist canonical collection membership returned by the resolver", async () => {
  const writes: unknown[] = [];
  const service = createProductContentAdminService({
    async productExists(productId) {
      assert.equal(productId, "product-1");
      return true;
    },
    async resolveCollectionSlugs(collectionSlugs) {
      assert.deepEqual(collectionSlugs, ["essentials", "city-uniform"]);
      return passThroughCollections(collectionSlugs);
    },
    async saveContent(content) {
      writes.push(content);
      return content;
    },
  });

  const result = await service.update(adminSession, validInput());

  assert.deepEqual(writes, [
    {
      productId: "product-1",
      editorialDescription: "Relaxed tailoring for everyday movement.",
      careInstructions: "Cold wash.",
      sizeGuide: null,
      seoTitle: "Relaxed Oxford Shirt",
      seoDescription: "Editorial menswear shirt.",
      collectionSlugs: ["city-uniform", "essentials"],
    },
  ]);
  assert.deepEqual(result, {
    ok: true,
    content: writes[0],
  });
});
