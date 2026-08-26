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
const testShopId = 920_006;
const externalIds = ["bulk-status-existing", "bulk-status-new", "bulk-status-atomic"] as const;

async function cleanup() {
  await prisma.productMirror.deleteMany({
    where: { pancakeProductId: { in: [...externalIds] } },
  });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

test("bulk status repository updates only status and creates minimal missing content", async () => {
  const syncedAt = new Date("2026-08-26T00:00:00.000Z");
  const existing = await prisma.productMirror.create({
    data: {
      pancakeShopId: testShopId,
      pancakeProductId: externalIds[0],
      slug: externalIds[0],
      name: "Bulk Existing",
      syncedAt,
    },
  });
  const missingContent = await prisma.productMirror.create({
    data: {
      pancakeShopId: testShopId,
      pancakeProductId: externalIds[1],
      slug: externalIds[1],
      name: "Bulk Missing Content",
      syncedAt,
    },
  });

  await prisma.productContent.create({
    data: {
      productId: existing.id,
      status: "DRAFT",
      editorialDescription: "Keep description",
      careInstructions: "Keep care",
      sizeGuide: "Keep size guide",
      seoTitle: "Keep SEO title",
      seoDescription: "Keep SEO description",
      collectionSlugs: ["keep-collection"],
    },
  });

  assert.deepEqual(
    await repository.updateStatusesAtomically({
      productIds: [existing.id, missingContent.id],
      status: "PUBLISHED",
    }),
    { ok: true, updatedCount: 2 },
  );

  const rows = await prisma.productContent.findMany({
    where: { productId: { in: [existing.id, missingContent.id] } },
    orderBy: { productId: "asc" },
  });
  const existingRow = rows.find((row) => row.productId === existing.id);
  const newRow = rows.find((row) => row.productId === missingContent.id);

  assert.equal(existingRow?.status, "PUBLISHED");
  assert.equal(existingRow?.editorialDescription, "Keep description");
  assert.equal(existingRow?.careInstructions, "Keep care");
  assert.equal(existingRow?.sizeGuide, "Keep size guide");
  assert.equal(existingRow?.seoTitle, "Keep SEO title");
  assert.equal(existingRow?.seoDescription, "Keep SEO description");
  assert.deepEqual(existingRow?.collectionSlugs, ["keep-collection"]);

  assert.equal(newRow?.status, "PUBLISHED");
  assert.equal(newRow?.editorialDescription, null);
  assert.equal(newRow?.careInstructions, null);
  assert.equal(newRow?.sizeGuide, null);
  assert.equal(newRow?.seoTitle, null);
  assert.equal(newRow?.seoDescription, null);
  assert.deepEqual(newRow?.collectionSlugs, []);

  assert.deepEqual(
    await repository.updateStatusesAtomically({
      productIds: [existing.id, missingContent.id],
      status: "PUBLISHED",
    }),
    { ok: true, updatedCount: 2 },
  );
});

test("bulk status repository fails closed with no partial write when any product is missing", async () => {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: testShopId,
      pancakeProductId: externalIds[2],
      slug: externalIds[2],
      name: "Bulk Atomic",
      syncedAt: new Date("2026-08-26T00:00:00.000Z"),
      content: {
        create: {
          status: "DRAFT",
          editorialDescription: "Must stay draft on failure",
        },
      },
    },
  });

  assert.deepEqual(
    await repository.updateStatusesAtomically({
      productIds: [product.id, "missing-product-id"],
      status: "REVIEWED",
    }),
    { ok: false, reason: "PRODUCT_NOT_FOUND" },
  );

  const content = await prisma.productContent.findUnique({ where: { productId: product.id } });
  assert.equal(content?.status, "DRAFT");
  assert.equal(content?.editorialDescription, "Must stay draft on failure");
});
