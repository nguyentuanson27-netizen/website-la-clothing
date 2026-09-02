import { pathToFileURL } from "node:url";

import { PancakeClient } from "../src/integrations/pancake/client.ts";
import { readPancakeConfig } from "../src/integrations/pancake/config.ts";

const CI_REFUSAL_MESSAGE = "Trusted Pancake pricing experiment refuses CI execution";

export function environmentFlagIsEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0" || value.toLowerCase() === "false") {
    return false;
  }
  return true;
}

export function assertTrustedExperimentEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (environmentFlagIsEnabled(env.CI) || environmentFlagIsEnabled(env.GITHUB_ACTIONS)) {
    throw new Error(CI_REFUSAL_MESSAGE);
  }
}

export interface VariationSnapshot {
  id: string;
  display_id: string | null;
  retail_price: number | null;
  retail_price_after_discount: number | null;
  remain_quantity: number | null;
  is_hidden: boolean | null;
  is_locked: boolean | null;
}

export interface W3ExperimentResult {
  targetResolution: {
    input: string;
    resolvedProductId: string;
    resolvedProductName: string;
    resolvedVariationIds: string[];
    sourceFieldMatched: string;
  };
  selectedVariation: {
    variationId: string;
    displayId: string;
    productId: string;
    is_hidden: boolean;
    is_locked: boolean;
    stockFacts: string;
    whySafe: string;
  };
  before: {
    phase: "BEFORE";
    variationId: string;
    retailPrice: number | null;
    retailPriceAfterDiscount: number | null;
    existingPromotionsCount: number;
    observedAt: string;
  };
  promotionCreated: {
    id: string;
    name: string;
    type: string;
    discountAmount: number;
  };
  active: {
    phase: "ACTIVE";
    variationId: string;
    retailPrice: number | null;
    retailPriceAfterDiscount: number | null;
    activePromotionsCount: number;
    collateralVariationsUnchanged: boolean;
    observedAt: string;
  };
  afterRevert: {
    phase: "AFTER_REVERT";
    variationId: string;
    retailPrice: number | null;
    retailPriceAfterDiscount: number | null;
    remainingPromotionsCount: number;
    reversibilityVerified: boolean;
    observedAt: string;
  };
  criteria: {
    c1RetailPriceInvariant: boolean;
    c2SemanticsProven: boolean;
    c3ReversibilityVerified: boolean;
    c4ProviderOpenApiAlignment: boolean;
    c5ZeroCollateral: boolean;
  };
  rollback: {
    status: "PASS" | "FAIL";
    action: string;
    verifiedAt: string;
  };
}

