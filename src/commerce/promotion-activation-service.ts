/**
 * The transactional boundary for effective promotion mutations.
 *
 * "Effective" means a mutation that can change what a buyer is charged now or later: publish,
 * re-enable, disable, and a material edit to a Scheduled campaign. Every one of them must do two
 * things atomically — change the campaign, and advance the durable pricing revision — because a
 * Merchant cache decision orders itself against that revision. If the revision could lag the
 * mutation, stale sale bytes could be served as current.
 *
 * Race safety comes from the revision row itself. Every effective mutation takes `FOR UPDATE` on
 * that single row *before* it reads anything else, which serializes all of them globally. That is
 * what makes the overlap check trustworthy: two concurrent publishes cannot both read a
 * conflict-free world and then both commit. Locking a variant set instead would need the set to be
 * known before it is computed, and would not cover PRODUCT targets whose coverage changes.
 *
 * Serializing every effective mutation is a deliberate throughput trade. Promotion publishes are
 * rare administrative actions, and correctness under concurrency is worth far more here than
 * parallelism.
 *
 * The revision lock alone is not enough, because catalog sync never takes it. A coverage-validating
 * mutation therefore also locks, in one fixed order, the campaign row, then its owning product
 * rows, then the variant rows the expansion probe produced, and re-reads every fact it decides on
 * *after* holding those locks. The order is fixed so concurrent mutations cannot deadlock against
 * each other, and each set is taken with `ORDER BY "id"` so two callers with overlapping sets queue
 * rather than cross.
 *
 * That boundary has a known limit worth stating rather than implying: `FOR UPDATE` cannot lock a row
 * that does not exist yet, so a variant inserted for an already-locked product during validation is
 * not covered by it. Locking the owning product row is the mitigation — a sync that adds a variant
 * touches its product — and per-variant runtime health is what catches whatever still slips through.
 */

import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { prisma } from "../db/prisma.ts";

import {
  isPromotionActivationEnabled,
  validateCampaignForActivation,
  type CampaignActivationError,
} from "./promotion-activation.ts";
import { deriveCampaignLifecycle } from "./promotion-campaign-lifecycle.ts";
import { resolvePromotionPricing, type ApplicablePromotionCampaign } from "./promotion-pricing.ts";

/**
 * Coverage-validating writes expand PRODUCT targets to their current variants. The bound protects
 * that expensive work; it is not a limit on how many variants a campaign may ultimately cover.
 */
export const MAX_EXPANDED_VARIANTS_PER_CAMPAIGN = 2000;

export const PROMOTION_REVISION_ID = "current";

export type ActivationFailure =
  | { reason: "ACTIVATION_DISABLED" }
  | { reason: "CAMPAIGN_NOT_FOUND" }
  | { reason: "ILLEGAL_TRANSITION"; from: string }
  | { reason: "INVALID_CAMPAIGN"; errors: readonly CampaignActivationError[] }
  | { reason: "TARGET_EXPANSION_LIMIT_EXCEEDED" }
  /** No currently covered variant would actually be discounted by this campaign. */
  | { reason: "NO_EFFECTIVE_DISCOUNT"; invalidVariantIds: readonly string[] }
  | { reason: "OVERLAPPING_CAMPAIGN"; conflictingCampaignIds: readonly string[] };

export type ActivationOutcome =
  | Readonly<{ ok: true; campaignId: string; revision: bigint }>
  | Readonly<{ ok: false; failure: ActivationFailure }>;

type Tx = Prisma.TransactionClient;

/**
 * Takes the global effective-mutation lock and returns the current revision.
 *
 * This is the first statement of every effective mutation, so ordering is established before any
 * decision is read.
 */
async function lockRevision(tx: Tx): Promise<bigint> {
  const rows = await tx.$queryRaw<Array<{ revision: bigint }>>`
    SELECT "revision" FROM "PromotionPricingRevision" WHERE "id" = ${PROMOTION_REVISION_ID} FOR UPDATE
  `;
  const revision = rows[0]?.revision;
  if (revision === undefined) {
    throw new Error("Promotion pricing revision row is missing; migrations are not deployed");
  }
  return revision;
}

