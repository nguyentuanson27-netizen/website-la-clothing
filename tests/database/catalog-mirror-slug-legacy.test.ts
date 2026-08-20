import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createCatalogMirrorRepository } from "../../src/commerce/catalog-mirror-repository.ts";
import { createBootstrapProductSlug } from "../../src/commerce/product-slug.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import type { PancakeParsedCatalogVariation } from "../../src/integrations/pancake/catalog-contract.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const repository = createCatalogMirrorRepository(prisma);
const shopId = 910_062;
const productId = "slug-rolling-legacy-product";

function variation(name: string): PancakeParsedCatalogVariation {
  return {
    id: `${productId}-variation`,
    productId,
    displayId: `${productId}-display`,
    barcode: `${productId}-barcode`,
    fields: [{ id: "size", keyValue: "size", name: "Size", value: "L" }],
    imageUrls: [],
    isHidden: false,
    isLocked: false,
    retailPrice: 600_000,
    retailPriceAfterDiscount: 600_000,
    product: {
      id: productId,
      name,
      sourceDescription: null,
      primaryImageUrl: null,
    },
    warehouseStocks: [{ warehouseId: "warehouse-legacy", remainQuantity: 2 }],
    sellableStock: 2,
  };
}

async function cleanup() {
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: productId } });
  await prisma.catalogSyncState.deleteMany({ where: { pancakeShopId: shopId } });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

test("new runtime heals a legacy p-digest row created after migration while preserving the old slug as history", async () => {
  const name = "Áo Len Cổ Tròn";
  const expectedSlug = createBootstrapProductSlug({ shopId, pancakeProductId: productId, name });
  const legacySlug = `p-${expectedSlug.slice(-20)}`;

  const existing = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: productId,
      slug: legacySlug,
      name,
      isPresent: true,
      isActive: true,
      syncedAt: new Date("2026-08-20T09:00:00.000Z"),
    },
  });

  await repository.syncSnapshot({
    shopId,
    variations: [variation(name)],
    syncedAt: new Date("2026-08-20T10:00:00.000Z"),
  });

  const healed = await prisma.productMirror.findUniqueOrThrow({
    where: { id: existing.id },
    select: { slug: true },
  });
  assert.equal(healed.slug, expectedSlug);

  const history = await prisma.productSlugHistory.findUniqueOrThrow({
    where: { slug: legacySlug },
    select: { productId: true },
  });
  assert.equal(history.productId, existing.id);
});
