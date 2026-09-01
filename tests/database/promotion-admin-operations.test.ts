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
  disablePromotionCampaign,
  editDraftPromotionCampaign,
  editScheduledPromotionCampaign,
  endPromotionCampaignEarly,
  publishPromotionCampaign,
  MAX_EXPANDED_VARIANTS_PER_CAMPAIGN,
  PROMOTION_REVISION_ID,
} from "../../src/commerce/promotion-activation-service.ts";

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
