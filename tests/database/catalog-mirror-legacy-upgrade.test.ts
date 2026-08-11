import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createCatalogMirrorRepository } from "../../src/commerce/catalog-mirror-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
const repository = createCatalogMirrorRepository(prisma);
const shopId = 910_041;
const legacyProductId = "legacy-product-before-c4";
const legacyVariationId = "legacy-variation-before-c4";

async function cleanup() {
  await prisma.productMirror.deleteMany({
    where: {
      OR: [
        { pancakeShopId: shopId },
        { pancakeProductId: legacyProductId },
      ],
    },
  });
  await prisma.catalogSyncState.deleteMany({ where: { pancakeShopId: shopId } });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

test("catalog mirror adopts and reconciles ProductMirror rows that predate shop scoping", async () => {
  const legacySyncedAt = new Date("2026-08-10T00:00:00.000Z");
  const c4SyncedAt = new Date("2026-08-11T00:00:00.000Z");

  const legacyProduct = await prisma.productMirror.create({
    data: {
      pancakeShopId: 0,
      pancakeProductId: legacyProductId,
      slug: "legacy-product-before-c4",
      name: "Legacy Product",
      isPresent: true,
      isActive: true,
      syncedAt: legacySyncedAt,
    },
  });
  const legacyVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: legacyVariationId,
      productId: legacyProduct.id,
      sku: "LEGACY-SKU",
      isPresent: true,
      isActive: true,
      syncedAt: legacySyncedAt,
    },
  });
  await prisma.warehouseStock.create({
    data: {
      variantId: legacyVariant.id,
      pancakeWarehouseId: "legacy-warehouse",
      quantity: 2,
      syncedAt: legacySyncedAt,
    },
  });

  await repository.syncSnapshot({ shopId, variations: [], syncedAt: c4SyncedAt });

  const reconciledProduct = await prisma.productMirror.findUniqueOrThrow({
    where: { pancakeProductId: legacyProductId },
  });
  assert.equal(reconciledProduct.pancakeShopId, shopId);
  assert.equal(reconciledProduct.isPresent, false);
  assert.equal(reconciledProduct.isActive, false);
  assert.equal(reconciledProduct.syncedAt.getTime(), c4SyncedAt.getTime());

  const reconciledVariant = await prisma.variantMirror.findUniqueOrThrow({
    where: { pancakeVariationId: legacyVariationId },
  });
  assert.equal(reconciledVariant.isPresent, false);
  assert.equal(reconciledVariant.isActive, false);
  assert.equal(reconciledVariant.syncedAt.getTime(), c4SyncedAt.getTime());
  assert.equal(await prisma.warehouseStock.count({ where: { variantId: legacyVariant.id } }), 0);
});
