/**
 * U17 / P7b — `/flash-sale` membership, boundaries and bounds.
 *
 * Membership must be a *filter over the shared projection*, not a second predicate. These tests
 * pin that by making the cases where a naive "is there a FLASH_SALE campaign?" check would differ:
 * a Flash campaign that cannot actually discount its variant, and a Flash campaign in conflict.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { createStorefrontCatalogRepository } from "../../src/commerce/storefront-catalog.ts";
import type { StorefrontDiscoveryQuery } from "../../src/commerce/storefront-discovery.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const repository = createStorefrontCatalogRepository(prisma);

const P = "u17-flash";
const SHOP = 920_953;
const NOW = new Date("2026-09-15T12:00:00.000Z");

function query(overrides: Partial<StorefrontDiscoveryQuery> = {}): StorefrontDiscoveryQuery {
  return {
    query: null, collection: null, color: null, size: null,
    inStockOnly: false, minPriceVnd: null, maxPriceVnd: null,
    page: 1, sort: "name-asc", ...overrides,
  } as StorefrontDiscoveryQuery;
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM "PromotionTarget" WHERE "id" LIKE ${`${P}-%`}`;
  await prisma.$executeRaw`DELETE FROM "PromotionCampaign" WHERE "id" LIKE ${`${P}-%`}`;
  await prisma.$executeRaw`DELETE FROM "ProductMirror" WHERE "pancakeProductId" LIKE ${`${P}-%`}`;
}

async function seedProduct(key: string, price: number) {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP, pancakeProductId: `${P}-${key}`, slug: `${P}-${key}`,
      name: `U17 ${key}`, isPresent: true, isActive: true, syncedAt: NOW,
    },
  });
  const variant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: `${P}-pv-${key}`, productId: product.id, color: "Đen", size: "M",
      pancakeRetailPrice: price, pancakeRetailPriceAfterDiscount: price,
      isPresent: true, isActive: true, syncedAt: NOW,
    },
  });
  await prisma.warehouseStock.create({
    data: { variantId: variant.id, pancakeWarehouseId: `${P}-wh`, quantity: 7, syncedAt: NOW },
  });
  return { product, variant };
}

async function campaign(
  key: string, productId: string,
  options: Readonly<{
    kind: "PROMOTION" | "FLASH_SALE";
    percentageValue?: number | null;
    fixedPriceVnd?: bigint | null;
    startsAt?: Date | null;
    endsAt?: Date | null;
  }>,
) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionCampaign"
       ("id","kind","name","discountType","percentageValue","fixedPriceVnd","startsAt","endsAt",
        "isEnabled","enabledAt","createdAt","updatedAt")
     VALUES ($1,$2::"PromotionCampaignKind",$3,$4::"PromotionDiscountType",$5,$6,$7,$8,true,$9,$9,$9)`,
    `${P}-${key}`, options.kind, `U17 ${key}`,
    options.fixedPriceVnd != null ? "FIXED_PRICE" : "PERCENTAGE",
    options.percentageValue ?? null, options.fixedPriceVnd ?? null,
    options.startsAt ?? null, options.endsAt ?? null, NOW,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionTarget" ("id","campaignId","productId","createdAt") VALUES ($1,$2,$3,$4)`,
    `${P}-t-${key}`, `${P}-${key}`, productId, NOW,
  );
}

test("U17 only currently active, valid, discounting Flash campaigns qualify", async () => {
  await cleanup();
  try {
    const active = await seedProduct("active", 500_000);
    await campaign("c-active", active.product.id, { kind: "FLASH_SALE", percentageValue: 20 });

    // A plain PROMOTION is a discount but not a Flash Sale.
    const promo = await seedProduct("promotion", 500_000);
    await campaign("c-promo", promo.product.id, { kind: "PROMOTION", percentageValue: 20 });

    // Scheduled and ended Flash campaigns are not current.
    const scheduled = await seedProduct("scheduled", 500_000);
    await campaign("c-sched", scheduled.product.id, {
      kind: "FLASH_SALE", percentageValue: 20,
      startsAt: new Date("2026-09-20T00:00:00.000Z"), endsAt: new Date("2026-09-21T00:00:00.000Z"),
    });
    const ended = await seedProduct("ended", 500_000);
    await campaign("c-ended", ended.product.id, {
      kind: "FLASH_SALE", percentageValue: 20,
      startsAt: new Date("2026-09-01T00:00:00.000Z"), endsAt: NOW, // endsAt is exclusive
    });

    // A Flash campaign whose fixed price is not below base cannot discount, so it is not a sale.
    const notCheaper = await seedProduct("not-cheaper", 500_000);
    await campaign("c-not-cheaper", notCheaper.product.id, {
      kind: "FLASH_SALE", fixedPriceVnd: BigInt(500_000),
    });

    // Rounding that lands back on base is likewise not a discount.
    const rounding = await seedProduct("rounding", 50);
    await campaign("c-rounding", rounding.product.id, { kind: "FLASH_SALE", percentageValue: 1 });

    const page = await repository.listFlashSalePage({
      shopId: SHOP, pageSize: 24, now: NOW, discovery: query(),
    });

    assert.deepEqual(
      page.products.map((product) => product.slug),
      [`${P}-active`],
      "only the campaign that is Flash, current and actually discounting qualifies",
    );
    assert.equal(page.totalCount, 1);
  } finally {
    await cleanup();
  }
});

test("U17 a conflicted variant is not a Flash Sale, because no promotion applies to it", async () => {
  await cleanup();
  try {
    const conflicted = await seedProduct("conflicted", 500_000);
    await campaign("c-one", conflicted.product.id, { kind: "FLASH_SALE", percentageValue: 20 });
    await campaign("c-two", conflicted.product.id, { kind: "FLASH_SALE", percentageValue: 30 });

    const page = await repository.listFlashSalePage({
      shopId: SHOP, pageSize: 24, now: NOW, discovery: query(),
    });

    // A predicate written as "has an active FLASH_SALE campaign" would wrongly list this product
    // at its undiscounted price. Deriving membership from the pricing decision cannot.
    assert.deepEqual(page.products, [], "campaigns never stack, so a conflicted variant is not on sale");
  } finally {
    await cleanup();
  }
});

test("U17 the Flash listing prices through the same projection that selected it", async () => {
  await cleanup();
  try {
    const { product } = await seedProduct("priced", 500_000);
    await campaign("c-priced", product.id, { kind: "FLASH_SALE", percentageValue: 20 });

    const page = await repository.listFlashSalePage({
      shopId: SHOP, pageSize: 24, now: NOW, discovery: query(),
    });
    const listed = page.products[0]!;
    const priced = page.pricingRule(listed.variants[0]!);

    assert.equal(priced.price, 400_000);
    assert.equal(priced.basePriceVnd, 500_000);
    assert.equal(priced.isDiscounted, true);
  } finally {
    await cleanup();
  }
});

test("U17 an empty route still knows when the next Flash window opens", async () => {
  await cleanup();
  try {
    const { product } = await seedProduct("future", 500_000);
    const opensAt = new Date("2026-09-16T09:00:00.000Z");
    await campaign("c-future", product.id, {
      kind: "FLASH_SALE", percentageValue: 20,
      startsAt: opensAt, endsAt: new Date("2026-09-16T12:00:00.000Z"),
    });

    const page = await repository.listFlashSalePage({
      shopId: SHOP, pageSize: 24, now: NOW, discovery: query(),
    });
    assert.deepEqual(page.products, [], "the sale has not opened yet");

    const boundary = await repository.readNextFlashSaleBoundary({ now: NOW });
    assert.deepEqual(boundary, opensAt, "an empty page must still know when it stops being empty");
  } finally {
    await cleanup();
  }
});

test("U17 a running Flash window reports its end as the next boundary", async () => {
  await cleanup();
  try {
    const { product } = await seedProduct("running", 500_000);
    const endsAt = new Date("2026-09-15T18:00:00.000Z");
    await campaign("c-running", product.id, {
      kind: "FLASH_SALE", percentageValue: 20,
      startsAt: new Date("2026-09-15T06:00:00.000Z"), endsAt,
    });

    const boundary = await repository.readNextFlashSaleBoundary({ now: NOW });
    assert.deepEqual(boundary, endsAt, "a running sale must announce when it ends");
  } finally {
    await cleanup();
  }
});

test("U17 membership crosses its start and end boundaries against the server instant", async () => {
  await cleanup();
  try {
    const { product } = await seedProduct("window", 500_000);
    const startsAt = new Date("2026-09-15T13:00:00.000Z");
    const endsAt = new Date("2026-09-15T14:00:00.000Z");
    await campaign("c-window", product.id, { kind: "FLASH_SALE", percentageValue: 20, startsAt, endsAt });

    const listAt = async (now: Date) =>
      (await repository.listFlashSalePage({ shopId: SHOP, pageSize: 24, now, discovery: query() }))
        .products.length;

    assert.equal(await listAt(new Date(startsAt.getTime() - 1)), 0, "not yet open");
    assert.equal(await listAt(startsAt), 1, "startsAt is inclusive");
    assert.equal(await listAt(new Date(endsAt.getTime() - 1)), 1, "still open just before the end");
    assert.equal(await listAt(endsAt), 0, "endsAt is exclusive");
  } finally {
    await cleanup();
  }
});

test("U17 the reviewed page/offset cliff is enforced before any listing work", async () => {
  // 1042 * 48 = 49,968 which is inside the 50,000 offset window; 1043 * 48 = 50,016 is not.
  const allowed = repository.listFlashSalePage({
    shopId: SHOP, pageSize: 48, now: NOW, discovery: query({ page: 1042 }),
  });
  await assert.doesNotReject(allowed, "page 1042 at 48 per page must remain inside the window");

  await assert.rejects(
    repository.listFlashSalePage({
      shopId: SHOP, pageSize: 48, now: NOW, discovery: query({ page: 1043 }),
    }),
    RangeError,
    "page 1043 at 48 per page must be refused",
  );
});

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});
