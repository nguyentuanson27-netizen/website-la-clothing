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
          status: "PUBLISHED",
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

test("storefront catalog exposes website editorial and SEO fields only when content is PUBLISHED", async () => {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "storefront-editorial-state-product",
      slug: "storefront-editorial-state-product",
      name: "Editorial State Product",
      sourceDescription: "Pancake source context must never become storefront editorial copy.",
      isPresent: true,
      isActive: true,
      syncedAt,
      content: {
        create: {
          status: "DRAFT",
          editorialDescription: "Website draft copy.",
          careInstructions: "Draft care copy.",
          sizeGuide: "Draft size copy.",
          seoTitle: "Draft SEO title",
          seoDescription: "Draft SEO description",
        },
      },
    },
  });

  for (const status of ["DRAFT", "REVIEWED"] as const) {
    await prisma.productContent.update({
      where: { productId: product.id },
      data: { status },
    });

    const detail = await repository.getProductBySlug({
      shopId,
      slug: "storefront-editorial-state-product",
    });

    assert.ok(detail);
    assert.equal(detail.editorialDescription, null);
    assert.equal(detail.careInstructions, null);
    assert.equal(detail.sizeGuide, null);
    assert.equal(detail.seoTitle, null);
    assert.equal(detail.seoDescription, null);
    assert.equal("sourceDescription" in detail, false);
    assert.equal(
      JSON.stringify(detail).includes("Pancake source context must never become storefront editorial copy."),
      false,
    );
  }

  await prisma.productContent.update({
    where: { productId: product.id },
    data: { status: "PUBLISHED" },
  });
  const published = await repository.getProductBySlug({
    shopId,
    slug: "storefront-editorial-state-product",
  });

  assert.equal(published?.editorialDescription, "Website draft copy.");
  assert.equal(published?.careInstructions, "Draft care copy.");
  assert.equal(published?.sizeGuide, "Draft size copy.");
  assert.equal(published?.seoTitle, "Draft SEO title");
  assert.equal(published?.seoDescription, "Draft SEO description");
  assert.equal(published ? "sourceDescription" in published : true, false);
});

test("storefront catalog rejects unbounded list requests", async () => {
  await assert.rejects(() => repository.listProducts({ shopId, limit: 0 }), /limit/i);
  await assert.rejects(() => repository.listProducts({ shopId, limit: 49 }), /limit/i);
});

test("storefront catalog resolves only published collections for product detail and facets", async () => {
  await prisma.collectionDefinition.upsert({
    where: { slug: "published-collection" },
    create: {
      slug: "published-collection",
      title: "Published Collection",
      description: "A published collection.",
      seoTitle: "Published Collection",
      seoDescription: "Published collection description",
      isPublished: true,
      pancakeCategoryIds: [],
    },
    update: { isPublished: true, title: "Published Collection" },
  });
  await prisma.collectionDefinition.upsert({
    where: { slug: "draft-collection" },
    create: {
      slug: "draft-collection",
      title: "Draft Collection",
      description: "A draft collection.",
      seoTitle: "Draft Collection",
      seoDescription: "Draft collection description",
      isPublished: false,
      pancakeCategoryIds: [],
    },
    update: { isPublished: false, title: "Draft Collection" },
  });

  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "storefront-collection-test-product",
      slug: "storefront-collection-test-product",
      name: "Collection Test Product",
      isPresent: true,
      isActive: true,
      syncedAt,
      content: {
        create: {
          status: "PUBLISHED",
          editorialDescription: "Product with published and draft collections.",
          collectionSlugs: ["published-collection", "draft-collection"],
        },
      },
      variants: {
        create: {
          pancakeVariationId: "storefront-collection-test-variant",
          color: "Ink",
          size: "M",
          isPresent: true,
          isActive: true,
          pancakeRetailPrice: 650_000,
          pancakeRetailPriceAfterDiscount: 650_000,
          syncedAt,
          warehouseStocks: {
            create: {
              pancakeWarehouseId: "storefront-col-wh",
              quantity: 5,
              syncedAt,
            },
          },
        },
      },
    },
  });

  const detail = await repository.getProductBySlug({
    shopId,
    slug: "storefront-collection-test-product",
  });

  assert.ok(detail);
  assert.deepEqual(detail.collections, [
    { slug: "published-collection", title: "Published Collection" },
  ]);

  const facets = await repository.listDiscoveryFacets({ shopId });
  assert.ok(facets.collections.includes("published-collection"));
  assert.equal(facets.collections.includes("draft-collection"), false);

  await prisma.productMirror.delete({ where: { id: product.id } });
  await prisma.collectionDefinition.deleteMany({
    where: { slug: { in: ["published-collection", "draft-collection"] } },
  });
});
