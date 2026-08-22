import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createAnonymousCartService } from "../../src/commerce/anonymous-cart.ts";
import { createStorefrontCartRepository } from "../../src/commerce/storefront-cart-repository.ts";
import { createStorefrontProductDetailRepository } from "../../src/commerce/storefront-product-detail.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const repository = createStorefrontProductDetailRepository(prisma);
const shopId = 910_060;
const cartId = "projection-composite-cart";
const syncedAt = new Date("2026-08-22T16:00:00.000Z");

async function cleanup() {
  await prisma.cart.deleteMany({ where: { id: cartId } });
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: shopId } });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => prisma.$disconnect());

test("parent PDP projects relation-linked active component variants without publishing the component product", async () => {
  const parent = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "projection-parent-product",
      slug: "projection-set-a",
      name: "Set A",
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });
  const component = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "projection-component-product",
      slug: "projection-shirt-a",
      name: "Ao A",
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });

  const parentVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "projection-parent-m",
      productId: parent.id,
      size: "M",
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: 790_000,
      pancakeRetailPriceAfterDiscount: 790_000,
      syncedAt,
    },
  });
  const componentVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "projection-component-m",
      productId: component.id,
      color: null,
      size: "M",
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: 390_000,
      pancakeRetailPriceAfterDiscount: 390_000,
      syncedAt,
    },
  });

  await prisma.warehouseStock.createMany({
    data: [
      {
        variantId: parentVariant.id,
        pancakeWarehouseId: "projection-warehouse-parent",
        quantity: 2,
        syncedAt,
      },
      {
        variantId: componentVariant.id,
        pancakeWarehouseId: "projection-warehouse-component",
        quantity: 3,
        syncedAt,
      },
    ],
  });
  await prisma.compositeComponentMirror.create({
    data: {
      parentVariantId: parentVariant.id,
      componentVariantId: componentVariant.id,
      quantity: 1,
      syncedAt,
    },
  });

  const detail = await repository.getProductBySlug({ shopId, slug: "projection-set-a" });
  assert.ok(detail);
  assert.equal(detail.projection.mode, "composite");
  assert.deepEqual(
    detail.projection.options.map(({ id, kindLabel }) => ({ id, kindLabel })),
    [
      { id: parentVariant.id, kindLabel: "Set" },
      { id: componentVariant.id, kindLabel: "Ao A" },
    ],
  );
  assert.equal(
    await repository.getProductBySlug({ shopId, slug: "projection-shirt-a" }),
    null,
  );

  await prisma.cart.create({
    data: {
      id: cartId,
      expiresAt: new Date("2026-08-24T00:00:00.000Z"),
    },
  });
  const cartService = createAnonymousCartService(prisma);
  const cartMutation = await cartService.setItemQuantity({
    cartId,
    variantId: componentVariant.id,
    quantity: 1,
    now: new Date("2026-08-23T00:00:00.000Z"),
  });
  assert.equal(cartMutation.ok, true);

  const lines = await createStorefrontCartRepository(prisma).getLines({
    shopId,
    items: [{ variantId: componentVariant.id, quantity: 1 }],
  });
  assert.deepEqual(
    lines.map(({ productSlug, productName, available, price }) => ({
      productSlug,
      productName,
      available,
      price,
    })),
    [{ productSlug: null, productName: "Ao A", available: true, price: 390_000 }],
  );
});
