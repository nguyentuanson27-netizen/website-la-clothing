import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createSearchSitemapRepository } from "../../src/seo/search-sitemap-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const repository = createSearchSitemapRepository(prisma);
const shopId = 910_120;
const otherShopId = 910_121;
const syncedAt = new Date("2026-08-21T00:00:00.000Z");
const productIds = [
  "p12-visible",
  "p12-inactive",
  "p12-stale",
  "p12-other-shop",
];
const collectionSlugs = ["p12-public-collection", "p12-draft-collection"];

async function cleanup() {
  await prisma.productMirror.deleteMany({
    where: { pancakeProductId: { in: productIds } },
  });
  await prisma.collectionDefinition.deleteMany({
    where: { slug: { in: collectionSlugs } },
  });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => prisma.$disconnect());

test("P12 sitemap repository returns only canonical current public paths", async () => {
  const visible = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "p12-visible",
      slug: "p12-visible-current",
      name: "P12 Visible Product",
      isPresent: true,
      isActive: true,
      syncedAt,
      slugHistory: {
        create: { slug: "p12-visible-old" },
      },
    },
  });
  assert.ok(visible.id);

  await prisma.productMirror.createMany({
    data: [
      {
        pancakeShopId: shopId,
        pancakeProductId: "p12-inactive",
        slug: "p12-inactive-current",
        name: "P12 Inactive Product",
        isPresent: true,
        isActive: false,
        syncedAt,
      },
      {
        pancakeShopId: shopId,
        pancakeProductId: "p12-stale",
        slug: "p12-stale-current",
        name: "P12 Stale Product",
        isPresent: false,
        isActive: false,
        syncedAt,
      },
      {
        pancakeShopId: otherShopId,
        pancakeProductId: "p12-other-shop",
        slug: "p12-other-shop-current",
        name: "P12 Other Shop Product",
        isPresent: true,
        isActive: true,
        syncedAt,
      },
    ],
  });

  await prisma.collectionDefinition.createMany({
    data: [
      {
        slug: "p12-public-collection",
        title: "P12 Public Collection",
        description: "Published website-owned collection.",
        isPublished: true,
      },
      {
        slug: "p12-draft-collection",
        title: "P12 Draft Collection",
        description: "Draft website-owned collection.",
        isPublished: false,
      },
    ],
  });

  assert.deepEqual(await repository.listCanonicalPaths({ shopId }), [
    "/collections/p12-public-collection",
    "/shop/p12-visible-current",
  ]);
});

test("P12 sitemap repository validates the configured shop boundary", async () => {
  await assert.rejects(() => repository.listCanonicalPaths({ shopId: 0 }), RangeError);
  await assert.rejects(
    () => repository.listCanonicalPaths({ shopId: 2_147_483_648 }),
    RangeError,
  );
});

test("W21 capacity counts and the emitted path list cannot drift apart", async () => {
  await prisma.productMirror.createMany({
    data: [
      {
        pancakeShopId: shopId,
        pancakeProductId: "p12-visible",
        slug: "p12-visible-current",
        name: "P12 Visible Product",
        isPresent: true,
        isActive: true,
        syncedAt,
      },
      {
        pancakeShopId: shopId,
        pancakeProductId: "p12-inactive",
        slug: "p12-inactive-current",
        name: "P12 Inactive Product",
        isPresent: true,
        isActive: false,
        syncedAt,
      },
      {
        pancakeShopId: shopId,
        pancakeProductId: "p12-stale",
        slug: "p12-stale-current",
        name: "P12 Stale Product",
        isPresent: false,
        isActive: true,
        syncedAt,
      },
      {
        pancakeShopId: otherShopId,
        pancakeProductId: "p12-other-shop",
        slug: "p12-other-shop-current",
        name: "P12 Other Shop Product",
        isPresent: true,
        isActive: true,
        syncedAt,
      },
    ],
  });

  await prisma.collectionDefinition.createMany({
    data: [
      {
        slug: "p12-public-collection",
        title: "P12 Public Collection",
        description: "Published website-owned collection.",
        isPublished: true,
      },
      {
        slug: "p12-draft-collection",
        title: "P12 Draft Collection",
        description: "Draft website-owned collection.",
        isPublished: false,
      },
    ],
  });

  const counts = await repository.countCanonicalPaths({ shopId });
  const paths = await repository.listCanonicalPaths({ shopId });

  // The capacity measurement is only trustworthy if it counts exactly what the sitemap emits, so
  // this asserts the composition of the real list rather than a second copy of the predicate.
  assert.equal(
    counts.productPaths,
    paths.filter((path) => path.startsWith("/shop/")).length,
    "inactive, absent and other-shop products are excluded from both the count and the list",
  );
  assert.equal(
    counts.collectionPaths,
    paths.filter((path) => path.startsWith("/collections/")).length,
    "draft collections are excluded from both the count and the list",
  );
  assert.equal(counts.productPaths + counts.collectionPaths, paths.length);
  assert.deepEqual(counts, { productPaths: 1, collectionPaths: 1 });
});

test("W21 capacity counts validate the same shop boundary as the path list", async () => {
  await assert.rejects(() => repository.countCanonicalPaths({ shopId: 0 }), RangeError);
  await assert.rejects(
    () => repository.countCanonicalPaths({ shopId: 2_147_483_648 }),
    RangeError,
  );
});
