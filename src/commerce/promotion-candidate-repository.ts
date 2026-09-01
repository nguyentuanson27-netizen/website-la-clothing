/**
 * Resolves which campaigns apply to which variants.
 *
 * This is the membership half of promotion pricing; the money half is the pricing resolver, which
 * this feeds. Keeping them apart is what lets the resolver stay a pure function and lets this stay a
 * bounded query.
 *
 * PRODUCT coverage is a **join, never a materialized list**. A variant synced, restored or
 * re-associated after a campaign was created is covered with no campaign write, and a frozen variant
 * list would have to be rebuilt on every catalog change to stay correct — which is exactly the
 * staleness the spec forbids.
 *
 * The repository never picks a winner between campaigns. Two candidates on one variant is a
 * conflict the resolver reports; deciding here would hide it.
 */

import { prisma } from "../db/prisma.ts";

import type { ApplicablePromotionCampaign } from "./promotion-pricing.ts";

/**
 * Bounded because this runs on storefront and cart paths. The current anonymous cart caps at 50
 * distinct items and a catalog page at 48, so this leaves generous headroom while keeping a single
 * malformed request from turning into an unbounded scan.
 */
export const MAX_CANDIDATE_VARIANTS_PER_LOOKUP = 200;

export class PromotionCandidateLookupError extends Error {}

export type ApplicableCampaignLookup = Readonly<{
  campaignsByVariantId: ReadonlyMap<string, readonly ApplicablePromotionCampaign[]>;
  /**
   * Requested variants that do not exist in the mirror. Reported rather than silently treated as
   * "no promotion", so a caller can fail closed instead of quoting a price for something unknown.
   */
  unknownVariantIds: readonly string[];
}>;

const campaignSelection = {
  id: true,
  name: true,
  kind: true,
  discountType: true,
  percentageValue: true,
  fixedPriceVnd: true,
  startsAt: true,
  endsAt: true,
} as const;

export async function readApplicablePromotionCampaigns({
  variantIds,
}: Readonly<{ variantIds: readonly string[] }>): Promise<ApplicableCampaignLookup> {
  if (!Array.isArray(variantIds)) {
    throw new PromotionCandidateLookupError("Variant identities must be a bounded array");
  }
  if (variantIds.length > MAX_CANDIDATE_VARIANTS_PER_LOOKUP) {
    throw new PromotionCandidateLookupError(
      `Promotion candidate lookup is bounded to ${MAX_CANDIDATE_VARIANTS_PER_LOOKUP} variants per call`,
    );
  }

  const requested = [...new Set(variantIds)];
  if (requested.length === 0) {
    return Object.freeze({
      campaignsByVariantId: new Map(),
      unknownVariantIds: Object.freeze([]),
    });
  }

  // A variant's owning product is its own `productId`. A composite component therefore follows its
  // real owner rather than the parent set it happens to be sold through, which is what keeps a
  // parent's campaign from silently repricing somebody else's product.
  const variants = await prisma.variantMirror.findMany({
    where: { id: { in: requested } },
    select: { id: true, productId: true },
  });

  const knownVariantIds = new Set(variants.map((variant) => variant.id));
  const unknownVariantIds = requested.filter((id) => !knownVariantIds.has(id));
  const productIds = [...new Set(variants.map((variant) => variant.productId))];

  // Draft and Disabled campaigns are not storefront-effective, so they are never candidates. Window
  // membership is deliberately left to the resolver: it owns the half-open interval contract, and
  // filtering by time here would put that rule in two places.
  const targets = await prisma.promotionTarget.findMany({
    where: {
      campaign: { isEnabled: true },
      OR: [{ variantId: { in: [...knownVariantIds] } }, { productId: { in: productIds } }],
    },
    select: {
      productId: true,
      variantId: true,
      campaign: { select: campaignSelection },
    },
  });

  const variantsByProductId = new Map<string, string[]>();
  for (const variant of variants) {
    const owned = variantsByProductId.get(variant.productId);
    if (owned === undefined) variantsByProductId.set(variant.productId, [variant.id]);
    else owned.push(variant.id);
  }

  const campaignsByVariantId = new Map<string, ApplicablePromotionCampaign[]>();
  const seen = new Map<string, Set<string>>();
  for (const variantId of knownVariantIds) {
    campaignsByVariantId.set(variantId, []);
    seen.set(variantId, new Set());
  }

  const attach = (variantId: string, campaign: ApplicablePromotionCampaign) => {
    const already = seen.get(variantId);
    // A campaign that covers a variant both directly and through its product is still one
    // candidate; counting it twice would look like a conflict with itself.
    if (already === undefined || already.has(campaign.id)) return;
    already.add(campaign.id);
    campaignsByVariantId.get(variantId)?.push(campaign);
  };

  for (const target of targets) {
    const campaign = Object.freeze({ ...target.campaign }) as ApplicablePromotionCampaign;
    if (target.variantId !== null) {
      attach(target.variantId, campaign);
      continue;
    }
    if (target.productId === null) continue;
    for (const variantId of variantsByProductId.get(target.productId) ?? []) {
      attach(variantId, campaign);
    }
  }

  return Object.freeze({
    campaignsByVariantId,
    unknownVariantIds: Object.freeze(unknownVariantIds),
  });
}
