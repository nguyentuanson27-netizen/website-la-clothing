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
const shopId = 910_050;
const otherShopId = 910_051;
const syncedAt = new Date("2026-08-11T03:00:00.000Z");

async function cleanup() {
  await prisma.productMirror.deleteMany({
    where: { pancakeShopId: { in: [shopId, otherShopId] } },
  });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => prisma.$disconnect());

test("storefront catalog exposes only present active products for the configured shop", async () => {
  const visibleProduct = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "storefront-visible-product",
      slug: "storefront-visible-product",
      name: "Visible Product",
      isPresent: true,
      isActive: true,
      syncedAt,
      content: {
        create: {
          editorialDescription: "Relaxed tailoring for everyday wear.",
          careInstructions: "Cold wash.",
          sizeGuide: "Relaxed fit.",
        },
      },
    },
  });

  const availableVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "storefront-available-variant",
      productId: visibleProduct.id,
      color: "Black",
      size: "M",
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: 590_000,
      pancakeRetailPriceAfterDiscount: 590_000,
      syncedAt,
    },
  });
  await prisma.warehouseStock.createMany({
    data: [
      {
        variantId: availableVariant.id,
        pancakeWarehouseId: "storefront-warehouse-a",
        quantity: 2,
        syncedAt,
      },
      {
        variantId: availableVariant.id,
        pancakeWarehouseId: "storefront-warehouse-b",
        quantity: 1,
        syncedAt,
      },
    ],
  });

  await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "storefront-sold-out-variant",
      productId: visibleProduct.id,
      color: "Black",
      size: "L",
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: 590_000,
      pancakeRetailPriceAfterDiscount: 590_000,
      syncedAt,
    },
  });

  await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "storefront-inactive-variant",
      productId: visibleProduct.id,
      color: "Stone",
      size: "M",
      isPresent: true,
      isActive: false,
      pancakeRetailPrice: 590_000,
      pancakeRetailPriceAfterDiscount: 590_000,
      syncedAt,
    },
  });

  await prisma.productMirror.createMany({
    data: [
      {
        pancakeShopId: shopId,
        pancakeProductId: "storefront-inactive-product",
        slug: "storefront-inactive-product",
        name: "Inactive Product",
        isPresent: true,
        isActive: false,
        syncedAt,
      },
      {
        pancakeShopId: shopId,
        pancakeProductId: "storefront-stale-product",
        slug: "storefront-stale-product",
        name: "Stale Product",
        isPresent: false,
        isActive: false,
        syncedAt,
      },
      {
        pancakeShopId: otherShopId,
        pancakeProductId: "storefront-other-shop-product",
        slug: "storefront-other-shop-product",
        name: "Other Shop Product",
        isPresent: true,
        isActive: true,
        syncedAt,
      },
    ],
  });

  const products = await repository.listProducts({ shopId, limit: 12 });
  assert.equal(products.length, 1);
  assert.equal(products[0]?.slug, "storefront-visible-product");
  assert.equal(products[0]?.editorialDescription, "Relaxed tailoring for everyday wear.");
  assert.equal(products[0]?.variants.length, 2);
  assert.equal(products[0]?.variants[0]?.sellableStock, 3);
  assert.equal(products[0]?.variants[1]?.sellableStock, 0);

  const detail = await repository.getProductBySlug({ shopId, slug: "storefront-visible-product" });
  assert.equal(detail?.name, "Visible Product");
  assert.equal(detail?.careInstructions, "Cold wash.");
  assert.equal(detail?.sizeGuide, "Relaxed fit.");

  assert.equal(
    await repository.getProductBySlug({ shopId, slug: "storefront-inactive-product" }),
    null,
  );
  assert.equal(
    await repository.getProductBySlug({ shopId: otherShopId, slug: "storefront-visible-product" }),
    null,
  );
});

test("storefront catalog rejects unbounded list requests", async () => {
  await assert.rejects(() => repository.listProducts({ shopId, limit: 0 }), /limit/i);
  await assert.rejects(() => repository.listProducts({ shopId, limit: 49 }), /limit/i);
});
