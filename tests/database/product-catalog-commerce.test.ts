import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { issueAdminCatalogConfirmationProof } from "../../src/commerce/admin-catalog-confirmation.ts";
import { createProductCommerceRepository } from "../../src/commerce/product-commerce-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const repository = createProductCommerceRepository(prisma);
const shopId = 920_139;
const syncedAt = new Date("2026-08-27T00:00:00.000Z");
const actorId = "catalog-admin-1";
const secret = "catalog-commerce-test-secret-1234567890";
const nowMs = Date.parse("2026-08-27T09:20:00.000Z");

async function cleanup() {
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: shopId } });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

async function createBaseFixture() {
  const ordinary = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "catalog-ordinary",
      slug: "catalog-ordinary",
      name: "Catalog Ordinary",
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });
  const stocked = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "catalog-ordinary-stocked",
      productId: ordinary.id,
      sku: "STOCKED",
      isPresent: true,
      isActive: false,
      syncedAt,
      warehouseStocks: {
        create: [
          { pancakeWarehouseId: "wh-negative", quantity: -2, syncedAt },
          { pancakeWarehouseId: "wh-positive", quantity: 3, syncedAt },
        ],
      },
    },
  });
  const zeroStock = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "catalog-ordinary-zero",
      productId: ordinary.id,
      sku: "ZERO",
      isPresent: true,
      isActive: false,
      syncedAt,
      warehouseStocks: {
        create: { pancakeWarehouseId: "wh-zero", quantity: 0, syncedAt },
      },
    },
  });

  const parent = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "catalog-parent",
      slug: "catalog-parent",
      name: "Catalog Parent",
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });
  const parentVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "catalog-parent-variant",
      productId: parent.id,
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });

  const child = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "catalog-child",
      slug: "catalog-child",
      name: "Catalog Child",
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });
  const childVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "catalog-child-variant",
      productId: child.id,
      isPresent: true,
      isActive: false,
      syncedAt,
      warehouseStocks: {
        create: { pancakeWarehouseId: "wh-child", quantity: 5, syncedAt },
      },
    },
  });

  return { ordinary, stocked, zeroStock, parent, parentVariant, child, childVariant };
}

function issueProof(
  productId: string,
  warningState: { zeroActiveProductIds: readonly string[]; compositeChildProductIds: readonly string[] },
) {
  return issueAdminCatalogConfirmationProof({
    secret,
    nowMs,
    actorId,
    operation: "enable",
    targetProductIds: [productId],
    zeroActiveProductIds: warningState.zeroActiveProductIds,
    compositeChildProductIds: warningState.compositeChildProductIds,
  }).proof;
}

test("catalog enable commits only ProductMirror.isActive when current warning proof still matches", async () => {
  const { ordinary, stocked } = await createBaseFixture();
  const warningState = await repository.readCatalogEnableWarningState(ordinary.id);
  assert.deepEqual(warningState, {
    zeroActiveProductIds: [ordinary.id],
    compositeChildProductIds: [],
  });

  const result = await repository.commitCatalogEnable({
    productId: ordinary.id,
    actorId,
    proof: issueProof(ordinary.id, warningState!),
    secret,
    nowMs,
  });
  assert.deepEqual(result, { ok: true });

  const product = await prisma.productMirror.findUniqueOrThrow({
    where: { id: ordinary.id },
    select: { isActive: true },
  });
  const variant = await prisma.variantMirror.findUniqueOrThrow({
    where: { id: stocked.id },
    select: { isActive: true },
  });
  assert.deepEqual(product, { isActive: true });
  assert.deepEqual(variant, { isActive: false });
});

test("catalog enable rechecks incoming composite membership after prepare and returns reconfirm with zero writes", async () => {
  const { parentVariant, child, childVariant } = await createBaseFixture();
  const preparedState = await repository.readCatalogEnableWarningState(child.id);
  assert.deepEqual(preparedState, {
    zeroActiveProductIds: [child.id],
    compositeChildProductIds: [],
  });
  const proof = issueProof(child.id, preparedState!);

  await prisma.compositeComponentMirror.create({
    data: {
      parentVariantId: parentVariant.id,
      componentVariantId: childVariant.id,
      quantity: 1,
      syncedAt: new Date(),
    },
  });

  const result = await repository.commitCatalogEnable({
    productId: child.id,
    actorId,
    proof,
    secret,
    nowMs,
  });
  assert.deepEqual(result, {
    ok: false,
    reason: "RECONFIRM_REQUIRED",
    warningState: {
      zeroActiveProductIds: [child.id],
      compositeChildProductIds: [child.id],
    },
  });
  assert.equal(
    (await prisma.productMirror.findUniqueOrThrow({ where: { id: child.id } })).isActive,
    false,
  );
});

test("catalog enable rechecks zero-active warning state after prepare", async () => {
  const { ordinary, stocked } = await createBaseFixture();
  const preparedState = await repository.readCatalogEnableWarningState(ordinary.id);
  const proof = issueProof(ordinary.id, preparedState!);

  await prisma.variantMirror.update({ where: { id: stocked.id }, data: { isActive: true } });

  const result = await repository.commitCatalogEnable({
    productId: ordinary.id,
    actorId,
    proof,
    secret,
    nowMs,
  });
  assert.deepEqual(result, {
    ok: false,
    reason: "RECONFIRM_REQUIRED",
    warningState: {
      zeroActiveProductIds: [],
      compositeChildProductIds: [],
    },
  });
  assert.equal(
    (await prisma.productMirror.findUniqueOrThrow({ where: { id: ordinary.id } })).isActive,
    false,
  );
});

