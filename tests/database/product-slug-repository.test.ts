import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createProductSlugRepository } from "../../src/commerce/product-slug.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});
const repository = createProductSlugRepository(prisma);
const shopId = 910_060;

async function cleanup() {
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: shopId } });
}

async function createProduct({
  pancakeProductId,
  slug,
  name,
}: {
  pancakeProductId: string;
  slug: string;
  name: string;
}) {
  return prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId,
      slug,
      name,
      isPresent: true,
      isActive: true,
      syncedAt: new Date("2026-08-20T00:00:00.000Z"),
    },
  });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

test("explicit product slug change stores the previous slug as permanent history", async () => {
  const product = await createProduct({
    pancakeProductId: "slug-product-1",
    slug: "ao-so-mi-opaque-bootstrap-11111111111111111111",
    name: "Áo Sơ Mi Oxford",
  });

  const result = await repository.changeSlug({
    productId: product.id,
    slug: "ao-so-mi-oxford",
  });

  assert.deepEqual(result, {
    ok: true,
    productId: product.id,
    previousSlug: "ao-so-mi-opaque-bootstrap-11111111111111111111",
    slug: "ao-so-mi-oxford",
    changed: true,
  });

  const updated = await prisma.productMirror.findUniqueOrThrow({ where: { id: product.id } });
  assert.equal(updated.slug, "ao-so-mi-oxford");

  const history = await prisma.productSlugHistory.findUniqueOrThrow({
    where: { slug: "ao-so-mi-opaque-bootstrap-11111111111111111111" },
  });
  assert.equal(history.productId, product.id);
});

test("repeating the current slug is a no-op and does not create redirect history", async () => {
  const product = await createProduct({
    pancakeProductId: "slug-product-noop",
    slug: "ao-khoac-den",
    name: "Áo Khoác Đen",
  });

  const result = await repository.changeSlug({ productId: product.id, slug: "ao-khoac-den" });

  assert.deepEqual(result, {
    ok: true,
    productId: product.id,
    previousSlug: "ao-khoac-den",
    slug: "ao-khoac-den",
    changed: false,
  });
  assert.equal(await prisma.productSlugHistory.count({ where: { productId: product.id } }), 0);
});

test("explicit product slug change rejects a slug currently owned by another product", async () => {
  const first = await createProduct({
    pancakeProductId: "slug-product-current-a",
    slug: "ao-thun-den",
    name: "Áo Thun Đen",
  });
  const second = await createProduct({
    pancakeProductId: "slug-product-current-b",
    slug: "quan-tay-den",
    name: "Quần Tây Đen",
  });

  assert.deepEqual(await repository.changeSlug({ productId: second.id, slug: first.slug }), {
    ok: false,
    reason: "SLUG_UNAVAILABLE",
  });
});

test("historical product slugs remain reserved and cannot be reused by another product", async () => {
  const first = await createProduct({
    pancakeProductId: "slug-product-history-a",
    slug: "ao-polo-cu",
    name: "Áo Polo",
  });
  const second = await createProduct({
    pancakeProductId: "slug-product-history-b",
    slug: "quan-short",
    name: "Quần Short",
  });

  const firstChange = await repository.changeSlug({
    productId: first.id,
    slug: "ao-polo-moi",
  });
  assert.equal(firstChange.ok, true);

  assert.deepEqual(await repository.changeSlug({ productId: second.id, slug: "ao-polo-cu" }), {
    ok: false,
    reason: "SLUG_UNAVAILABLE",
  });
});

test("product slug repository fails closed when the target product does not exist", async () => {
  assert.deepEqual(
    await repository.changeSlug({ productId: "missing-product", slug: "missing-product-slug" }),
    { ok: false, reason: "PRODUCT_NOT_FOUND" },
  );
});
