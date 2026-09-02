import assert from "node:assert/strict";
import test from "node:test";

import {
  assertApprovedShopId,
  assertTrustedExperimentEnvironment,
  checkExistingPromotionCollisions,
  deriveExperimentCriteria,
  environmentFlagIsEnabled,
  EXPECTED_PEER_VARIATION_ID,
  EXPECTED_SHOP_ID,
  EXPECTED_TARGET_INPUT,
  EXPECTED_TARGET_PRODUCT_ID,
  EXPECTED_TARGET_VARIATION_ID,
  parsePromotionApplicabilityResponse,
  PROMO_NAME,
  PROMO_TYPE,
  sanitizeErrorMessage,
  validateCreatedPromotionScope,
  validatePaginationBounds,
  validateTargetVariationPreflight,
  verifyRollbackState,
} from "../../scripts/pancake-w3-experiment.ts";

test("0. environmentFlagIsEnabled correctly identifies enabled values", () => {
  assert.equal(environmentFlagIsEnabled("true"), true);
  assert.equal(environmentFlagIsEnabled("1"), true);
  assert.equal(environmentFlagIsEnabled("false"), false);
  assert.equal(environmentFlagIsEnabled("0"), false);
  assert.equal(environmentFlagIsEnabled(""), false);
  assert.equal(environmentFlagIsEnabled(undefined), false);
});

test("1. refuses CI execution", () => {
  assert.throws(
    () =>
      assertTrustedExperimentEnvironment({
        CI: "true",
        W3_EXPERIMENT_APPROVED: EXPECTED_TARGET_INPUT,
      } as unknown as NodeJS.ProcessEnv),
    /Trusted Pancake pricing experiment refuses CI execution/,
  );
  assert.throws(
    () =>
      assertTrustedExperimentEnvironment({
        GITHUB_ACTIONS: "true",
        W3_EXPERIMENT_APPROVED: EXPECTED_TARGET_INPUT,
      } as unknown as NodeJS.ProcessEnv),
    /Trusted Pancake pricing experiment refuses CI execution/,
  );
});

test("2. refuses without W3_EXPERIMENT_APPROVED=a132", () => {
  assert.throws(
    () => assertTrustedExperimentEnvironment({} as unknown as NodeJS.ProcessEnv),
    /W3 experiment requires explicit operator approval: W3_EXPERIMENT_APPROVED=a132/,
  );
});

test("3. refuses wrong approval value", () => {
  assert.throws(
    () =>
      assertTrustedExperimentEnvironment({
        W3_EXPERIMENT_APPROVED: "true",
      } as unknown as NodeJS.ProcessEnv),
    /W3 experiment requires explicit operator approval: W3_EXPERIMENT_APPROVED=a132/,
  );
  assert.throws(
    () =>
      assertTrustedExperimentEnvironment({
        W3_EXPERIMENT_APPROVED: "a131",
      } as unknown as NodeJS.ProcessEnv),
    /W3 experiment requires explicit operator approval: W3_EXPERIMENT_APPROVED=a132/,
  );
  assert.doesNotThrow(() =>
    assertTrustedExperimentEnvironment({
      W3_EXPERIMENT_APPROVED: EXPECTED_TARGET_INPUT,
    } as unknown as NodeJS.ProcessEnv),
  );
});

test("4. refuses wrong shop ID", () => {
  assert.throws(() => assertApprovedShopId(999999), /configured shop ID 999999 does not match expected/);
  assert.doesNotThrow(() => assertApprovedShopId(EXPECTED_SHOP_ID));
});

test("5. refuses if target variation missing", () => {
  const missingVarProduct = {
    id: EXPECTED_TARGET_PRODUCT_ID,
    variations: [{ id: "other-var-id", remain_quantity: 0 }],
  };
  assert.throws(
    () => validateTargetVariationPreflight(missingVarProduct),
    /Target variation preflight failed: variation .* not found/,
  );
});

test("6. refuses if target variation moved to another product", () => {
  const wrongProductVar = {
    id: EXPECTED_TARGET_PRODUCT_ID,
    variations: [
      {
        id: EXPECTED_TARGET_VARIATION_ID,
        product_id: "other-product-id",
        remain_quantity: 0,
      },
    ],
  };
  assert.throws(
    () => validateTargetVariationPreflight(wrongProductVar),
    /belongs to product other-product-id, expected/,
  );
});

