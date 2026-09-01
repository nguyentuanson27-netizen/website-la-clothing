import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  await prisma.$executeRaw`DELETE FROM "WarehouseStock" WHERE "id" LIKE ${`${PREFIX}-%`}`;
  await prisma.$executeRaw`DELETE FROM "ProductContent" WHERE "id" LIKE ${`${PREFIX}-%`}`;
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

async function setMoney(suffix: string, retail: number | null, afterDiscount: number | null) {
  await prisma.$executeRawUnsafe(
    `UPDATE "VariantMirror"
     SET "pancakeRetailPrice" = $2, "pancakeRetailPriceAfterDiscount" = $3
     WHERE "id" = $1`,
    `${PREFIX}-${suffix}`, retail, afterDiscount,
  );
}

async function setStock(suffix: string, quantities: readonly number[]) {
  for (const [index, quantity] of quantities.entries()) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "WarehouseStock"
         ("id","variantId","pancakeWarehouseId","quantity","syncedAt","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,NOW(),NOW(),NOW())`,
      `${PREFIX}-stock-${suffix}-${index}`, `${PREFIX}-${suffix}`, `wh-${index}`, quantity,
    );
  }
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

/**
 * Merchant v1 defers *all* composite projections, and a variation sits on one of two sides of the
 * composite graph: it is a set (it has components) or it is a component (it has parents). Deferring
 * only components would let a bundle parent into the emittable set — an offer M3 is not allowed to
 * emit — and make the identity and MPN evidence greener than what can actually be published.
 *
 * All three kinds are seeded together so the counts discriminate: a classification that catches
 * only one side leaves the other in `emittableStandaloneVariations`.
 */
test("M1 both sides of a composite are deferred; only a true standalone is emittable", async () => {
  await insertProduct("alone", "external-product-alone");
  await insertProduct("parent", "external-product-parent");
  await insertProduct("child", "external-product-child");
  await insertVariant("vstandalone", "alone", "external-variation-standalone", "LA-ALONE");
  await insertVariant("vparent", "parent", "external-variation-parent", "LA-SET");
  await insertVariant("vchild", "child", "external-variation-child", null);
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CompositeComponentMirror" ("parentVariantId","componentVariantId","quantity","syncedAt")
     VALUES ($1,$2,1,NOW())`,
    `${PREFIX}-vparent`, `${PREFIX}-vchild`,
  );

  const summary = summarizeMerchantIdentity(await readMerchantIdentityRows(SHOP_ID));

  assert.equal(summary.totalVariations, 3);
  assert.equal(summary.compositeDeferred, 2, "the set and its component are both deferred");
  assert.equal(
    summary.emittableStandaloneVariations,
    1,
    "only the variation on neither side of the composite graph is emittable",
  );
  assert.equal(summary.productIdentifiers.PRESENT, 1, "the deferred families are not counted");
  assert.equal(summary.sku.PRESENT, 1);
  assert.equal(summary.mpnReady, true, "the standalone has a present, unique SKU");
});

/** A set whose SKU is missing must not be able to make MPN readiness look worse either. */
test("M1 a composite set is deferred even when nothing else is composite", async () => {
  await insertProduct("parent", "external-product-parent");
  await insertProduct("child", "external-product-child");
  await insertVariant("vparent", "parent", "external-variation-parent", null);
  await insertVariant("vchild", "child", "external-variation-child", "LA-CHILD");
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CompositeComponentMirror" ("parentVariantId","componentVariantId","quantity","syncedAt")
     VALUES ($1,$2,1,NOW())`,
    `${PREFIX}-vparent`, `${PREFIX}-vchild`,
  );

  const summary = summarizeMerchantIdentity(await readMerchantIdentityRows(SHOP_ID));

  assert.equal(summary.compositeDeferred, 2);
  assert.equal(summary.emittableStandaloneVariations, 0);
  assert.equal(summary.sku.MISSING, 0, "the set's missing SKU is not an emittable-offer problem");
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

/**
 * Same contract as the money audit: M1 evidence is gathered *before* any approved external context
 * exists, so an audit that will not start without a live API key is one the person who needs the
 * evidence cannot run. Spawned rather than imported, because only the process proves what the
 * process requires.
 */
test("M1 the mirror-only identity audit runs with a database and a shop id, and no API key", () => {
  // The documented environment is constructed here rather than inherited: the point is to prove what
  // the contract says is sufficient, which an ambient shop id from some outer config would obscure.
  const { PANCAKE_API_KEY: _removed, ...inherited } = process.env;

  const audit = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/merchant-identity-audit.ts"],
    {
      env: { ...inherited, PANCAKE_SHOP_ID: "920007" },
      encoding: "utf8",
      cwd: process.cwd(),
    },
  );

  assert.equal(
    audit.status,
    0,
    `the audit must not require PANCAKE_API_KEY; stderr was: ${audit.stderr}`,
  );
  assert.match(audit.stdout, /MERCHANT_IDENTITY_AUDIT_BEGIN/);
  assert.match(audit.stdout, /MERCHANT_IDENTITY_AUDIT_END/);
  assert.equal(audit.stderr.includes("PANCAKE_API_KEY"), false);
});

