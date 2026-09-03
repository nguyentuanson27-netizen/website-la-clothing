/**
 * P4 operations beyond publish/disable, and the authorization boundary in front of all of them.
 *
 * Split from the publish/disable suite because these prove a different property: which mutations are
 * *effective* — that is, which ones must advance the durable pricing revision — and which deliberately
 * must not. Copy and a Draft-only edit change no price anyone can be charged, so advancing the
 * revision for them would invalidate every Merchant cache entry for nothing.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { AuthorizationError } from "../../src/auth/authorization.ts";
import {
  MAX_PROMOTION_IDENTIFIER_LENGTH,
  MAX_TARGETS_PER_CAMPAIGN,
} from "../../src/commerce/promotion-activation.ts";
import { MAX_CAMPAIGN_NAME_LENGTH } from "../../src/commerce/promotion-campaign-name.ts";
import {
  copyPromotionCampaign,
  createDraftPromotionCampaign,
  disablePromotionCampaign,
  editDraftPromotionCampaign,
  editScheduledPromotionCampaign,
  endPromotionCampaignEarly,
  publishPromotionCampaign,
  MAX_EXPANDED_VARIANTS_PER_CAMPAIGN,
  PROMOTION_REVISION_ID,
} from "../../src/commerce/promotion-activation-service.ts";
import { createPromotionAdminRepository } from "../../src/commerce/promotion-admin-repository.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const ON = { LA_PROMOTION_ACTIVATION_ENABLED: "true" } as const;
const NOW = new Date("2026-09-15T00:00:00.000Z");
const P = "p4-ops";
const SHOP = 920_942;

const ADMIN = { user: { id: "admin-1", role: "ADMIN" }, session: { id: "s-1" } } as const;
const STAFF = { user: { id: "staff-1", role: "STAFF" }, session: { id: "s-2" } } as const;

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM "PromotionTarget" WHERE "id" LIKE ${`${P}-%`}`;
  await prisma.$executeRaw`DELETE FROM "PromotionCampaign" WHERE "id" LIKE ${`${P}-%`}`;
  // Copies get generated ids, so they are cleaned by the name this suite gives their sources.
  await prisma.$executeRaw`DELETE FROM "PromotionCampaign" WHERE "name" LIKE 'Campaign %'`;
  await prisma.$executeRaw`DELETE FROM "VariantMirror" WHERE "id" LIKE ${`${P}-%`}`;
  await prisma.$executeRaw`DELETE FROM "ProductMirror" WHERE "id" LIKE ${`${P}-%`}`;
}

async function seedProduct(suffix: string, variantCount: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ProductMirror" ("id","pancakeShopId","pancakeProductId","slug","name","syncedAt","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,'P4 Ops Product',NOW(),NOW(),NOW())`,
    `${P}-${suffix}`, SHOP, `${P}-${suffix}-ext`, `${P}-${suffix}-slug`,
  );
  await addVariants(suffix, 1, variantCount);
}

async function addVariants(suffix: string, from: number, to: number) {
  if (to < from) return;
  // A usable base price is part of the fixture, not decoration: activation refuses a campaign that
  // cannot discount anything, so a variant with no mirrored price is not publishable.
  await prisma.$executeRawUnsafe(
    `INSERT INTO "VariantMirror"
       ("id","pancakeVariationId","productId","pancakeRetailPrice","syncedAt","createdAt","updatedAt")
     SELECT $1 || i, $1 || i || '-ext', $2, 500000, NOW(), NOW(), NOW()
     FROM generate_series($3::int, $4::int) AS i`,
    `${P}-${suffix}-v`, `${P}-${suffix}`, from, to,
  );
}

async function draft(
  suffix: string,
  productSuffix: string,
  window: { startsAt?: Date | null; endsAt?: Date | null } = {},
) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionCampaign"
       ("id","kind","name","discountType","percentageValue","isEnabled","startsAt","endsAt","createdAt","updatedAt")
     VALUES ($1,'PROMOTION'::"PromotionCampaignKind",$2,'PERCENTAGE'::"PromotionDiscountType",10,FALSE,$3,$4,NOW(),NOW())`,
    `${P}-${suffix}`, `Campaign ${suffix}`, window.startsAt ?? null, window.endsAt ?? null,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionTarget" ("id","campaignId","productId","variantId","createdAt")
     VALUES ($1,$2,$3,NULL,NOW())`,
    `${P}-t-${suffix}`, `${P}-${suffix}`, `${P}-${productSuffix}`,
  );
}

async function revision(): Promise<bigint> {
  const [row] = await prisma.$queryRaw<Array<{ revision: bigint }>>`
    SELECT "revision" FROM "PromotionPricingRevision" WHERE "id" = ${PROMOTION_REVISION_ID}
  `;
  return row?.revision ?? BigInt(-1);
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => { await prisma.$disconnect(); });

/* ---------------------------------------------------------------- authorization */

