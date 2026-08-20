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
const shopId = 910_061;

function variation({ productId, name }: { productId: string; name: string }): PancakeParsedCatalogVariation {
  return {
    id: `${productId}-variation`,
    productId,
    displayId: `${productId}-display`,
    barcode: `${productId}-barcode`,
    fields: [{ id: "size", keyValue: "size", name: "Size", value: "M" }],
    imageUrls: [],
    isHidden: false,
    isLocked: false,
    retailPrice: 500_000,
    retailPriceAfterDiscount: 500_000,
    product: {
      id: productId,
      name,
      sourceDescription: null,
      primaryImageUrl: null,
    },
    warehouseStocks: [{ warehouseId: "warehouse-1", remainQuantity: 1 }],
    sellableStock: 1,
  };
}

async function cleanup() {
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: shopId } });
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: "slug-reservation-owner-" } } });
  await prisma.catalogSyncState.deleteMany({ where: { pancakeShopId: shopId } });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

test("catalog sync creates a deterministic readable slug once and Pancake name changes never mutate it", async () => {
  const productId = "slug-sync-product";
  const firstName = "Áo Sơ Mi Oxford Đen";
  const expectedSlug = createBootstrapProductSlug({ shopId, pancakeProductId: productId, name: firstName });

  await repository.syncSnapshot({
    shopId,
    variations: [variation({ productId, name: firstName })],
    syncedAt: new Date("2026-08-20T10:00:00.000Z"),
  });

  const first = await prisma.productMirror.findUniqueOrThrow({
    where: { pancakeProductId: productId },
    select: { slug: true, name: true },
  });
  assert.equal(first.slug, expectedSlug);
  assert.match(first.slug, /^ao-so-mi-oxford-den-[a-f0-9]{20}$/);

  await repository.syncSnapshot({
    shopId,
    variations: [variation({ productId, name: "Tên Pancake Đã Đổi" })],
    syncedAt: new Date("2026-08-20T11:00:00.000Z"),
  });

  const second = await prisma.productMirror.findUniqueOrThrow({
    where: { pancakeProductId: productId },
    select: { slug: true, name: true },
  });
  assert.equal(second.name, "Tên Pancake Đã Đổi");
  assert.equal(second.slug, expectedSlug);
});

test("catalog sync fails closed instead of reusing a permanently reserved historical slug", async () => {
  const productId = "slug-sync-reserved";
  const name = "Áo Khoác Đen";
  const reservedSlug = createBootstrapProductSlug({ shopId, pancakeProductId: productId, name });

  const owner = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId + 1,
      pancakeProductId: `slug-reservation-owner-${Date.now()}`,
      slug: `slug-reservation-current-${Date.now()}`,
      name: "Reservation Owner",
      isPresent: false,
      isActive: false,
      syncedAt: new Date("2026-08-20T09:00:00.000Z"),
    },
  });
  await prisma.productSlugHistory.create({ data: { slug: reservedSlug, productId: owner.id } });

  await assert.rejects(
    () =>
      repository.syncSnapshot({
        shopId,
        variations: [variation({ productId, name })],
        syncedAt: new Date("2026-08-20T12:00:00.000Z"),
      }),
    /bootstrap slug is already reserved/,
  );

  assert.equal(await prisma.productMirror.count({ where: { pancakeProductId: productId } }), 0);
});