async function advanceRevision(tx: Tx, current: bigint): Promise<bigint> {
  const next = current + BigInt(1);
  await tx.$executeRaw`
    UPDATE "PromotionPricingRevision"
    SET "revision" = ${next}, "updatedAt" = NOW()
    WHERE "id" = ${PROMOTION_REVISION_ID}
  `;
  return next;
}

/** Current variants covered by a campaign's explicit targets, bounded by one probe row. */
async function expandCoverage(
  tx: Tx,
  targets: readonly { productId: string | null; variantId: string | null }[],
): Promise<string[] | null> {
  const productIds = targets.flatMap((t) => (t.productId === null ? [] : [t.productId]));
  const directVariantIds = targets.flatMap((t) => (t.variantId === null ? [] : [t.variantId]));

  const owned = productIds.length === 0
    ? []
    : await tx.variantMirror.findMany({
        where: { productId: { in: productIds } },
        select: { id: true },
        take: MAX_EXPANDED_VARIANTS_PER_CAMPAIGN + 1,
      });

  const covered = new Set<string>([...directVariantIds, ...owned.map((variant) => variant.id)]);
  // Probing one past the bound is what lets this report the limit instead of silently truncating.
  return covered.size > MAX_EXPANDED_VARIANTS_PER_CAMPAIGN ? null : [...covered];
}

/**
 * Locks a set of rows in one deterministic order.
 *
 * `ORDER BY "id"` is what keeps two callers holding overlapping sets from crossing: they queue on
 * the same first row instead of each holding what the other still needs.
 */
async function lockRows(
  tx: Tx,
  table: "PromotionCampaign" | "ProductMirror" | "VariantMirror",
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  await tx.$queryRawUnsafe(
    `SELECT "id" FROM "${table}" WHERE "id" = ANY($1::text[]) ORDER BY "id" FOR UPDATE`,
    [...ids].sort(),
  );
}

/** Owning products of a campaign's targets: the named products, plus owners of the named variants. */
async function owningProductIds(
  tx: Tx,
  targets: readonly { productId: string | null; variantId: string | null }[],
): Promise<string[]> {
  const named = targets.flatMap((t) => (t.productId === null ? [] : [t.productId]));
  const variantIds = targets.flatMap((t) => (t.variantId === null ? [] : [t.variantId]));
  const owners = variantIds.length === 0
    ? []
    : await tx.variantMirror.findMany({
        where: { id: { in: variantIds } },
        select: { productId: true },
      });
  return [...new Set([...named, ...owners.map((variant) => variant.productId)])];
}

type CandidateMoney = Readonly<{
  discountType: "PERCENTAGE" | "FIXED_PRICE";
  percentageValue: number | null;
  fixedPriceVnd: bigint | null;
}>;

/**
 * Runs the campaign's money rule over every variant it currently covers, through the central pricing
 * authority rather than a comparison written here — activation and the storefront must not be able
 * to disagree about what counts as a discount.
 *
 * A variant whose mirrored base is unusable is tolerated. That is catalog drift, not a campaign
 * defect, and the accepted runtime contract keeps healthy siblings discounted while only the
 * offending variant loses its promotion; refusing here would let one bad mirror row block a whole
 * product, and would leave per-variant health with nothing to do. A variant whose base *is* usable
 * but which the campaign still fails to discount is a mis-specified campaign, and is refused.
 */