test("P4 every promotion mutation requires an authenticated admin", async () => {
  await seedProduct("prod", 1);
  await draft("a", "prod");
  const before = await revision();

  for (const [label, session] of [["anonymous", null], ["non-admin", STAFF]] as const) {
    const expected = session === null ? "UNAUTHENTICATED" : "FORBIDDEN";
    for (const attempt of [
      () => publishPromotionCampaign({ campaignId: `${P}-a`, now: NOW, env: ON, session }),
      () => disablePromotionCampaign({ campaignId: `${P}-a`, now: NOW, session }),
      () => endPromotionCampaignEarly({ campaignId: `${P}-a`, now: NOW, session }),
      () => editScheduledPromotionCampaign({ campaignId: `${P}-a`, now: NOW, env: ON, session, patch: {} }),
      () => copyPromotionCampaign({ campaignId: `${P}-a`, session }),
      () => editDraftPromotionCampaign({ campaignId: `${P}-a`, now: NOW, session, patch: {} }),
      () => createDraftPromotionCampaign({ name: "Draft", session }),
    ]) {
      await assert.rejects(attempt, (error: unknown) => {
        assert.ok(error instanceof AuthorizationError, `${label}: expected an authorization error`);
        assert.equal(error.code, expected);
        return true;
      });
    }
  }

  assert.equal(await revision(), before, "no unauthorized attempt advanced the revision");
  assert.equal(
    (await prisma.promotionCampaign.findUniqueOrThrow({ where: { id: `${P}-a` } })).isEnabled,
    false,
  );
  assert.equal(await prisma.promotionCampaign.count({ where: { name: { contains: "Bản sao" } } }), 0);
});

/* ---------------------------------------------------------------- expansion bound */

test("P4 a campaign covering exactly the expansion bound publishes; one more does not", async () => {
  await seedProduct("at", MAX_EXPANDED_VARIANTS_PER_CAMPAIGN);
  await seedProduct("over", MAX_EXPANDED_VARIANTS_PER_CAMPAIGN + 1);
  await draft("at", "at");
  await draft("over", "over");

  const atBound = await publishPromotionCampaign({ campaignId: `${P}-at`, now: NOW, env: ON, session: ADMIN });
  assert.equal(atBound.ok, true, "the bound is inclusive: exactly 2000 is allowed");

  const overBound = await publishPromotionCampaign({ campaignId: `${P}-over`, now: NOW, env: ON, session: ADMIN });
  assert.equal(overBound.ok, false);
  assert.equal(overBound.ok === false && overBound.failure.reason, "TARGET_EXPANSION_LIMIT_EXCEEDED");
});

test("P4 disable still succeeds after PRODUCT coverage grows past the expansion bound", async () => {
  await seedProduct("grow", 1900);
  await draft("a", "grow");
  assert.equal(
    (await publishPromotionCampaign({ campaignId: `${P}-a`, now: NOW, env: ON, session: ADMIN })).ok,
    true,
    "1900 variants is publishable",
  );

  // The catalog grows underneath the enabled campaign; its coverage can no longer be expanded.
  await addVariants("grow", 1901, MAX_EXPANDED_VARIANTS_PER_CAMPAIGN + 1);
  const before = await revision();

  const result = await disablePromotionCampaign({
    campaignId: `${P}-a`,
    now: new Date(NOW.getTime() + 60_000),
    session: ADMIN,
  });

  assert.equal(result.ok, true, "rollback must never be the thing that fails");
  assert.equal(await revision(), before + BigInt(1));
});

/* ---------------------------------------------------------------- monotonic revision */

test("P4 concurrent effective mutations advance the revision once each, with no lost increment", async () => {
  const count = 5;
  for (let index = 0; index < count; index += 1) {
    await seedProduct(`p${index}`, 1);
    await draft(`c${index}`, `p${index}`);
  }
  const before = await revision();

  // Disjoint coverage, so every one of them is a legitimate winner: the only thing that can go wrong
  // is a lost increment.
  const results = await Promise.all(
    Array.from({ length: count }, (_, index) =>
      publishPromotionCampaign({ campaignId: `${P}-c${index}`, now: NOW, env: ON, session: ADMIN }),
    ),
  );

  assert.equal(results.filter((result) => result.ok).length, count, "all publishes are legitimate");
  assert.equal(await revision(), before + BigInt(count), "every effective mutation advanced it exactly once");

  const observed = results.flatMap((result) => (result.ok ? [result.revision] : []));
  assert.equal(new Set(observed.map(String)).size, count, "no two mutations reported the same revision");
});

/* ---------------------------------------------------------------- end early */

test("P4 ending a running campaign early is effective and advances the revision", async () => {
  await seedProduct("prod", 1);
  await draft("a", "prod", { endsAt: new Date("2026-10-01T00:00:00.000Z") });
  await publishPromotionCampaign({ campaignId: `${P}-a`, now: NOW, env: ON, session: ADMIN });
  const before = await revision();
  const endedAt = new Date(NOW.getTime() + 60_000);

  const result = await endPromotionCampaignEarly({ campaignId: `${P}-a`, now: endedAt, session: ADMIN });

  assert.equal(result.ok, true);
  assert.equal(await revision(), before + BigInt(1));
  const campaign = await prisma.promotionCampaign.findUniqueOrThrow({ where: { id: `${P}-a` } });
  assert.deepEqual(campaign.endsAt, endedAt, "the window closes now rather than at its configured end");
  assert.equal(campaign.isEnabled, true, "ending early is not disabling; the campaign stays enabled and ends");
});

test("P4 a campaign that is not currently running cannot be ended early", async () => {
  await seedProduct("prod", 1);
  await draft("a", "prod", { startsAt: new Date("2026-10-01T00:00:00.000Z"), endsAt: new Date("2026-10-05T00:00:00.000Z") });
  await publishPromotionCampaign({ campaignId: `${P}-a`, now: NOW, env: ON, session: ADMIN });
  const before = await revision();

  const result = await endPromotionCampaignEarly({ campaignId: `${P}-a`, now: NOW, session: ADMIN });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.failure.reason, "ILLEGAL_TRANSITION");
  assert.equal(await revision(), before);
});

/* ---------------------------------------------------------------- scheduled material edit */

