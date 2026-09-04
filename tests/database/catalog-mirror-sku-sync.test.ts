import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createCatalogMirrorRepository } from "../../src/commerce/catalog-mirror-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import type { PancakeParsedCatalogVariation } from "../../src/integrations/pancake/catalog-contract.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for catalog mirror sku sync tests");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
const repository = createCatalogMirrorRepository(prisma);
const testShopId = 910_041;

function makeVariation({
  id,
  productId = "mirror-product-sku-test",
  displayId,
  barcode,
}: {
  id: string;
  productId?: string;
  displayId: string | null;
  barcode: string;
}): PancakeParsedCatalogVariation {
  return {
    id,
    productId,
    displayId,
    barcode,
    fields: [
      { id: "f-color", keyValue: "color", name: "Color", value: "Navy" },
      { id: "f-size", keyValue: "size", name: "Size", value: "M" },
    ],
    imageUrls: ["https://example.test/navy-m.jpg"],
    isHidden: false,
    isLocked: false,
    retailPrice: 500_000,
    retailPriceAfterDiscount: 500_000,
    product: {
      id: productId,
      name: "Áo A132 SKU Test",
      sourceDescription: "Description",
      primaryImageUrl: "https://example.test/navy.jpg",
    },
    warehouseStocks: [{ warehouseId: "wh-1", remainQuantity: 10 }],
    sellableStock: 10,
  };
}

async function cleanup() {
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: testShopId } });
  await prisma.catalogSyncState.deleteMany({ where: { pancakeShopId: testShopId } });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

test("catalog mirror sync maps display_id directly to VariantMirror.sku without fallback", async () => {
  const syncTime = new Date("2026-09-04T12:00:00.000Z");

  // 1. Positive: display_id = 'A132-M' -> VariantMirror.sku = 'A132-M'
  const positive = makeVariation({
    id: "var-positive-1",
    displayId: "A132-M",
    barcode: "145-1",
  });

  // 2. Negative / Anti-fallback: display_id = null, barcode = '145-2', variationId = UUID
  // Must result in sku = null, never barcode, never variationId, never slug
  const antiFallback = makeVariation({
    id: "var-anti-fallback-2",
    displayId: null,
    barcode: "145-2",
  });

  await repository.syncSnapshot({
    shopId: testShopId,
    variations: [positive, antiFallback],
    syncedAt: syncTime,
  });

  const rowPositive = await prisma.variantMirror.findUniqueOrThrow({
    where: { pancakeVariationId: "var-positive-1" },
  });
  assert.equal(rowPositive.pancakeDisplayId, "A132-M");
  assert.equal(rowPositive.sku, "A132-M", "Positive: sku must equal display_id");

  const rowAntiFallback = await prisma.variantMirror.findUniqueOrThrow({
    where: { pancakeVariationId: "var-anti-fallback-2" },
  });
  assert.equal(rowAntiFallback.pancakeDisplayId, null);
  assert.equal(rowAntiFallback.sku, null, "Negative: null display_id must yield null sku");
  assert.notEqual(rowAntiFallback.sku, "145-2", "Anti-fallback: must not fall back to barcode");
  assert.notEqual(
    rowAntiFallback.sku,
    "var-anti-fallback-2",
    "Anti-fallback: must not fall back to pancakeVariationId",
  );

  // 3. Update: upstream fixture display_id changes from A132-M to A132-M2
  const updatedPositive = makeVariation({
    id: "var-positive-1",
    displayId: "A132-M2",
    barcode: "145-1",
  });

  const updateSyncTime = new Date("2026-09-04T13:00:00.000Z");
  await repository.syncSnapshot({
    shopId: testShopId,
    variations: [updatedPositive],
    syncedAt: updateSyncTime,
  });

  const rowUpdated = await prisma.variantMirror.findUniqueOrThrow({
    where: { pancakeVariationId: "var-positive-1" },
  });
  assert.equal(
    rowUpdated.id,
    rowPositive.id,
    "Identity reconciliation must follow pancakeVariationId, not SKU",
  );
  assert.equal(rowUpdated.sku, "A132-M2", "Update: sku must update to new display_id");
  assert.equal(rowUpdated.pancakeDisplayId, "A132-M2");
});