async function findVariantsTheCampaignCannotDiscount(
  tx: Tx,
  candidate: CandidateMoney,
  coveredVariantIds: readonly string[],
  now: Date,
): Promise<{ invalid: string[]; discounted: number }> {
  if (coveredVariantIds.length === 0) return { invalid: [], discounted: 0 };

  const variants = await tx.variantMirror.findMany({
    where: { id: { in: [...coveredVariantIds] } },
    select: { id: true, pancakeRetailPrice: true },
  });

  // The window is deliberately dropped. Activation asks whether this campaign *could* discount these
  // variants, not whether it is running at this instant: a Scheduled campaign must be validated
  // before its window opens.
  const applicable: ApplicablePromotionCampaign = {
    id: "candidate",
    name: "candidate",
    kind: "PROMOTION",
    discountType: candidate.discountType,
    percentageValue: candidate.percentageValue,
    fixedPriceVnd: candidate.fixedPriceVnd,
    startsAt: null,
    endsAt: null,
  };

  const invalid: string[] = [];
  let discounted = 0;
  for (const variant of variants) {
    const pricing = resolvePromotionPricing({
      basePriceVnd: variant.pancakeRetailPrice,
      campaigns: [applicable],
      now,
    });
    if (pricing.isDiscounted) {
      discounted += 1;
      continue;
    }
    if (pricing.reason === "BASE_PRICE_UNAVAILABLE") continue;
    invalid.push(variant.id);
  }

  return { invalid, discounted };
}

function windowsOverlap(
  a: { startsAt: Date | null; endsAt: Date | null },
  b: { startsAt: Date | null; endsAt: Date | null },
): boolean {
  const startA = a.startsAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const endA = a.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const startB = b.startsAt?.getTime() ?? Number.NEGATIVE_INFINITY;
  const endB = b.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;
  // Half-open, so B may start exactly when A ends without overlapping.
  return startA < endB && startB < endA;
}

async function findOverlappingCampaigns(
  tx: Tx,
  campaignId: string,
  window: { startsAt: Date | null; endsAt: Date | null },
  coveredVariantIds: readonly string[],
): Promise<string[]> {
  const others = await tx.promotionCampaign.findMany({
    where: { isEnabled: true, id: { not: campaignId } },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      targets: { select: { productId: true, variantId: true } },
    },
  });

  const covered = new Set(coveredVariantIds);
  const conflicting: string[] = [];

  for (const other of others) {
    if (!windowsOverlap(window, other)) continue;
    const otherCoverage = await expandCoverage(tx, other.targets);
    // An unbounded competitor cannot be proved disjoint, so it is treated as conflicting rather
    // than waved through.
    if (otherCoverage === null || otherCoverage.some((id) => covered.has(id))) {
      conflicting.push(other.id);
    }
  }

  return conflicting;
}

export type PublishInput = Readonly<{
  campaignId: string;
  now: Date;
  client?: PrismaClient;
  env?: Readonly<Record<string, string | undefined>>;
}>;

/**
 * Publish or re-enable a campaign.
 *
 * Re-enable is only legal for a campaign that was disabled before it was ever active; anything that
 * has run is terminal and must be copied instead. That check uses the derived lifecycle rather than
 * a stored flag, so it stays correct after a restart and for a window nobody observed.
 */
