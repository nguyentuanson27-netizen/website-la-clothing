import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.ts";
import {
  disablePromotionCampaign,
  publishPromotionCampaign,
  MAX_EXPANDED_VARIANTS_PER_CAMPAIGN,
  PROMOTION_REVISION_ID,
} from "../../src/commerce/promotion-activation-service.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const ON = { LA_PROMOTION_ACTIVATION_ENABLED: "true" } as const;
const NOW = new Date("2026-09-15T00:00:00.000Z");
const P = "p4-svc";
const SHOP = 920_941;

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM "PromotionTarget" WHERE "id" LIKE ${`${P}-%`}`;
  await prisma.$executeRaw`DELETE FROM "PromotionCampaign" WHERE "id" LIKE ${`${P}-%`}`;
  await prisma.$executeRaw`DELETE FROM "VariantMirror" WHERE "id" LIKE ${`${P}-%`}`;
  await prisma.$executeRaw`DELETE FROM "ProductMirror" WHERE "id" LIKE ${`${P}-%`}`;
}

async function seedCatalog() {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ProductMirror" ("id","pancakeShopId","pancakeProductId","slug","name","syncedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'P4 Product',NOW(),NOW(),NOW())`,
    `${P}-prod`, SHOP, `${P}-prod-ext`, `${P}-prod-slug`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "VariantMirror" ("id","pancakeVariationId","productId","syncedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,NOW(),NOW(),NOW())`,
    `${P}-v1`, `${P}-v1-ext`, `${P}-prod`,
  );
}

async function draft(suffix: string, targetProduct = true) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionCampaign"
       ("id","kind","name","discountType","percentageValue","isEnabled","createdAt","updatedAt")
     VALUES ($1,'PROMOTION'::"PromotionCampaignKind",$2,'PERCENTAGE'::"PromotionDiscountType",10,FALSE,NOW(),NOW())`,
    `${P}-${suffix}`, `Campaign ${suffix}`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionTarget" ("id","campaignId","productId","variantId","createdAt")
     VALUES ($1,$2,$3,$4,NOW())`,
    `${P}-t-${suffix}`, `${P}-${suffix}`,
    targetProduct ? `${P}-prod` : null,
    targetProduct ? null : `${P}-v1`,
  );
}

/** A product with more variants than a coverage-validating write is allowed to expand. */
async function seedWideProduct() {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ProductMirror" ("id","pancakeShopId","pancakeProductId","slug","name","syncedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'P4 Wide Product',NOW(),NOW(),NOW())`,
    `${P}-wide-prod`, SHOP, `${P}-wide-prod-ext`, `${P}-wide-prod-slug`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "VariantMirror" ("id","pancakeVariationId","productId","syncedAt","createdAt","updatedAt")
     SELECT $1 || i, $1 || i || '-ext', $2, NOW(), NOW(), NOW()
     FROM generate_series(1, $3::int) AS i`,
    `${P}-wide-v`, `${P}-wide-prod`, MAX_EXPANDED_VARIANTS_PER_CAMPAIGN + 1,
  );
}

async function draftTargeting(suffix: string, productId: string | null, variantId: string | null) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionCampaign"
       ("id","kind","name","discountType","percentageValue","isEnabled","createdAt","updatedAt")
     VALUES ($1,'PROMOTION'::"PromotionCampaignKind",$2,'PERCENTAGE'::"PromotionDiscountType",10,FALSE,NOW(),NOW())`,
    `${P}-${suffix}`, `Campaign ${suffix}`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionTarget" ("id","campaignId","productId","variantId","createdAt")
     VALUES ($1,$2,$3,$4,NOW())`,
    `${P}-t-${suffix}`, `${P}-${suffix}`, productId, variantId,
  );
}

async function revision(): Promise<bigint> {
  const [row] = await prisma.$queryRaw<Array<{ revision: bigint }>>`
    SELECT "revision" FROM "PromotionPricingRevision" WHERE "id" = ${PROMOTION_REVISION_ID}
  `;
  return row?.revision ?? BigInt(-1);
}

test.beforeEach(async () => { await cleanup(); await seedCatalog(); });
test.afterEach(cleanup);
test.after(async () => { await prisma.$disconnect(); });

test("P4 publishing is refused entirely while the activation gate is off", async () => {
  await draft("a");
  const before = await revision();

  const result = await publishPromotionCampaign({ campaignId: `${P}-a`, now: NOW, env: {} });

  assert.deepEqual(result, { ok: false, failure: { reason: "ACTIVATION_DISABLED" } });
  assert.equal(await revision(), before, "a refused publish advances nothing");
  assert.equal(
    (await prisma.promotionCampaign.findUniqueOrThrow({ where: { id: `${P}-a` } })).isEnabled,
    false,
  );
});

