/**
 * U16 review regressions: query-wide promotion freshness and card hydration across the 200-id
 * candidate-reader boundary.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createStorefrontCatalogRepository } from "../../src/commerce/storefront-catalog.ts";
import type { StorefrontDiscoveryQuery } from "../../src/commerce/storefront-discovery.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const repository = createStorefrontCatalogRepository(prisma);
const P = "u16-fresh";
const SHOP = 920_953;
const NOW = new Date("2026-09-15T00:00:00.000Z");

function query(overrides: Partial<StorefrontDiscoveryQuery> = {}): StorefrontDiscoveryQuery {
  return {
    query: null,
    collection: null,
    color: null,
    size: null,
    availability: null,
    minPriceVnd: null,
    maxPriceVnd: null,
    page: 1,
    sort: "name-asc",
    ...overrides,
  } as StorefrontDiscoveryQuery;
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM "PromotionTarget" WHERE "id" LIKE ${`${P}-%`}`;
  await prisma.$executeRaw`DELETE FROM "PromotionCampaign" WHERE "id" LIKE ${`${P}-%`}`;
  await prisma.$executeRaw`DELETE FROM "ProductMirror" WHERE "pancakeProductId" LIKE ${`${P}-%`}`;
}

async function seedProduct(key: string, name: string, price: number, variantCount = 1) {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP,
      pancakeProductId: `${P}-${key}`,
      slug: `${P}-${key}`,
      name,
      isPresent: true,
      isActive: true,
      syncedAt: NOW,
    },
  });

  await prisma.variantMirror.createMany({
    data: Array.from({ length: variantCount }, (_, index) => ({
      pancakeVariationId: `${P}-pv-${key}-${index + 1}`,
      productId: product.id,
      color: "Đen",
      size: `S${index + 1}`,
      pancakeRetailPrice: price + index,
      pancakeRetailPriceAfterDiscount: price + index - 1,
      isPresent: true,
      isActive: true,
      syncedAt: NOW,
    })),
  });

  const firstVariant = await prisma.variantMirror.findFirstOrThrow({
    where: { productId: product.id },
    orderBy: { pancakeVariationId: "asc" },
  });
  return { product, firstVariant };
}

test("U16 an off-page scheduled discount controls freshness and enters page one at startsAt", async () => {
  await cleanup();
  try {
    await seedProduct("cheap", "U16 Fresh AAA Cheap", 500_000);
    const expensive = await seedProduct("expensive", "U16 Fresh ZZZ Expensive", 900_000);
    const startsAt = new Date(NOW.getTime() + 5_000);
    const endsAt = new Date(NOW.getTime() + 3_600_000);

    await prisma.promotionCampaign.create({
      data: {
        id: `${P}-campaign`,
        kind: "PROMOTION",
        name: "U16 off-page boundary",
        discountType: "PERCENTAGE",
        percentageValue: 90,
        startsAt,
        endsAt,
        isEnabled: true,
        enabledAt: NOW,
        targets: {
          create: {
            id: `${P}-target`,
            productId: expensive.product.id,
            createdAt: NOW,
          },
        },
      },
    });

    const before = await repository.listDiscoveryPage({
      shopId: SHOP,
      pageSize: 1,
      discovery: query({ sort: "price-asc" }),
      now: NOW,
    });
    assert.deepEqual(before.products.map((product) => product.slug), [`${P}-cheap`]);
    assert.equal(
      before.refreshAfterMs,
      5_000,
      "the next boundary must include a campaign whose product is currently off-page",
    );

    const atBoundary = await repository.listDiscoveryPage({
      shopId: SHOP,
      pageSize: 1,
      discovery: query({ sort: "price-asc" }),
      now: startsAt,
    });
    assert.deepEqual(
      atBoundary.products.map((product) => product.slug),
      [`${P}-expensive`],
      "startsAt is inclusive and the newly discounted off-page product must enter page one",
    );
  } finally {
    await cleanup();
  }
});

test("U16 price-band freshness still sees a currently excluded product that a discount can add", async () => {
  await cleanup();
  try {
    const candidate = await seedProduct("price-band", "U16 Fresh Price Band", 900_000);
    const startsAt = new Date(NOW.getTime() + 7_000);

    await prisma.promotionCampaign.create({
      data: {
        id: `${P}-band-campaign`,
        kind: "PROMOTION",
        name: "U16 price-band boundary",
        discountType: "PERCENTAGE",
        percentageValue: 50,
        startsAt,
        isEnabled: true,
        enabledAt: NOW,
        targets: {
          create: {
            id: `${P}-band-target`,
            productId: candidate.product.id,
            createdAt: NOW,
          },
        },
      },
    });

    const discovery = query({ minPriceVnd: 400_000, maxPriceVnd: 500_000 });
    const before = await repository.listDiscoveryPage({
      shopId: SHOP,
      pageSize: 24,
      discovery,
      now: NOW,
    });
    assert.equal(before.totalCount, 0);
    assert.equal(before.refreshAfterMs, 7_000);

    const after = await repository.listDiscoveryPage({
      shopId: SHOP,
      pageSize: 24,
      discovery,
      now: startsAt,
    });
    assert.deepEqual(after.products.map((product) => product.slug), [`${P}-price-band`]);
  } finally {
    await cleanup();
  }
});

test("U16 a max storefront page can hydrate more than 200 variants without weakening the per-query cap", async () => {
  await cleanup();
  try {
    // 24 cards x 9 options = 216 ids. The shared batching unit test pins the query budget to
    // [200, 16]; this integration proves the listing actually uses that helper instead of sending
    // all 216 ids to the low-level repository in one rejected call.
    for (let productIndex = 0; productIndex < 24; productIndex += 1) {
      await seedProduct(
        `many-${productIndex + 1}`,
        `U16 Fresh Many ${String(productIndex + 1).padStart(2, "0")}`,
        500_000 + productIndex * 1_000,
        9,
      );
    }

    const page = await repository.listDiscoveryPage({
      shopId: SHOP,
      pageSize: 24,
      discovery: query({ sort: "name-asc" }),
      now: NOW,
    });

    assert.equal(page.products.length, 24);
    assert.equal(
      page.products.reduce((total, product) => total + product.variants.length, 0),
      216,
    );
  } finally {
    await cleanup();
  }
});

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});
