/** U17 / P7b — Flash membership, purchasability, representative selection and bounds. */

import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createFlashSaleCatalogRepository } from "../../src/commerce/flash-sale-catalog.ts";
import type { StorefrontDiscoveryQuery } from "../../src/commerce/storefront-discovery.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const repository = createFlashSaleCatalogRepository(prisma);

const P = "u17-flash";
const SHOP = 920_953;
const NOW = new Date("2026-09-15T12:00:00.000Z");

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
  };
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM "PromotionTarget" WHERE "id" LIKE ${`${P}-%`}`;
  await prisma.$executeRaw`DELETE FROM "PromotionCampaign" WHERE "id" LIKE ${`${P}-%`}`;
  await prisma.$executeRaw`DELETE FROM "ProductMirror" WHERE "pancakeProductId" LIKE ${`${P}-%`}`;
}

async function seedProduct(key: string) {
  return prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP,
      pancakeProductId: `${P}-${key}`,
      slug: `${P}-${key}`,
      name: `U17 ${key}`,
      isPresent: true,
      isActive: true,
      syncedAt: NOW,
    },
  });
}

async function seedVariant(
  productId: string,
  key: string,
  options: Readonly<{
    price: number;
    stock?: number;
    color?: string | null;
    size?: string | null;
  }>,
) {
  const variant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: `${P}-pv-${key}`,
      productId,
      color: options.color === undefined ? "Đen" : options.color,
      size: options.size === undefined ? "M" : options.size,
      pancakeRetailPrice: options.price,
      pancakeRetailPriceAfterDiscount: options.price,
      isPresent: true,
      isActive: true,
      syncedAt: NOW,
    },
  });
  await prisma.warehouseStock.create({
    data: {
      variantId: variant.id,
      pancakeWarehouseId: `${P}-wh-${key}`,
      quantity: options.stock ?? 7,
      syncedAt: NOW,
    },
  });
  return variant;
}

type CampaignTarget = Readonly<{ productId?: string; variantId?: string }>;

async function campaign(
  key: string,
  target: CampaignTarget,
  options: Readonly<{
    kind: "PROMOTION" | "FLASH_SALE";
    percentageValue?: number | null;
    fixedPriceVnd?: bigint | null;
    startsAt?: Date | null;
    endsAt?: Date | null;
  }>,
) {
  const flashStartsAt = new Date(NOW.getTime() - 60 * 60_000);
  const flashEndsAt = new Date(NOW.getTime() + 60 * 60_000);
  const startsAt = options.startsAt === undefined
    ? (options.kind === "FLASH_SALE" ? flashStartsAt : null)
    : options.startsAt;
  const endsAt = options.endsAt === undefined
    ? (options.kind === "FLASH_SALE" ? flashEndsAt : null)
    : options.endsAt;

  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionCampaign"
       ("id","kind","name","discountType","percentageValue","fixedPriceVnd","startsAt","endsAt",
        "isEnabled","enabledAt","createdAt","updatedAt")
     VALUES ($1,$2::"PromotionCampaignKind",$3,$4::"PromotionDiscountType",$5,$6,$7,$8,true,$9,$9,$9)`,
    `${P}-${key}`,
    options.kind,
    `U17 ${key}`,
    options.fixedPriceVnd != null ? "FIXED_PRICE" : "PERCENTAGE",
    options.percentageValue ?? null,
    options.fixedPriceVnd ?? null,
    startsAt,
    endsAt,
    NOW,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionTarget"
       ("id","campaignId","productId","variantId","createdAt")
     VALUES ($1,$2,$3,$4,$5)`,
    `${P}-t-${key}`,
    `${P}-${key}`,
    target.productId ?? null,
    target.variantId ?? null,
    NOW,
  );
}

test("U17 only currently active, valid, discounting Flash campaigns qualify", async () => {
  await cleanup();
  try {
    const active = await seedProduct("active");
    await seedVariant(active.id, "active", { price: 500_000 });
    await campaign("c-active", { productId: active.id }, { kind: "FLASH_SALE", percentageValue: 20 });

    const promo = await seedProduct("promotion");
    await seedVariant(promo.id, "promotion", { price: 500_000 });
    await campaign("c-promo", { productId: promo.id }, { kind: "PROMOTION", percentageValue: 20 });

    const scheduled = await seedProduct("scheduled");
    await seedVariant(scheduled.id, "scheduled", { price: 500_000 });
    await campaign("c-sched", { productId: scheduled.id }, {
      kind: "FLASH_SALE",
      percentageValue: 20,
      startsAt: new Date("2026-09-20T00:00:00.000Z"),
      endsAt: new Date("2026-09-21T00:00:00.000Z"),
    });

    const ended = await seedProduct("ended");
    await seedVariant(ended.id, "ended", { price: 500_000 });
    await campaign("c-ended", { productId: ended.id }, {
      kind: "FLASH_SALE",
      percentageValue: 20,
      startsAt: new Date("2026-09-01T00:00:00.000Z"),
      endsAt: NOW,
    });

    const notCheaper = await seedProduct("not-cheaper");
    await seedVariant(notCheaper.id, "not-cheaper", { price: 500_000 });
    await campaign("c-not-cheaper", { productId: notCheaper.id }, {
      kind: "FLASH_SALE",
      fixedPriceVnd: 500_000n,
    });

    const rounding = await seedProduct("rounding");
    await seedVariant(rounding.id, "rounding", { price: 50 });
    await campaign("c-rounding", { productId: rounding.id }, {
      kind: "FLASH_SALE",
      percentageValue: 1,
    });

    const page = await repository.listFlashSalePage({
      shopId: SHOP,
      pageSize: 24,
      now: NOW,
      discovery: query(),
    });

    assert.deepEqual(page.products.map((product) => product.slug), [`${P}-active`]);
    assert.equal(page.totalCount, 1);
  } finally {
    await cleanup();
  }
});

test("U17 conflicted variants are not Flash Sale members", async () => {
  await cleanup();
  try {
    const product = await seedProduct("conflicted");
    await seedVariant(product.id, "conflicted", { price: 500_000 });
    await campaign("c-one", { productId: product.id }, { kind: "FLASH_SALE", percentageValue: 20 });
    await campaign("c-two", { productId: product.id }, { kind: "FLASH_SALE", percentageValue: 30 });

    const page = await repository.listFlashSalePage({
      shopId: SHOP,
      pageSize: 24,
      now: NOW,
      discovery: query(),
    });

    assert.deepEqual(page.products, []);
    assert.equal(page.totalCount, 0);
  } finally {
    await cleanup();
  }
});

test("U17 membership requires a purchasable Flash variant and representative ignores cheaper non-Flash variants", async () => {
  await cleanup();
  try {
    const mixed = await seedProduct("mixed");
    await seedVariant(mixed.id, "mixed-regular", { price: 300_000, size: "S" });
    const flash = await seedVariant(mixed.id, "mixed-flash", { price: 500_000, size: "M" });
    await campaign("c-mixed", { variantId: flash.id }, { kind: "FLASH_SALE", percentageValue: 20 });

    const soldOut = await seedProduct("sold-out");
    const soldOutFlash = await seedVariant(soldOut.id, "sold-out", { price: 500_000, stock: 0 });
    await campaign("c-sold-out", { variantId: soldOutFlash.id }, { kind: "FLASH_SALE", percentageValue: 20 });

    const unmapped = await seedProduct("unmapped");
    const unmappedFlash = await seedVariant(unmapped.id, "unmapped", { price: 500_000, size: " " });
    await campaign("c-unmapped", { variantId: unmappedFlash.id }, { kind: "FLASH_SALE", percentageValue: 20 });

    const ambiguous = await seedProduct("ambiguous");
    const ambiguousFlash = await seedVariant(ambiguous.id, "ambiguous-a", { price: 500_000, size: "M" });
    await seedVariant(ambiguous.id, "ambiguous-b", { price: 550_000, size: "M" });
    await campaign("c-ambiguous", { variantId: ambiguousFlash.id }, { kind: "FLASH_SALE", percentageValue: 20 });

    const page = await repository.listFlashSalePage({
      shopId: SHOP,
      pageSize: 24,
      now: NOW,
      discovery: query(),
    });

    assert.equal(page.totalCount, 1, "only the product with a purchasable Flash variant qualifies");
    assert.deepEqual(page.products.map((product) => product.slug), [`${P}-mixed`]);

    const presentation = page.products[0]!.flashSale;
    assert.equal(presentation.representativeVariantId, flash.id);
    assert.equal(presentation.basePriceVnd, 500_000);
    assert.equal(presentation.effectivePriceVnd, 400_000);
    assert.equal(
      presentation.hasCheaperCurrentVariant,
      true,
      "the 300k regular variant must affect wording but never become the Flash representative",
    );
    assert.equal(presentation.remainingMs, 60 * 60_000);
  } finally {
    await cleanup();
  }
});

test("U17 an empty route still knows when the next enabled Flash window opens", async () => {
  await cleanup();
  try {
    const product = await seedProduct("future");
    await seedVariant(product.id, "future", { price: 500_000 });
    const opensAt = new Date("2026-09-16T09:00:00.000Z");
    await campaign("c-future", { productId: product.id }, {
      kind: "FLASH_SALE",
      percentageValue: 20,
      startsAt: opensAt,
      endsAt: new Date("2026-09-16T12:00:00.000Z"),
    });

    const page = await repository.listFlashSalePage({
      shopId: SHOP,
      pageSize: 24,
      now: NOW,
      discovery: query(),
    });
    assert.deepEqual(page.products, []);

    const boundary = await repository.readNextFlashSaleBoundary({ now: NOW });
    assert.deepEqual(boundary, opensAt);
  } finally {
    await cleanup();
  }
});

test("U17 a running Flash window reports its end as the next boundary", async () => {
  await cleanup();
  try {
    const product = await seedProduct("running");
    await seedVariant(product.id, "running", { price: 500_000 });
    const endsAt = new Date("2026-09-15T18:00:00.000Z");
    await campaign("c-running", { productId: product.id }, {
      kind: "FLASH_SALE",
      percentageValue: 20,
      startsAt: new Date("2026-09-15T06:00:00.000Z"),
      endsAt,
    });

    const boundary = await repository.readNextFlashSaleBoundary({ now: NOW });
    assert.deepEqual(boundary, endsAt);
  } finally {
    await cleanup();
  }
});

test("U17 membership crosses start/end boundaries against the server instant", async () => {
  await cleanup();
  try {
    const product = await seedProduct("window");
    await seedVariant(product.id, "window", { price: 500_000 });
    const startsAt = new Date("2026-09-15T13:00:00.000Z");
    const endsAt = new Date("2026-09-15T14:00:00.000Z");
    await campaign("c-window", { productId: product.id }, {
      kind: "FLASH_SALE",
      percentageValue: 20,
      startsAt,
      endsAt,
    });

    const listAt = async (now: Date) =>
      (await repository.listFlashSalePage({ shopId: SHOP, pageSize: 24, now, discovery: query() }))
        .products.length;

    assert.equal(await listAt(new Date(startsAt.getTime() - 1)), 0);
    assert.equal(await listAt(startsAt), 1, "startsAt is inclusive");
    assert.equal(await listAt(new Date(endsAt.getTime() - 1)), 1);
    assert.equal(await listAt(endsAt), 0, "endsAt is exclusive");
  } finally {
    await cleanup();
  }
});

test("U17 the reviewed page/offset cliff is enforced before listing work", async () => {
  await cleanup();
  await assert.doesNotReject(
    repository.listFlashSalePage({
      shopId: SHOP,
      pageSize: 48,
      now: NOW,
      discovery: query({ page: 1042 }),
    }),
  );

  await assert.rejects(
    repository.listFlashSalePage({
      shopId: SHOP,
      pageSize: 48,
      now: NOW,
      discovery: query({ page: 1043 }),
    }),
    RangeError,
  );
});

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});
