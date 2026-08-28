import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createProductCommerceRepository } from "../../src/commerce/product-commerce-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
const repository = createProductCommerceRepository(prisma);
const shopId = 920_138;
const syncedAt = new Date("2026-08-27T00:00:00.000Z");

async function cleanup() {
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: shopId } });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

async function createFixture() {
  const ordinary = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "commerce-ordinary",
      slug: "commerce-ordinary",
      name: "Commerce Ordinary",
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });
  const parent = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "commerce-parent",
      slug: "commerce-parent",
      name: "Commerce Parent",
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });
  const child = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "commerce-child",
      slug: "commerce-child",
      name: "Commerce Child",
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });
  const other = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "commerce-other",
      slug: "commerce-other",
      name: "Commerce Other",
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });

  const ordinaryM = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "commerce-ordinary-m",
      productId: ordinary.id,
      sku: "ORD-M",
      size: "M",
      pancakeRetailPrice: 200_000,
      isPresent: true,
      isActive: false,
      syncedAt,
      warehouseStocks: {
        create: { pancakeWarehouseId: "wh-1", quantity: 0, syncedAt },
      },
    },
  });
  const ordinaryXl = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "commerce-ordinary-xl",
      productId: ordinary.id,
      sku: "ORD-XL",
      size: "XL",
      pancakeRetailPrice: 210_000,
      isPresent: true,
      isActive: false,
      syncedAt,
      warehouseStocks: {
        create: { pancakeWarehouseId: "wh-1", quantity: 1, syncedAt },
      },
    },
  });
  const ordinaryStale = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "commerce-ordinary-stale",
      productId: ordinary.id,
      size: "XXL",
      isPresent: false,
      isActive: false,
      syncedAt,
    },
  });
  const parentVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "commerce-parent-set",
      productId: parent.id,
      sku: "SET-1",
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });
  const childVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "commerce-child-m",
      productId: child.id,
      sku: "CHILD-M",
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });
  const otherVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "commerce-other-m",
      productId: other.id,
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });

  await prisma.compositeComponentMirror.create({
    data: {
      parentVariantId: parentVariant.id,
      componentVariantId: childVariant.id,
      quantity: 2,
      syncedAt,
    },
  });

  return {
    ordinary,
    parent,
    child,
    other,
    ordinaryM,
    ordinaryXl,
    ordinaryStale,
    parentVariant,
    childVariant,
    otherVariant,
  };
}

test("generic activation closes the ordinary-product regression without mutating product stock or price", async () => {
  const fixture = await createFixture();

  assert.equal(
    await repository.setVariantActivation({
      productId: fixture.ordinary.id,
      variantIds: [fixture.ordinaryXl.id],
      isActive: true,
    }),
    true,
  );

  const product = await prisma.productMirror.findUniqueOrThrow({
    where: { id: fixture.ordinary.id },
    select: {
      isActive: true,
      variants: {
        orderBy: { size: "asc" },
        select: {
          id: true,
          size: true,
          isActive: true,
          pancakeRetailPrice: true,
          warehouseStocks: { select: { quantity: true } },
        },
      },
    },
  });

  assert.equal(product.isActive, true);
  assert.deepEqual(
    product.variants.map((variant) => ({
      size: variant.size,
      isActive: variant.isActive,
      price: variant.pancakeRetailPrice,
      stock: variant.warehouseStocks.reduce((sum, row) => sum + row.quantity, 0),
    })),
    [
      { size: "M", isActive: false, price: 200_000, stock: 0 },
      { size: "XL", isActive: true, price: 210_000, stock: 1 },
      { size: "XXL", isActive: false, price: null, stock: 0 },
    ],
  );
});

test("generic activation uses the same path for composite parent and child variants and preserves edges", async () => {
  const fixture = await createFixture();

  assert.equal(
    await repository.setVariantActivation({
      productId: fixture.parent.id,
      variantIds: [fixture.parentVariant.id],
      isActive: true,
    }),
    true,
  );
  assert.equal(
    await repository.setVariantActivation({
      productId: fixture.child.id,
      variantIds: [fixture.childVariant.id],
      isActive: true,
    }),
    true,
  );

  const states = await prisma.variantMirror.findMany({
    where: { id: { in: [fixture.parentVariant.id, fixture.childVariant.id] } },
    orderBy: { id: "asc" },
    select: { id: true, isActive: true },
  });
  assert.equal(states.every((row) => row.isActive), true);
  assert.equal(
    await prisma.compositeComponentMirror.count({
      where: {
        parentVariantId: fixture.parentVariant.id,
        componentVariantId: fixture.childVariant.id,
      },
    }),
    1,
  );
});

test("generic activation is atomic and rejects wrong-product stale or missing targets with zero writes", async () => {
  const fixture = await createFixture();

  for (const variantIds of [
    [fixture.ordinaryXl.id, fixture.otherVariant.id],
    [fixture.ordinaryXl.id, fixture.ordinaryStale.id],
    [fixture.ordinaryXl.id, "missing-variant"],
  ]) {
    assert.equal(
      await repository.setVariantActivation({
        productId: fixture.ordinary.id,
        variantIds,
        isActive: true,
      }),
      false,
    );
    const activeCount = await prisma.variantMirror.count({
      where: { productId: fixture.ordinary.id, isActive: true },
    });
    assert.equal(activeCount, 0);
  }

  await prisma.productMirror.update({
    where: { id: fixture.ordinary.id },
    data: { isPresent: false },
  });
  assert.equal(
    await repository.setVariantActivation({
      productId: fixture.ordinary.id,
      variantIds: [fixture.ordinaryXl.id],
      isActive: true,
    }),
    false,
  );
});

test("generic activation treats an already-requested state as idempotent success", async () => {
  const fixture = await createFixture();

  assert.equal(
    await repository.setVariantActivation({
      productId: fixture.ordinary.id,
      variantIds: [fixture.ordinaryM.id, fixture.ordinaryXl.id],
      isActive: false,
    }),
    true,
  );
});
