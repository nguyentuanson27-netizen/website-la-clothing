import assert from "node:assert/strict";
import test from "node:test";

import {
  assertExperimentCriteriaSatisfied,
  deriveExperimentCriteria,
  EXPECTED_TARGET_PRODUCT_ID,
  EXPECTED_TARGET_VARIATION_ID,
  fetchBoundedPromotions,
  validateTargetVariationPreflight,
} from "../../scripts/pancake-w3-experiment.ts";

function productWithTarget(overrides: Record<string, unknown> = {}) {
  return {
    id: EXPECTED_TARGET_PRODUCT_ID,
    variations: [
      {
        id: EXPECTED_TARGET_VARIATION_ID,
        product_id: EXPECTED_TARGET_PRODUCT_ID,
        remain_quantity: 0,
        retail_price: 429000,
        retail_price_after_discount: 429000,
        ...overrides,
      },
    ],
  };
}

test("preflight refuses missing or malformed aggregate stock instead of treating it as zero", () => {
  for (const badValue of [undefined, "0", Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5]) {
    const product = productWithTarget({ remain_quantity: badValue });
    assert.throws(
      () => validateTargetVariationPreflight(product),
      /Target variation preflight failed: remain_quantity must be the safe integer 0/,
    );
  }
});

test("preflight refuses malformed or non-zero warehouse stock facts", () => {
  assert.throws(
    () => validateTargetVariationPreflight(productWithTarget({ variations_warehouses: "unknown" })),
    /variations_warehouses must be an array when present/,
  );

  for (const warehouseRemain of [undefined, "0", Number.NaN, Number.POSITIVE_INFINITY, -1, 1, 0.5]) {
    assert.throws(
      () =>
        validateTargetVariationPreflight(
          productWithTarget({ variations_warehouses: [{ remain_quantity: warehouseRemain }] }),
        ),
      /warehouse remain_quantity must be the safe integer 0/,
    );
  }
});

test("bounded promotion traversal continues across full pages when metadata is omitted", async () => {
  const requestedPages: number[] = [];
  const client = {
    getJson: async (_path: string, query: { page: number }) => {
      requestedPages.push(query.page);
      if (query.page === 1) {
        return { success: true, data: [{ id: "p1" }, { id: "p2" }] };
      }
      return { success: true, data: [{ id: "p3" }] };
    },
  } as Parameters<typeof fetchBoundedPromotions>[0];

  const promotions = await fetchBoundedPromotions(client, 1635185058, { maxPages: 3, pageSize: 2 });

  assert.deepEqual(requestedPages, [1, 2]);
  assert.deepEqual(promotions.map((p) => p.id), ["p1", "p2", "p3"]);
});

test("bounded promotion traversal refuses silent truncation when every metadata-free page is full", async () => {
  const client = {
    getJson: async () => ({ success: true, data: [{ id: "p1" }, { id: "p2" }] }),
  } as Parameters<typeof fetchBoundedPromotions>[0];

  await assert.rejects(
    () => fetchBoundedPromotions(client, 1635185058, { maxPages: 2, pageSize: 2 }),
    /Promotion pagination reached max pages with a full final page and no usable pagination metadata/,
  );
});

test("criteria assertion turns any failed W3 criterion into a failed experiment", () => {
  assert.throws(
    () =>
      assertExperimentCriteriaSatisfied({
        c1RetailPriceInvariant: true,
        c2SemanticsProven: false,
        c3ReversibilityVerified: true,
        c4ProviderOpenApiAlignment: true,
        c5ZeroCollateral: false,
      }),
    /W3_EXPERIMENT_CRITERIA_FAILED: c2SemanticsProven, c5ZeroCollateral/,
  );

  assert.doesNotThrow(() =>
    assertExperimentCriteriaSatisfied({
      c1RetailPriceInvariant: true,
      c2SemanticsProven: true,
      c3ReversibilityVerified: true,
      c4ProviderOpenApiAlignment: true,
      c5ZeroCollateral: true,
    }),
  );
});

test("reversibility compares promotion count with baseline rather than requiring an empty shop", () => {
  const criteria = deriveExperimentCriteria({
    beforeRetailPrice: 429000,
    beforeRetailPriceAfterDiscount: 429000,
    beforePromotionsCount: 2,
    activeRetailPrice: 429000,
    activeRetailPriceAfterDiscount: 429000,
    activeCollateralUnchanged: true,
    promoId: "promo-test",
    createdPromoScopeValid: true,
    targetApplicability: {
      variationId: EXPECTED_TARGET_VARIATION_ID,
      matchedPromotionId: "promo-test",
      applicable: true,
      observedAt: new Date().toISOString(),
    },
    peerApplicability: {
      variationId: "peer",
      matchedPromotionId: null,
      applicable: false,
      observedAt: new Date().toISOString(),
    },
    postRollbackApplicability: {
      variationId: EXPECTED_TARGET_VARIATION_ID,
      matchedPromotionId: null,
      applicable: false,
      observedAt: new Date().toISOString(),
    },
    revertRetailPrice: 429000,
    revertRetailPriceAfterDiscount: 429000,
    revertPromotionsCount: 2,
  });

  assert.equal(criteria.c3ReversibilityVerified, true);
});
