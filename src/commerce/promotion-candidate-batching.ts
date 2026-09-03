import {
  MAX_CANDIDATE_VARIANTS_PER_LOOKUP,
  readApplicablePromotionCampaigns,
  type ApplicableCampaignLookup,
} from "./promotion-candidate-repository.ts";

export type PromotionCandidateBatchReader = typeof readApplicablePromotionCampaigns;

/**
 * Reads promotion candidates for an arbitrarily sized, already-bounded storefront projection
 * without weakening the repository's per-query safety cap.
 *
 * The low-level repository deliberately rejects more than 200 variant ids in one call. PDP and
 * listing projections can legitimately contain more than 200 variants, so callers use this helper
 * to keep each DB query bounded while still resolving the complete projection. Input ids are
 * deduplicated before batching; results are merged by the same internal VariantMirror identity.
 */
export async function readApplicablePromotionCampaignsBatched({
  variantIds,
  readBatch = readApplicablePromotionCampaigns,
}: Readonly<{
  variantIds: readonly string[];
  readBatch?: PromotionCandidateBatchReader;
}>): Promise<ApplicableCampaignLookup> {
  if (!Array.isArray(variantIds)) {
    throw new TypeError("Variant identities must be an array");
  }

  const requested = [...new Set(variantIds)];
  if (requested.length === 0) {
    return Object.freeze({
      campaignsByVariantId: new Map(),
      unknownVariantIds: Object.freeze([]),
    });
  }

  const campaignsByVariantId = new Map<
    string,
    ApplicableCampaignLookup["campaignsByVariantId"] extends ReadonlyMap<string, infer TValue>
      ? TValue
      : never
  >();
  const unknownVariantIds: string[] = [];

  for (
    let offset = 0;
    offset < requested.length;
    offset += MAX_CANDIDATE_VARIANTS_PER_LOOKUP
  ) {
    const batch = requested.slice(offset, offset + MAX_CANDIDATE_VARIANTS_PER_LOOKUP);
    const result = await readBatch({ variantIds: batch });

    for (const [variantId, campaigns] of result.campaignsByVariantId) {
      campaignsByVariantId.set(variantId, campaigns);
    }
    unknownVariantIds.push(...result.unknownVariantIds);
  }

  return Object.freeze({
    campaignsByVariantId,
    unknownVariantIds: Object.freeze(unknownVariantIds),
  });
}
