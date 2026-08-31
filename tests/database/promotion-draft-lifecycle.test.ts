import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const PREFIX = "p1-draft-lifecycle";

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM "PromotionCampaign" WHERE "id" LIKE ${`${PREFIX}-%`}`;
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

test("P1 persistence allows incomplete or business-invalid Draft campaign state", async () => {
  const rows = [
    {
      id: `${PREFIX}-flash-incomplete`,
      kind: "FLASH_SALE",
      discountType: "PERCENTAGE",
      percentageValue: null,
      fixedPriceVnd: null,
      startsAt: null,
      endsAt: null,
    },
    {
      id: `${PREFIX}-percentage-invalid`,
      kind: "PROMOTION",
      discountType: "PERCENTAGE",
      percentageValue: 100,
      fixedPriceVnd: null,
      startsAt: null,
      endsAt: null,
    },
    {
      id: `${PREFIX}-window-invalid`,
      kind: "PROMOTION",
      discountType: "FIXED_PRICE",
      percentageValue: null,
      fixedPriceVnd: BigInt(0),
      startsAt: new Date("2026-09-02T00:00:00.000Z"),
      endsAt: new Date("2026-09-01T00:00:00.000Z"),
    },
  ] as const;

  for (const row of rows) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PromotionCampaign"
         ("id", "kind", "name", "discountType", "percentageValue", "fixedPriceVnd", "startsAt", "endsAt", "createdAt", "updatedAt")
       VALUES ($1, $2::"PromotionCampaignKind", $3, $4::"PromotionDiscountType", $5, $6, $7, $8, NOW(), NOW())`,
      row.id,
      row.kind,
      "Draft can be incomplete",
      row.discountType,
      row.percentageValue,
      row.fixedPriceVnd,
      row.startsAt,
      row.endsAt,
    );
  }

  const persisted = await prisma.$queryRaw<Array<{ id: string; isEnabled: boolean }>>`
    SELECT "id", "isEnabled"
    FROM "PromotionCampaign"
    WHERE "id" LIKE ${`${PREFIX}-%`}
    ORDER BY "id"
  `;

  assert.equal(persisted.length, rows.length);
  assert.ok(persisted.every((row) => row.isEnabled === false), "Draft rows stay fail-closed");
});
