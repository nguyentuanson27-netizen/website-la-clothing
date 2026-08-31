import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const PREFIX = "p1-audit";

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM "OrderLineSnapshot" WHERE "id" LIKE ${`${PREFIX}-%`}`;
  await prisma.$executeRaw`DELETE FROM "OrderMirror" WHERE "id" LIKE ${`${PREFIX}-%`}`;
  await prisma.$executeRaw`DELETE FROM "VariantMirror" WHERE "id" LIKE ${`${PREFIX}-%`}`;
  await prisma.$executeRaw`DELETE FROM "ProductMirror" WHERE "id" LIKE ${`${PREFIX}-%`}`;
}

async function seed() {
  await prisma.$executeRaw`
    INSERT INTO "ProductMirror" ("id", "pancakeShopId", "pancakeProductId", "slug", "name", "syncedAt", "createdAt", "updatedAt")
    VALUES (${`${PREFIX}-product`}, 920007, ${`${PREFIX}-external-product`}, ${`${PREFIX}-slug`}, 'P1 Audit Product', NOW(), NOW(), NOW())
  `;
  await prisma.$executeRaw`
    INSERT INTO "VariantMirror" ("id", "pancakeVariationId", "productId", "syncedAt", "createdAt", "updatedAt")
    VALUES (${`${PREFIX}-variant`}, ${`${PREFIX}-external-variation`}, ${`${PREFIX}-product`}, NOW(), NOW(), NOW())
  `;
  await prisma.$executeRaw`
    INSERT INTO "OrderMirror" ("id", "publicCode", "createdAt", "updatedAt")
    VALUES (${`${PREFIX}-order`}, ${`${PREFIX}-code`}, NOW(), NOW())
  `;
}

test.before(cleanup);
test.beforeEach(async () => {
  await cleanup();
  await seed();
});
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

/**
 * The pre-promotion insert shape. It must keep working unchanged: rolling the application back
 * must not be blocked by a column the old code never writes.
 */
async function insertHistoricalLine(id: string) {
  await prisma.$executeRaw`
    INSERT INTO "OrderLineSnapshot"
      ("id", "orderId", "variantId", "pancakeVariationId", "productName", "color", "size", "quantity", "unitPriceVnd", "lineTotalVnd", "createdAt")
    VALUES (${id}, ${`${PREFIX}-order`}, ${`${PREFIX}-variant`}, ${`${PREFIX}-external-variation`},
            'P1 Audit Product', 'Đen', 'L', 2, 890000, 1780000, NOW())
  `;
}

test("P1 historical order lines written by pre-promotion code still insert and read back null audit", async () => {
  await insertHistoricalLine(`${PREFIX}-historical`);

  const [row] = await prisma.$queryRaw<
    Array<{
      pancakeVariationId: string;
      productName: string;
      color: string | null;
      size: string;
      quantity: number;
      unitPriceVnd: bigint;
      lineTotalVnd: bigint;
      baseUnitPriceVnd: bigint | null;
      promotionCampaignId: string | null;
      promotionName: string | null;
      promotionKind: string | null;
      promotionDiscountType: string | null;
      promotionPercentageValue: number | null;
      promotionFixedPriceVnd: bigint | null;
    }>
  >`
    SELECT "pancakeVariationId", "productName", "color", "size", "quantity", "unitPriceVnd", "lineTotalVnd",
           "baseUnitPriceVnd", "promotionCampaignId", "promotionName", "promotionKind",
           "promotionDiscountType", "promotionPercentageValue", "promotionFixedPriceVnd"
    FROM "OrderLineSnapshot" WHERE "id" = ${`${PREFIX}-historical`}
  `;

  assert.deepEqual(row, {
    pancakeVariationId: `${PREFIX}-external-variation`,
    productName: "P1 Audit Product",
    color: "Đen",
    size: "L",
    quantity: 2,
    unitPriceVnd: BigInt(890_000),
    lineTotalVnd: BigInt(1_780_000),
    baseUnitPriceVnd: null,
    promotionCampaignId: null,
    promotionName: null,
    promotionKind: null,
    promotionDiscountType: null,
    promotionPercentageValue: null,
    promotionFixedPriceVnd: null,
  });
});

test("P1 a promoted line stores base price, final price and the campaign audit snapshot", async () => {
  await prisma.$executeRaw`
    INSERT INTO "OrderLineSnapshot"
      ("id", "orderId", "variantId", "pancakeVariationId", "productName", "color", "size", "quantity",
       "unitPriceVnd", "lineTotalVnd", "baseUnitPriceVnd", "promotionCampaignId", "promotionName",
       "promotionKind", "promotionDiscountType", "promotionPercentageValue", "createdAt")
    VALUES (${`${PREFIX}-promoted`}, ${`${PREFIX}-order`}, ${`${PREFIX}-variant`}, ${`${PREFIX}-external-variation`},
            'P1 Audit Product', 'Đen', 'L', 2, 801000, 1602000, 890000, 'campaign-snapshot-id',
            'Flash Sale thang 9', 'FLASH_SALE'::"PromotionCampaignKind",
            'PERCENTAGE'::"PromotionDiscountType", 10, NOW())
  `;

  const [row] = await prisma.$queryRaw<
    Array<{
      unitPriceVnd: bigint;
      baseUnitPriceVnd: bigint | null;
      lineTotalVnd: bigint;
      promotionCampaignId: string | null;
      promotionName: string | null;
      promotionKind: string | null;
      promotionDiscountType: string | null;
      promotionPercentageValue: number | null;
    }>
  >`
    SELECT "unitPriceVnd", "baseUnitPriceVnd", "lineTotalVnd", "promotionCampaignId", "promotionName",
           "promotionKind", "promotionDiscountType", "promotionPercentageValue"
    FROM "OrderLineSnapshot" WHERE "id" = ${`${PREFIX}-promoted`}
  `;

  assert.deepEqual(row, {
    unitPriceVnd: BigInt(801_000),
    baseUnitPriceVnd: BigInt(890_000),
    lineTotalVnd: BigInt(1_602_000),
    promotionCampaignId: "campaign-snapshot-id",
    promotionName: "Flash Sale thang 9",
    promotionKind: "FLASH_SALE",
    promotionDiscountType: "PERCENTAGE",
    promotionPercentageValue: 10,
  });
});

test("P1 promotion audit is all-or-nothing so a line can never claim a nameless promotion", async () => {
  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "OrderLineSnapshot"
        ("id", "orderId", "variantId", "pancakeVariationId", "productName", "size", "quantity",
         "unitPriceVnd", "lineTotalVnd", "promotionCampaignId", "createdAt")
      VALUES (${`${PREFIX}-partial`}, ${`${PREFIX}-order`}, ${`${PREFIX}-variant`}, ${`${PREFIX}-external-variation`},
              'P1 Audit Product', 'L', 1, 801000, 801000, 'campaign-snapshot-id', NOW())
    `,
    "a promotion id without its audit snapshot must be rejected",
  );

  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "OrderLineSnapshot"
        ("id", "orderId", "variantId", "pancakeVariationId", "productName", "size", "quantity",
         "unitPriceVnd", "lineTotalVnd", "promotionName", "createdAt")
      VALUES (${`${PREFIX}-orphan`}, ${`${PREFIX}-order`}, ${`${PREFIX}-variant`}, ${`${PREFIX}-external-variation`},
              'P1 Audit Product', 'L', 1, 801000, 801000, 'Flash Sale thang 9', NOW())
    `,
    "promotion audit without a promotion id must be rejected",
  );
});

test("P1 order-line money stays a non-negative integer VND amount", async () => {
  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "OrderLineSnapshot"
        ("id", "orderId", "variantId", "pancakeVariationId", "productName", "size", "quantity",
         "unitPriceVnd", "lineTotalVnd", "baseUnitPriceVnd", "createdAt")
      VALUES (${`${PREFIX}-negative`}, ${`${PREFIX}-order`}, ${`${PREFIX}-variant`}, ${`${PREFIX}-external-variation`},
              'P1 Audit Product', 'L', 1, 801000, 801000, -1, NOW())
    `,
    "a negative base unit price must be rejected",
  );
});

