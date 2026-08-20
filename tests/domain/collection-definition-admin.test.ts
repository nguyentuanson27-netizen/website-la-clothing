import assert from "node:assert/strict";
import test from "node:test";

import { AuthorizationError } from "../../src/auth/authorization.ts";
import { CollectionDefinitionError } from "../../src/commerce/collection-definition.ts";
import { createCollectionDefinitionAdminService } from "../../src/commerce/collection-definition-admin.ts";

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
    slug: " city-uniform ",
    title: " City Uniform ",
    description: " Daily tailoring and essentials. ",
    seoTitle: " City Uniform | LA Clothing ",
    seoDescription: " Everyday menswear essentials. ",
    isPublished: "on",
    pancakeCategoryIds: "42, 7",
  };
}

test("collection admin requires ADMIN before parsing or persistence", async () => {
  let saves = 0;
  const service = createCollectionDefinitionAdminService({
    async saveDefinition() {
      saves += 1;
      throw new Error("must not write");
    },
  });

  await assert.rejects(
    () => service.save(customerSession, validInput()),
    (error: unknown) => {
      assert.ok(error instanceof AuthorizationError);
      assert.equal(error.code, "FORBIDDEN");
      return true;
    },
  );
  assert.equal(saves, 0);
});

test("collection admin normalizes browser form values and persists through the reviewed definition boundary", async () => {
  const writes: unknown[] = [];
  const service = createCollectionDefinitionAdminService({
    async saveDefinition(definition) {
      writes.push(definition);
      return definition;
    },
  });

  const result = await service.save(adminSession, validInput());

  assert.deepEqual(writes, [
    {
      slug: "city-uniform",
      title: "City Uniform",
      description: "Daily tailoring and essentials.",
      seoTitle: "City Uniform | LA Clothing",
      seoDescription: "Everyday menswear essentials.",
      isPublished: true,
      pancakeCategoryIds: [7, 42],
    },
  ]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.definition.pancakeCategoryIds, [7, 42]);
  }
});

test("collection admin keeps publication opt-in and optional category mapping empty by default", async () => {
  const writes: unknown[] = [];
  const service = createCollectionDefinitionAdminService({
    async saveDefinition(definition) {
      writes.push(definition);
      return definition;
    },
  });

  const result = await service.save(adminSession, {
    slug: "essentials",
    title: "Essentials",
    description: "Core pieces.",
    seoTitle: "",
    seoDescription: null,
    isPublished: null,
    pancakeCategoryIds: "",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(writes, [
    {
      slug: "essentials",
      title: "Essentials",
      description: "Core pieces.",
      seoTitle: null,
      seoDescription: null,
      isPublished: false,
      pancakeCategoryIds: [],
    },
  ]);
});

test("collection admin rejects malformed checkbox and category CSV before persistence", async () => {
  let saves = 0;
  const service = createCollectionDefinitionAdminService({
    async saveDefinition() {
      saves += 1;
      throw new Error("must not write");
    },
  });

  for (const input of [
    { ...validInput(), isPublished: "yes" },
    { ...validInput(), pancakeCategoryIds: "7,,42" },
    { ...validInput(), pancakeCategoryIds: "7, 7" },
    { ...validInput(), pancakeCategoryIds: "1.5" },
    { ...validInput(), pancakeCategoryIds: "2147483648" },
  ]) {
    assert.deepEqual(await service.save(adminSession, input), {
      ok: false,
      reason: "INVALID_INPUT",
    });
  }
  assert.equal(saves, 0);
});

test("collection admin collapses domain validation failures to a safe form result", async () => {
  let saves = 0;
  const service = createCollectionDefinitionAdminService({
    async saveDefinition(definition) {
      saves += 1;
      throw new CollectionDefinitionError(
        typeof definition === "object" ? "collection-description" : "collection-shape",
      );
    },
  });

  assert.deepEqual(await service.save(adminSession, validInput()), {
    ok: false,
    reason: "INVALID_INPUT",
  });
  assert.equal(saves, 1);
});
