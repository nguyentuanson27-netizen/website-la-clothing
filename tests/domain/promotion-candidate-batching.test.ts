import assert from "node:assert/strict";
import test from "node:test";

import { MAX_CANDIDATE_VARIANTS_PER_LOOKUP } from "../../src/commerce/promotion-candidate-repository.ts";
import { readApplicablePromotionCampaignsBatched } from "../../src/commerce/promotion-candidate-batching.ts";

function ids(count: number) {
  return Array.from({ length: count }, (_, index) => `variant-${index + 1}`);
}

test("U15 exactly 200 variants stay in one bounded candidate lookup", async () => {
  const calls: string[][] = [];
  const variantIds = ids(MAX_CANDIDATE_VARIANTS_PER_LOOKUP);

  const result = await readApplicablePromotionCampaignsBatched({
    variantIds,
    readBatch: async ({ variantIds: batch }) => {
      calls.push([...batch]);
      return {
        campaignsByVariantId: new Map(batch.map((variantId) => [variantId, []])),
        unknownVariantIds: [],
      };
    },
  });

  assert.deepEqual(calls.map((batch) => batch.length), [200]);
  assert.equal(result.campaignsByVariantId.size, 200);
});

test("U15 201 variants are resolved as bounded 200 + 1 batches instead of failing the PDP", async () => {
  const calls: string[][] = [];
  const variantIds = ids(MAX_CANDIDATE_VARIANTS_PER_LOOKUP + 1);

  const result = await readApplicablePromotionCampaignsBatched({
    variantIds,
    readBatch: async ({ variantIds: batch }) => {
      assert.ok(batch.length <= MAX_CANDIDATE_VARIANTS_PER_LOOKUP);
      calls.push([...batch]);
      return {
        campaignsByVariantId: new Map(batch.map((variantId) => [variantId, []])),
        unknownVariantIds: batch.filter((variantId) => variantId === "variant-201"),
      };
    },
  });

  assert.deepEqual(calls.map((batch) => batch.length), [200, 1]);
  assert.equal(result.campaignsByVariantId.size, 201);
  assert.deepEqual(result.unknownVariantIds, ["variant-201"]);
});

test("U15 duplicate ids are deduplicated before batches are planned", async () => {
  const calls: string[][] = [];
  const requested = [...ids(200), "variant-1", "variant-200", "variant-201"];

  await readApplicablePromotionCampaignsBatched({
    variantIds: requested,
    readBatch: async ({ variantIds: batch }) => {
      calls.push([...batch]);
      return { campaignsByVariantId: new Map(), unknownVariantIds: [] };
    },
  });

  assert.deepEqual(calls.map((batch) => batch.length), [200, 1]);
});
