import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createStorefrontCatalogRepository } from "../../src/commerce/storefront-catalog.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const repository = createStorefrontCatalogRepository(prisma);
const shopId = 910_052;
const syncedAt = new Date("2026-08-11T04:10:00.000Z");

async function cleanup() {
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: shopId } });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => prisma.$disconnect());

test("storefront catalog pagination keeps products after the first 24 browseable", async () => {
  await prisma.productMirror.createMany({
    data: Array.from({ length: 25 }, (_, index) => {
      const ordinal = String(index + 1).padStart(2, "0");
      return {
        pancakeShopId: shopId,
        pancakeProductId: `storefront-page-product-${ordinal}`,
        slug: `storefront-page-product-${ordinal}`,
        name: `Product ${ordinal}`,
        isPresent: true,
        isActive: true,
        syncedAt,
      };
    }),
  });

  const firstPage = await repository.listProductPage({ shopId, page: 1, pageSize: 24 });
  assert.equal(firstPage.totalProducts, 25);
  assert.equal(firstPage.totalPages, 2);
  assert.equal(firstPage.page, 1);
  assert.equal(firstPage.products.length, 24);
  assert.equal(firstPage.products[0]?.slug, "storefront-page-product-01");
  assert.equal(firstPage.products[23]?.slug, "storefront-page-product-24");

  const secondPage = await repository.listProductPage({ shopId, page: 2, pageSize: 24 });
  assert.equal(secondPage.totalProducts, 25);
  assert.equal(secondPage.totalPages, 2);
  assert.equal(secondPage.page, 2);
  assert.equal(secondPage.products.length, 1);
  assert.equal(secondPage.products[0]?.slug, "storefront-page-product-25");
});
