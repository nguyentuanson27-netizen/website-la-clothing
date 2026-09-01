import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.ts";
import {
  MAX_CANDIDATE_VARIANTS_PER_LOOKUP,
  readApplicablePromotionCampaigns,
} from "../../src/commerce/promotion-candidate-repository.ts";
import { prisma as sharedPrisma } from "../../src/db/prisma.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const P = "p3-cand";
const SHOP = 920_931;

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM "PromotionTarget" WHERE "id" LIKE ${`${P}-%`}`;
  await prisma.$executeRaw`DELETE FROM "PromotionCampaign" WHERE "id" LIKE ${`${P}-%`}`;
  await prisma.$executeRaw`DELETE FROM "CompositeComponentMirror" WHERE "parentVariantId" LIKE ${`${P}-%`} OR "componentVariantId" LIKE ${`${P}-%`}`;
  await prisma.$executeRaw`DELETE FROM "VariantMirror" WHERE "id" LIKE ${`${P}-%`}`;
  await prisma.$executeRaw`DELETE FROM "ProductMirror" WHERE "id" LIKE ${`${P}-%`}`;
}

async function product(suffix: string) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ProductMirror" ("id","pancakeShopId","pancakeProductId","slug","name","syncedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'P3 Product',NOW(),NOW(),NOW())`,
    `${P}-${suffix}`, SHOP, `${P}-${suffix}-ext`, `${P}-${suffix}-slug`,
  );
}

async function variant(suffix: string, productSuffix: string, present = true, active = true) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "VariantMirror" ("id","pancakeVariationId","productId","isPresent","isActive","syncedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,NOW(),NOW(),NOW())`,
    `${P}-${suffix}`, `${P}-${suffix}-ext`, `${P}-${productSuffix}`, present, active,
  );
}

async function campaign(
  suffix: string,
  opts: Partial<{ isEnabled: boolean; startsAt: string | null; endsAt: string | null }> = {},
) {
  const { isEnabled = true, startsAt = null, endsAt = null } = opts;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionCampaign"
       ("id","kind","name","discountType","percentageValue","isEnabled","enabledAt","startsAt","endsAt","createdAt","updatedAt")
     VALUES ($1,'PROMOTION'::"PromotionCampaignKind",$2,'PERCENTAGE'::"PromotionDiscountType",10,$3,
             CASE WHEN $3 THEN NOW() ELSE NULL END,$4::timestamptz,$5::timestamptz,NOW(),NOW())`,
    `${P}-${suffix}`, `Campaign ${suffix}`, isEnabled, startsAt, endsAt,
  );
}

async function target(suffix: string, campaignSuffix: string, productSuffix: string | null, variantSuffix: string | null) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionTarget" ("id","campaignId","productId","variantId","createdAt")
     VALUES ($1,$2,$3,$4,NOW())`,
    `${P}-${suffix}`, `${P}-${campaignSuffix}`,
    productSuffix ? `${P}-${productSuffix}` : null,
    variantSuffix ? `${P}-${variantSuffix}` : null,
  );
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => { await prisma.$disconnect(); });

test("P3 a direct VARIANT target reaches only that variant", async () => {
  await product("prod");
  await variant("v1", "prod");
  await variant("v2", "prod");
  await campaign("c1");
  await target("t1", "c1", null, "v1");

  const result = await readApplicablePromotionCampaigns({
    variantIds: [`${P}-v1`, `${P}-v2`],
  });

  assert.deepEqual(result.campaignsByVariantId.get(`${P}-v1`)?.map((c) => c.id), [`${P}-c1`]);
  assert.deepEqual(result.campaignsByVariantId.get(`${P}-v2`), []);
});

test("P3 a PRODUCT target covers the product's current variants without a frozen list", async () => {
  await product("prod");
  await variant("v1", "prod");
  await campaign("c1");
  await target("t1", "c1", "prod", null);

  // A variant synced after the campaign was created is covered, because coverage is a join.
  await variant("v-late", "prod");

  const result = await readApplicablePromotionCampaigns({
    variantIds: [`${P}-v1`, `${P}-v-late`],
  });

  assert.deepEqual(result.campaignsByVariantId.get(`${P}-v1`)?.map((c) => c.id), [`${P}-c1`]);
  assert.deepEqual(
    result.campaignsByVariantId.get(`${P}-v-late`)?.map((c) => c.id),
    [`${P}-c1`],
    "a later-synced variant is covered without any re-materialization",
  );
});

