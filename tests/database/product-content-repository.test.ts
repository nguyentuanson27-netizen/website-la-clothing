import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createProductContentRepository } from "../../src/commerce/product-content-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
const repository = createProductContentRepository(prisma);
const testShopId = 920_004;
const externalId = "product-content-repository-product";
const componentExternalId = "product-content-repository-component";

async function cleanup() {
  await prisma.productMirror.deleteMany({
    where: { pancakeProductId: { in: [externalId, componentExternalId] } },
  });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

test("product content repository reads source context and upserts editorial publication state independently", async () => {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: testShopId,
      pancakeProductId: externalId,
      slug: externalId,
      name: "Editorial Repository Product",
      sourceDescription: "Read-only Pancake source context.",
      syncedAt: new Date("2026-08-10T00:00:00.000Z"),
    },
  });

  assert.equal(await repository.productExists(product.id), true);
  assert.equal(await repository.productExists("missing-product"), false);

  const initial = await repository.saveContent({
    productId: product.id,
    status: "DRAFT",
    editorialDescription: "First editorial copy.",
    careInstructions: "Cold wash.",
    sizeGuide: null,
    seoTitle: "First title",
    seoDescription: null,
    collectionSlugs: ["city-uniform"],
  });
  const updated = await repository.saveContent({
    productId: product.id,
    status: "PUBLISHED",
    editorialDescription: "Updated editorial copy.",
    careInstructions: null,
    sizeGuide: "Relaxed fit.",
    seoTitle: "Updated title",
    seoDescription: "Updated description.",
    collectionSlugs: ["city-uniform", "essentials"],
  });

  assert.equal(initial.productId, product.id);
  assert.equal(initial.status, "DRAFT");
  assert.deepEqual(initial.collectionSlugs, ["city-uniform"]);
  assert.equal(updated.status, "PUBLISHED");
  assert.equal(updated.editorialDescription, "Updated editorial copy.");
  assert.equal(updated.careInstructions, null);
  assert.equal(updated.sizeGuide, "Relaxed fit.");
  assert.deepEqual(updated.collectionSlugs, ["city-uniform", "essentials"]);
  assert.equal(await prisma.productContent.count({ where: { productId: product.id } }), 1);

  const editorProduct = await repository.findForEditor(product.id);
  assert.equal(editorProduct?.name, "Editorial Repository Product");
  assert.equal(editorProduct?.sourceDescription, "Read-only Pancake source context.");
  assert.equal(editorProduct?.content?.status, "PUBLISHED");
  assert.equal(editorProduct?.content?.seoTitle, "Updated title");
  assert.deepEqual(editorProduct?.content?.collectionSlugs, ["city-uniform", "essentials"]);

  const products = await repository.listForAdmin(100);
  const listed = products.find(({ id }) => id === product.id);
  assert.equal(listed?.content?.status, "PUBLISHED");
});

test("ProductContent persistence defaults newly-created content to DRAFT when publication status is omitted", async () => {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: testShopId,
      pancakeProductId: externalId,
      slug: externalId,
      name: "Editorial Repository Product",
      syncedAt: new Date("2026-08-10T00:00:00.000Z"),
    },
  });

  const content = await prisma.productContent.create({
    data: {
      productId: product.id,
      editorialDescription: "Legacy additive migration copy.",
    },
    select: { status: true },
  });

  assert.equal(content.status, "DRAFT");
});

test("admin editor projection reads persisted composite parent → child edges with quantity", async () => {
  const syncedAt = new Date("2026-08-10T00:00:00.000Z");
  const parent = await prisma.productMirror.create({
    data: {
      pancakeShopId: testShopId,
      pancakeProductId: externalId,
      slug: externalId,
      name: "Editorial Composite Parent",
      syncedAt,
    },
  });
  const child = await prisma.productMirror.create({
    data: {
      pancakeShopId: testShopId,
      pancakeProductId: componentExternalId,
      slug: componentExternalId,
      name: "Editorial Composite Child",
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });

  const parentVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: `${externalId}-parent-m`,
      productId: parent.id,
      sku: "SET-PARENT-M",
      color: "Stone",
      size: "M",
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });
  const componentVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: `${componentExternalId}-child-m`,
      productId: child.id,
      sku: "CHILD-M",
      color: "Olive",
      size: "M",
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });

  await prisma.warehouseStock.createMany({
    data: [
      {
        variantId: componentVariant.id,
        pancakeWarehouseId: `${componentExternalId}-warehouse-a`,
        quantity: 4,
        syncedAt,
      },
      {
        variantId: componentVariant.id,
        pancakeWarehouseId: `${componentExternalId}-warehouse-b`,
        quantity: 3,
        syncedAt,
      },
    ],
  });
  await prisma.compositeComponentMirror.create({
    data: {
      parentVariantId: parentVariant.id,
      componentVariantId: componentVariant.id,
      quantity: 2,
      syncedAt,
    },
  });

  const editorProduct = await repository.findForEditor(parent.id);
  const projectedParent = editorProduct?.variants.find(({ id }) => id === parentVariant.id);
  assert.equal(projectedParent?.compositeComponents.length, 1);

  const edge = projectedParent?.compositeComponents[0];
  assert.equal(edge?.quantity, 2);
  assert.equal(edge?.componentVariant.id, componentVariant.id);
  assert.equal(edge?.componentVariant.sku, "CHILD-M");
  assert.equal(edge?.componentVariant.size, "M");
  assert.equal(edge?.componentVariant.product.id, child.id);
  assert.equal(edge?.componentVariant.product.name, "Editorial Composite Child");
  assert.equal(edge?.componentVariant.product.slug, componentExternalId);
  assert.equal(
    edge?.componentVariant.warehouseStocks.reduce((total, stock) => total + stock.quantity, 0),
    7,
  );

  // The child carries no outgoing edge, but its own variant must expose the persisted incoming
  // composite membership so the editor can own the global VariantMirror activation control.
  const editorChild = await repository.findForEditor(child.id);
  const projectedChild = editorChild?.variants.find(({ id }) => id === componentVariant.id);
  assert.equal(projectedChild?.compositeComponents.length, 0);
  assert.equal(projectedChild?.isPresent, true);
  assert.equal(projectedChild?.isActive, false);
  assert.equal(projectedChild?.compositeParents.length, 1);

  const incoming = projectedChild?.compositeParents[0];
  assert.equal(incoming?.quantity, 2);
  assert.equal(incoming?.parentVariant.id, parentVariant.id);
  assert.equal(incoming?.parentVariant.sku, "SET-PARENT-M");
  assert.equal(incoming?.parentVariant.size, "M");
  assert.equal(incoming?.parentVariant.product.id, parent.id);
  assert.equal(incoming?.parentVariant.product.name, "Editorial Composite Parent");
});

test("admin editor projection reports no composite edges for a standalone product", async () => {
  const syncedAt = new Date("2026-08-10T00:00:00.000Z");
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: testShopId,
      pancakeProductId: externalId,
      slug: externalId,
      name: "Editorial Standalone Product",
      syncedAt,
    },
  });
  await prisma.variantMirror.create({
    data: {
      pancakeVariationId: `${externalId}-standalone-m`,
      productId: product.id,
      sku: "STANDALONE-M",
      size: "M",
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });

  const editorProduct = await repository.findForEditor(product.id);
  assert.equal(editorProduct?.variants.length, 1);
  assert.deepEqual(editorProduct?.variants[0]?.compositeComponents, []);
});