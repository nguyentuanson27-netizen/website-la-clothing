/**
 * Runtime campaign health, derived from pricing outcomes.
 *
 * A campaign is not simply valid or invalid at runtime. Catalog drift affects individual variants:
 * one variant's base price becomes unusable, another gets covered by a second campaign, the rest are
 * fine. The reviewed contract is that healthy siblings keep their promotion while only the offending
 * variant loses it, so health is per variant and the campaign-level status summarises it.
 *
 * Nothing is stored. Health is recomputed from current outcomes, which is what makes recovery
 * automatic: a variant that becomes valid again during the campaign interval is simply healthy on
 * the next read, with no repair write and no chance of a stale invalid flag outliving its cause.
 *
 * No money appears here. This feeds an admin diagnostic, and a report that carried prices would be
 * a second place for pricing to be read from.
 */

import type { PrismaClient } from "../generated/prisma/client.ts";
import { prisma } from "../db/prisma.ts";
import { isBoundedPromotionIdentifier } from "./promotion-activation.ts";
import {
  resolvePromotionPricing,
  type ApplicablePromotionCampaign,
  type PromotionPricingReason,
} from "./promotion-pricing.ts";
import {
  describeCampaignRuntimeHealth,
  emitPromotionSignal,
  type PromotionRuntimeHealthSignal,
  type PromotionSignalWriter,
} from "../operations/promotion-observability.ts";

/** Bounded so one broken catalog import cannot turn a diagnostic into an unbounded payload. */
export const MAX_REPORTED_AFFECTED_VARIANTS = 50;

export type VariantPricingOutcome = Readonly<{
  variantId: string;
  isDiscounted: boolean;
  reason: PromotionPricingReason | null;
  /** Every campaign competing for this variant, so an admin can see what to change. */
  conflictingCampaignIds: readonly string[];
}>;

export type AffectedVariant = Readonly<{
  variantId: string;
  reason: PromotionPricingReason | null;
  conflictingCampaignIds: readonly string[];
}>;

export type CampaignRuntimeStatus =
  /** Every currently covered variant takes the promotion. */
  | "HEALTHY"
  /** Some covered variants take it and some cannot; the healthy ones continue. */
  | "PARTIALLY_INVALID"
  /** No covered variant can take it right now. */
  | "FULLY_INVALID"
  /** The campaign currently covers no variant at all. */
  | "NO_COVERAGE";

export type CampaignRuntimeHealth = Readonly<{
  campaignId: string;
  status: CampaignRuntimeStatus;
  coveredVariants: number;
  discountedVariants: number;
  affectedVariants: number;
  affected: readonly AffectedVariant[];
  affectedTruncated: boolean;
}>;

export type AssessCampaignRuntimeHealthInput = Readonly<{
  campaignId: string;
  outcomes: readonly VariantPricingOutcome[];
  emit?: (signal: PromotionRuntimeHealthSignal) => void;
  writer?: PromotionSignalWriter;
}>;

export function assessCampaignRuntimeHealth({
  campaignId,
  outcomes,
  emit,
  writer,
}: AssessCampaignRuntimeHealthInput): CampaignRuntimeHealth {
  const affected: AffectedVariant[] = [];
  let discountedVariants = 0;
  let affectedVariants = 0;

  for (const outcome of outcomes) {
    if (outcome.isDiscounted) {
      discountedVariants += 1;
      continue;
    }
    affectedVariants += 1;
    if (affected.length < MAX_REPORTED_AFFECTED_VARIANTS) {
      affected.push(
        Object.freeze({
          variantId: outcome.variantId,
          // The resolver's typed reason is passed through rather than reinterpreted, so an
          // unusable base price stays a base-price problem instead of looking like a promotion defect.
          reason: outcome.reason,
          conflictingCampaignIds: Object.freeze([...outcome.conflictingCampaignIds]),
        }),
      );
    }
  }

  const coveredVariants = outcomes.length;
  const status: CampaignRuntimeStatus = coveredVariants === 0
    ? "NO_COVERAGE"
    : affectedVariants === 0
      ? "HEALTHY"
      : discountedVariants === 0
        ? "FULLY_INVALID"
        : "PARTIALLY_INVALID";

  const health = Object.freeze({
    campaignId,
    status,
    coveredVariants,
    discountedVariants,
    affectedVariants,
    affected: Object.freeze(affected),
    affectedTruncated: affectedVariants > affected.length,
  });

  try {
    const signal = describeCampaignRuntimeHealth(health);
    if (emit) {
      emit(signal);
    } else if (writer) {
      emitPromotionSignal(signal, writer);
    } else {
      emitPromotionSignal(signal);
    }
  } catch {
    // Observability emission failures are swallowed to protect caller execution.
  }

  return health;
}