/**
 * M1's verification list names out-of-stock, `PRICE_UNRESOLVED` and malformed text explicitly, and
 * they are checked here rather than only in the domain because the facts have to survive the read:
 * a summed stock quantity, a Draft description that must not count, and a mirrored price shape are
 * all things a repository can get wrong without any classifier noticing.
 */
test("M1 catalog facts are read from the real mirror, including stock, media and published copy", async () => {
  await insertProduct("p", "external-product-1");
  await prisma.$executeRawUnsafe(
    `UPDATE "ProductMirror" SET "primaryImageUrl" = $2 WHERE "id" = $1`,
    `${PREFIX}-p`, "https://content.pancake.vn/catalog/1/2/3/shirt.jpg",
  );
  await insertVariant("v1", "p", "external-variation-1", "LA-A");
  await insertVariant("v2", "p", "external-variation-2", "LA-B");
  await setMoney("v1", 500_000, 500_000);
  // A mirrored discount the website does not honour: no publishable price.
  await setMoney("v2", 500_000, 400_000);
  await setStock("v1", [3, 2]);
  await setStock("v2", []);

  const summary = summarizeMerchantIdentity(await readMerchantIdentityRows(SHOP_ID));

  assert.deepEqual(summary.price, { READY: 1, PRICE_UNRESOLVED: 1 });
  assert.deepEqual(
    summary.availability,
    { IN_STOCK: 1, OUT_OF_STOCK: 1, AVAILABILITY_UNRESOLVED: 0 },
    "stock is summed across warehouses, and no rows means no stock",
  );
  assert.deepEqual(summary.media, { READY: 2, MISSING: 0, UNTRUSTED: 0 });
  assert.deepEqual(summary.title, { READY: 2, MISSING: 0, MALFORMED: 0 });
  assert.deepEqual(
    summary.description,
    { READY: 0, MISSING: 2, MALFORMED: 0 },
    "no ProductContent row at all means no publishable description",
  );
  assert.equal(summary.merchantFactsReady, 0);
});

test("M1 only a PUBLISHED description counts as a Merchant fact", async () => {
  await insertProduct("p", "external-product-1");
  await insertVariant("v1", "p", "external-variation-1", "LA-A");
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ProductContent" ("id","productId","status","editorialDescription","createdAt","updatedAt")
     VALUES ($1,$2,'DRAFT'::"ProductContentStatus",'Ban nhap chua duyet',NOW(),NOW())`,
    `${PREFIX}-content`, `${PREFIX}-p`,
  );

  const draft = summarizeMerchantIdentity(await readMerchantIdentityRows(SHOP_ID));
  assert.deepEqual(
    draft.description,
    { READY: 0, MISSING: 1, MALFORMED: 0 },
    "a Draft is work in progress; auditing it would overstate readiness",
  );

  await prisma.$executeRawUnsafe(
    `UPDATE "ProductContent" SET "status" = 'PUBLISHED'::"ProductContentStatus" WHERE "id" = $1`,
    `${PREFIX}-content`,
  );

  const published = summarizeMerchantIdentity(await readMerchantIdentityRows(SHOP_ID));
  assert.deepEqual(published.description, { READY: 1, MISSING: 0, MALFORMED: 0 });
});

test("M1 malformed mirrored text is reported rather than silently emitted", async () => {
  await insertProduct("p", "external-product-1");
  // A control character that survives the mirror and would break a feed serializer downstream.
  await prisma.$executeRawUnsafe(
    `UPDATE "ProductMirror" SET "name" = 'Ao' || chr(27) || ' so mi' WHERE "id" = $1`,
    `${PREFIX}-p`,
  );
  await insertVariant("v1", "p", "external-variation-1", "LA-A");

  const summary = summarizeMerchantIdentity(await readMerchantIdentityRows(SHOP_ID));

  assert.deepEqual(summary.title, { READY: 0, MISSING: 0, MALFORMED: 1 });
  assert.equal(summary.merchantFactsReady, 0);
  assert.equal(
    JSON.stringify(summary).includes("Ao"),
    false,
    "the offending text is counted, never echoed into the report",
  );
});

test("M1 apparel runtime stays blocked over the real catalog even though the policy is settled", async () => {
  await insertProduct("p", "external-product-1");
  await insertVariant("v1", "p", "external-variation-1", "LA-A");

  const summary = summarizeMerchantIdentity(await readMerchantIdentityRows(SHOP_ID));

  // Neither of these is a fact about the mirror, so no catalog shape can move them: the policy was
  // decided by a human in ADR 0007, and the override runtime either exists or does not.
  assert.deepEqual(summary.apparelFacts, {
    policy: "RESOLVED",
    productOverrides: "NOT_IMPLEMENTED",
    verdict: "BLOCKED",
  });
  assert.equal(summary.durability.verdict, "BLOCKED");
});