test("P4 a material edit to a Scheduled campaign is effective and re-validated", async () => {
  await seedProduct("prod", 1);
  await draft("a", "prod", { startsAt: new Date("2026-10-01T00:00:00.000Z"), endsAt: new Date("2026-10-05T00:00:00.000Z") });
  await publishPromotionCampaign({ campaignId: `${P}-a`, now: NOW, env: ON, session: ADMIN });
  const before = await revision();

  const result = await editScheduledPromotionCampaign({
    campaignId: `${P}-a`,
    now: NOW,
    env: ON,
    session: ADMIN,
    patch: { percentageValue: 25 },
  });

  assert.equal(result.ok, true);
  assert.equal(await revision(), before + BigInt(1), "a scheduled edit changes future prices, so it is effective");
  assert.equal(
    (await prisma.promotionCampaign.findUniqueOrThrow({ where: { id: `${P}-a` } })).percentageValue,
    25,
  );
});

test("P4 a scheduled edit that would become invalid is refused with nothing written", async () => {
  await seedProduct("prod", 1);
  await draft("a", "prod", { startsAt: new Date("2026-10-01T00:00:00.000Z"), endsAt: new Date("2026-10-05T00:00:00.000Z") });
  await publishPromotionCampaign({ campaignId: `${P}-a`, now: NOW, env: ON, session: ADMIN });
  const before = await revision();

  const result = await editScheduledPromotionCampaign({
    campaignId: `${P}-a`,
    now: NOW,
    env: ON,
    session: ADMIN,
    patch: { percentageValue: 0 },
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.failure.reason, "INVALID_CAMPAIGN");
  assert.equal(await revision(), before);
  assert.equal(
    (await prisma.promotionCampaign.findUniqueOrThrow({ where: { id: `${P}-a` } })).percentageValue,
    10,
    "the original value survives a refused edit",
  );
});

test("P4 a scheduled edit that would move a window onto an enabled rival is refused for overlap", async () => {
  await seedProduct("prod", 1);
  await draft("a", "prod", { startsAt: new Date("2026-10-01T00:00:00.000Z"), endsAt: new Date("2026-10-05T00:00:00.000Z") });
  await draft("b", "prod", { startsAt: new Date("2026-11-01T00:00:00.000Z"), endsAt: new Date("2026-11-05T00:00:00.000Z") });
  await publishPromotionCampaign({ campaignId: `${P}-a`, now: NOW, env: ON, session: ADMIN });
  await publishPromotionCampaign({ campaignId: `${P}-b`, now: NOW, env: ON, session: ADMIN });
  const before = await revision();

  const result = await editScheduledPromotionCampaign({
    campaignId: `${P}-b`,
    now: NOW,
    env: ON,
    session: ADMIN,
    // Moved back onto A's window, over the same product.
    patch: { startsAt: new Date("2026-10-02T00:00:00.000Z"), endsAt: new Date("2026-10-06T00:00:00.000Z") },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(
    result.ok === false && result.failure,
    { reason: "OVERLAPPING_CAMPAIGN", conflictingCampaignIds: [`${P}-a`] },
  );
  assert.equal(await revision(), before);
});

test("P4 a running campaign is not editable through the scheduled-edit path", async () => {
  await seedProduct("prod", 1);
  await draft("a", "prod");
  await publishPromotionCampaign({ campaignId: `${P}-a`, now: NOW, env: ON, session: ADMIN });

  const result = await editScheduledPromotionCampaign({
    campaignId: `${P}-a`,
    now: NOW,
    env: ON,
    session: ADMIN,
    patch: { percentageValue: 25 },
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.failure.reason, "ILLEGAL_TRANSITION");
});

/* ---------------------------------------------------------------- non-effective mutations */

test("P4 Copy produces a Draft and does not advance the revision", async () => {
  await seedProduct("prod", 3);
  await draft("a", "prod");
  const before = await revision();

  const result = await copyPromotionCampaign({ campaignId: `${P}-a`, session: ADMIN });

  assert.equal(result.ok, true);
  assert.equal(await revision(), before, "a Draft is not storefront-effective, so nothing is invalidated");

  const copy = await prisma.promotionCampaign.findUniqueOrThrow({
    where: { id: result.ok ? result.campaignId : "" },
    include: { targets: true },
  });
  assert.equal(copy.isEnabled, false);
  assert.equal(copy.enabledAt, null);
  assert.equal(copy.disabledAt, null);
  assert.equal(copy.name, "Campaign a - Bản sao");
});

/**
 * The fixture is deliberately *under* the expansion bound. Copying a wide product would let an
 * expanding implementation off the hook — expansion refuses past the bound, so it would decline to
 * expand and the copy would come out looking correct for the wrong reason.
 */
test("P4 Copy carries target rows across without expanding PRODUCT coverage", async () => {
  await seedProduct("prod", 3);
  await draft("a", "prod");

  const result = await copyPromotionCampaign({ campaignId: `${P}-a`, session: ADMIN });
  assert.equal(result.ok, true);

  const copy = await prisma.promotionCampaign.findUniqueOrThrow({
    where: { id: result.ok ? result.campaignId : "" },
    include: { targets: true },
  });
  assert.equal(copy.targets.length, 1, "one PRODUCT row, not one row per covered variant");
  assert.equal(copy.targets[0]?.productId, `${P}-prod`);
  assert.equal(copy.targets[0]?.variantId, null);
});

/** Copy must stay available for exactly the campaign that can no longer be published or edited. */
test("P4 Copy still works when the source campaign's coverage exceeds the expansion bound", async () => {
  await seedProduct("wide", MAX_EXPANDED_VARIANTS_PER_CAMPAIGN + 1);
  await draft("a", "wide");
  const before = await revision();

  const result = await copyPromotionCampaign({ campaignId: `${P}-a`, session: ADMIN });

  assert.equal(result.ok, true, "Copy is non-expanding, so the bound cannot block it");
  assert.equal(await revision(), before);
  const copy = await prisma.promotionCampaign.findUniqueOrThrow({
    where: { id: result.ok ? result.campaignId : "" },
    include: { targets: true },
  });
  assert.equal(copy.targets.length, 1);
});

test("P4 a Draft-only edit does not advance the revision", async () => {
  await seedProduct("prod", 1);
  await draft("a", "prod");
  const before = await revision();

  const result = await editDraftPromotionCampaign({
    campaignId: `${P}-a`,
    now: NOW,
    session: ADMIN,
    // Deliberately invalid: a Draft may be saved incomplete.
    patch: { percentageValue: null, name: "Half-finished draft" },
  });

  assert.equal(result.ok, true);
  assert.equal(await revision(), before, "editing a Draft charges nobody anything");
  const campaign = await prisma.promotionCampaign.findUniqueOrThrow({ where: { id: `${P}-a` } });
  assert.equal(campaign.percentageValue, null);
  assert.equal(campaign.name, "Half-finished draft");
});

test("P4 an enabled campaign cannot be edited through the Draft path", async () => {
  await seedProduct("prod", 1);
  await draft("a", "prod");
  await publishPromotionCampaign({ campaignId: `${P}-a`, now: NOW, env: ON, session: ADMIN });

  const result = await editDraftPromotionCampaign({
    campaignId: `${P}-a`,
    now: NOW,
    session: ADMIN,
    patch: { percentageValue: 25 },
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.failure.reason, "ILLEGAL_TRANSITION");
});

/* ---------------------------------------------------------------- P5b create / edit / repository */

test("P5b createDraftPromotionCampaign creates a Draft and does not advance the revision", async () => {
  await seedProduct("prod", 2);
  const before = await revision();

  const result = await createDraftPromotionCampaign({
    name: "Chiến dịch Thu Đông",
    kind: "PROMOTION",
    discountType: "PERCENTAGE",
    percentageValue: 20,
    targets: [{ productId: `${P}-prod`, variantId: null }],
    session: ADMIN,
  });

  assert.equal(result.ok, true);
  assert.equal(await revision(), before, "creating a Draft charges nobody, so the revision is untouched");

  const createdId = result.ok ? result.campaignId : "";
  const campaign = await prisma.promotionCampaign.findUniqueOrThrow({
    where: { id: createdId },
    include: { targets: true },
  });

  assert.equal(campaign.name, "Chiến dịch Thu Đông");
  assert.equal(campaign.isEnabled, false);
  assert.equal(campaign.enabledAt, null);
  assert.equal(campaign.disabledAt, null);
  assert.equal(campaign.percentageValue, 20);
  assert.equal(campaign.targets.length, 1);
  assert.equal(campaign.targets[0]?.productId, `${P}-prod`);
  assert.equal(campaign.targets[0]?.variantId, null);

  await prisma.promotionTarget.deleteMany({ where: { campaignId: createdId } });
  await prisma.promotionCampaign.delete({ where: { id: createdId } });
});

test("P5b createDraftPromotionCampaign rejects invalid draft input (oversized name, too many targets, invalid target scope)", async () => {
  const before = await revision();

  const oversizedName = await createDraftPromotionCampaign({
    name: "a".repeat(MAX_CAMPAIGN_NAME_LENGTH + 1),
    session: ADMIN,
  });
  assert.equal(oversizedName.ok, false);
  assert.equal(oversizedName.ok === false && oversizedName.failure.reason, "INVALID_DRAFT_INPUT");

  const invalidScope = await createDraftPromotionCampaign({
    name: "Bad Scope",
    targets: [{ productId: null, variantId: null }],
    session: ADMIN,
  });
  assert.equal(invalidScope.ok, false);
  assert.equal(invalidScope.ok === false && invalidScope.failure.reason, "INVALID_DRAFT_INPUT");

  const overTargets = await createDraftPromotionCampaign({
    name: "Too Many Targets",
    targets: Array.from({ length: MAX_TARGETS_PER_CAMPAIGN + 1 }, (_, i) => ({
      productId: `p-${i}`,
      variantId: null,
    })),
    session: ADMIN,
  });
  assert.equal(overTargets.ok, false);
  assert.equal(overTargets.ok === false && overTargets.failure.reason, "INVALID_DRAFT_INPUT");

  assert.equal(await revision(), before);
});

test("P5b createDraftPromotionCampaign and editDraftPromotionCampaign reject duplicate targets with typed DUPLICATE_TARGET", async () => {
  await seedProduct("prod", 1);
  const before = await revision();

  const createDuplicate = await createDraftPromotionCampaign({
    name: "Duplicate Targets",
    targets: [
      { productId: `${P}-prod`, variantId: null },
      { productId: `${P}-prod`, variantId: null },
    ],
    session: ADMIN,
  });
  assert.equal(createDuplicate.ok, false);
  assert.equal(createDuplicate.ok === false && createDuplicate.failure.reason, "DUPLICATE_TARGET");

  await draft("dup-test", "prod");
  const editDuplicate = await editDraftPromotionCampaign({
    campaignId: `${P}-dup-test`,
    now: NOW,
    session: ADMIN,
    patch: {
      targets: [
        { productId: `${P}-prod`, variantId: null },
        { productId: `${P}-prod`, variantId: null },
      ],
    },
  });
  assert.equal(editDuplicate.ok, false);
  assert.equal(editDuplicate.ok === false && editDuplicate.failure.reason, "DUPLICATE_TARGET");

  assert.equal(await revision(), before);
});

test("P5b repository listRelatedCampaignsForProduct identifies direct product targets and variant targets with bounded query", async () => {
  await seedProduct("rel-p1", 2);
  await seedProduct("rel-p2", 2);

  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionCampaign"
       ("id","kind","name","discountType","percentageValue","isEnabled","createdAt","updatedAt")
     VALUES ($1,'PROMOTION'::"PromotionCampaignKind",'C1 Product Level','PERCENTAGE'::"PromotionDiscountType",10,FALSE,NOW(),NOW())`,
    `${P}-c1-prod`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionTarget" ("id","campaignId","productId","variantId","createdAt")
     VALUES ($1,$2,$3,NULL,NOW())`,
    `${P}-t-c1`, `${P}-c1-prod`, `${P}-rel-p1`,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionCampaign"
       ("id","kind","name","discountType","percentageValue","isEnabled","createdAt","updatedAt")
     VALUES ($1,'FLASH_SALE'::"PromotionCampaignKind",'C2 Variant Level','PERCENTAGE'::"PromotionDiscountType",20,FALSE,NOW(),NOW())`,
    `${P}-c2-var`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionTarget" ("id","campaignId","productId","variantId","createdAt")
     VALUES ($1,$2,NULL,$3,NOW())`,
    `${P}-t-c2`, `${P}-c2-var`, `${P}-rel-p1-v1`,
  );

  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionCampaign"
       ("id","kind","name","discountType","percentageValue","isEnabled","createdAt","updatedAt")
     VALUES ($1,'PROMOTION'::"PromotionCampaignKind",'C3 Unrelated','PERCENTAGE'::"PromotionDiscountType",15,FALSE,NOW(),NOW())`,
    `${P}-c3-other`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionTarget" ("id","campaignId","productId","variantId","createdAt")
     VALUES ($1,$2,$3,NULL,NOW())`,
    `${P}-t-c3`, `${P}-c3-other`, `${P}-rel-p2`,
  );

  const repository = createPromotionAdminRepository(prisma);
  const related = await repository.listRelatedCampaignsForProduct({
    productId: `${P}-rel-p1`,
    variantIds: [`${P}-rel-p1-v1`, `${P}-rel-p1-v2`],
  });

  assert.equal(related.length, 2, "only campaigns targeting this product or its variants are returned");
  const c1 = related.find((r) => r.id === `${P}-c1-prod`);
  assert.ok(c1, "direct product target campaign is found");
  assert.equal(c1?.targetScope, "PRODUCT");
  assert.equal(c1?.status, "DRAFT");

  const c2 = related.find((r) => r.id === `${P}-c2-var`);
  assert.ok(c2, "direct variant target campaign is found");
  assert.equal(c2?.targetScope, "VARIANT");
  assert.equal(c2?.kind, "FLASH_SALE");

  const c3 = related.find((r) => r.id === `${P}-c3-other`);
  assert.equal(c3, undefined, "unrelated campaign is excluded");
});

test("P5b repository getCampaignForEdit loads campaign and target labels without variant expansion", async () => {
  await seedProduct("edit-p", 2);
  await draft("edit-load", "edit-p");

  const repository = createPromotionAdminRepository(prisma);
  const campaign = await repository.getCampaignForEdit(`${P}-edit-load`, NOW);

  assert.ok(campaign);
  assert.equal(campaign.name, "Campaign edit-load");
  assert.equal(campaign.status, "DRAFT");
  assert.equal(campaign.targets.length, 1);
  assert.equal(campaign.targets[0]?.scope, "PRODUCT");
  assert.equal(campaign.targets[0]?.productId, `${P}-edit-p`);
  assert.equal(campaign.targets[0]?.label, "P4 Ops Product");
});

/* ---------------------------------------------------------------- expired window */

test("P4 a campaign whose window has already closed cannot be published", async () => {
  await seedProduct("prod", 1);
  await draft("a", "prod", {
    startsAt: new Date("2026-08-01T00:00:00.000Z"),
    endsAt: new Date("2026-08-10T00:00:00.000Z"),
  });
  const before = await revision();

  const result = await publishPromotionCampaign({ campaignId: `${P}-a`, now: NOW, env: ON, session: ADMIN });

  assert.equal(result.ok, false, "enabling a campaign that can never run is an admin mistake, not a no-op");
  assert.equal(result.ok === false && result.failure.reason, "INVALID_CAMPAIGN");
  assert.equal(await revision(), before);
  assert.equal(
    (await prisma.promotionCampaign.findUniqueOrThrow({ where: { id: `${P}-a` } })).isEnabled,
    false,
  );
});

/* ---------------------------------------------------------- Draft input bounds and concurrency */

/**
 * "A Draft may be business-invalid" is not "a Draft may be anything".
 *
 * The reviewed bounds reject syntactically oversized names, identifiers and target arrays *before
 * persistence, Draft included* — those are storage and input-surface limits, not opinions about
 * whether a campaign makes commercial sense. Skipping them on the Draft path means the only thing
 * standing between browser input and the table is whatever the database happens to reject.
 */
test("P4 a Draft edit rejects an oversized name before it reaches the database", async () => {
  await seedProduct("prod", 1);
  await draft("a", "prod");

  const result = await editDraftPromotionCampaign({
    campaignId: `${P}-a`,
    now: NOW,
    session: ADMIN,
    patch: { name: "n".repeat(MAX_CAMPAIGN_NAME_LENGTH + 1) },
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.failure.reason, "INVALID_DRAFT_INPUT");
  assert.equal(
    (await prisma.promotionCampaign.findUniqueOrThrow({ where: { id: `${P}-a` } })).name,
    "Campaign a",
    "nothing is written when the input is refused",
  );
});

test("P4 a Draft edit accepts a name exactly at the bound", async () => {
  await seedProduct("prod", 1);
  await draft("a", "prod");
  const atBound = "n".repeat(MAX_CAMPAIGN_NAME_LENGTH);

  const result = await editDraftPromotionCampaign({
    campaignId: `${P}-a`, now: NOW, session: ADMIN, patch: { name: atBound },
  });

  assert.equal(result.ok, true, "the bound is inclusive");
  assert.equal(
    (await prisma.promotionCampaign.findUniqueOrThrow({ where: { id: `${P}-a` } })).name,
    atBound,
  );
});

test("P4 a Draft edit rejects more explicit targets than the bound allows", async () => {
  await seedProduct("prod", 1);
  await draft("a", "prod");

  const overBound = await editDraftPromotionCampaign({
    campaignId: `${P}-a`,
    now: NOW,
    session: ADMIN,
    patch: {
      targets: Array.from({ length: MAX_TARGETS_PER_CAMPAIGN + 1 }, (_, index) => ({
        productId: `${P}-p${index}`,
        variantId: null,
      })),
    },
  });

  assert.equal(overBound.ok, false);
  assert.equal(overBound.ok === false && overBound.failure.reason, "INVALID_DRAFT_INPUT");
  assert.equal(
    await prisma.promotionTarget.count({ where: { campaignId: `${P}-a` } }),
    1,
    "the existing targets are untouched",
  );
});

test("P4 a Draft edit rejects an oversized identifier before any lookup", async () => {
  await seedProduct("prod", 1);
  await draft("a", "prod");

  const result = await editDraftPromotionCampaign({
    campaignId: `${P}-a`,
    now: NOW,
    session: ADMIN,
    patch: { targets: [{ productId: "p".repeat(MAX_PROMOTION_IDENTIFIER_LENGTH + 1), variantId: null }] },
  });

  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.failure.reason, "INVALID_DRAFT_INPUT");
});

/**
 * The Draft path used to read the lifecycle, decide "this is a Draft", and then write by id with
 * nothing holding that fact still.
 *
 * A publish committing in between turns the campaign into an enabled one, and the Draft write then
 * lands a material change — discount, window, targets — on a campaign buyers are being priced
 * against, with no activation validation and no revision advance. That is a lost update against the
 * durable pricing contract, not merely an odd sequence.
 *
 * The competing publish is forced to commit first by holding the campaign row on its own connection.
 */
test("P4 a Draft edit cannot land on a campaign a concurrent publish has enabled", async () => {
  await seedProduct("prod", 1);
  await draft("a", "prod");

  const rival = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  let publishCommitted = false;

  try {
    const publish = rival.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "revision" FROM "PromotionPricingRevision" WHERE "id" = ${PROMOTION_REVISION_ID} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "PromotionCampaign" WHERE "id" = ${`${P}-a`} FOR UPDATE`;
      await tx.$queryRaw`SELECT pg_sleep(0.5)::text`;
      await tx.promotionCampaign.update({
        where: { id: `${P}-a` },
        data: { isEnabled: true, enabledAt: NOW, disabledAt: null },
      });
      await tx.$executeRaw`
        UPDATE "PromotionPricingRevision" SET "revision" = "revision" + 1, "updatedAt" = NOW()
        WHERE "id" = ${PROMOTION_REVISION_ID}
      `;
      publishCommitted = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    const edit = editDraftPromotionCampaign({
      campaignId: `${P}-a`,
      now: NOW,
      session: ADMIN,
      patch: { percentageValue: 90 },
    });

    const [, result] = await Promise.all([publish, edit]);

    assert.equal(publishCommitted, true);
    assert.equal(result.ok, false, "the campaign is no longer a Draft by the time the write runs");
    assert.equal(result.ok === false && result.failure.reason, "ILLEGAL_TRANSITION");
    assert.equal(
      (await prisma.promotionCampaign.findUniqueOrThrow({ where: { id: `${P}-a` } })).percentageValue,
      10,
      "no material change reached the enabled campaign",
    );
  } finally {
    await rival.$disconnect();
  }
});

/* --------------------------------------------------- top-level identifier bound and lock ordering */

/**
 * `campaignId` is browser-supplied on every operation, and the 128-code-unit bound applies to it as
 * much as to a target identifier — before any lookup. Otherwise an unbounded string reaches a
 * transaction and a `FOR UPDATE` as a query parameter, which is exactly what the pre-lookup bound
 * exists to prevent.
 */
test("P4 every operation bounds the campaign id before it reaches the database", async () => {
  const oversized = "c".repeat(MAX_PROMOTION_IDENTIFIER_LENGTH + 1);
  const before = await revision();

  const attempts = [
    ["publish", () => publishPromotionCampaign({ campaignId: oversized, now: NOW, env: ON, session: ADMIN })],
    ["disable", () => disablePromotionCampaign({ campaignId: oversized, now: NOW, session: ADMIN })],
    ["end early", () => endPromotionCampaignEarly({ campaignId: oversized, now: NOW, session: ADMIN })],
    ["scheduled edit", () => editScheduledPromotionCampaign({ campaignId: oversized, now: NOW, env: ON, session: ADMIN, patch: {} })],
    ["draft edit", () => editDraftPromotionCampaign({ campaignId: oversized, now: NOW, session: ADMIN, patch: {} })],
    ["copy", () => copyPromotionCampaign({ campaignId: oversized, session: ADMIN })],
  ] as const;

  for (const [label, attempt] of attempts) {
    const result = await attempt();
    assert.equal(result.ok, false, `${label} must refuse an oversized campaign id`);
    assert.equal(
      result.ok === false && result.failure.reason,
      "INVALID_DRAFT_INPUT",
      `${label} must refuse it as bounded input, not as a missing campaign`,
    );
  }

  assert.equal(await revision(), before);
});

test("P4 a campaign id exactly at the bound is accepted and looked up normally", async () => {
  const atBound = `${P}-${"c".repeat(MAX_PROMOTION_IDENTIFIER_LENGTH - P.length - 1)}`;
  assert.equal(atBound.length, MAX_PROMOTION_IDENTIFIER_LENGTH);

  const result = await publishPromotionCampaign({
    campaignId: atBound, now: NOW, env: ON, session: ADMIN,
  });

  assert.equal(result.ok, false);
  assert.equal(
    result.ok === false && result.failure.reason,
    "CAMPAIGN_NOT_FOUND",
    "the bound is inclusive: it reaches the lookup and simply does not exist",
  );
});

/**
 * `validateEffectiveState` documents that the caller has already locked the campaign row, and the
 * Scheduled edit relies on that precondition to re-read the campaign it validates. Disable and
 * end-early lock it too: the source contract puts the campaign-row lock after authorization for
 * them as well, and it is what stops two rollbacks from interleaving on the same row.
 *
 * A competing writer is forced to commit first by holding the campaign row on its own connection and
 * then disabling the campaign. Merely observing that the operation *finishes* after the holder
 * commits proves nothing — the final UPDATE blocks on the row lock either way. What separates a
 * locked implementation from an unlocked one is which state the *decision* was made on: without the
 * lock, the plain read sees the pre-commit snapshot and the operation proceeds against a campaign
 * that no longer exists in that state.
 */
for (const [label, window, run] of [
  [
    "scheduled edit",
    { startsAt: new Date("2026-10-01T00:00:00.000Z"), endsAt: new Date("2026-10-05T00:00:00.000Z") },
    (id: string) => editScheduledPromotionCampaign({
      campaignId: id, now: NOW, env: ON, session: ADMIN, patch: { percentageValue: 25 },
    }),
  ],
  [
    "disable",
    { endsAt: new Date("2026-12-01T00:00:00.000Z") },
    (id: string) => disablePromotionCampaign({ campaignId: id, now: NOW, session: ADMIN }),
  ],
  [
    "end early",
    { endsAt: new Date("2026-12-01T00:00:00.000Z") },
    (id: string) => endPromotionCampaignEarly({
      campaignId: id, now: new Date(NOW.getTime() + 60_000), session: ADMIN,
    }),
  ],
] as const) {
  test(`P4 ${label} decides on campaign state read under the row lock`, async () => {
    await seedProduct("prod", 1);
    await draft("a", "prod", window);
    assert.equal(
      (await publishPromotionCampaign({ campaignId: `${P}-a`, now: NOW, env: ON, session: ADMIN })).ok,
      true,
    );

    const rival = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    let rivalCommitted = false;

    try {
      const disableFirst = rival.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "PromotionCampaign" WHERE "id" = ${`${P}-a`} FOR UPDATE`;
        await tx.$queryRaw`SELECT pg_sleep(0.5)::text`;
        await tx.promotionCampaign.update({
          where: { id: `${P}-a` },
          data: { isEnabled: false, disabledAt: NOW },
        });
        rivalCommitted = true;
      });

      await new Promise((resolve) => setTimeout(resolve, 100));
      const [, result] = await Promise.all([disableFirst, run(`${P}-a`)]);

      assert.equal(rivalCommitted, true);
      assert.equal(
        result.ok,
        false,
        `${label} acted on a campaign state that was already gone when it committed`,
      );
      assert.equal(
        result.ok === false && result.failure.reason,
        "ILLEGAL_TRANSITION",
        `${label} must observe the committed state, not the snapshot it read first`,
      );
    } finally {
      await rival.$disconnect();
    }
  });
}

