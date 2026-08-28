import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM "CollectionDefinition" WHERE "slug" LIKE 'p7-schema-%'`;
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

test("P7 deployed schema stores website-owned collection definitions with fail-closed publication defaults", async () => {
  const rows = await prisma.$queryRaw<
    Array<{
      slug: string;
      title: string;
      description: string | null;
      seoTitle: string | null;
      seoDescription: string | null;
      isPublished: boolean;
      homepagePosition: number | null;
      pancakeCategoryIds: number[];
    }>
  >`
    INSERT INTO "CollectionDefinition" ("id", "slug", "title", "createdAt", "updatedAt")
    VALUES ('p7-schema-id', 'p7-schema-manual', 'Manual Collection', NOW(), NOW())
    RETURNING
      "slug",
      "title",
      "description",
      "seoTitle",
      "seoDescription",
      "isPublished",
      "homepagePosition",
      "pancakeCategoryIds"
  `;

  assert.deepEqual(rows, [
    {
      slug: "p7-schema-manual",
      title: "Manual Collection",
      description: null,
      seoTitle: null,
      seoDescription: null,
      isPublished: false,
      homepagePosition: null,
      pancakeCategoryIds: [],
    },
  ]);
});

test("P7 deployed schema enforces stable unique collection slugs", async () => {
  await prisma.$executeRaw`
    INSERT INTO "CollectionDefinition" ("id", "slug", "title", "createdAt", "updatedAt")
    VALUES ('p7-schema-id-1', 'p7-schema-unique', 'First', NOW(), NOW())
  `;

  await assert.rejects(() =>
    prisma.$executeRaw`
      INSERT INTO "CollectionDefinition" ("id", "slug", "title", "createdAt", "updatedAt")
      VALUES ('p7-schema-id-2', 'p7-schema-unique', 'Second', NOW(), NOW())
    `,
  );
});

// Slots 1 and 6 are this file's share of the globally unique `homepagePosition` constraint;
// `collection-definition-repository.test.ts` owns 2, 3 and 5.
test("U2 deployed schema bounds homepage positions to unique slots 1 through 6 while allowing unassigned collections", async () => {
  await prisma.$executeRaw`
    INSERT INTO "CollectionDefinition" ("id", "slug", "title", "homepagePosition", "createdAt", "updatedAt")
    VALUES
      ('p7-schema-home-1', 'p7-schema-home-one', 'Home One', 1, NOW(), NOW()),
      ('p7-schema-home-6', 'p7-schema-home-six', 'Home Six', 6, NOW(), NOW()),
      ('p7-schema-home-null-a', 'p7-schema-home-null-a', 'No Slot A', NULL, NOW(), NOW()),
      ('p7-schema-home-null-b', 'p7-schema-home-null-b', 'No Slot B', NULL, NOW(), NOW())
  `;

  await assert.rejects(() =>
    prisma.$executeRaw`
      INSERT INTO "CollectionDefinition" ("id", "slug", "title", "homepagePosition", "createdAt", "updatedAt")
      VALUES ('p7-schema-home-zero', 'p7-schema-home-zero', 'Invalid Zero', 0, NOW(), NOW())
    `,
  );
  await assert.rejects(() =>
    prisma.$executeRaw`
      INSERT INTO "CollectionDefinition" ("id", "slug", "title", "homepagePosition", "createdAt", "updatedAt")
      VALUES ('p7-schema-home-seven', 'p7-schema-home-seven', 'Invalid Seven', 7, NOW(), NOW())
    `,
  );
  await assert.rejects(() =>
    prisma.$executeRaw`
      INSERT INTO "CollectionDefinition" ("id", "slug", "title", "homepagePosition", "createdAt", "updatedAt")
      VALUES ('p7-schema-home-duplicate', 'p7-schema-home-duplicate', 'Duplicate One', 1, NOW(), NOW())
    `,
  );
});
