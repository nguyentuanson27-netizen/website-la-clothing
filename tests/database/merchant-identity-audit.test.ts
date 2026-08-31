import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { readMerchantIdentityRows } from "../../src/commerce/merchant-identity-audit-repository.ts";
import { summarizeMerchantIdentity } from "../../src/commerce/merchant-identity-audit.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const PREFIX = "m1-identity";
const SHOP_ID = 920_921;

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM "CompositeComponentMirror" WHERE "parentVariantId" LIKE ${`${PREFIX}-%`} OR "componentVariantId" LIKE ${`${PREFIX}-%`}`;
  await prisma.$executeRaw`DELETE FROM "VariantMirror" WHERE "id" LIKE ${`${PREFIX}-%`}`;
  await prisma.$executeRaw`DELETE FROM "ProductMirror" WHERE "id" LIKE ${`${PREFIX}-%`}`;
}

async function insertProduct(suffix: string, externalId: string, active = true) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ProductMirror"
       ("id","pancakeShopId","pancakeProductId","slug","name","isPresent","isActive","syncedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'M1 Product',TRUE,$5,NOW(),NOW(),NOW())`,
    `${PREFIX}-${suffix}`, SHOP_ID, externalId, `${PREFIX}-${suffix}-slug`, active,
  );
}

async function insertVariant(
  suffix: string,
  productSuffix: string,
  externalId: string,
  sku: string | null,
  active = true,
) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "VariantMirror"
       ("id","pancakeVariationId","productId","sku","isPresent","isActive","syncedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,TRUE,$5,NOW(),NOW(),NOW())`,
    `${PREFIX}-${suffix}`, externalId, `${PREFIX}-${productSuffix}`, sku, active,
  );
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

test("M1 the audit reports identifier and SKU health over the real mirror", async () => {
  await insertProduct("p", "external-product-1");
  await insertVariant("v1", "p", "external-variation-1", "LA-A");
  await insertVariant("v2", "p", "external-variation-2", "LA-B");
  await insertVariant("v3", "p", "external-variation-3", null);

  const summary = summarizeMerchantIdentity(await readMerchantIdentityRows(SHOP_ID));

  assert.equal(summary.emittableStandaloneVariations, 3);
  assert.equal(summary.variationIdentifiers.PRESENT, 3);
  assert.equal(summary.productIdentifiers.PRESENT, 1, "one family, counted once");
  assert.equal(summary.sku.PRESENT, 2);
  assert.equal(summary.sku.MISSING, 1);
  assert.equal(summary.mpnReady, false, "a missing SKU blocks MPN readiness");
});

test("M1 a duplicate SKU across emitted variations is reported and blocks MPN", async () => {
  await insertProduct("p", "external-product-1");
  await insertVariant("v1", "p", "external-variation-1", "LA-DUP");
  await insertVariant("v2", "p", "external-variation-2", "LA-DUP");

  const summary = summarizeMerchantIdentity(await readMerchantIdentityRows(SHOP_ID));

  assert.deepEqual(summary.duplicateSkus, [{ value: "LA-DUP", occurrences: 2 }]);
  assert.equal(summary.mpnReady, false);
});

test("M1 a composite component is deferred rather than audited as an emittable offer", async () => {
  await insertProduct("parent", "external-product-parent");
  await insertProduct("child", "external-product-child");
  await insertVariant("vparent", "parent", "external-variation-parent", "LA-SET");
  await insertVariant("vchild", "child", "external-variation-child", null);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CompositeComponentMirror" ("parentVariantId","componentVariantId","quantity","syncedAt")
     VALUES ($1,$2,1,NOW())`,
    `${PREFIX}-vparent`, `${PREFIX}-vchild`,
  );

  const summary = summarizeMerchantIdentity(await readMerchantIdentityRows(SHOP_ID));

  assert.equal(summary.compositeDeferred, 1);
  assert.equal(summary.emittableStandaloneVariations, 1, "only the parent is emittable");
  assert.equal(summary.mpnReady, true, "the deferred component's missing SKU does not block");
});

test("M1 an inactive product's variations are not counted as emittable", async () => {
  await insertProduct("hidden", "external-product-hidden", false);
  await insertVariant("v1", "hidden", "external-variation-hidden", null);

  const summary = summarizeMerchantIdentity(await readMerchantIdentityRows(SHOP_ID));

  assert.equal(summary.totalVariations, 1);
  assert.equal(summary.emittableStandaloneVariations, 0);
});

/**
 * Half of the durability gate's option 2: the mirror must reconcile rows by the external ids, not by
 * slug, array position or the local row id. This is the part provable without an approved catalog
 * context; the upstream-lifetime half is not, and the verdict stays blocked because of it.
 */
test("M1 the mirror reconciles rows by external identity, not by slug or local id", async () => {
  await insertProduct("p", "external-product-1");
  await insertVariant("v1", "p", "external-variation-1", "LA-A");

  const originalProduct = await prisma.productMirror.findUniqueOrThrow({
    where: { pancakeProductId: "external-product-1" },
    select: { id: true },
  });
  const originalVariant = await prisma.variantMirror.findUniqueOrThrow({
    where: { pancakeVariationId: "external-variation-1" },
    select: { id: true },
  });

  // A resync that renames the product and changes option text must land on the same rows, because
  // the external ids are the reconciliation keys.
  await prisma.productMirror.update({
    where: { pancakeProductId: "external-product-1" },
    data: { slug: `${PREFIX}-p-renamed`, name: "Renamed" },
  });
  await prisma.variantMirror.update({
    where: { pancakeVariationId: "external-variation-1" },
    data: { color: "Changed", size: "XL" },
  });

  assert.equal(
    (await prisma.productMirror.findUniqueOrThrow({
      where: { pancakeProductId: "external-product-1" },
      select: { id: true },
    })).id,
    originalProduct.id,
    "the product row survived a slug and name change",
  );
  assert.equal(
    (await prisma.variantMirror.findUniqueOrThrow({
      where: { pancakeVariationId: "external-variation-1" },
      select: { id: true },
    })).id,
    originalVariant.id,
    "the variant row survived an option text change",
  );

  const summary = summarizeMerchantIdentity(await readMerchantIdentityRows(SHOP_ID));
  assert.equal(summary.durability.mirrorReconcilesByExternalId, true);
  assert.equal(
    summary.durability.verdict,
    "BLOCKED",
    "reconciliation alone is not lifetime durability",
  );
});

test("M1 the audit rejects a malformed shop scope before touching the database", async () => {
  for (const shopId of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(
      () => readMerchantIdentityRows(shopId),
      /positive safe integer/,
      `${shopId} must be rejected`,
    );
  }
});
