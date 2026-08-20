import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createStorefrontProductSlugResolver } from "../../src/commerce/storefront-product-slug-resolution.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const resolveProductSlug = createStorefrontProductSlugResolver(prisma);
const shopId = 910_060;
const otherShopId = 910_061;
const syncedAt = new Date("2026-08-20T15:00:00.000Z");

const productIds = [
  "p6b-visible",
  "p6b-inactive",
  "p6b-stale",
  "p6b-other-shop",
];

async function cleanup() {
  await prisma.productMirror.deleteMany({
    where: { pancakeProductId: { in: productIds } },
  });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => prisma.$disconnect());

test("storefront slug resolution distinguishes current, historical and unknown slugs", async () => {
  await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "p6b-visible",
      slug: "p6b-visible-current",
      name: "P6b Visible Product",
      isPresent: true,
      isActive: true,
      syncedAt,
      slugHistory: {
        create: { slug: "p6b-visible-old" },
      },
    },
  });

  assert.deepEqual(await resolveProductSlug({ shopId, slug: "p6b-visible-current" }), {
    kind: "CURRENT",
  });
  assert.deepEqual(await resolveProductSlug({ shopId, slug: "p6b-visible-old" }), {
    kind: "HISTORICAL",
    currentSlug: "p6b-visible-current",
  });
  assert.deepEqual(await resolveProductSlug({ shopId, slug: "p6b-does-not-exist" }), {
    kind: "UNKNOWN",
  });
});

test("historical redirects stay scoped to visible active products in the configured shop", async () => {
  await prisma.productMirror.createMany({
    data: [
      {
        pancakeShopId: shopId,
        pancakeProductId: "p6b-inactive",
        slug: "p6b-inactive-current",
        name: "P6b Inactive Product",
        isPresent: true,
        isActive: false,
        syncedAt,
      },
      {
        pancakeShopId: shopId,
        pancakeProductId: "p6b-stale",
        slug: "p6b-stale-current",
        name: "P6b Stale Product",
        isPresent: false,
        isActive: false,
        syncedAt,
      },
      {
        pancakeShopId: otherShopId,
        pancakeProductId: "p6b-other-shop",
        slug: "p6b-other-shop-current",
        name: "P6b Other Shop Product",
        isPresent: true,
        isActive: true,
        syncedAt,
      },
    ],
  });

  const products = await prisma.productMirror.findMany({
    where: { pancakeProductId: { in: ["p6b-inactive", "p6b-stale", "p6b-other-shop"] } },
    select: { id: true, pancakeProductId: true },
  });
  const ids = new Map(products.map((product) => [product.pancakeProductId, product.id]));

  await prisma.productSlugHistory.createMany({
    data: [
      { productId: ids.get("p6b-inactive")!, slug: "p6b-inactive-old" },
      { productId: ids.get("p6b-stale")!, slug: "p6b-stale-old" },
      { productId: ids.get("p6b-other-shop")!, slug: "p6b-other-shop-old" },
    ],
  });

  for (const slug of ["p6b-inactive-old", "p6b-stale-old", "p6b-other-shop-old"]) {
    assert.deepEqual(await resolveProductSlug({ shopId, slug }), { kind: "UNKNOWN" });
  }
});

test("slug resolution treats malformed public slugs as unknown without masking invalid shop configuration", async () => {
  assert.deepEqual(await resolveProductSlug({ shopId, slug: "x".repeat(161) }), {
    kind: "UNKNOWN",
  });
  await assert.rejects(() => resolveProductSlug({ shopId: 0, slug: "p6b-anything" }), RangeError);
});