test("7. refuses if stock > 0", () => {
  const inStockProduct = {
    id: EXPECTED_TARGET_PRODUCT_ID,
    variations: [
      {
        id: EXPECTED_TARGET_VARIATION_ID,
        product_id: EXPECTED_TARGET_PRODUCT_ID,
        remain_quantity: 5,
      },
    ],
  };
  assert.throws(
    () => validateTargetVariationPreflight(inStockProduct),
    /has stock 5 > 0/,
  );

  const inWarehouseProduct = {
    id: EXPECTED_TARGET_PRODUCT_ID,
    variations: [
      {
        id: EXPECTED_TARGET_VARIATION_ID,
        product_id: EXPECTED_TARGET_PRODUCT_ID,
        remain_quantity: 0,
        variations_warehouses: [{ remain_quantity: 3 }],
      },
    ],
  };
  assert.throws(
    () => validateTargetVariationPreflight(inWarehouseProduct),
    /warehouse stock sum 3 > 0/,
  );
});

test("8. refuses if unsafe target state is detected", () => {
  const compositeProduct = {
    id: EXPECTED_TARGET_PRODUCT_ID,
    variations: [
      {
        id: EXPECTED_TARGET_VARIATION_ID,
        product_id: EXPECTED_TARGET_PRODUCT_ID,
        remain_quantity: 0,
        is_composite: true,
      },
    ],
  };
  assert.throws(
    () => validateTargetVariationPreflight(compositeProduct),
    /is composite/,
  );

  const lockedProduct = {
    id: EXPECTED_TARGET_PRODUCT_ID,
    variations: [
      {
        id: EXPECTED_TARGET_VARIATION_ID,
        product_id: EXPECTED_TARGET_PRODUCT_ID,
        remain_quantity: 0,
        is_locked: true,
      },
    ],
  };
  assert.throws(
    () => validateTargetVariationPreflight(lockedProduct),
    /is locked/,
  );
});

test("9. detects existing deterministic test promotion", () => {
  const existing = [{ id: "promo-1", name: PROMO_NAME }];
  assert.throws(
    () => checkExistingPromotionCollisions(existing, PROMO_NAME, EXPECTED_TARGET_VARIATION_ID),
    /Existing test promotion collision detected/,
  );
});

test("10. detects existing active promotion targeting A132-S", () => {
  const existingActive = [
    {
      id: "promo-other",
      name: "OTHER_PROMO",
      is_activated: true,
      items: [{ variation_id: EXPECTED_TARGET_VARIATION_ID }],
    },
  ];
  assert.throws(
    () => checkExistingPromotionCollisions(existingActive, PROMO_NAME, EXPECTED_TARGET_VARIATION_ID),
    /Existing active promotion collision on target variation/,
  );
});

test("11. bounded promotion pagination traverses valid pages", () => {
  assert.doesNotThrow(() => validatePaginationBounds(1, 5, 250, 10, 50));
});

test("12. refuses pagination truncation/overflow", () => {
  assert.throws(
    () => validatePaginationBounds(1, 15, 250, 10, 50),
    /Promotion pagination exceeded safety bounds: total_pages 15 exceeds max 10/,
  );
  assert.throws(
    () => validatePaginationBounds(1, 5, 600, 10, 50),
    /Promotion pagination exceeded safety bounds: total_entries 600 exceeds max 500/,
  );
});

test("13. validates exact created promotion scope", () => {
  const validPromo = {
    id: "promo-uuid-1",
    name: PROMO_NAME,
    type: PROMO_TYPE,
    is_activated: true,
    is_variation: true,
    items: [
      {
        product_id: EXPECTED_TARGET_PRODUCT_ID,
        variation_id: EXPECTED_TARGET_VARIATION_ID,
      },
    ],
  };

  assert.equal(
    validateCreatedPromotionScope(
      validPromo,
      "promo-uuid-1",
      PROMO_NAME,
      PROMO_TYPE,
      EXPECTED_TARGET_PRODUCT_ID,
      EXPECTED_TARGET_VARIATION_ID,
      EXPECTED_PEER_VARIATION_ID,
    ),
    true,
  );
});

test("14. refuses promotion scope containing peer variation or extra items", () => {
  const peerPromo = {
    id: "promo-uuid-1",
    name: PROMO_NAME,
    type: PROMO_TYPE,
    is_activated: true,
    is_variation: true,
    items: [
      {
        product_id: EXPECTED_TARGET_PRODUCT_ID,
        variation_id: EXPECTED_PEER_VARIATION_ID,
      },
    ],
  };
  assert.throws(
    () =>
      validateCreatedPromotionScope(
        peerPromo,
        "promo-uuid-1",
        PROMO_NAME,
        PROMO_TYPE,
        EXPECTED_TARGET_PRODUCT_ID,
        EXPECTED_TARGET_VARIATION_ID,
        EXPECTED_PEER_VARIATION_ID,
      ),
    /does not match expected/,
  );

  const multiItemPromo = {
    id: "promo-uuid-1",
    name: PROMO_NAME,
    type: PROMO_TYPE,
    is_activated: true,
    is_variation: true,
    items: [
      {
        product_id: EXPECTED_TARGET_PRODUCT_ID,
        variation_id: EXPECTED_TARGET_VARIATION_ID,
      },
      {
        product_id: EXPECTED_TARGET_PRODUCT_ID,
        variation_id: EXPECTED_PEER_VARIATION_ID,
      },
    ],
  };
  assert.throws(
    () =>
      validateCreatedPromotionScope(
        multiItemPromo,
        "promo-uuid-1",
        PROMO_NAME,
        PROMO_TYPE,
        EXPECTED_TARGET_PRODUCT_ID,
        EXPECTED_TARGET_VARIATION_ID,
        EXPECTED_PEER_VARIATION_ID,
      ),
    /items length is 2, expected 1/,
  );
});

