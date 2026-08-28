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

const testShopId = 920_014;
const externalPrefix = "bulk-collection-";

async function cleanup() {
  await prisma.productMirror.deleteMany({
    where: { pancakeProductId: { startsWith: externalPrefix } },
  });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

type SeedInput = Readonly<{
  key: string;
  isPresent?: boolean;
  content?: Readonly<{ collectionSlugs: string[] }>;
}>;

async function seedProduct(input: SeedInput): Promise<string> {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: testShopId,
      pancakeProductId: `${externalPrefix}${input.key}`,
      slug: `${externalPrefix}${input.key}`,
      name: `Bulk collection ${input.key}`,
      isPresent: input.isPresent ?? true,
      syncedAt: new Date("2026-08-28T00:00:00.000Z"),
    },
  });

  if (input.content) {
    await prisma.productContent.create({
      data: {
        productId: product.id,
        status: "REVIEWED",
        editorialDescription: "Giữ nguyên mô tả",
        careInstructions: "Giữ nguyên bảo quản",
        sizeGuide: "Giữ nguyên size guide",
        seoTitle: "Giữ nguyên SEO title",
        seoDescription: "Giữ nguyên SEO description",
        collectionSlugs: input.content.collectionSlugs,
      },
    });
  }

  return product.id;
}

async function readMembership(productId: string): Promise<string[] | null> {
  const content = await prisma.productContent.findUnique({
    where: { productId },
    select: { collectionSlugs: true },
  });
  return content ? content.collectionSlugs : null;
}

test("bulk collection add appends only the requested slug and preserves everything else", async () => {
  const withOther = await seedProduct({
    key: "add-existing",
    content: { collectionSlugs: ["ao-khoac"] },
  });
  const withoutContent = await seedProduct({ key: "add-missing-content" });
  const alreadyMember = await seedProduct({
    key: "add-idempotent",
    content: { collectionSlugs: ["mua-thu"] },
  });

  assert.deepEqual(
    await repository.updateCollectionMembershipAtomically({
      productIds: [withOther, withoutContent, alreadyMember],
      collectionSlug: "mua-thu",
      operation: "add",
    }),
    { ok: true, matchedCount: 3, changedCount: 2 },
  );

  assert.deepEqual(await readMembership(withOther), ["ao-khoac", "mua-thu"]);
  assert.deepEqual(await readMembership(withoutContent), ["mua-thu"]);
  assert.deepEqual(await readMembership(alreadyMember), ["mua-thu"]);

  const preserved = await prisma.productContent.findUniqueOrThrow({
    where: { productId: withOther },
  });
  assert.equal(preserved.status, "REVIEWED");
  assert.equal(preserved.editorialDescription, "Giữ nguyên mô tả");
  assert.equal(preserved.careInstructions, "Giữ nguyên bảo quản");
  assert.equal(preserved.sizeGuide, "Giữ nguyên size guide");
  assert.equal(preserved.seoTitle, "Giữ nguyên SEO title");
  assert.equal(preserved.seoDescription, "Giữ nguyên SEO description");

  const created = await prisma.productContent.findUniqueOrThrow({
    where: { productId: withoutContent },
  });
  assert.equal(created.status, "DRAFT");
  assert.equal(created.editorialDescription, null);
  assert.equal(created.seoTitle, null);
});

test("bulk collection remove drops only the requested slug and is idempotent", async () => {
  const member = await seedProduct({
    key: "remove-member",
    content: { collectionSlugs: ["ao-khoac", "mua-thu", "co-ban"] },
  });
  const notMember = await seedProduct({
    key: "remove-not-member",
    content: { collectionSlugs: ["ao-khoac"] },
  });
  const withoutContent = await seedProduct({ key: "remove-missing-content" });

  assert.deepEqual(
    await repository.updateCollectionMembershipAtomically({
      productIds: [member, notMember, withoutContent],
      collectionSlug: "mua-thu",
      operation: "remove",
    }),
    { ok: true, matchedCount: 3, changedCount: 1 },
  );

  assert.deepEqual(await readMembership(member), ["ao-khoac", "co-ban"]);
  assert.deepEqual(await readMembership(notMember), ["ao-khoac"]);
  assert.equal(await readMembership(withoutContent), null, "remove never creates content rows");

  assert.deepEqual(
    await repository.updateCollectionMembershipAtomically({
      productIds: [member],
      collectionSlug: "mua-thu",
      operation: "remove",
    }),
    { ok: true, matchedCount: 1, changedCount: 0 },
  );
  assert.deepEqual(await readMembership(member), ["ao-khoac", "co-ban"]);
});

test("bulk collection membership writes nothing when one target is missing or no longer present", async () => {
  const valid = await seedProduct({
    key: "atomic-valid",
    content: { collectionSlugs: ["ao-khoac"] },
  });
  const stale = await seedProduct({
    key: "atomic-stale",
    isPresent: false,
    content: { collectionSlugs: ["ao-khoac"] },
  });

  assert.deepEqual(
    await repository.updateCollectionMembershipAtomically({
      productIds: [valid, stale],
      collectionSlug: "mua-thu",
      operation: "add",
    }),
    { ok: false, reason: "PRODUCT_NOT_FOUND" },
  );
  assert.deepEqual(
    await repository.updateCollectionMembershipAtomically({
      productIds: [valid, `${valid}-does-not-exist`],
      collectionSlug: "mua-thu",
      operation: "add",
    }),
    { ok: false, reason: "PRODUCT_NOT_FOUND" },
  );

  assert.deepEqual(await readMembership(valid), ["ao-khoac"]);
  assert.deepEqual(await readMembership(stale), ["ao-khoac"]);
});

test("bulk collection add refuses to push any product past the editable membership limit", async () => {
  const full = await seedProduct({
    key: "limit-full",
    content: {
      collectionSlugs: ["c-1", "c-2", "c-3", "c-4", "c-5", "c-6", "c-7", "c-8"],
    },
  });
  const spare = await seedProduct({
    key: "limit-spare",
    content: { collectionSlugs: ["c-1"] },
  });

  assert.deepEqual(
    await repository.updateCollectionMembershipAtomically({
      productIds: [full, spare],
      collectionSlug: "mua-thu",
      operation: "add",
    }),
    { ok: false, reason: "COLLECTION_LIMIT_REACHED" },
  );

  assert.equal((await readMembership(full))?.length, 8);
  assert.deepEqual(await readMembership(spare), ["c-1"]);
});

test("bulk collection membership never changes commerce or mirrored product state", async () => {
  const productId = await seedProduct({
    key: "mirror-untouched",
    content: { collectionSlugs: [] },
  });
  const before = await prisma.productMirror.findUniqueOrThrow({ where: { id: productId } });

  await repository.updateCollectionMembershipAtomically({
    productIds: [productId],
    collectionSlug: "mua-thu",
    operation: "add",
  });

  const after = await prisma.productMirror.findUniqueOrThrow({ where: { id: productId } });
  assert.equal(after.isActive, before.isActive);
  assert.equal(after.isPresent, before.isPresent);
  assert.equal(after.name, before.name);
  assert.equal(after.slug, before.slug);
  assert.equal(after.primaryImageUrl, before.primaryImageUrl);
  assert.equal(after.syncedAt.toISOString(), before.syncedAt.toISOString());
});
