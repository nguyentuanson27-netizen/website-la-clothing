import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  buildAdminProductFacetTargets,
  parseAdminProductDirectorySearchParams,
} from "../../src/commerce/admin-product-directory.ts";
import { createProductContentRepository } from "../../src/commerce/product-content-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
const repository = createProductContentRepository(prisma);

const testShopId = 920_011;
const externalPrefix = "admin-facet-";

function query(searchParams: Record<string, string | string[] | undefined>) {
  return parseAdminProductDirectorySearchParams(searchParams);
}

async function cleanup() {
  await prisma.productMirror.deleteMany({
    where: { pancakeProductId: { startsWith: externalPrefix } },
  });
}

type SeedProduct = Readonly<{
  key: string;
  name: string;
  isActive?: boolean;
  content?: Readonly<{
    status: "DRAFT" | "REVIEWED" | "PUBLISHED";
    collectionSlugs: string[];
  }>;
}>;

async function seed(product: SeedProduct): Promise<void> {
  await prisma.productMirror.create({
    data: {
      pancakeShopId: testShopId,
      pancakeProductId: `${externalPrefix}${product.key}`,
      slug: `${externalPrefix}${product.key}`,
      name: product.name,
      isActive: product.isActive ?? true,
      syncedAt: new Date("2026-08-10T00:00:00.000Z"),
      ...(product.content
        ? {
            content: {
              create: {
                status: product.content.status,
                collectionSlugs: product.content.collectionSlugs,
              },
            },
          }
        : {}),
    },
  });
}

/**
 * The facet contract: every chip's displayed count must equal the total of the page its own
 * href opens. Counting and linking therefore have to derive from the same target query.
 */
async function assertFacetCountsMatchTheirTargets(
  active: ReturnType<typeof query>,
  context: string,
): Promise<void> {
  const targets = buildAdminProductFacetTargets(active);
  const counts = await repository.countDirectoryFacets(targets);

  for (const [key, target] of Object.entries(targets)) {
    const { totalCount } = await repository.listDirectoryPage({ query: target });
    assert.equal(
      counts[key as keyof typeof counts],
      totalCount,
      `${context}: facet "${key}" displays ${counts[key as keyof typeof counts]} but its target page totals ${totalCount}`,
    );
  }
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

test("facet counts equal the totals of the pages their links open, across combined filters", async () => {
  const token = "admfacet";
  const citySlug = "admfacet-city";

  // A spread that makes every dropped dimension observable: statuses crossed with membership,
  // plus an inactive row so the activity dimension is not degenerate.
  await seed({
    key: "city-draft",
    name: `${token} city draft`,
    content: { status: "DRAFT", collectionSlugs: [citySlug] },
  });
  await seed({
    key: "city-published",
    name: `${token} city published`,
    content: { status: "PUBLISHED", collectionSlugs: [citySlug] },
  });
  await seed({
    key: "loose-draft",
    name: `${token} loose draft`,
    content: { status: "DRAFT", collectionSlugs: [] },
  });
  await seed({
    key: "loose-published",
    name: `${token} loose published`,
    content: { status: "PUBLISHED", collectionSlugs: [] },
  });
  await seed({ key: "no-content", name: `${token} no content` });
  await seed({
    key: "inactive-reviewed",
    name: `${token} inactive reviewed`,
    isActive: false,
    content: { status: "REVIEWED", collectionSlugs: [citySlug] },
  });

  // Collection active: the status chips keep the collection, so their counts must too.
  await assertFacetCountsMatchTheirTargets(
    query({ q: token, collection: citySlug }),
    "collection active",
  );

  // Status active: the uncategorized chip keeps the status, so its count must too.
  await assertFacetCountsMatchTheirTargets(query({ q: token, status: "DRAFT" }), "status active");

  // Both active at once.
  await assertFacetCountsMatchTheirTargets(
    query({ q: token, status: "PUBLISHED", collection: citySlug }),
    "status + collection active",
  );

  // q/activity active: the All chip retains them, so its count and link must agree.
  await assertFacetCountsMatchTheirTargets(
    query({ q: token, activity: "active" }),
    "search + activity active",
  );

  // Uncategorized sentinel active alongside a status.
  await assertFacetCountsMatchTheirTargets(
    query({ q: token, status: "DRAFT", collection: "none" }),
    "uncategorized + status active",
  );
});

test("the All facet retains search and activity while clearing status and collection", async () => {
  const token = "admfacetall";
  const citySlug = "admfacetall-city";

  await seed({
    key: "all-a",
    name: `${token} a`,
    content: { status: "PUBLISHED", collectionSlugs: [citySlug] },
  });
  await seed({
    key: "all-b",
    name: `${token} b`,
    content: { status: "DRAFT", collectionSlugs: [] },
  });
  await seed({ key: "all-c", name: `${token} c`, isActive: false });

  const active = query({ q: token, status: "PUBLISHED", collection: citySlug, activity: "active" });
  const targets = buildAdminProductFacetTargets(active);

  // Dimensions the facet row owns are cleared; the search form's dimensions are retained.
  assert.equal(targets.all.status, null);
  assert.equal(targets.all.collection, null);
  assert.equal(targets.all.uncategorized, false);
  assert.equal(targets.all.query, token);
  assert.equal(targets.all.activity, "active");

  // Two active rows carry the token; the inactive one is excluded by the retained activity filter.
  const counts = await repository.countDirectoryFacets(targets);
  assert.equal(counts.all, 2);

  const { totalCount } = await repository.listDirectoryPage({ query: targets.all });
  assert.equal(counts.all, totalCount);
});
