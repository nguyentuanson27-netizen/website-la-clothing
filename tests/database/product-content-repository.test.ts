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

async function cleanup() {
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: externalId } });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

test("product content repository reads mirrored products and upserts one editorial snapshot", async () => {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: testShopId,
      pancakeProductId: externalId,
      slug: externalId,
      name: "Editorial Repository Product",
      syncedAt: new Date("2026-08-10T00:00:00.000Z"),
    },
  });

  assert.equal(await repository.productExists(product.id), true);
  assert.equal(await repository.productExists("missing-product"), false);

  const initial = await repository.saveContent({
    productId: product.id,
    editorialDescription: "First editorial copy.",
    careInstructions: "Cold wash.",
    sizeGuide: null,
    seoTitle: "First title",
    seoDescription: null,
    collectionSlugs: ["city-uniform"],
  });
  const updated = await repository.saveContent({
    productId: product.id,
    editorialDescription: "Updated editorial copy.",
    careInstructions: null,
    sizeGuide: "Relaxed fit.",
    seoTitle: "Updated title",
    seoDescription: "Updated description.",
    collectionSlugs: ["city-uniform", "essentials"],
  });

  assert.equal(initial.productId, product.id);
  assert.deepEqual(initial.collectionSlugs, ["city-uniform"]);
  assert.equal(updated.editorialDescription, "Updated editorial copy.");
  assert.equal(updated.careInstructions, null);
  assert.equal(updated.sizeGuide, "Relaxed fit.");
  assert.deepEqual(updated.collectionSlugs, ["city-uniform", "essentials"]);
  assert.equal(await prisma.productContent.count({ where: { productId: product.id } }), 1);

  const editorProduct = await repository.findForEditor(product.id);
  assert.equal(editorProduct?.name, "Editorial Repository Product");
  assert.equal(editorProduct?.content?.seoTitle, "Updated title");
  assert.deepEqual(editorProduct?.content?.collectionSlugs, ["city-uniform", "essentials"]);

  const products = await repository.listForAdmin(100);
  assert.ok(products.some(({ id }) => id === product.id));
});
