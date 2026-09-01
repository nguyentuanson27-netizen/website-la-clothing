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

import type { PromotionPricingReason } from "./promotion-pricing.ts";

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

export function assessCampaignRuntimeHealth({
  campaignId,
  outcomes,
}: Readonly<{
  campaignId: string;
  outcomes: readonly VariantPricingOutcome[];
}>): CampaignRuntimeHealth {
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

  return Object.freeze({
    campaignId,
    status,
    coveredVariants,
    discountedVariants,
    affectedVariants,
    affected: Object.freeze(affected),
    affectedTruncated: affectedVariants > affected.length,
  });
}