export type EvaluateCampaignRuntimeHealthInput = Readonly<{
  campaignId: string;
  client?: Pick<PrismaClient, "promotionCampaign" | "variantMirror">;
  now?: Date;
  writer?: PromotionSignalWriter;
}>;

/**
 * Evaluates runtime health on-demand for a persisted campaign.
 * Resolves current variant outcomes against the database mirror, invokes
 * assessCampaignRuntimeHealth, and emits promotion.runtime_health signal.
 * Telemetry failures are swallowed to safeguard caller execution.
 */
export async function evaluateCampaignRuntimeHealth({
  campaignId,
  client = prisma,
  now = new Date(),
  writer,
}: EvaluateCampaignRuntimeHealthInput): Promise<CampaignRuntimeHealth | null> {
  const trimmedId = campaignId.trim();
  if (!isBoundedPromotionIdentifier(trimmedId)) return null;

  const campaign = await client.promotionCampaign.findUnique({
    where: { id: trimmedId },
    select: {
      id: true,
      kind: true,
      name: true,
      discountType: true,
      percentageValue: true,
      fixedPriceVnd: true,
      startsAt: true,
      endsAt: true,
      targets: {
        select: { productId: true, variantId: true },
      },
    },
  });

  if (campaign === null) return null;

  const directVariantIds = campaign.targets.flatMap((t) => (t.variantId === null ? [] : [t.variantId]));
  const productIds = campaign.targets.flatMap((t) => (t.productId === null ? [] : [t.productId]));

  const ownedVariants = productIds.length === 0
    ? []
    : await client.variantMirror.findMany({
        where: { productId: { in: productIds } },
        select: { id: true },
        take: 2000,
      });

  const allVariantIds = [...new Set([...directVariantIds, ...ownedVariants.map((v) => v.id)])];
  if (allVariantIds.length === 0) {
    return assessCampaignRuntimeHealth({ campaignId: campaign.id, outcomes: [], writer });
  }

  const variants = await client.variantMirror.findMany({
    where: { id: { in: allVariantIds } },
    select: { id: true, pancakeRetailPrice: true },
  });

  const applicable: ApplicablePromotionCampaign = {
    id: campaign.id,
    name: campaign.name,
    kind: campaign.kind,
    discountType: campaign.discountType,
    percentageValue: campaign.percentageValue,
    fixedPriceVnd: campaign.fixedPriceVnd,
    startsAt: campaign.startsAt,
    endsAt: campaign.endsAt,
  };

  const outcomes: VariantPricingOutcome[] = variants.map((variant) => {
    const pricing = resolvePromotionPricing({
      basePriceVnd: variant.pancakeRetailPrice,
      campaigns: [applicable],
      now,
    });
    return {
      variantId: variant.id,
      isDiscounted: pricing.isDiscounted,
      reason: pricing.reason,
      conflictingCampaignIds: [],
    };
  });

  return assessCampaignRuntimeHealth({
    campaignId: campaign.id,
    outcomes,
    writer,
  });
}