test("Finding 3 Case A: campaign with 50+ variant targets does not crowd out another related campaign", async () => {
  const pId = "crowd-p";
  await seedProduct(pId, 55);

  // Campaign A: 55 variant targets
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionCampaign"
       ("id","kind","name","discountType","percentageValue","isEnabled","createdAt","updatedAt")
     VALUES ($1,'PROMOTION'::"PromotionCampaignKind",'Campaign A Many Targets','PERCENTAGE'::"PromotionDiscountType",10,FALSE,NOW(),NOW())`,
    `${P}-camp-a-many`,
  );
  for (let i = 1; i <= 55; i++) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PromotionTarget" ("id","campaignId","productId","variantId","createdAt")
       VALUES ($1,$2,NULL,$3,NOW())`,
      `${P}-t-a-${i}`, `${P}-camp-a-many`, `${P}-${pId}-v${i}`,
    );
  }

  // Campaign B: 1 product target
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionCampaign"
       ("id","kind","name","discountType","percentageValue","isEnabled","createdAt","updatedAt")
     VALUES ($1,'PROMOTION'::"PromotionCampaignKind",'Campaign B Direct Product','PERCENTAGE'::"PromotionDiscountType",15,FALSE,NOW(),NOW())`,
    `${P}-camp-b-prod`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionTarget" ("id","campaignId","productId","variantId","createdAt")
     VALUES ($1,$2,$3,NULL,NOW())`,
    `${P}-t-b-prod`, `${P}-camp-b-prod`, `${P}-${pId}`,
  );

  const repository = createPromotionAdminRepository(prisma);
  const variantIds = Array.from({ length: 55 }, (_, i) => `${P}-${pId}-v${i + 1}`);
  const related = await repository.listRelatedCampaignsForProduct({
    productId: `${P}-${pId}`,
    variantIds,
    limit: 50,
  });

  // BOTH campaigns must be present! Campaign A's 55 targets must not truncate Campaign B
  assert.ok(related.length >= 2, "both campaigns must be found even when one has 50+ variant targets");
  const foundA = related.find((r) => r.id === `${P}-camp-a-many`);
  const foundB = related.find((r) => r.id === `${P}-camp-b-prod`);
  assert.ok(foundA, "Campaign A with 55 variant targets is returned");
  assert.equal(foundA?.targetScope, "VARIANT");
  assert.ok(foundB, "Campaign B is returned and not crowded out");
  assert.equal(foundB?.targetScope, "PRODUCT");
});

