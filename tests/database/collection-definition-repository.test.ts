import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { CollectionDefinitionError } from "../../src/commerce/collection-definition.ts";
import { createCollectionDefinitionRepository } from "../../src/commerce/collection-definition-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
const repository = createCollectionDefinitionRepository(prisma);

async function cleanup() {
  await prisma.collectionDefinition.deleteMany({
    where: { slug: { startsWith: "p7-repo-" } },
  });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

test("P7 repository validates and upserts one canonical website-owned definition by slug", async () => {
  const initial = await repository.saveDefinition({
    slug: "p7-repo-shirts",
    title: "Shirts",
    description: "Initial collection copy.",
    pancakeCategoryIds: [42, 7, 42],
  });
  const updated = await repository.saveDefinition({
    slug: "p7-repo-shirts",
    title: "Shirts Updated",
    description: "Updated collection copy.",
    seoTitle: "Shirts | LA Clothing",
    isPublished: true,
    pancakeCategoryIds: [7],
  });

  assert.equal(initial.isPublished, false);
  assert.deepEqual(initial.pancakeCategoryIds, [7, 42]);
  assert.equal(updated.title, "Shirts Updated");
  assert.equal(updated.isPublished, true);
  assert.deepEqual(updated.pancakeCategoryIds, [7]);
  assert.equal(
    await prisma.collectionDefinition.count({ where: { slug: "p7-repo-shirts" } }),
    1,
  );
});

test("P7 repository rejects malformed definitions before persistence", async () => {
  await assert.rejects(
    () =>
      repository.saveDefinition({
        slug: "P7 Invalid Slug",
        title: "Invalid",
        description: "Should never persist.",
      }),
    (error: unknown) =>
      error instanceof CollectionDefinitionError && error.reason === "collection-slug",
  );

  assert.equal(
    await prisma.collectionDefinition.count({
      where: { title: "Invalid" },
    }),
    0,
  );
});

test("P7 public repository reads expose only published definitions", async () => {
  await repository.saveDefinition({
    slug: "p7-repo-draft",
    title: "Draft",
    description: "Draft copy.",
  });
  await repository.saveDefinition({
    slug: "p7-repo-public-b",
    title: "Public B",
    description: "Public B copy.",
    isPublished: true,
  });
  await repository.saveDefinition({
    slug: "p7-repo-public-a",
    title: "Public A",
    description: "Public A copy.",
    isPublished: true,
  });

  const published = await repository.listPublished(100);
  assert.deepEqual(
    published.filter(({ slug }) => slug.startsWith("p7-repo-")).map(({ slug }) => slug),
    ["p7-repo-public-a", "p7-repo-public-b"],
  );

  assert.equal(await repository.findPublishedBySlug("p7-repo-draft"), null);
  assert.equal((await repository.findPublishedBySlug("p7-repo-public-a"))?.title, "Public A");
});

test("P7 membership resolver returns deterministic canonical slugs and fails closed for stale membership", async () => {
  await repository.saveDefinition({
    slug: "p7-repo-membership-b",
    title: "Membership B",
    description: "Draft membership B.",
  });
  await repository.saveDefinition({
    slug: "p7-repo-membership-a",
    title: "Membership A",
    description: "Draft membership A.",
  });

  assert.deepEqual(
    await repository.resolveMembershipSlugs([
      "p7-repo-membership-b",
      "p7-repo-membership-a",
    ]),
    ["p7-repo-membership-a", "p7-repo-membership-b"],
  );
  assert.equal(
    await repository.resolveMembershipSlugs([
      "p7-repo-membership-a",
      "p7-repo-membership-missing",
    ]),
    null,
  );
  assert.deepEqual(await repository.resolveMembershipSlugs([]), []);
});

test("P7 repository bounds collection list reads", async () => {
  await assert.rejects(() => repository.listPublished(0), RangeError);
  await assert.rejects(() => repository.listForAdmin(101), RangeError);
});