test("P1 the order-line migration is additive and destroys no existing column contract", async () => {
  const columns = await prisma.$queryRaw<
    Array<{ column_name: string; data_type: string; is_nullable: string }>
  >`
    SELECT "column_name", "data_type", "is_nullable"
    FROM information_schema.columns
    WHERE "table_name" = 'OrderLineSnapshot'
    ORDER BY "column_name"
  `;
  const byName = new Map(columns.map((column) => [column.column_name, column]));

  for (const [name, dataType, nullable] of [
    ["id", "text", "NO"],
    ["orderId", "text", "NO"],
    ["variantId", "text", "NO"],
    ["pancakeVariationId", "text", "NO"],
    ["productName", "text", "NO"],
    ["color", "text", "YES"],
    ["size", "text", "NO"],
    ["quantity", "integer", "NO"],
    ["unitPriceVnd", "bigint", "NO"],
    ["lineTotalVnd", "bigint", "NO"],
  ] as const) {
    assert.deepEqual(
      byName.get(name),
      { column_name: name, data_type: dataType, is_nullable: nullable },
      `${name} must keep its existing contract`,
    );
  }

  for (const name of [
    "baseUnitPriceVnd",
    "promotionCampaignId",
    "promotionName",
    "promotionKind",
    "promotionDiscountType",
    "promotionPercentageValue",
    "promotionFixedPriceVnd",
  ]) {
    assert.equal(byName.get(name)?.is_nullable, "YES", `${name} must be additive and nullable`);
  }
});

test("P1 keeps the mirrored Pancake price columns as external Float facts", async () => {
  const rows = await prisma.$queryRaw<Array<{ column_name: string; data_type: string }>>`
    SELECT "column_name", "data_type"
    FROM information_schema.columns
    WHERE "table_name" = 'VariantMirror'
      AND "column_name" IN ('pancakeRetailPrice', 'pancakeRetailPriceAfterDiscount')
    ORDER BY "column_name"
  `;

  assert.deepEqual(rows, [
    { column_name: "pancakeRetailPrice", data_type: "double precision" },
    { column_name: "pancakeRetailPriceAfterDiscount", data_type: "double precision" },
  ]);
});