test("15. target applicability PASS when exact promo ID returned", () => {
  const response = {
    success: true,
    data: [
      {
        promotion_advance_id: "promo-uuid-1",
        promotion_advance_info: {
          id: "promo-uuid-1",
          name: PROMO_NAME,
        },
      },
    ],
  };

  const obs = parsePromotionApplicabilityResponse(response, "promo-uuid-1", EXPECTED_TARGET_VARIATION_ID);
  assert.equal(obs.applicable, true);
  assert.equal(obs.matchedPromotionId, "promo-uuid-1");
  assert.equal(obs.variationId, EXPECTED_TARGET_VARIATION_ID);
});

test("16. target applicability FAIL when promo absent", () => {
  const response = {
    success: true,
    data: null,
  };

  const obs = parsePromotionApplicabilityResponse(response, "promo-uuid-1", EXPECTED_TARGET_VARIATION_ID);
  assert.equal(obs.applicable, false);
  assert.equal(obs.matchedPromotionId, null);
});

test("17. peer negative applicability PASS", () => {
  const response = {
    success: true,
    data: null,
  };

  const obs = parsePromotionApplicabilityResponse(response, "promo-uuid-1", EXPECTED_PEER_VARIATION_ID);
  assert.equal(obs.applicable, false);
  assert.equal(obs.matchedPromotionId, null);
});

