import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createCatalogMirrorRepository } from "../../src/commerce/catalog-mirror-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import type { PancakeCatalogVariation } from "../../src/integrations/pancake/catalog-contract.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const repository = createCatalogMirrorRepository(prisma);
const shopId = 910_040;

function snapshot(productName: string): PancakeCatalogVariation[] {
  return [{
    id: "ordering-variation",
    productId: "ordering-product",
    displayId: "DISPLAY-ORDERING",
    barcode: "BAR-ORDERING",
    fields: [],
    imageUrls: [],
    isHidden: false,
    isLocked: false,
    retailPrice: 100,
    retailPriceAfterDiscount: 100,
    product: { id: "ordering-product", name: productName },
    warehouseStocks: [],
    sellableStock: 0,
  }];
}

async function cleanup() {
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: shopId } });
  await prisma.catalogSyncState.deleteMany({ where: { pancakeShopId: shopId } });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => prisma.$disconnect());

test("catalog mirror rejects an older snapshot after a newer snapshot has committed", async () => {
  await repository.syncSnapshot({ shopId, variations: snapshot("Newest Product"), syncedAt: new Date("2026-08-11T02:00:00.000Z") });
  await assert.rejects(() => repository.syncSnapshot({ shopId, variations: snapshot("Stale Product"), syncedAt: new Date("2026-08-11T01:00:00.000Z") }), /older than the committed mirror/i);
  const product = await prisma.productMirror.findFirstOrThrow({ where: { pancakeShopId: shopId } });
  assert.equal(product.name, "Newest Product");
  assert.deepEqual(product.syncedAt, new Date("2026-08-11T02:00:00.000Z"));
});

test("catalog mirror preserves the watermark for an empty first snapshot", async () => {
  const newerEmptyAt = new Date("2026-08-11T02:00:00.000Z");
  await repository.syncSnapshot({ shopId, variations: [], syncedAt: newerEmptyAt });
  await assert.rejects(() => repository.syncSnapshot({ shopId, variations: snapshot("Stale Product"), syncedAt: new Date("2026-08-11T01:00:00.000Z") }), /older than the committed mirror/i);
  assert.equal(await prisma.productMirror.count({ where: { pancakeShopId: shopId } }), 0);
  const state = await prisma.catalogSyncState.findUniqueOrThrow({ where: { pancakeShopId: shopId } });
  assert.deepEqual(state.syncedAt, newerEmptyAt);
});
