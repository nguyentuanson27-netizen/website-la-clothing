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

export type PromotionCandidateReadClient = {
  variantMirror: { findMany: (args: unknown) => Promise<Array<{ id: string; productId: string }>> };
  promotionTarget: {
    findMany: (args: unknown) => Promise<
      Array<{
        productId: string | null;
        variantId: string | null;
        campaign: ApplicablePromotionCampaign;
      }>
    >;
  };
};

export const MAX_CANDIDATE_VARIANTS_PER_LOOKUP = 200;

export class PromotionCandidateLookupError extends Error {}

export type ApplicableCampaignLookup = Readonly<{
  campaignsByVariantId: ReadonlyMap<string, readonly ApplicablePromotionCampaign[]>;
  unknownVariantIds: readonly string[];
}>;

export type TrustedPromotionVariantOwner = Readonly<{ id: string; productId: string }>;

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

async function readTargetsForKnownVariants({
  variants,
  client,
}: Readonly<{
  variants: readonly TrustedPromotionVariantOwner[];
  client: PromotionCandidateReadClient;
}>): Promise<ReadonlyMap<string, readonly ApplicablePromotionCampaign[]>> {
  const knownVariantIds = new Set(variants.map((variant) => variant.id));
  const productIds = [...new Set(variants.map((variant) => variant.productId))];

  if (knownVariantIds.size === 0) return new Map();

  const targets = await client.promotionTarget.findMany({
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

  return campaignsByVariantId;
}

/**
 * Trusted ownership path for bounded server-owned projections that already loaded VariantMirror
 * identity and owner product in the same canonical query. It deliberately does not re-read
 * VariantMirror, so U26 can prove a whole-generation DB budget rather than hiding two queries inside
 * every batch. Request-controlled variant ids must continue to use `readApplicablePromotionCampaigns`.
 */
export async function readApplicablePromotionCampaignsForKnownVariants({
  variants,
  client = prisma as unknown as PromotionCandidateReadClient,
}: Readonly<{
  variants: readonly TrustedPromotionVariantOwner[];
  client?: PromotionCandidateReadClient;
}>): Promise<ApplicableCampaignLookup> {
  if (!Array.isArray(variants)) {
    throw new PromotionCandidateLookupError("Known variants must be a bounded array");
  }

  const ids = new Set<string>();
  for (const variant of variants) {
    if (
      variant === null ||
      typeof variant !== "object" ||
      typeof variant.id !== "string" ||
      variant.id.length === 0 ||
      typeof variant.productId !== "string" ||
      variant.productId.length === 0 ||
      ids.has(variant.id)
    ) {
      throw new PromotionCandidateLookupError("Known variants must have unique trusted identities");
    }
    ids.add(variant.id);
  }

  return Object.freeze({
    campaignsByVariantId: await readTargetsForKnownVariants({ variants, client }),
    unknownVariantIds: Object.freeze([]),
  });
}

export async function readApplicablePromotionCampaigns({
  variantIds,
  client = prisma as unknown as PromotionCandidateReadClient,
}: Readonly<{
  variantIds: readonly string[];
  client?: PromotionCandidateReadClient;
}>): Promise<ApplicableCampaignLookup> {
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

  const variants = await client.variantMirror.findMany({
    where: { id: { in: requested } },
    select: { id: true, productId: true },
  });

  const knownVariantIds = new Set(variants.map((variant) => variant.id));
  const unknownVariantIds = requested.filter((id) => !knownVariantIds.has(id));

  return Object.freeze({
    campaignsByVariantId: await readTargetsForKnownVariants({ variants, client }),
    unknownVariantIds: Object.freeze(unknownVariantIds),
  });
}