test("18. peer applicability fails C5 if promo appears", () => {
  const criteria = deriveExperimentCriteria({
    beforeRetailPrice: 429000,
    beforeRetailPriceAfterDiscount: 429000,
    activeRetailPrice: 429000,
    activeRetailPriceAfterDiscount: 429000,
    activeCollateralUnchanged: true,
    promoId: "promo-1",
    createdPromoScopeValid: true,
    targetApplicability: {
      variationId: EXPECTED_TARGET_VARIATION_ID,
      matchedPromotionId: "promo-1",
      applicable: true,
      observedAt: new Date().toISOString(),
    },
    peerApplicability: {
      variationId: EXPECTED_PEER_VARIATION_ID,
      matchedPromotionId: "promo-1", // leaked to peer!
      applicable: true,
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
    revertPromotionsCount: 0,
  });

  assert.equal(criteria.c5ZeroCollateral, false);
});

test("19. C2 is derived, never hard-coded", () => {
  const failedC2Criteria = deriveExperimentCriteria({
    beforeRetailPrice: 429000,
    beforeRetailPriceAfterDiscount: 429000,
    activeRetailPrice: 429000,
    activeRetailPriceAfterDiscount: 429000,
    activeCollateralUnchanged: true,
    promoId: "promo-1",
    createdPromoScopeValid: true,
    targetApplicability: {
      variationId: EXPECTED_TARGET_VARIATION_ID,
      matchedPromotionId: null,
      applicable: false, // Target failed to match!
      observedAt: new Date().toISOString(),
    },
    peerApplicability: {
      variationId: EXPECTED_PEER_VARIATION_ID,
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
    revertPromotionsCount: 0,
  });

  assert.equal(failedC2Criteria.c2SemanticsProven, false);

  const passedC2Criteria = deriveExperimentCriteria({
    beforeRetailPrice: 429000,
    beforeRetailPriceAfterDiscount: 429000,
    activeRetailPrice: 429000,
    activeRetailPriceAfterDiscount: 429000,
    activeCollateralUnchanged: true,
    promoId: "promo-1",
    createdPromoScopeValid: true,
    targetApplicability: {
      variationId: EXPECTED_TARGET_VARIATION_ID,
      matchedPromotionId: "promo-1",
      applicable: true,
      observedAt: new Date().toISOString(),
    },
    peerApplicability: {
      variationId: EXPECTED_PEER_VARIATION_ID,
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
    revertPromotionsCount: 0,
  });

  assert.equal(passedC2Criteria.c2SemanticsProven, true);
});

test("20. C4 is derived from verified provider response shape", () => {
  const invalidScopeCriteria = deriveExperimentCriteria({
    beforeRetailPrice: 429000,
    beforeRetailPriceAfterDiscount: 429000,
    activeRetailPrice: 429000,
    activeRetailPriceAfterDiscount: 429000,
    activeCollateralUnchanged: true,
    promoId: "promo-1",
    createdPromoScopeValid: false, // invalid scope!
    targetApplicability: {
      variationId: EXPECTED_TARGET_VARIATION_ID,
      matchedPromotionId: "promo-1",
      applicable: true,
      observedAt: new Date().toISOString(),
    },
    peerApplicability: {
      variationId: EXPECTED_PEER_VARIATION_ID,
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
    revertPromotionsCount: 0,
  });

  assert.equal(invalidScopeCriteria.c4ProviderOpenApiAlignment, false);
});

test("21. rollback success verifies cleanly", () => {
  assert.doesNotThrow(() =>
    verifyRollbackState({
      deleteSuccess: true,
      remainingPromotions: [],
      promoId: "promo-1",
      postRollbackTargetApplicability: {
        variationId: EXPECTED_TARGET_VARIATION_ID,
        matchedPromotionId: null,
        applicable: false,
        observedAt: new Date().toISOString(),
      },
      beforeBaseline: { retailPrice: 429000, retailPriceAfterDiscount: 429000 },
      afterVar: { retail_price: 429000, retail_price_after_discount: 429000 },
      collateralUnchanged: true,
    }),
  );
});

test("22. rollback API failure throws ROLLBACK_FAILED", () => {
  assert.throws(
    () =>
      verifyRollbackState({
        deleteSuccess: false,
        remainingPromotions: [],
        promoId: "promo-1",
        postRollbackTargetApplicability: {
          variationId: EXPECTED_TARGET_VARIATION_ID,
          matchedPromotionId: null,
          applicable: false,
          observedAt: new Date().toISOString(),
        },
        beforeBaseline: { retailPrice: 429000, retailPriceAfterDiscount: 429000 },
        afterVar: { retail_price: 429000, retail_price_after_discount: 429000 },
        collateralUnchanged: true,
      }),
    /ROLLBACK_FAILED: Deletion API did not report success/,
  );
});

test("23. promotion still present after delete throws ROLLBACK_FAILED", () => {
  assert.throws(
    () =>
      verifyRollbackState({
        deleteSuccess: true,
        remainingPromotions: [{ id: "promo-1" }],
        promoId: "promo-1",
        postRollbackTargetApplicability: {
          variationId: EXPECTED_TARGET_VARIATION_ID,
          matchedPromotionId: null,
          applicable: false,
          observedAt: new Date().toISOString(),
        },
        beforeBaseline: { retailPrice: 429000, retailPriceAfterDiscount: 429000 },
        afterVar: { retail_price: 429000, retail_price_after_discount: 429000 },
        collateralUnchanged: true,
      }),
    /ROLLBACK_FAILED: Promotion promo-1 is still present in active promotions list after deletion/,
  );
});

test("24. test promotion still applicable after rollback throws ROLLBACK_FAILED", () => {
  assert.throws(
    () =>
      verifyRollbackState({
        deleteSuccess: true,
        remainingPromotions: [],
        promoId: "promo-1",
        postRollbackTargetApplicability: {
          variationId: EXPECTED_TARGET_VARIATION_ID,
          matchedPromotionId: "promo-1",
          applicable: true,
          observedAt: new Date().toISOString(),
        },
        beforeBaseline: { retailPrice: 429000, retailPriceAfterDiscount: 429000 },
        afterVar: { retail_price: 429000, retail_price_after_discount: 429000 },
        collateralUnchanged: true,
      }),
    /ROLLBACK_FAILED: Test promotion promo-1 is still applicable to target variation after deletion/,
  );
});

test("25. catalog baseline mismatch after rollback throws ROLLBACK_FAILED", () => {
  assert.throws(
    () =>
      verifyRollbackState({
        deleteSuccess: true,
        remainingPromotions: [],
        promoId: "promo-1",
        postRollbackTargetApplicability: {
          variationId: EXPECTED_TARGET_VARIATION_ID,
          matchedPromotionId: null,
          applicable: false,
          observedAt: new Date().toISOString(),
        },
        beforeBaseline: { retailPrice: 429000, retailPriceAfterDiscount: 429000 },
        afterVar: { retail_price: 399000, retail_price_after_discount: 399000 },
        collateralUnchanged: true,
      }),
    /ROLLBACK_FAILED: Target catalog price facts do not match baseline after rollback/,
  );
});

test("26. secret-bearing error inputs are sanitized/non-leaking", () => {
  const secret = "super_secret_pancake_key_123456789";
  const err = new Error(`Connection failed with api_key=${secret} at https://pos.pages.fm/api`);
  const sanitized = sanitizeErrorMessage(err, [secret]);
  assert.equal(sanitized.includes(secret), false);
  assert.equal(sanitized.includes("[REDACTED]"), true);
});
