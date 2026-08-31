import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { summarizeMirroredMoney } from "../../src/commerce/mirrored-money-audit.ts";
import { readMirroredVariantMoneyRows } from "../../src/commerce/mirrored-money-audit-repository.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const PREFIX = "w3-money";
const SHOP_ID = 920_911;
const OTHER_SHOP_ID = 920_912;

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM "VariantMirror" WHERE "id" LIKE ${`${PREFIX}-%`}`;
  await prisma.$executeRaw`DELETE FROM "ProductMirror" WHERE "id" LIKE ${`${PREFIX}-%`}`;
}

async function insertProduct(
  suffix: string,
  shopId: number,
  visible: { isPresent: boolean; isActive: boolean } = { isPresent: true, isActive: true },
) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ProductMirror"
       ("id","pancakeShopId","pancakeProductId","slug","name","isPresent","isActive","syncedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'W3 Money Product',$5,$6,NOW(),NOW(),NOW())`,
    `${PREFIX}-${suffix}`,
    shopId,
    `${PREFIX}-${suffix}-external`,
    `${PREFIX}-${suffix}-slug`,
    visible.isPresent,
    visible.isActive,
  );
}

async function insertVariant(
  suffix: string,
  productSuffix: string,
  retailPrice: number | null,
  overrides: Partial<{ afterDiscount: number | null; isPresent: boolean; isActive: boolean }> = {},
) {
  const { afterDiscount = retailPrice, isPresent = true, isActive = true } = overrides;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "VariantMirror"
       ("id","pancakeVariationId","productId","pancakeRetailPrice","pancakeRetailPriceAfterDiscount",
        "isPresent","isActive","syncedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),NOW(),NOW())`,
    `${PREFIX}-${suffix}`,
    `${PREFIX}-${suffix}-variation`,
    `${PREFIX}-${productSuffix}`,
    retailPrice,
    afterDiscount,
    isPresent,
    isActive,
  );
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

test("W3 the audit reads real mirrored money and classifies it against the website rule", async () => {
  await insertProduct("product", SHOP_ID);
  await insertVariant("a-usable", "product", 890_000);
  await insertVariant("b-null", "product", null);
  await insertVariant("c-zero", "product", 0);
  await insertVariant("d-negative", "product", -5);
  await insertVariant("e-noninteger", "product", 1.5);

  const summary = summarizeMirroredMoney(await readMirroredVariantMoneyRows(SHOP_ID));

  assert.equal(summary.totalVariants, 5);
  assert.deepEqual(summary.counts, {
    USABLE: 1,
    NULL: 1,
    ZERO: 1,
    NEGATIVE: 1,
    NON_FINITE: 0,
    NON_INTEGER: 1,
    UNSAFE_INTEGER: 0,
  });
  assert.equal(summary.visibleVariants, 5);
  assert.equal(summary.visibleVariantsBecomingUnavailable, 4);
});

test("W3 a variant hidden by its own flags or by its product is not counted as a buyer loss", async () => {
  await insertProduct("visible", SHOP_ID);
  await insertProduct("hidden", SHOP_ID, { isPresent: true, isActive: false });

  await insertVariant("a-visible-bad", "visible", null);
  await insertVariant("b-inactive-bad", "visible", null, { isActive: false });
  await insertVariant("c-absent-bad", "visible", null, { isPresent: false });
  await insertVariant("d-hidden-product-bad", "hidden", null);

  const summary = summarizeMirroredMoney(await readMirroredVariantMoneyRows(SHOP_ID));

  assert.equal(summary.counts.NULL, 4, "every row is still audited");
  assert.equal(summary.visibleVariants, 1);
  assert.equal(summary.visibleVariantsBecomingUnavailable, 1);
  assert.deepEqual(
    summary.visibleUnavailableExamples.map((example) => example.pancakeVariationId),
    [`${PREFIX}-a-visible-bad-variation`],
  );
});

test("W3 the audit stays inside the configured shop scope", async () => {
  await insertProduct("mine", SHOP_ID);
  await insertProduct("theirs", OTHER_SHOP_ID);
  await insertVariant("a-mine", "mine", 890_000);
  await insertVariant("b-theirs", "theirs", null);

  const summary = summarizeMirroredMoney(await readMirroredVariantMoneyRows(SHOP_ID));

  assert.equal(summary.totalVariants, 1);
  assert.equal(summary.counts.USABLE, 1);
  assert.equal(summary.counts.NULL, 0);
});

test("W3 the audit reports where the mirrored discount field is lower than base", async () => {
  await insertProduct("product", SHOP_ID);
  await insertVariant("a-equal", "product", 890_000, { afterDiscount: 890_000 });
  await insertVariant("b-lower", "product", 890_000, { afterDiscount: 499_000 });
  await insertVariant("c-null-discount", "product", 890_000, { afterDiscount: null });

  const summary = summarizeMirroredMoney(await readMirroredVariantMoneyRows(SHOP_ID));

  assert.equal(summary.discountField.equalToBase, 1);
  assert.equal(summary.discountField.lowerThanBase, 1);
  assert.equal(summary.discountField.unusableForComparison, 1);
  assert.deepEqual(
    summary.discountField.lowerThanBaseExamples.map((example) => example.pancakeVariationId),
    [`${PREFIX}-b-lower-variation`],
  );
});

test("W3 the audit rejects a malformed shop scope before touching the database", async () => {
  for (const shopId of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      () => readMirroredVariantMoneyRows(shopId),
      /positive safe integer/,
      `${shopId} must be rejected`,
    );
  }
});
