import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createCatalogMirrorRepository } from "../../src/commerce/catalog-mirror-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import type { PancakeCatalogVariation } from "../../src/integrations/pancake/catalog-contract.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
const repository = createCatalogMirrorRepository(prisma);
const shopId = 910_039;

function variation({
  id,
  productName = "Mirror Product",
  displayId,
  barcode,
  retailPrice = 500_000,
  retailPriceAfterDiscount = 450_000,
  stocks,
}: {
  id: string;
  productName?: string;
  displayId: string;
  barcode: string;
  retailPrice?: number;
  retailPriceAfterDiscount?: number;
  stocks: Array<{ warehouseId: string; remainQuantity: number }>;
}): PancakeCatalogVariation {
  return {
    id,
    productId: "mirror-product-1",
    displayId,
    barcode,
    fields: [
      { id: "field-color", keyValue: "color", name: "Color", value: "Black" },
      { id: "field-size", keyValue: "size", name: "Size", value: "M" },
    ],
    imageUrls: ["https://example.test/mirror-product.jpg"],
    isHidden: false,
    isLocked: false,
    retailPrice,
    retailPriceAfterDiscount,
    product: { id: "mirror-product-1", name: productName },
    warehouseStocks: stocks,
    sellableStock: stocks.reduce((total, stock) => total + stock.remainQuantity, 0),
  };
}

async function cleanup() {
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: shopId } });
  await prisma.catalogSyncState.deleteMany({ where: { pancakeShopId: shopId } });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

test("catalog mirror sync is idempotent, preserves website-owned policy, and aggregates all warehouses", async () => {
  const firstSyncAt = new Date("2026-08-11T00:00:00.000Z");
  const secondSyncAt = new Date("2026-08-11T01:00:00.000Z");
  const firstSnapshot = [
    variation({
      id: "mirror-variation-1",
      displayId: "DISPLAY-1",
      barcode: "BAR-1",
      stocks: [
        { warehouseId: "warehouse-a", remainQuantity: 3.5 },
        { warehouseId: "warehouse-b", remainQuantity: 4 },
      ],
    }),
    variation({
      id: "mirror-variation-2",
      displayId: "DISPLAY-2",
      barcode: "BAR-2",
      stocks: [{ warehouseId: "warehouse-a", remainQuantity: 1 }],
    }),
  ];

  await repository.syncSnapshot({ shopId, variations: firstSnapshot, syncedAt: firstSyncAt });
  await repository.syncSnapshot({ shopId, variations: firstSnapshot, syncedAt: firstSyncAt });

  assert.equal(await prisma.productMirror.count({ where: { pancakeShopId: shopId } }), 1);
  assert.equal(
    await prisma.variantMirror.count({ where: { product: { pancakeShopId: shopId } } }),
    2,
  );
  assert.equal(
    await prisma.warehouseStock.count({ where: { variant: { product: { pancakeShopId: shopId } } } }),
    3,
  );

  const firstRead = await repository.listPresentProducts({ shopId, limit: 10 });
  assert.equal(firstRead.length, 1);
  assert.equal(firstRead[0]?.name, "Mirror Product");
  assert.equal(firstRead[0]?.isActive, false);
  assert.equal(firstRead[0]?.variants[0]?.pancakeVariationId, "mirror-variation-1");
  assert.equal(firstRead[0]?.variants[0]?.pancakeDisplayId, "DISPLAY-1");
  assert.equal(firstRead[0]?.variants[0]?.pancakeBarcode, "BAR-1");
  assert.equal(firstRead[0]?.variants[0]?.pancakeRetailPrice, 500_000);
  assert.equal(firstRead[0]?.variants[0]?.pancakeRetailPriceAfterDiscount, 450_000);
  assert.deepEqual(firstRead[0]?.variants[0]?.pancakeFields, firstSnapshot[0]?.fields);
  assert.deepEqual(firstRead[0]?.variants[0]?.pancakeImageUrls, firstSnapshot[0]?.imageUrls);
  assert.equal(firstRead[0]?.variants[0]?.sellableStock, 7.5);

  const mirroredProduct = await prisma.productMirror.findFirstOrThrow({
    where: { pancakeShopId: shopId },
    include: { variants: { orderBy: { pancakeVariationId: "asc" } } },
  });
  await prisma.productMirror.update({
    where: { id: mirroredProduct.id },
    data: { isActive: true },
  });
  await prisma.variantMirror.update({
    where: { id: mirroredProduct.variants[0]!.id },
    data: { isActive: true, sku: "LOCAL-SKU", color: "Local Black", size: "Local M" },
  });

  const secondSnapshot = [
    variation({
      id: "mirror-variation-1",
      productName: "Mirror Product Updated",
      displayId: "DISPLAY-1-UPDATED",
      barcode: "BAR-1-UPDATED",
      retailPrice: 520_000,
      retailPriceAfterDiscount: 470_000,
      stocks: [{ warehouseId: "warehouse-a", remainQuantity: 2 }],
    }),
  ];
  await repository.syncSnapshot({ shopId, variations: secondSnapshot, syncedAt: secondSyncAt });

  const secondRead = await repository.listPresentProducts({ shopId, limit: 10 });
  assert.equal(secondRead.length, 1);
  assert.equal(secondRead[0]?.name, "Mirror Product Updated");
  assert.equal(secondRead[0]?.isActive, true);
  assert.equal(secondRead[0]?.variants.length, 1);
  assert.equal(secondRead[0]?.variants[0]?.isActive, true);
  assert.equal(secondRead[0]?.variants[0]?.sku, "LOCAL-SKU");
  assert.equal(secondRead[0]?.variants[0]?.color, "Local Black");
  assert.equal(secondRead[0]?.variants[0]?.size, "Local M");
  assert.equal(secondRead[0]?.variants[0]?.pancakeDisplayId, "DISPLAY-1-UPDATED");
  assert.equal(secondRead[0]?.variants[0]?.sellableStock, 2);

  const staleVariant = await prisma.variantMirror.findUniqueOrThrow({
    where: { pancakeVariationId: "mirror-variation-2" },
  });
  assert.equal(staleVariant.isPresent, false);
  assert.equal(staleVariant.isActive, false);
  assert.equal(
    await prisma.warehouseStock.count({ where: { variantId: staleVariant.id } }),
    0,
  );
});

test("catalog mirror rejects inconsistent duplicate variation identity before database writes", async () => {
  const first = variation({
    id: "duplicate-variation",
    displayId: "DISPLAY-A",
    barcode: "BAR-A",
    stocks: [],
  });
  const duplicate = variation({
    id: "duplicate-variation",
    displayId: "DISPLAY-B",
    barcode: "BAR-B",
    stocks: [],
  });

  await assert.rejects(
    () =>
      repository.syncSnapshot({
        shopId,
        variations: [first, duplicate],
        syncedAt: new Date("2026-08-11T00:00:00.000Z"),
      }),
    /duplicate variation/i,
  );
  assert.equal(await prisma.productMirror.count({ where: { pancakeShopId: shopId } }), 0);
});

test("catalog mirror rejects shop ids outside the PostgreSQL INTEGER range before writes", async () => {
  await assert.rejects(
    () =>
      repository.syncSnapshot({
        shopId: 2_147_483_648,
        variations: [],
        syncedAt: new Date("2026-08-11T00:00:00.000Z"),
      }),
    /shop id/i,
  );
  assert.equal(await prisma.productMirror.count({ where: { pancakeShopId: shopId } }), 0);
});