test("P4 a successful publish enables the campaign and advances the revision atomically", async () => {
  await draft("a");
  const before = await revision();

  const result = await publishPromotionCampaign({ campaignId: `${P}-a`, now: NOW, env: ON });

  assert.equal(result.ok, true);
  assert.equal(await revision(), before + BigInt(1));
  const campaign = await prisma.promotionCampaign.findUniqueOrThrow({ where: { id: `${P}-a` } });
  assert.equal(campaign.isEnabled, true);
  assert.deepEqual(campaign.enabledAt, NOW);
  assert.equal(campaign.disabledAt, null);
});

test("P4 a rejected publish leaves both the campaign and the revision untouched", async () => {
  // No targets: invalid for activation.
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionCampaign"
       ("id","kind","name","discountType","percentageValue","isEnabled","createdAt","updatedAt")
     VALUES ($1,'PROMOTION'::"PromotionCampaignKind",'No targets','PERCENTAGE'::"PromotionDiscountType",10,FALSE,NOW(),NOW())`,
    `${P}-empty`,
  );
  const before = await revision();

  const result = await publishPromotionCampaign({ campaignId: `${P}-empty`, now: NOW, env: ON });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.failure.reason, "INVALID_CAMPAIGN");
  assert.equal(await revision(), before, "the revision never moves for a rejected mutation");
  assert.equal(
    (await prisma.promotionCampaign.findUniqueOrThrow({ where: { id: `${P}-empty` } })).isEnabled,
    false,
  );
});

test("P4 two concurrent publishes of overlapping campaigns cannot both succeed", async () => {
  await draft("a");
  await draft("b");
  const before = await revision();

  const [first, second] = await Promise.all([
    publishPromotionCampaign({ campaignId: `${P}-a`, now: NOW, env: ON }),
    publishPromotionCampaign({ campaignId: `${P}-b`, now: NOW, env: ON }),
  ]);

  const succeeded = [first, second].filter((r) => r.ok);
  const failed = [first, second].filter((r) => !r.ok);

  assert.equal(succeeded.length, 1, "exactly one publish may win");
  assert.equal(
    failed[0]?.ok === false && failed[0].failure.reason,
    "OVERLAPPING_CAMPAIGN",
    "the loser is rejected for overlap, not by an arbitrary error",
  );
  assert.equal(await revision(), before + BigInt(1), "only the winning mutation advanced it");
});

/**
 * The deterministic version of the test above.
 *
 * `Promise.all` alone does not prove the lock is doing the work: if one publish happens to commit
 * before the other reaches its overlap query, the second sees the committed state and correctly
 * reports a conflict even with no lock at all. This forces the interleaving that matters.
 *
 * A competing effective mutation is simulated on its own connection: it takes the revision lock and
 * *then* enables a rival campaign. The publish under test must block on that lock before reading
 * anything, so when it proceeds it observes the committed rival and refuses. An implementation that
 * decided overlap before locking would have read a conflict-free world and published anyway.
 */
test("P4 an overlap decision cannot be made before the effective-mutation lock is held", async () => {
  await draft("a");
  await draft("b");

  const competitor = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  let rivalCommitted = false;
  let publishObservedAt: "before rival" | "after rival" | null = null;

  try {
    const rival = competitor.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "revision" FROM "PromotionPricingRevision" WHERE "id" = ${PROMOTION_REVISION_ID} FOR UPDATE`;
      // Hold the lock long enough that the publish under test must be waiting on it.
      await tx.$queryRaw`SELECT pg_sleep(0.5)::text`;
      await tx.promotionCampaign.update({
        where: { id: `${P}-a` },
        data: { isEnabled: true, enabledAt: NOW, disabledAt: null },
      });
      await tx.$executeRaw`
        UPDATE "PromotionPricingRevision" SET "revision" = "revision" + 1, "updatedAt" = NOW()
        WHERE "id" = ${PROMOTION_REVISION_ID}
      `;
      rivalCommitted = true;
    });

    // Give the rival time to take the lock before the publish starts.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const publish = publishPromotionCampaign({ campaignId: `${P}-b`, now: NOW, env: ON }).then(
      (result) => {
        publishObservedAt = rivalCommitted ? "after rival" : "before rival";
        return result;
      },
    );

    const [, result] = await Promise.all([rival, publish]);

    assert.equal(
      publishObservedAt,
      "after rival",
      "the publish must wait for the in-flight effective mutation",
    );
    assert.equal(result.ok, false, "it must not publish over a rival that committed first");
    assert.equal(
      result.ok === false && result.failure.reason,
      "OVERLAPPING_CAMPAIGN",
      "and it must say why",
    );
  } finally {
    await competitor.$disconnect();
  }
});