test("P3 a restored variant is covered again with no campaign write", async () => {
  await product("prod");
  await variant("v1", "prod", false, false);
  await campaign("c1");
  await target("t1", "c1", "prod", null);

  assert.deepEqual(
    (await readApplicablePromotionCampaigns({ variantIds: [`${P}-v1`] }))
      .campaignsByVariantId.get(`${P}-v1`)?.map((c) => c.id),
    [`${P}-c1`],
  );

  await prisma.variantMirror.update({
    where: { id: `${P}-v1` },
    data: { isPresent: true, isActive: true },
  });

  assert.deepEqual(
    (await readApplicablePromotionCampaigns({ variantIds: [`${P}-v1`] }))
      .campaignsByVariantId.get(`${P}-v1`)?.map((c) => c.id),
    [`${P}-c1`],
  );
});

test("P3 a composite component follows its own owning product, not the parent's campaign", async () => {
  await product("parent");
  await product("child");
  await variant("v-parent", "parent");
  await variant("v-child", "child");
  await prisma.$executeRawUnsafe(
    `INSERT INTO "CompositeComponentMirror" ("parentVariantId","componentVariantId","quantity","syncedAt")
     VALUES ($1,$2,1,NOW())`,
    `${P}-v-parent`, `${P}-v-child`,
  );
  await campaign("c-parent");
  await target("t-parent", "c-parent", "parent", null);

  const result = await readApplicablePromotionCampaigns({
    variantIds: [`${P}-v-parent`, `${P}-v-child`],
  });

  assert.deepEqual(result.campaignsByVariantId.get(`${P}-v-parent`)?.map((c) => c.id), [`${P}-c-parent`]);
  assert.deepEqual(
    result.campaignsByVariantId.get(`${P}-v-child`),
    [],
    "the component's real owner is its own product, so the parent's campaign does not reach it",
  );
});

test("P3 only enabled campaigns are candidates, so a Draft is never storefront-effective", async () => {
  await product("prod");
  await variant("v1", "prod");
  await campaign("c-draft", { isEnabled: false });
  await target("t1", "c-draft", "prod", null);

  const result = await readApplicablePromotionCampaigns({ variantIds: [`${P}-v1`] });

  assert.deepEqual(result.campaignsByVariantId.get(`${P}-v1`), []);
});

test("P3 both a variant and its product target surface as candidates so a conflict is visible", async () => {
  await product("prod");
  await variant("v1", "prod");
  await campaign("c-product");
  await campaign("c-variant");
  await target("t-product", "c-product", "prod", null);
  await target("t-variant", "c-variant", null, "v1");

  const result = await readApplicablePromotionCampaigns({ variantIds: [`${P}-v1`] });

  assert.deepEqual(
    result.campaignsByVariantId.get(`${P}-v1`)?.map((c) => c.id).sort(),
    [`${P}-c-product`, `${P}-c-variant`],
    "the repository never picks a winner; the resolver reports the conflict",
  );
});

test("P3 a campaign covering a variant twice is still one candidate", async () => {
  await product("prod");
  await variant("v1", "prod");
  await campaign("c1");
  await target("t-product", "c1", "prod", null);
  await target("t-variant", "c1", null, "v1");

  const result = await readApplicablePromotionCampaigns({ variantIds: [`${P}-v1`] });

  assert.deepEqual(result.campaignsByVariantId.get(`${P}-v1`)?.map((c) => c.id), [`${P}-c1`]);
});

test("P3 an unknown variant is reported rather than silently returning no promotion", async () => {
  await product("prod");
  await variant("v1", "prod");

  const result = await readApplicablePromotionCampaigns({
    variantIds: [`${P}-v1`, `${P}-does-not-exist`],
  });

  assert.deepEqual(result.unknownVariantIds, [`${P}-does-not-exist`]);
  assert.equal(result.campaignsByVariantId.has(`${P}-does-not-exist`), false);
});

