import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { readMerchantIdentityRows } from "../../src/commerce/merchant-identity-audit-repository.ts";
import { summarizeMerchantIdentity } from "../../src/commerce/merchant-identity-audit.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const PREFIX = "m1-stock-regression";
const SHOP_ID = 920_922;

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM "WarehouseStock" WHERE "id" LIKE ${`${PREFIX}-%`}`;
  await prisma.$executeRaw`DELETE FROM "VariantMirror" WHERE "id" LIKE ${`${PREFIX}-%`}`;
  await prisma.$executeRaw`DELETE FROM "ProductMirror" WHERE "id" LIKE ${`${PREFIX}-%`}`;
}

async function insertVariant(suffix: string) {
  const productId = `${PREFIX}-product-${suffix}`;
  const variantId = `${PREFIX}-variant-${suffix}`;

  await prisma.$executeRawUnsafe(
    `INSERT INTO "ProductMirror"
       ("id","pancakeShopId","pancakeProductId","slug","name","isPresent","isActive","syncedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'Stock audit product',TRUE,TRUE,NOW(),NOW(),NOW())`,
    productId,
    SHOP_ID,
    `external-product-${suffix}`,
    `${PREFIX}-${suffix}`,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO "VariantMirror"
       ("id","pancakeVariationId","productId","sku","isPresent","isActive","syncedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,TRUE,TRUE,NOW(),NOW(),NOW())`,
    variantId,
    `external-variation-${suffix}`,
    productId,
    `SKU-${suffix}`,
  );

  return variantId;
}

async function insertStock(variantId: string, suffix: string, quantities: readonly number[]) {
  for (const [index, quantity] of quantities.entries()) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "WarehouseStock"
         ("id","variantId","pancakeWarehouseId","quantity","syncedAt","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,NOW(),NOW(),NOW())`,
      `${PREFIX}-stock-${suffix}-${index}`,
      variantId,
      `warehouse-${suffix}-${index}`,
      quantity,
    );
  }
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

test("M1 rejects a mixed invalid warehouse source instead of hiding it in the aggregate", async () => {
  const mixed = await insertVariant("mixed");
  const zero = await insertVariant("zero");

  await insertStock(mixed, "mixed", [-3, 4]);
  await insertStock(zero, "zero", [0]);

  const summary = summarizeMerchantIdentity(await readMerchantIdentityRows(SHOP_ID));

  assert.deepEqual(
    summary.availability,
    { IN_STOCK: 0, OUT_OF_STOCK: 2 },
    "a negative source quantity is not evidence of stock even when another warehouse makes the sum positive",
  );
});