test("Finding 3 Case B: campaign targeting both product and variant classifies as BOTH", async () => {
  const pId = "both-p";
  await seedProduct(pId, 2);

  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionCampaign"
       ("id","kind","name","discountType","percentageValue","isEnabled","createdAt","updatedAt")
     VALUES ($1,'PROMOTION'::"PromotionCampaignKind",'Campaign Both Scopes','PERCENTAGE'::"PromotionDiscountType",20,FALSE,NOW(),NOW())`,
    `${P}-camp-both`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionTarget" ("id","campaignId","productId","variantId","createdAt")
     VALUES ($1,$2,$3,NULL,NOW())`,
    `${P}-t-both-prod`, `${P}-camp-both`, `${P}-${pId}`,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionTarget" ("id","campaignId","productId","variantId","createdAt")
     VALUES ($1,$2,NULL,$3,NOW())`,
    `${P}-t-both-var`, `${P}-camp-both`, `${P}-${pId}-v1`,
  );

  const repository = createPromotionAdminRepository(prisma);
  const related = await repository.listRelatedCampaignsForProduct({
    productId: `${P}-${pId}`,
    variantIds: [`${P}-${pId}-v1`, `${P}-${pId}-v2`],
  });

  const foundBoth = related.find((r) => r.id === `${P}-camp-both`);
  assert.ok(foundBoth, "campaign targeting both product and variant is returned");
  assert.equal(foundBoth?.targetScope, "BOTH", "targetScope must be classified as BOTH");
});

test("Finding 3 Case C: >50 related campaigns are bounded and deterministically ordered", async () => {
  const pId = "bounded-p";
  await seedProduct(pId, 1);

  // Insert 55 campaigns with distinct createdAt timestamps
  for (let i = 1; i <= 55; i++) {
    const pad = String(i).padStart(3, "0");
    const seconds = 1000 + i;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PromotionCampaign"
         ("id","kind","name","discountType","percentageValue","isEnabled","createdAt","updatedAt")
       VALUES ($1,'PROMOTION'::"PromotionCampaignKind",$2,'PERCENTAGE'::"PromotionDiscountType",10,FALSE,
               ('2026-09-01T00:00:00.000Z'::timestamptz + make_interval(secs => $3)),NOW())`,
      `${P}-bounded-${pad}`, `Bounded Campaign ${pad}`, seconds,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PromotionTarget" ("id","campaignId","productId","variantId","createdAt")
       VALUES ($1,$2,$3,NULL,NOW())`,
      `${P}-t-bnd-${pad}`, `${P}-bounded-${pad}`, `${P}-${pId}`,
    );
  }

  const repository = createPromotionAdminRepository(prisma);
  const related = await repository.listRelatedCampaignsForProduct({
    productId: `${P}-${pId}`,
    limit: 50,
  });

  assert.equal(related.length, 50, "result is capped at 50 campaigns");
  // Check deterministic order: createdAt desc -> campaign 055 should be first, 006 should be 50th
  assert.equal(related[0]?.id, `${P}-bounded-055`, "most recent campaign is first");
  assert.equal(related[49]?.id, `${P}-bounded-006`, "50th campaign is 006");
});

test("Finding 1 regression: createDraftPromotionCampaign refuses oversized target ID and writes nothing", async () => {
  const oversizedId = "prod-".concat("x".repeat(150));
  const beforeCampaignCount = await prisma.promotionCampaign.count();
  const beforeTargetCount = await prisma.promotionTarget.count();

  const outcome = await createDraftPromotionCampaign({
    name: "Draft Oversized ID",
    targets: [{ productId: oversizedId, variantId: null }],
    session: ADMIN,
  });

  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.failure.reason, "INVALID_DRAFT_INPUT");
  }

  assert.equal(await prisma.promotionCampaign.count(), beforeCampaignCount, "no campaign written");
  assert.equal(await prisma.promotionTarget.count(), beforeTargetCount, "no target written");
});

test("Finding 2 regression: valid fixed price persists exact BigInt amount and does not alter value", async () => {
  const pId = "fx-p";
  await seedProduct(pId, 1);

  const exactVnd = BigInt(450_000);
  const outcome = await createDraftPromotionCampaign({
    name: "Exact Fixed Price Draft",
    discountType: "FIXED_PRICE",
    fixedPriceVnd: exactVnd,
    targets: [{ productId: `${P}-${pId}`, variantId: null }],
    session: ADMIN,
  });

  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    const saved = await prisma.promotionCampaign.findUnique({
      where: { id: outcome.campaignId },
      select: { fixedPriceVnd: true, discountType: true },
    });
    assert.equal(saved?.discountType, "FIXED_PRICE");
    assert.equal(saved?.fixedPriceVnd, exactVnd, "exact monetary amount is stored without alteration");
  }
});

