import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { readMerchantIdentityRows } from "../../src/commerce/merchant-identity-audit-repository.ts";
import { summarizeMerchantIdentity } from "../../src/commerce/merchant-identity-audit.ts";
import { MAX_MEDIA_CANDIDATES_SCANNED } from "../../src/commerce/product-media.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const PREFIX = "m1-media-parity-5542421957";
const SHOP_ID = 920_922;

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM "VariantMirror" WHERE "id" LIKE ${`${PREFIX}-%`}`;
  await prisma.$executeRaw`DELETE FROM "ProductMirror" WHERE "id" LIKE ${`${PREFIX}-%`}`;
}

async function insertProduct() {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ProductMirror"
       ("id","pancakeShopId","pancakeProductId","slug","name","isPresent","isActive","syncedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'M1 Media Product',TRUE,TRUE,NOW(),NOW(),NOW())`,
    `${PREFIX}-p`, SHOP_ID, `${PREFIX}-product`, `${PREFIX}-slug`,
  );
}

async function insertVariant(
  suffix: string,
  externalId: string,
  active: boolean,
  imageUrls: unknown,
) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "VariantMirror"
       ("id","pancakeVariationId","productId","pancakeDisplayId","sku","isPresent","isActive","pancakeImageUrls","syncedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,TRUE,$6,$7::jsonb,NOW(),NOW(),NOW())`,
    `${PREFIX}-${suffix}`,
    externalId,
    `${PREFIX}-p`,
    `${PREFIX}-${suffix}-mpn`,
    `${PREFIX}-${suffix}-local-sku`,
    active,
    JSON.stringify(imageUrls),
  );
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => prisma.$disconnect());

test("M1 media audit gives every active sibling the storefront product-level media candidates", async () => {
  await insertProduct();
  await insertVariant("v1", `${PREFIX}-variation-1`, true, []);
  await insertVariant(
    "v2",
    `${PREFIX}-variation-2`,
    true,
    ["https://content.pancake.vn/catalog/1/2/3/sibling.jpg"],
  );

  const rows = await readMerchantIdentityRows(SHOP_ID);
  const summary = summarizeMerchantIdentity(rows);

  assert.equal(summary.emittableStandaloneVariations, 2);
  assert.deepEqual(
    summary.media,
    { READY: 2, MISSING: 0, UNTRUSTED: 0 },
    "the sibling without its own image must still see the same product-level storefront media",
  );
});

test("M1 media audit excludes inactive sibling images exactly like storefront product projection", async () => {
  await insertProduct();
  await insertVariant("v1", `${PREFIX}-variation-1`, true, []);
  await insertVariant(
    "v2",
    `${PREFIX}-variation-2`,
    false,
    ["https://content.pancake.vn/catalog/1/2/3/inactive.jpg"],
  );

  const rows = await readMerchantIdentityRows(SHOP_ID);
  const summary = summarizeMerchantIdentity(rows);

  assert.equal(summary.emittableStandaloneVariations, 1);
  assert.deepEqual(
    summary.media,
    { READY: 0, MISSING: 1, UNTRUSTED: 0 },
    "inactive sibling media must not make an active offer appear storefront-ready",
  );
});

test("M1 media audit bounds untrusted image candidate materialization before resolver scanning", async () => {
  await insertProduct();
  const candidates = Array.from(
    { length: MAX_MEDIA_CANDIDATES_SCANNED + 25 },
    (_, index) => `https://attacker.example/image-${index}.jpg`,
  );
  await insertVariant("v1", `${PREFIX}-variation-1`, true, candidates);
  await insertVariant(
    "v2",
    `${PREFIX}-variation-2`,
    true,
    ["https://content.pancake.vn/catalog/1/2/3/too-late.jpg"],
  );

  const rows = await readMerchantIdentityRows(SHOP_ID);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.variantImageUrls?.length, MAX_MEDIA_CANDIDATES_SCANNED);
    assert.equal(row.variantImageUrls?.[0], "https://attacker.example/image-0.jpg");
    assert.equal(
      row.variantImageUrls?.[MAX_MEDIA_CANDIDATES_SCANNED - 1],
      `https://attacker.example/image-${MAX_MEDIA_CANDIDATES_SCANNED - 1}.jpg`,
      "candidate order is preserved while later untrusted payload is not materialized",
    );
  }

  const summary = summarizeMerchantIdentity(rows);
  assert.deepEqual(
    summary.media,
    { READY: 0, MISSING: 0, UNTRUSTED: 2 },
    "a trusted image beyond the shared candidate budget must not be reached",
  );
});
