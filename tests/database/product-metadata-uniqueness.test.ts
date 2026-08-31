import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.ts";
import {
  evaluateProductMetadataUniqueness,
  type ProductMetadataUniquenessCandidate,
} from "../../src/seo/product-metadata-uniqueness.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const PREFIX = "w2a";

async function cleanup() {
  await prisma.$executeRaw`
    DELETE FROM "ProductContent" WHERE "productId" LIKE ${`${PREFIX}-%`}
  `;
  await prisma.$executeRaw`DELETE FROM "ProductMirror" WHERE "id" LIKE ${`${PREFIX}-%`}`;
}

async function insertProduct(
  suffix: string,
  name: string,
  seo: { seoTitle: string | null; seoDescription: string | null },
) {
  const id = `${PREFIX}-${suffix}`;
  await prisma.$executeRaw`
    INSERT INTO "ProductMirror" ("id", "pancakeShopId", "pancakeProductId", "slug", "name", "syncedAt", "createdAt", "updatedAt")
    VALUES (${id}, 920007, ${`${id}-external`}, ${`${id}-slug`}, ${name}, NOW(), NOW(), NOW())
  `;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ProductContent" ("id", "productId", "seoTitle", "seoDescription", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    `${id}-content`,
    id,
    seo.seoTitle,
    seo.seoDescription,
  );
}

async function readCandidates(): Promise<ProductMetadataUniquenessCandidate[]> {
  return prisma.$queryRaw<ProductMetadataUniquenessCandidate[]>`
    SELECT p."slug", p."name", c."seoTitle", c."seoDescription"
    FROM "ProductMirror" p
    LEFT JOIN "ProductContent" c ON c."productId" = p."id"
    WHERE p."id" LIKE ${`${PREFIX}-%`}
    ORDER BY p."slug"
  `;
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

test("W2a the deployed schema does not prevent two products from publishing identical SEO copy", async () => {
  const seo = {
    seoTitle: "W2a duplicate SEO title",
    seoDescription: "W2a duplicate SEO description.",
  };

  await insertProduct("dup-a", "W2a Product A", seo);
  await insertProduct("dup-b", "W2a Product B", seo);

  const verdict = evaluateProductMetadataUniqueness(await readCandidates());

  assert.equal(
    verdict.safeToRemoveSlugDiscriminator,
    false,
    "the slug discriminator is still doing real work for this catalog shape",
  );
  assert.equal(verdict.collidingProductCount, 2);
  assert.deepEqual(verdict.collisions[0]?.slugs, [`${PREFIX}-dup-a-slug`, `${PREFIX}-dup-b-slug`]);
});

test("W2a two products sharing a name with no published SEO copy also collide without the slug", async () => {
  const unpublished = { seoTitle: null, seoDescription: null };

  await insertProduct("fallback-a", "W2a Shared Name", unpublished);
  await insertProduct("fallback-b", "W2a Shared Name", unpublished);

  const verdict = evaluateProductMetadataUniqueness(await readCandidates());

  assert.equal(verdict.safeToRemoveSlugDiscriminator, false);
  assert.equal(verdict.collidingProductCount, 2);
});

test("W2a a catalog whose published copy already differs is reported as safe", async () => {
  await insertProduct("unique-a", "W2a Product A", {
    seoTitle: "W2a title A",
    seoDescription: "W2a description A.",
  });
  await insertProduct("unique-b", "W2a Product B", {
    seoTitle: "W2a title B",
    seoDescription: "W2a description B.",
  });

  assert.deepEqual(evaluateProductMetadataUniqueness(await readCandidates()), {
    safeToRemoveSlugDiscriminator: true,
    collidingProductCount: 0,
    collisions: [],
  });
});
