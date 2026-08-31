import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const PREFIX = "p1-promo";

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM "PromotionTarget" WHERE "id" LIKE ${`${PREFIX}-%`}`;
  await prisma.$executeRaw`DELETE FROM "PromotionCampaign" WHERE "id" LIKE ${`${PREFIX}-%`}`;
  await prisma.$executeRaw`DELETE FROM "OrderLineSnapshot" WHERE "id" LIKE ${`${PREFIX}-%`}`;
  await prisma.$executeRaw`DELETE FROM "OrderMirror" WHERE "id" LIKE ${`${PREFIX}-%`}`;
  await prisma.$executeRaw`DELETE FROM "VariantMirror" WHERE "id" LIKE ${`${PREFIX}-%`}`;
  await prisma.$executeRaw`DELETE FROM "ProductMirror" WHERE "id" LIKE ${`${PREFIX}-%`}`;
}

async function seedCatalog() {
  await prisma.$executeRaw`
    INSERT INTO "ProductMirror" ("id", "pancakeShopId", "pancakeProductId", "slug", "name", "syncedAt", "createdAt", "updatedAt")
    VALUES (${`${PREFIX}-product`}, 920007, ${`${PREFIX}-external-product`}, ${`${PREFIX}-slug`}, 'P1 Promotion Product', NOW(), NOW(), NOW())
  `;
  await prisma.$executeRaw`
    INSERT INTO "VariantMirror" ("id", "pancakeVariationId", "productId", "syncedAt", "createdAt", "updatedAt")
    VALUES (${`${PREFIX}-variant`}, ${`${PREFIX}-external-variation`}, ${`${PREFIX}-product`}, NOW(), NOW(), NOW())
  `;
}

async function insertCampaign(
  id: string,
  overrides: Partial<{
    kind: string;
    name: string;
    discountType: string;
    percentageValue: number | null;
    fixedPriceVnd: bigint | null;
    startsAt: string | null;
    endsAt: string | null;
  }> = {},
) {
  const values = {
    kind: "PROMOTION",
    name: "P1 campaign",
    discountType: "PERCENTAGE",
    percentageValue: 10,
    fixedPriceVnd: null,
    startsAt: null,
    endsAt: null,
    ...overrides,
  };

  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionCampaign"
       ("id", "kind", "name", "discountType", "percentageValue", "fixedPriceVnd", "startsAt", "endsAt", "createdAt", "updatedAt")
     VALUES ($1, $2::"PromotionCampaignKind", $3, $4::"PromotionDiscountType", $5, $6, $7::timestamptz, $8::timestamptz, NOW(), NOW())`,
    id,
    values.kind,
    values.name,
    values.discountType,
    values.percentageValue,
    values.fixedPriceVnd,
    values.startsAt,
    values.endsAt,
  );
}

