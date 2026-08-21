import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createStorefrontCartRepository } from "../../src/commerce/storefront-cart-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const repository = createStorefrontCartRepository(prisma);
const shopId = 910_060;
const otherShopId = 910_061;
const syncedAt = new Date("2026-08-11T05:30:00.000Z");

async function cleanup() {
  await prisma.productMirror.deleteMany({
    where: { pancakeShopId: { in: [shopId, otherShopId] } },
  });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => prisma.$disconnect());

test("storefront cart resolves current lines only from the configured shop and preserves stale lines as unavailable", async () => {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "cart-storefront-product",
      slug: "cart-storefront-product",
      name: "Cart Storefront Product",
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });

  const available = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "cart-storefront-available",
      productId: product.id,
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
        variantId: available.id,
        pancakeWarehouseId: "cart-storefront-warehouse-a",
        quantity: 2,
        syncedAt,
      },
      {
        variantId: available.id,
        pancakeWarehouseId: "cart-storefront-warehouse-b",
        quantity: 1,
        syncedAt,
      },
    ],
  });

  const stale = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "cart-storefront-stale",
      productId: product.id,
      color: "Stone",
      size: "L",
      isPresent: false,
      isActive: false,
      pancakeRetailPrice: 620_000,
      pancakeRetailPriceAfterDiscount: 620_000,
      syncedAt,
    },
  });

  const otherProduct = await prisma.productMirror.create({
    data: {
      pancakeShopId: otherShopId,
      pancakeProductId: "cart-other-shop-product",
      slug: "cart-other-shop-product",
      name: "Other Shop Product",
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });
  const otherShopVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "cart-other-shop-variant",
      productId: otherProduct.id,
      color: "Olive",
      size: "S",
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: 490_000,
      pancakeRetailPriceAfterDiscount: 490_000,
      syncedAt,
    },
  });

  const lines = await repository.getLines({
    shopId,
    items: [
      { variantId: available.id, quantity: 2 },
      { variantId: stale.id, quantity: 1 },
      { variantId: otherShopVariant.id, quantity: 1 },
    ],
  });

  assert.deepEqual(lines, [
    {
      variantId: available.id,
      productSlug: "cart-storefront-product",
      productName: "Cart Storefront Product",
      color: "Black",
      size: "M",
      quantity: 2,
      price: 590_000,
      available: true,
      unavailableReason: null,
      media: { primary: null, gallery: [] },
    },
    {
      variantId: stale.id,
      productSlug: "cart-storefront-product",
      productName: "Cart Storefront Product",
      color: "Stone",
      size: "L",
      quantity: 1,
      price: null,
      available: false,
      unavailableReason: "VARIANT_UNAVAILABLE",
      media: { primary: null, gallery: [] },
    },
    {
      variantId: otherShopVariant.id,
      productSlug: null,
      productName: null,
      color: null,
      size: null,
      quantity: 1,
      price: null,
      available: false,
      unavailableReason: "VARIANT_UNAVAILABLE",
      media: { primary: null, gallery: [] },
    },
  ]);
});

test("storefront cart resolves trusted product media from database mirror", async () => {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "cart-media-product",
      slug: "cart-media-product",
      name: "Cart Media Product",
      primaryImageUrl: "https://content.pancake.vn/images/1/2/3/cart-product.jpg",
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });

  const variant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "cart-media-variant",
      productId: product.id,
      color: "Ink",
      size: "M",
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: 850_000,
      pancakeRetailPriceAfterDiscount: 850_000,
      pancakeImageUrls: ["https://content.pancake.vn/images/1/2/3/cart-variant.jpg"],
      syncedAt,
    },
  });

  const [line] = await repository.getLines({
    shopId,
    items: [{ variantId: variant.id, quantity: 1 }],
  });

  assert.equal(line?.media.primary?.url, "https://content.pancake.vn/images/1/2/3/cart-product.jpg");
  assert.equal(line?.media.primary?.alt, "Cart Media Product");
  assert.equal(line?.media.gallery.length, 2);
});

test("storefront cart read model rejects requests larger than the cart line ceiling", async () => {
  await assert.rejects(
    () =>
      repository.getLines({
        shopId,
        items: Array.from({ length: 51 }, (_, index) => ({
          variantId: `cart-overflow-${index}`,
          quantity: 1,
        })),
      }),
    /50/,
  );
});
