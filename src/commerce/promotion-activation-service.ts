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
 */

import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { prisma } from "../db/prisma.ts";

import {
  isPromotionActivationEnabled,
  validateCampaignForActivation,
  type CampaignActivationError,
} from "./promotion-activation.ts";
import { deriveCampaignLifecycle } from "./promotion-campaign-lifecycle.ts";

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