test("catalog disable is idempotent and never changes variant activation", async () => {
  const { ordinary, stocked } = await createBaseFixture();
  await prisma.productMirror.update({ where: { id: ordinary.id }, data: { isActive: true } });
  await prisma.variantMirror.update({ where: { id: stocked.id }, data: { isActive: true } });

  assert.equal(await repository.disableCatalog(ordinary.id), true);
  assert.equal(await repository.disableCatalog(ordinary.id), true);

  assert.deepEqual(
    await prisma.productMirror.findUniqueOrThrow({ where: { id: ordinary.id }, select: { isActive: true } }),
    { isActive: false },
  );
  assert.deepEqual(
    await prisma.variantMirror.findUniqueOrThrow({ where: { id: stocked.id }, select: { isActive: true } }),
    { isActive: true },
  );
});

test("combined quick action uses summed stock, activates product plus positive-stock variants, and leaves zero-stock variants unchanged", async () => {
  const { ordinary, stocked, zeroStock } = await createBaseFixture();

  assert.deepEqual(await repository.activateProductAndStockedVariants(ordinary.id), {
    ok: true,
    activatedVariantCount: 1,
  });

  assert.deepEqual(
    await prisma.productMirror.findUniqueOrThrow({ where: { id: ordinary.id }, select: { isActive: true } }),
    { isActive: true },
  );
  assert.deepEqual(
    await prisma.variantMirror.findMany({
      where: { id: { in: [stocked.id, zeroStock.id] } },
      orderBy: { sku: "asc" },
      select: { sku: true, isActive: true },
    }),
    [
      { sku: "STOCKED", isActive: true },
      { sku: "ZERO", isActive: false },
    ],
  );
});

test("combined quick action treats a malformed mirrored quantity as unsellable", async () => {
  const { ordinary, stocked, zeroStock } = await createBaseFixture();

  // A single non-finite quantity makes the whole variant total unusable. Summing straight through
  // would read it as sellable, and the storefront resolver then throws on that exact row.
  const malformed = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "catalog-ordinary-malformed",
      productId: ordinary.id,
      sku: "MALFORMED",
      isPresent: true,
      isActive: false,
      syncedAt,
      warehouseStocks: {
        create: { pancakeWarehouseId: "wh-malformed", quantity: Number.POSITIVE_INFINITY, syncedAt },
      },
    },
  });

  assert.deepEqual(await repository.activateProductAndStockedVariants(ordinary.id), {
    ok: true,
    activatedVariantCount: 1,
  });

  assert.deepEqual(
    await prisma.variantMirror.findMany({
      where: { id: { in: [stocked.id, zeroStock.id, malformed.id] } },
      orderBy: { sku: "asc" },
      select: { sku: true, isActive: true },
    }),
    [
      { sku: "MALFORMED", isActive: false },
      { sku: "STOCKED", isActive: true },
      { sku: "ZERO", isActive: false },
    ],
  );
});

test("combined quick action fails closed when an incoming composite edge exists at mutation time", async () => {
  const { parentVariant, child, childVariant } = await createBaseFixture();
  await prisma.compositeComponentMirror.create({
    data: {
      parentVariantId: parentVariant.id,
      componentVariantId: childVariant.id,
      quantity: 1,
      syncedAt,
    },
  });

  assert.deepEqual(await repository.activateProductAndStockedVariants(child.id), {
    ok: false,
    reason: "COMPOSITE_CHILD",
  });
  assert.deepEqual(
    await prisma.productMirror.findUniqueOrThrow({ where: { id: child.id }, select: { isActive: true } }),
    { isActive: false },
  );
  assert.deepEqual(
    await prisma.variantMirror.findUniqueOrThrow({ where: { id: childVariant.id }, select: { isActive: true } }),
    { isActive: false },
  );
});

test("combined quick action can atomically activate more than 100 server-computed eligible variants", async () => {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "catalog-large",
      slug: "catalog-large",
      name: "Catalog Large",
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });
  const variantRows = Array.from({ length: 101 }, (_, index) => ({
    id: `catalog-large-variant-${index}`,
    pancakeVariationId: `catalog-large-external-${index}`,
    productId: product.id,
    sku: `LARGE-${index}`,
    isPresent: true,
    isActive: false,
    syncedAt,
  }));
  await prisma.variantMirror.createMany({ data: variantRows });
  await prisma.warehouseStock.createMany({
    data: variantRows.map((variant, index) => ({
      variantId: variant.id,
      pancakeWarehouseId: `large-wh-${index}`,
      quantity: 1,
      syncedAt,
    })),
  });

  assert.deepEqual(await repository.activateProductAndStockedVariants(product.id), {
    ok: true,
    activatedVariantCount: 101,
  });
  assert.equal(
    await prisma.variantMirror.count({ where: { productId: product.id, isActive: true } }),
    101,
  );
});