test("P4 a campaign whose window does not overlap an enabled one may still publish", async () => {
  await draft("a");
  await draft("b");
  await prisma.promotionCampaign.update({
    where: { id: `${P}-a` },
    data: { startsAt: new Date("2026-09-01T00:00:00.000Z"), endsAt: new Date("2026-09-10T00:00:00.000Z") },
  });
  await prisma.promotionCampaign.update({
    where: { id: `${P}-b` },
    // Starts exactly when A ends: half-open windows do not overlap.
    data: { startsAt: new Date("2026-09-10T00:00:00.000Z"), endsAt: new Date("2026-09-20T00:00:00.000Z") },
  });

  assert.equal((await publishPromotionCampaign({ campaignId: `${P}-a`, now: NOW, env: ON })).ok, true);
  assert.equal((await publishPromotionCampaign({ campaignId: `${P}-b`, now: NOW, env: ON })).ok, true);
});

test("P4 a campaign that has already run is terminal and cannot be re-enabled", async () => {
  await draft("a");
  await publishPromotionCampaign({ campaignId: `${P}-a`, now: NOW, env: ON });
  await disablePromotionCampaign({
    campaignId: `${P}-a`,
    now: new Date(NOW.getTime() + 60_000),
  });

  const result = await publishPromotionCampaign({
    campaignId: `${P}-a`,
    now: new Date(NOW.getTime() + 120_000),
    env: ON,
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.failure.reason, "ILLEGAL_TRANSITION");
});

test("P4 disable advances the revision so a cache cannot keep serving stale sale bytes", async () => {
  await draft("a");
  await publishPromotionCampaign({ campaignId: `${P}-a`, now: NOW, env: ON });
  const afterPublish = await revision();

  const result = await disablePromotionCampaign({
    campaignId: `${P}-a`,
    now: new Date(NOW.getTime() + 60_000),
  });

  assert.equal(result.ok, true);
  assert.equal(await revision(), afterPublish + BigInt(1));
  assert.equal(
    (await prisma.promotionCampaign.findUniqueOrThrow({ where: { id: `${P}-a` } })).isEnabled,
    false,
  );
});

test("P4 disable does not depend on the activation gate, so rollback always works", async () => {
  await draft("a");
  await publishPromotionCampaign({ campaignId: `${P}-a`, now: NOW, env: ON });

  // The gate is not consulted at all here: turning it off must never strand an enabled campaign.
  const result = await disablePromotionCampaign({
    campaignId: `${P}-a`,
    now: new Date(NOW.getTime() + 60_000),
  });

  assert.equal(result.ok, true);
});

/**
 * The expansion bound is a safety limit on how much work a coverage-validating write may do. It has
 * to fail the write, not silently validate a truncated coverage set — a truncated set would let an
 * overlapping campaign through because the variants that actually collide were never looked at.
 */
test("P4 a PRODUCT target wider than the expansion bound refuses the publish rather than truncating", async () => {
  await seedWideProduct();
  await draftTargeting("wide", `${P}-wide-prod`, null);
  const before = await revision();

  const result = await publishPromotionCampaign({ campaignId: `${P}-wide`, now: NOW, env: ON });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.failure.reason, "TARGET_EXPANSION_LIMIT_EXCEEDED");
  assert.equal(await revision(), before, "a refused publish advances nothing");
  assert.equal(
    (await prisma.promotionCampaign.findUniqueOrThrow({ where: { id: `${P}-wide` } })).isEnabled,
    false,
  );
});

/**
 * The same bound applies to an *already enabled* competitor, which is reachable in production: a
 * campaign published while its product was small, whose product later grew. Its coverage can no
 * longer be enumerated, so it cannot be proved disjoint. Treating it as non-overlapping would be the
 * unsafe reading — two campaigns could then both price the same variant.
 */
test("P4 an enabled campaign whose coverage cannot be enumerated blocks a publish instead of being waved through", async () => {
  await seedWideProduct();
  await draftTargeting("wide", `${P}-wide-prod`, null);
  // Enabled directly: this is a campaign that was publishable when its product was small.
  await prisma.promotionCampaign.update({
    where: { id: `${P}-wide` },
    data: { isEnabled: true, enabledAt: NOW },
  });
  // Targets a variant of a different product, so it is genuinely disjoint — but unprovably so.
  await draftTargeting("b", null, `${P}-v1`);
  const before = await revision();

  const result = await publishPromotionCampaign({ campaignId: `${P}-b`, now: NOW, env: ON });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.ok === false && result.failure,
    { reason: "OVERLAPPING_CAMPAIGN", conflictingCampaignIds: [`${P}-wide`] },
  );
  assert.equal(await revision(), before);
});

test("P4 an unknown campaign fails closed without advancing the revision", async () => {
  const before = await revision();

  const result = await publishPromotionCampaign({
    campaignId: `${P}-does-not-exist`,
    now: NOW,
    env: ON,
  });

  assert.deepEqual(result, { ok: false, failure: { reason: "CAMPAIGN_NOT_FOUND" } });
  assert.equal(await revision(), before);
});
