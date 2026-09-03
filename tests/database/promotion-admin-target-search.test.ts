import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createPromotionAdminRepository } from "../../src/commerce/promotion-admin-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const repository = createPromotionAdminRepository(prisma);
const PREFIX = "p5b-shop-scope";
const SHOP = 920_942;
const OTHER_SHOP = 920_943;
const NEEDLE = "P5b Shop Scope Needle";

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM "VariantMirror" WHERE "id" LIKE ${`${PREFIX}-%`}`;
  await prisma.$executeRaw`DELETE FROM "ProductMirror" WHERE "id" LIKE ${`${PREFIX}-%`}`;
}

async function seedProduct(shopId: number, suffix: string) {
  const productId = `${PREFIX}-${suffix}-product`;
  const variantId = `${PREFIX}-${suffix}-variant`;

  await prisma.$executeRawUnsafe(
    `INSERT INTO "ProductMirror"
       ("id","pancakeShopId","pancakeProductId","slug","name","isPresent","isActive","syncedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,TRUE,TRUE,NOW(),NOW(),NOW())`,
    productId,
    shopId,
    `${PREFIX}-${suffix}-external`,
    `${PREFIX}-${suffix}`,
    NEEDLE,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO "VariantMirror"
       ("id","pancakeVariationId","productId","pancakeRetailPrice","isPresent","syncedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,500000,TRUE,NOW(),NOW(),NOW())`,
    variantId,
    `${PREFIX}-${suffix}-variant-external`,
    productId,
  );

  return { productId, variantId };
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

test("P5b target picker repository excludes matching products and variants from another shop", async () => {
  const current = await seedProduct(SHOP, "current");
  await seedProduct(OTHER_SHOP, "foreign");

  const products = await repository.searchTargetProducts({ shopId: SHOP, search: NEEDLE });
  assert.deepEqual(products.map((product) => product.id), [current.productId]);

  const variants = await repository.searchTargetVariants({ shopId: SHOP, search: NEEDLE });
  assert.deepEqual(variants.map((variant) => variant.id), [current.variantId]);
});