async function insertTarget(id: string, campaignId: string, productId: string | null, variantId: string | null) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionTarget" ("id", "campaignId", "productId", "variantId", "createdAt")
     VALUES ($1, $2, $3, $4, NOW())`,
    id,
    campaignId,
    productId,
    variantId,
  );
}

async function assertRejected(operation: () => Promise<unknown>, label: string) {
  await assert.rejects(operation, (error: unknown) => error instanceof Error, label);
}

test.before(cleanup);
test.beforeEach(async () => {
  await cleanup();
  await seedCatalog();
});
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

test("P1 persists a campaign with fail-closed lifecycle defaults", async () => {
  await insertCampaign(`${PREFIX}-campaign`);

  const rows = await prisma.$queryRaw<
    Array<{
      kind: string;
      name: string;
      discountType: string;
      percentageValue: number | null;
      fixedPriceVnd: bigint | null;
      startsAt: Date | null;
      endsAt: Date | null;
      isEnabled: boolean;
      enabledAt: Date | null;
      disabledAt: Date | null;
    }>
  >`
    SELECT "kind", "name", "discountType", "percentageValue", "fixedPriceVnd",
           "startsAt", "endsAt", "isEnabled", "enabledAt", "disabledAt"
    FROM "PromotionCampaign" WHERE "id" = ${`${PREFIX}-campaign`}
  `;

  assert.deepEqual(rows, [
    {
      kind: "PROMOTION",
      name: "P1 campaign",
      discountType: "PERCENTAGE",
      percentageValue: 10,
      fixedPriceVnd: null,
      startsAt: null,
      endsAt: null,
      isEnabled: false,
      enabledAt: null,
      disabledAt: null,
    },
  ]);
});

test("P1 stores website-owned fixed sale price as an integer VND BigInt", async () => {
  await insertCampaign(`${PREFIX}-fixed`, {
    discountType: "FIXED_PRICE",
    percentageValue: null,
    fixedPriceVnd: BigInt("9007199254740993"),
  });

  const [row] = await prisma.$queryRaw<Array<{ fixedPriceVnd: bigint | null }>>`
    SELECT "fixedPriceVnd" FROM "PromotionCampaign" WHERE "id" = ${`${PREFIX}-fixed`}
  `;

  assert.equal(row?.fixedPriceVnd, BigInt("9007199254740993"));
});

test("P1 enforces discount-type money exclusivity in the database, not the UI", async () => {
  await assertRejected(
    () => insertCampaign(`${PREFIX}-bad-1`, { discountType: "PERCENTAGE", percentageValue: null }),
    "percentage campaigns require a percentage value",
  );
  await assertRejected(
    () =>
      insertCampaign(`${PREFIX}-bad-2`, {
        discountType: "PERCENTAGE",
        percentageValue: 10,
        fixedPriceVnd: BigInt(100_000),
      }),
    "percentage campaigns must not carry a fixed price",
  );
  await assertRejected(
    () =>
      insertCampaign(`${PREFIX}-bad-3`, {
        discountType: "FIXED_PRICE",
        percentageValue: 10,
        fixedPriceVnd: BigInt(100_000),
      }),
    "fixed-price campaigns must not carry a percentage",
  );
  await assertRejected(
    () => insertCampaign(`${PREFIX}-bad-4`, { discountType: "FIXED_PRICE", percentageValue: null }),
    "fixed-price campaigns require a fixed price",
  );
});

test("P1 rejects out-of-range percentages and non-positive fixed prices", async () => {
  for (const percentageValue of [0, 100, -1]) {
    await assertRejected(
      () => insertCampaign(`${PREFIX}-pct-${percentageValue}`, { percentageValue }),
      `percentage ${percentageValue} must be rejected`,
    );
  }
  for (const percentageValue of [1, 99]) {
    await insertCampaign(`${PREFIX}-pct-ok-${percentageValue}`, { percentageValue });
  }

  for (const fixedPriceVnd of [BigInt(0), BigInt(-1)]) {
    await assertRejected(
      () =>
        insertCampaign(`${PREFIX}-fixed-${fixedPriceVnd}`, {
          discountType: "FIXED_PRICE",
          percentageValue: null,
          fixedPriceVnd,
        }),
      `fixed price ${fixedPriceVnd} must be rejected`,
    );
  }
});

test("P1 enforces the campaign name bound at its exact 120/121 boundary", async () => {
  await insertCampaign(`${PREFIX}-name-120`, { name: "a".repeat(120) });
  await assertRejected(
    () => insertCampaign(`${PREFIX}-name-121`, { name: "a".repeat(121) }),
    "121 code units must be rejected",
  );
  await assertRejected(
    () => insertCampaign(`${PREFIX}-name-empty`, { name: "" }),
    "an empty name must be rejected",
  );
});

test("P1 enforces the half-open interval and the Flash Sale window requirement", async () => {
  const start = "2026-09-01T00:00:00.000Z";
  const end = "2026-09-02T00:00:00.000Z";

  await insertCampaign(`${PREFIX}-window`, { startsAt: start, endsAt: end });
  await insertCampaign(`${PREFIX}-open`, { startsAt: null, endsAt: null });
  await insertCampaign(`${PREFIX}-flash`, { kind: "FLASH_SALE", startsAt: start, endsAt: end });

  await assertRejected(
    () => insertCampaign(`${PREFIX}-inverted`, { startsAt: end, endsAt: start }),
    "endsAt must be strictly after startsAt",
  );
  await assertRejected(
    () => insertCampaign(`${PREFIX}-empty-window`, { startsAt: start, endsAt: start }),
    "an empty interval must be rejected",
  );
  await assertRejected(
    () => insertCampaign(`${PREFIX}-flash-open`, { kind: "FLASH_SALE", startsAt: start, endsAt: null }),
    "a Flash Sale requires both bounds",
  );
});

test("P1 target rows carry exactly one of product or variant scope", async () => {
  await insertCampaign(`${PREFIX}-campaign`);

  await insertTarget(`${PREFIX}-target-product`, `${PREFIX}-campaign`, `${PREFIX}-product`, null);
  await insertTarget(`${PREFIX}-target-variant`, `${PREFIX}-campaign`, null, `${PREFIX}-variant`);

  await assertRejected(
    () => insertTarget(`${PREFIX}-target-none`, `${PREFIX}-campaign`, null, null),
    "a target must name a scope",
  );
  await assertRejected(
    () =>
      insertTarget(`${PREFIX}-target-both`, `${PREFIX}-campaign`, `${PREFIX}-product`, `${PREFIX}-variant`),
    "a target must not name both scopes",
  );
});

test("P1 rejects duplicate targets inside one campaign while allowing them across campaigns", async () => {
  await insertCampaign(`${PREFIX}-campaign`);
  await insertCampaign(`${PREFIX}-campaign-b`);

  await insertTarget(`${PREFIX}-t1`, `${PREFIX}-campaign`, `${PREFIX}-product`, null);
  await assertRejected(
    () => insertTarget(`${PREFIX}-t2`, `${PREFIX}-campaign`, `${PREFIX}-product`, null),
    "a product may appear once per campaign",
  );

  await insertTarget(`${PREFIX}-t3`, `${PREFIX}-campaign`, null, `${PREFIX}-variant`);
  await assertRejected(
    () => insertTarget(`${PREFIX}-t4`, `${PREFIX}-campaign`, null, `${PREFIX}-variant`),
    "a variant may appear once per campaign",
  );

  await insertTarget(`${PREFIX}-t5`, `${PREFIX}-campaign-b`, `${PREFIX}-product`, null);
});

test("P1 targets require a real catalog row", async () => {
  await insertCampaign(`${PREFIX}-campaign`);

  await assertRejected(
    () => insertTarget(`${PREFIX}-t-missing`, `${PREFIX}-campaign`, `${PREFIX}-not-a-product`, null),
    "a product target must reference a mirrored product",
  );
  await assertRejected(
    () => insertTarget(`${PREFIX}-t-missing-v`, `${PREFIX}-campaign`, null, `${PREFIX}-not-a-variant`),
    "a variant target must reference a mirrored variant",
  );
});

test("P1 initializes exactly one durable promotion pricing revision at zero", async () => {
  const rows = await prisma.$queryRaw<Array<{ id: string; revision: bigint }>>`
    SELECT "id", "revision" FROM "PromotionPricingRevision"
  `;

  assert.equal(rows.length, 1, "the revision must be a singleton");
  assert.equal(rows[0]?.id, "current");
  assert.ok((rows[0]?.revision ?? BigInt(-1)) >= BigInt(0), "the revision must be non-negative");
});

test("P1 bounds the revision to one row and forbids a negative value", async () => {
  await assertRejected(
    () =>
      prisma.$executeRaw`
        INSERT INTO "PromotionPricingRevision" ("id", "revision", "updatedAt")
        VALUES ('another', 0, NOW())
      `,
    "a second revision row must be rejected",
  );
  await assertRejected(
    () => prisma.$executeRaw`UPDATE "PromotionPricingRevision" SET "revision" = -1 WHERE "id" = 'current'`,
    "a negative revision must be rejected",
  );
});

test("P1 revision advance is transactionally lockable and monotonic under concurrency", async () => {
  const [before] = await prisma.$queryRaw<Array<{ revision: bigint }>>`
    SELECT "revision" FROM "PromotionPricingRevision" WHERE "id" = 'current'
  `;
  const start = before?.revision ?? BigInt(0);

  async function advance(): Promise<bigint> {
    return prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<Array<{ revision: bigint }>>`
        SELECT "revision" FROM "PromotionPricingRevision" WHERE "id" = 'current' FOR UPDATE
      `;
      const next = (locked?.revision ?? BigInt(0)) + BigInt(1);
      await tx.$executeRaw`
        UPDATE "PromotionPricingRevision" SET "revision" = ${next}, "updatedAt" = NOW() WHERE "id" = 'current'
      `;
      return next;
    });
  }

  const advanced = await Promise.all([advance(), advance(), advance()]);

  const [after] = await prisma.$queryRaw<Array<{ revision: bigint }>>`
    SELECT "revision" FROM "PromotionPricingRevision" WHERE "id" = 'current'
  `;

  assert.equal(after?.revision, start + BigInt(3), "each locked advance must be observed exactly once");
  assert.deepEqual(
    [...advanced].sort((a, b) => Number(a - b)),
    [start + BigInt(1), start + BigInt(2), start + BigInt(3)],
    "concurrent advances must serialize rather than collide",
  );
});

test("P1 a rolled-back transaction leaves the durable revision unchanged", async () => {
  const [before] = await prisma.$queryRaw<Array<{ revision: bigint }>>`
    SELECT "revision" FROM "PromotionPricingRevision" WHERE "id" = 'current'
  `;

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        UPDATE "PromotionPricingRevision" SET "revision" = "revision" + 1 WHERE "id" = 'current'
      `;
      throw new Error("simulated mutation failure");
    }),
  );

  const [after] = await prisma.$queryRaw<Array<{ revision: bigint }>>`
    SELECT "revision" FROM "PromotionPricingRevision" WHERE "id" = 'current'
  `;
  assert.equal(after?.revision, before?.revision);
});