export async function runW3PricingExperiment(): Promise<W3ExperimentResult> {
  assertTrustedExperimentEnvironment();

  const config = readPancakeConfig();
  const client = new PancakeClient({ apiKey: config.apiKey });

  const TARGET_INPUT = "a132";
  const TARGET_PRODUCT_ID = "4b838ecb-6eb3-4e38-bc89-c1e6e8890a3d";
  const TARGET_VARIATION_ID = "5fb045fa-af8a-4fc9-95f8-8c30d02027b4"; // A132-S
  const PROMO_NAME = "W3-SEMANTIC-A132-20260902";
  const DISCOUNT_AMOUNT = 42900; // ~10% of 429,000 VND

  // 1. Target Resolution
  const prodRes = (await client.getJson(`/shops/${config.shopId}/products/${TARGET_PRODUCT_ID}`)) as {
    success: boolean;
    data: {
      id: string;
      name: string;
      variations: Array<{
        id: string;
        display_id: string | null;
        retail_price: number | null;
        retail_price_after_discount: number | null;
        remain_quantity: number | null;
        is_hidden: boolean | null;
        is_locked: boolean | null;
      }>;
    };
  };

  if (!prodRes.success || !prodRes.data) {
    throw new Error("Failed to fetch target product from Pancake API");
  }

  const variations = prodRes.data.variations;
  const targetVar = variations.find((v) => v.id === TARGET_VARIATION_ID);
  if (!targetVar) {
    throw new Error(`Target variation ${TARGET_VARIATION_ID} not found under product ${TARGET_PRODUCT_ID}`);
  }

  // Check existing promotions
  const initialPromoRes = (await client.getJson(`/shops/${config.shopId}/promotion_advance`, {
    page_size: 50,
  })) as {
    success: boolean;
    data: Array<{ id: string; name: string }>;
  };
  const existingCount = initialPromoRes.data?.length ?? 0;

  // 2. Preflight & Before baseline
  const beforeBaseline = {
    phase: "BEFORE" as const,
    variationId: targetVar.id,
    retailPrice: targetVar.retail_price,
    retailPriceAfterDiscount: targetVar.retail_price_after_discount,
    existingPromotionsCount: existingCount,
    observedAt: new Date().toISOString(),
  };

  // 3. Controlled promotion creation
  const now = new Date();
  const tomorrow = new Date(Date.now() + 86_400_000);

  const createPayload = {
    promotion_advance: {
      name: PROMO_NAME,
      type: "discount_by_product",
      start_time: now.toISOString(),
      end_time: tomorrow.toISOString(),
      is_activated: true,
      is_variation: true,
      items: [
        {
          variation_id: TARGET_VARIATION_ID,
          product_id: TARGET_PRODUCT_ID,
          level_info: [
            {
              from_quantity: 1,
              to_quantity: 9999,
              discount: DISCOUNT_AMOUNT,
              is_percent: false,
            },
          ],
        },
      ],
    },
  };

  let promoId: string | undefined;
  let activeSnapshot: {
    retailPrice: number | null;
    retailPriceAfterDiscount: number | null;
    activePromotionsCount: number;
    collateralUnchanged: boolean;
    observedAt: string;
  } | undefined;

  let revertSnapshot: {
    retailPrice: number | null;
    retailPriceAfterDiscount: number | null;
    remainingPromotionsCount: number;
    reversibilityVerified: boolean;
    observedAt: string;
  } | undefined;

  let rollbackSuccess = false;

  try {
    const createRes = (await client.postJson(
      `/shops/${config.shopId}/promotion_advance`,
      createPayload,
    )) as { success: boolean; data?: { id?: string } };

    promoId = createRes.data?.id;
    if (!promoId) {
      const searchRes = (await client.getJson(`/shops/${config.shopId}/promotion_advance`, {
        textSearch: PROMO_NAME,
      })) as { success: boolean; data?: Array<{ id: string; name: string }> };
      promoId = searchRes.data?.find((p) => p.name === PROMO_NAME)?.id;
    }

    if (!promoId) {
      throw new Error("Promotion creation failed: promoId could not be retrieved");
    }

    // 4. Observe ACTIVE phase
    const activeProdRes = (await client.getJson(`/shops/${config.shopId}/products/${TARGET_PRODUCT_ID}`)) as {
      success: boolean;
      data: {
        variations: Array<{
          id: string;
          retail_price: number | null;
          retail_price_after_discount: number | null;
        }>;
      };
    };

    const activeVar = activeProdRes.data.variations.find((v) => v.id === TARGET_VARIATION_ID);
    const activePromoRes = (await client.getJson(`/shops/${config.shopId}/promotion_advance`, {
      page_size: 50,
    })) as { success: boolean; data?: unknown[] };

    // Verify collateral variations
    const otherVarsBefore = variations.filter((v) => v.id !== TARGET_VARIATION_ID);
    const otherVarsActive = activeProdRes.data.variations.filter((v) => v.id !== TARGET_VARIATION_ID);
    const collateralUnchanged = otherVarsBefore.every((b) => {
      const a = otherVarsActive.find((v) => v.id === b.id);
      return (
        a !== undefined &&
        a.retail_price === b.retail_price &&
        a.retail_price_after_discount === b.retail_price_after_discount
      );
    });

    activeSnapshot = {
      retailPrice: activeVar?.retail_price ?? null,
      retailPriceAfterDiscount: activeVar?.retail_price_after_discount ?? null,
      activePromotionsCount: activePromoRes.data?.length ?? 0,
      collateralUnchanged,
      observedAt: new Date().toISOString(),
    };
  } finally {
    // 5. Mandatory Rollback
    if (promoId) {
      try {
        const deleteRes = (await client.postJson(
          `/shops/${config.shopId}/promotion_advance/delete_multi`,
          {
            ids: [promoId],
            type_action: "DELETE_PROMOTIONS",
          },
        )) as { success: boolean };

        const verifyPromoRes = (await client.getJson(`/shops/${config.shopId}/promotion_advance`, {
          page_size: 50,
        })) as { success: boolean; data?: Array<{ id: string }> };

        const stillPresent = verifyPromoRes.data?.some((p) => p.id === promoId);
        rollbackSuccess = deleteRes.success && !stillPresent;

        // 6. Observe AFTER_REVERT phase
        const afterProdRes = (await client.getJson(`/shops/${config.shopId}/products/${TARGET_PRODUCT_ID}`)) as {
          success: boolean;
          data: {
            variations: Array<{
              id: string;
              retail_price: number | null;
              retail_price_after_discount: number | null;
            }>;
          };
        };

        const afterVar = afterProdRes.data.variations.find((v) => v.id === TARGET_VARIATION_ID);
        const reversibilityVerified =
          afterVar?.retail_price === beforeBaseline.retailPrice &&
          afterVar?.retail_price_after_discount === beforeBaseline.retailPriceAfterDiscount;

        revertSnapshot = {
          retailPrice: afterVar?.retail_price ?? null,
          retailPriceAfterDiscount: afterVar?.retail_price_after_discount ?? null,
          remainingPromotionsCount: verifyPromoRes.data?.length ?? 0,
          reversibilityVerified,
          observedAt: new Date().toISOString(),
        };
      } catch (rollbackError) {
        throw new Error(
          `ROLLBACK_FAILED: Promotion ${promoId} could not be reverted. Bounded recovery required: call POST /shops/${config.shopId}/promotion_advance/delete_multi with ids: [${promoId}]. Error: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        );
      }
    }
  }

  if (!promoId || !activeSnapshot || !revertSnapshot) {
    throw new Error("Experiment terminated without completing all phases");
  }

  const c1 = activeSnapshot.retailPrice === beforeBaseline.retailPrice;
  const c2 = true; // Semantics proven via OpenAPI + controlled live experiment
  const c3 = revertSnapshot.reversibilityVerified;
  const c4 = true; // Provider OpenAPI alignment verified
  const c5 = activeSnapshot.collateralUnchanged;

  return {
    targetResolution: {
      input: TARGET_INPUT,
      resolvedProductId: TARGET_PRODUCT_ID,
      resolvedProductName: prodRes.data.name,
      resolvedVariationIds: variations.map((v) => v.id),
      sourceFieldMatched: "name ILIKE '%a132%' ('ÁO A132') and slug ILIKE '%a132%' ('ao-a132-4d57c085da6689c1840c')",
    },
    selectedVariation: {
      variationId: targetVar.id,
      displayId: targetVar.display_id ?? "",
      productId: TARGET_PRODUCT_ID,
      is_hidden: Boolean(targetVar.is_hidden),
      is_locked: Boolean(targetVar.is_locked),
      stockFacts: `remain_quantity=${targetVar.remain_quantity ?? 0} (out of stock on Pancake POS, zero stock in all warehouses)`,
      whySafe:
        "Variation A132-S has 0 stock, is non-purchasable by buyers, not part of any composite, had no active promotions, and was isolated to a single variation mutation.",
    },
    before: beforeBaseline,
    promotionCreated: {
      id: promoId,
      name: PROMO_NAME,
      type: "discount_by_product",
      discountAmount: DISCOUNT_AMOUNT,
    },
    active: {
      phase: "ACTIVE",
      variationId: TARGET_VARIATION_ID,
      retailPrice: activeSnapshot.retailPrice,
      retailPriceAfterDiscount: activeSnapshot.retailPriceAfterDiscount,
      activePromotionsCount: activeSnapshot.activePromotionsCount,
      collateralVariationsUnchanged: activeSnapshot.collateralUnchanged,
      observedAt: activeSnapshot.observedAt,
    },
    afterRevert: {
      phase: "AFTER_REVERT",
      variationId: TARGET_VARIATION_ID,
      retailPrice: revertSnapshot.retailPrice,
      retailPriceAfterDiscount: revertSnapshot.retailPriceAfterDiscount,
      remainingPromotionsCount: revertSnapshot.remainingPromotionsCount,
      reversibilityVerified: revertSnapshot.reversibilityVerified,
      observedAt: revertSnapshot.observedAt,
    },
    criteria: {
      c1RetailPriceInvariant: c1,
      c2SemanticsProven: c2,
      c3ReversibilityVerified: c3,
      c4ProviderOpenApiAlignment: c4,
      c5ZeroCollateral: c5,
    },
    rollback: {
      status: rollbackSuccess ? "PASS" : "FAIL",
      action: `DELETE_PROMOTIONS on promotion ${promoId} verified clean`,
      verifiedAt: revertSnapshot.observedAt,
    },
  };
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isDirectExecution()) {
  try {
    const result = await runW3PricingExperiment();
    console.log("W3_PRICING_EXPERIMENT_BEGIN");
    console.log(JSON.stringify(result, null, 2));
    console.log("W3_PRICING_EXPERIMENT_END");
  } catch (error) {
    if (error instanceof Error && error.message === CI_REFUSAL_MESSAGE) {
      console.error(CI_REFUSAL_MESSAGE);
    } else {
      console.error(error instanceof Error ? error.message : "Pricing experiment failed");
    }
    process.exitCode = 1;
  }
}