export async function publishPromotionCampaign({
  campaignId,
  now,
  client = prisma,
  env = process.env,
}: PublishInput): Promise<ActivationOutcome> {
  if (!isPromotionActivationEnabled(env)) {
    return { ok: false, failure: { reason: "ACTIVATION_DISABLED" } };
  }

  return client.$transaction(async (tx) => {
    const currentRevision = await lockRevision(tx);
    await lockRows(tx, "PromotionCampaign", [campaignId]);

    const campaign = await tx.promotionCampaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true, kind: true, name: true, discountType: true, percentageValue: true,
        fixedPriceVnd: true, startsAt: true, endsAt: true, isEnabled: true,
        enabledAt: true, disabledAt: true,
        targets: { select: { productId: true, variantId: true } },
      },
    });
    if (campaign === null) {
      return { ok: false, failure: { reason: "CAMPAIGN_NOT_FOUND" } } as const;
    }

    // Owning products next, then the variants the probe finds. Everything decided below is read
    // after these locks are held, so catalog sync cannot move it between validation and commit.
    await lockRows(tx, "ProductMirror", await owningProductIds(tx, campaign.targets));
    const probe = await expandCoverage(tx, campaign.targets);
    if (probe === null) {
      return { ok: false, failure: { reason: "TARGET_EXPANSION_LIMIT_EXCEEDED" } } as const;
    }
    await lockRows(tx, "VariantMirror", probe);

    const lifecycle = deriveCampaignLifecycle({ ...campaign, now });
    if (lifecycle.status !== "DRAFT" && !lifecycle.canReEnable) {
      return {
        ok: false,
        failure: { reason: "ILLEGAL_TRANSITION", from: lifecycle.status },
      } as const;
    }

    const variantOwnerProductIds = new Map<string, string>();
    const targetedVariantIds = campaign.targets.flatMap((t) => (t.variantId === null ? [] : [t.variantId]));
    if (targetedVariantIds.length > 0) {
      for (const variant of await tx.variantMirror.findMany({
        where: { id: { in: targetedVariantIds } },
        select: { id: true, productId: true },
      })) {
        variantOwnerProductIds.set(variant.id, variant.productId);
      }
    }

    const validation = validateCampaignForActivation({ ...campaign, now, variantOwnerProductIds });
    if (!validation.ok) {
      return { ok: false, failure: { reason: "INVALID_CAMPAIGN", errors: validation.errors } } as const;
    }

    // Re-expanded under the locks. The probe above decided which rows to lock; this is the coverage
    // the decision is actually made on, and it cannot move before commit.
    const coverage = await expandCoverage(tx, campaign.targets);
    if (coverage === null) {
      return { ok: false, failure: { reason: "TARGET_EXPANSION_LIMIT_EXCEEDED" } } as const;
    }

    const conflicting = await findOverlappingCampaigns(tx, campaign.id, campaign, coverage);
    if (conflicting.length > 0) {
      return {
        ok: false,
        failure: { reason: "OVERLAPPING_CAMPAIGN", conflictingCampaignIds: conflicting },
      } as const;
    }

    const money = await findVariantsTheCampaignCannotDiscount(tx, campaign, coverage, now);
    if (money.invalid.length > 0 || money.discounted === 0) {
      return {
        ok: false,
        failure: { reason: "NO_EFFECTIVE_DISCOUNT", invalidVariantIds: money.invalid },
      } as const;
    }

    await tx.promotionCampaign.update({
      where: { id: campaign.id },
      // Re-enable writes a fresh enabledAt and clears disabledAt, so the enabled interval that
      // decides "ever active" starts now rather than reaching back through the disabled gap.
      data: { isEnabled: true, enabledAt: now, disabledAt: null },
    });

    const revision = await advanceRevision(tx, currentRevision);
    return { ok: true, campaignId: campaign.id, revision } as const;
  });
}

/**
 * Disable a campaign.
 *
 * Deliberately does not expand coverage: disable must stay available even when a PRODUCT target has
 * grown past the expansion bound, because the alternative is a campaign that cannot be switched off.
 * It is the rollback path, so it must never be the thing that fails.
 */
export async function disablePromotionCampaign({
  campaignId,
  now,
  client = prisma,
}: Omit<PublishInput, "env">): Promise<ActivationOutcome> {
  return client.$transaction(async (tx) => {
    const currentRevision = await lockRevision(tx);

    const campaign = await tx.promotionCampaign.findUnique({
      where: { id: campaignId },
      select: { id: true, isEnabled: true },
    });
    if (campaign === null) {
      return { ok: false, failure: { reason: "CAMPAIGN_NOT_FOUND" } } as const;
    }
    if (!campaign.isEnabled) {
      return { ok: false, failure: { reason: "ILLEGAL_TRANSITION", from: "DISABLED" } } as const;
    }

    await tx.promotionCampaign.update({
      where: { id: campaign.id },
      data: { isEnabled: false, disabledAt: now },
    });

    const revision = await advanceRevision(tx, currentRevision);
    return { ok: true, campaignId: campaign.id, revision } as const;
  });
}