test("P3 the lookup is bounded and rejects an oversized or malformed request", async () => {
  await assert.rejects(
    () => readApplicablePromotionCampaigns({
      variantIds: Array.from({ length: MAX_CANDIDATE_VARIANTS_PER_LOOKUP + 1 }, (_, i) => `v-${i}`),
    }),
    /bounded/,
  );

  assert.deepEqual(
    (await readApplicablePromotionCampaigns({ variantIds: [] })).campaignsByVariantId.size,
    0,
    "an empty request touches the database not at all",
  );
});

test("P3 candidate campaigns carry exactly the facts the pricing resolver needs", async () => {
  await product("prod");
  await variant("v1", "prod");
  await campaign("c1", { startsAt: "2026-09-01T00:00:00.000Z", endsAt: "2026-10-01T00:00:00.000Z" });
  await target("t1", "c1", "prod", null);

  const [candidate] = (await readApplicablePromotionCampaigns({ variantIds: [`${P}-v1`] }))
    .campaignsByVariantId.get(`${P}-v1`) ?? [];

  assert.deepEqual(Object.keys(candidate ?? {}).sort(), [
    "discountType", "endsAt", "fixedPriceVnd", "id", "kind", "name", "percentageValue", "startsAt",
  ]);
  assert.equal(candidate?.percentageValue, 10);
  assert.equal(candidate?.fixedPriceVnd, null);
});

/**
 * P3 asks for a query-count regression, and it is a contract rather than a micro-optimisation: this
 * repository runs on storefront and cart render paths, so an implementation that drifts into a
 * per-variant or per-campaign lookup degrades every product page while every behavioural test stays
 * green.
 *
 * Round-trips are counted by wrapping the client the repository actually uses. The wrapper covers
 * both model delegates it can reach and the raw escape hatches, so a refactor into either shape is
 * still counted; it would not catch a round-trip issued through some third path, which is why the
 * assertion is on *growth* rather than on an exact number alone.
 */
function countRoundTrips() {
  const restore: Array<() => void> = [];
  let count = 0;

  const wrap = (owner: Record<string, unknown>, key: string) => {
    const original = owner[key];
    if (typeof original !== "function") return;
    const previous = original as (...args: unknown[]) => unknown;
    owner[key] = (...args: unknown[]) => {
      count += 1;
      return previous.apply(owner, args);
    };
    restore.push(() => {
      owner[key] = previous;
    });
  };

  const client = sharedPrisma as unknown as Record<string, Record<string, unknown>>;
  wrap(client.variantMirror, "findMany");
  wrap(client.promotionTarget, "findMany");
  wrap(client.promotionCampaign, "findMany");
  for (const raw of ["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"]) {
    wrap(client as unknown as Record<string, unknown> as Record<string, unknown>, raw);
  }

  return {
    get count() {
      return count;
    },
    reset() {
      count = 0;
    },
    restore() {
      for (const undo of restore.splice(0)) undo();
    },
  };
}

test("P3 the candidate lookup issues a constant number of queries whatever the batch size", async () => {
  await product("prod");
  await campaign("c");
  await target("t", "c", "prod", null);
  for (let index = 0; index < 40; index += 1) await variant(`v${index}`, "prod");

  const meter = countRoundTrips();
  try {
    const small = [`${P}-v0`];
    const large = Array.from({ length: 40 }, (_, index) => `${P}-v${index}`);

    meter.reset();
    await readApplicablePromotionCampaigns({ variantIds: small });
    const forOne = meter.count;

    meter.reset();
    await readApplicablePromotionCampaigns({ variantIds: large });
    const forForty = meter.count;

    assert.ok(forOne > 0, "the meter must actually be observing the repository");
    assert.equal(
      forForty,
      forOne,
      `query count grew with batch size (${forOne} -> ${forForty}); the lookup has drifted into N+1`,
    );
    assert.equal(forOne, 2, "one bounded variant read plus one bounded target read");
  } finally {
    meter.restore();
  }
});

test("P3 an empty request touches the database not at all", async () => {
  const meter = countRoundTrips();
  try {
    meter.reset();
    const result = await readApplicablePromotionCampaigns({ variantIds: [] });

    assert.equal(meter.count, 0, "nothing to look up must cost nothing");
    assert.equal(result.campaignsByVariantId.size, 0);
    assert.deepEqual(result.unknownVariantIds, []);
  } finally {
    meter.restore();
  }
});
