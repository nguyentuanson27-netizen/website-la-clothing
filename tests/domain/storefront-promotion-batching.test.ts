import assert from "node:assert/strict";
import test from "node:test";

import { readApplicablePromotionCampaignsBatched } from "../../src/commerce/promotion-candidate-batching.ts";
import { MAX_CANDIDATE_VARIANTS_PER_LOOKUP } from "../../src/commerce/promotion-candidate-repository.ts";

test("U16 a 24-card x 9-variant listing uses two bounded promotion lookups", async () => {
  const calls: number[] = [];
  const variantIds = Array.from({ length: 24 * 9 }, (_, index) => `shop-variant-${index + 1}`);

  const result = await readApplicablePromotionCampaignsBatched({
    variantIds,
    readBatch: async ({ variantIds: batch }) => {
      assert.ok(batch.length <= MAX_CANDIDATE_VARIANTS_PER_LOOKUP);
      calls.push(batch.length);
      return {
        campaignsByVariantId: new Map(batch.map((variantId) => [variantId, []])),
        unknownVariantIds: [],
      };
    },
  });

  assert.deepEqual(calls, [200, 16]);
  assert.equal(result.campaignsByVariantId.size, 216);
});
