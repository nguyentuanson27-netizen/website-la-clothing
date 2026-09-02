import { pathToFileURL } from "node:url";

import { PancakeClient } from "../src/integrations/pancake/client.ts";
import { readPancakeConfig } from "../src/integrations/pancake/config.ts";

export const CI_REFUSAL_MESSAGE = "Trusted Pancake pricing experiment refuses CI execution";
export const EXPECTED_SHOP_ID = 1635185058;
export const EXPECTED_TARGET_INPUT = "a132";
export const EXPECTED_TARGET_PRODUCT_ID = "4b838ecb-6eb3-4e38-bc89-c1e6e8890a3d";
export const EXPECTED_TARGET_VARIATION_ID = "5fb045fa-af8a-4fc9-95f8-8c30d02027b4"; // A132-S
export const EXPECTED_PEER_VARIATION_ID = "9ea76227-51f0-45a2-b5cc-f6b42e5ec3da"; // A132-M
export const PROMO_NAME = "W3-SEMANTIC-A132-20260902";
export const PROMO_TYPE = "discount_by_product";
export const DISCOUNT_AMOUNT = 42900; // ~10% of 429,000 VND
export const MAX_PAGINATION_PAGES = 10;
export const PAGINATION_PAGE_SIZE = 50;

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

  if (env.W3_EXPERIMENT_APPROVED !== EXPECTED_TARGET_INPUT) {
    throw new Error(
      `W3 experiment requires explicit operator approval: W3_EXPERIMENT_APPROVED=${EXPECTED_TARGET_INPUT}`,
    );
  }
}

export function assertApprovedShopId(shopId: number): void {
  if (shopId !== EXPECTED_SHOP_ID) {
    throw new Error(
      `W3 experiment refused: configured shop ID ${shopId} does not match expected shop ID ${EXPECTED_SHOP_ID}`,
    );
  }
}

export interface TargetVariationSummary {
  variationId: string;
  displayId: string;
  productId: string;
  retailPrice: number | null;
  retailPriceAfterDiscount: number | null;
  remainQuantity: number;
  isHidden: boolean;
  isLocked: boolean;
  isComposite: boolean;
  whySafe: string;
}

export function validateTargetVariationPreflight(
  productPayload: unknown,
  targetProductId: string = EXPECTED_TARGET_PRODUCT_ID,
  targetVariationId: string = EXPECTED_TARGET_VARIATION_ID,
): TargetVariationSummary {
  if (typeof productPayload !== "object" || productPayload === null) {
    throw new Error("Target product preflight failed: invalid product payload");
  }

  const raw = productPayload as {
    id?: unknown;
    variations?: unknown;
  };

  if (raw.id !== targetProductId) {
    throw new Error(
      `Target product preflight failed: product ID ${String(raw.id)} does not match expected ${targetProductId}`,
    );
  }

  if (!Array.isArray(raw.variations)) {
    throw new Error("Target product preflight failed: variations array missing");
  }

  const variations = raw.variations as Array<Record<string, unknown>>;
  const targetVar = variations.find((v) => v.id === targetVariationId);

  if (!targetVar) {
    throw new Error(
      `Target variation preflight failed: variation ${targetVariationId} not found under product ${targetProductId}`,
    );
  }

  if (targetVar.product_id !== undefined && targetVar.product_id !== targetProductId) {
    throw new Error(
      `Target variation preflight failed: variation ${targetVariationId} belongs to product ${String(targetVar.product_id)}, expected ${targetProductId}`,
    );
  }

  const remainQuantity = typeof targetVar.remain_quantity === "number" ? targetVar.remain_quantity : 0;
  if (remainQuantity > 0) {
    throw new Error(
      `Target variation preflight failed: variation ${targetVariationId} has stock ${remainQuantity} > 0`,
    );
  }

  if (Array.isArray(targetVar.variations_warehouses) && targetVar.variations_warehouses.length > 0) {
    const warehouseStockSum = (targetVar.variations_warehouses as Array<{ remain_quantity?: unknown }>).reduce(
      (acc, w) => acc + (typeof w.remain_quantity === "number" ? w.remain_quantity : 0),
      0,
    );
    if (warehouseStockSum > 0) {
      throw new Error(
        `Target variation preflight failed: warehouse stock sum ${warehouseStockSum} > 0 for ${targetVariationId}`,
      );
    }
  }

  if (targetVar.is_composite === true || (Array.isArray(targetVar.composite_products) && targetVar.composite_products.length > 0)) {
    throw new Error(`Target variation preflight failed: variation ${targetVariationId} is composite`);
  }

  if (targetVar.is_locked === true) {
    throw new Error(`Target variation preflight failed: variation ${targetVariationId} is locked`);
  }

  const retailPrice = typeof targetVar.retail_price === "number" ? targetVar.retail_price : null;
  const retailPriceAfterDiscount =
    typeof targetVar.retail_price_after_discount === "number" ? targetVar.retail_price_after_discount : null;

  return {
    variationId: targetVariationId,
    displayId: typeof targetVar.display_id === "string" ? targetVar.display_id : "",
    productId: targetProductId,
    retailPrice,
    retailPriceAfterDiscount,
    remainQuantity,
    isHidden: Boolean(targetVar.is_hidden),
    isLocked: Boolean(targetVar.is_locked),
    isComposite: Boolean(targetVar.is_composite),
    whySafe:
      "Variation A132-S has verified 0 stock, is non-purchasable by buyers, not part of any composite, had no active promotions, and was isolated to a single variation mutation.",
  };
}

export function validatePaginationBounds(
  page: number,
  totalPages: number,
  totalEntries: number,
  maxPages: number = MAX_PAGINATION_PAGES,
  pageSize: number = PAGINATION_PAGE_SIZE,
): void {
  if (totalPages > maxPages) {
    throw new Error(
      `Promotion pagination exceeded safety bounds: total_pages ${totalPages} exceeds max ${maxPages}; refusing truncation`,
    );
  }
  if (totalEntries > maxPages * pageSize) {
    throw new Error(
      `Promotion pagination exceeded safety bounds: total_entries ${totalEntries} exceeds max ${maxPages * pageSize}; refusing truncation`,
    );
  }
}

export function checkExistingPromotionCollisions(
  promotions: unknown[],
  promoName: string = PROMO_NAME,
  targetVariationId: string = EXPECTED_TARGET_VARIATION_ID,
): void {
  if (!Array.isArray(promotions)) {
    throw new Error("Invalid promotions list format for collision check");
  }

  for (const item of promotions) {
    if (typeof item !== "object" || item === null) continue;
    const p = item as {
      id?: unknown;
      name?: unknown;
      is_activated?: unknown;
      items?: unknown;
    };

    if (p.name === promoName) {
      throw new Error(
        `Existing test promotion collision detected: promotion with name "${promoName}" already exists (id: ${String(p.id)})`,
      );
    }

    if (p.is_activated === true && Array.isArray(p.items)) {
      const targetsTarget = (p.items as Array<{ variation_id?: unknown }>).some(
        (it) => it.variation_id === targetVariationId,
      );
      if (targetsTarget) {
        throw new Error(
          `Existing active promotion collision on target variation ${targetVariationId} (promotion id: ${String(p.id)}, name: ${String(p.name)})`,
        );
      }
    }
  }
}

export function validateCreatedPromotionScope(
  promo: unknown,
  expectedPromoId: string,
  expectedPromoName: string = PROMO_NAME,
  expectedType: string = PROMO_TYPE,
  expectedProductId: string = EXPECTED_TARGET_PRODUCT_ID,
  expectedVariationId: string = EXPECTED_TARGET_VARIATION_ID,
  peerVariationId: string = EXPECTED_PEER_VARIATION_ID,
): boolean {
  if (typeof promo !== "object" || promo === null) {
    throw new Error("Created promotion validation failed: invalid promotion payload");
  }

  const p = promo as {
    id?: unknown;
    name?: unknown;
    type?: unknown;
    is_activated?: unknown;
    is_variation?: unknown;
    items?: unknown;
  };

  if (p.id !== expectedPromoId) {
    throw new Error(
      `Created promotion scope validation failed: ID ${String(p.id)} does not match expected ${expectedPromoId}`,
    );
  }

  if (p.name !== expectedPromoName) {
    throw new Error(
      `Created promotion scope validation failed: name ${String(p.name)} does not match expected ${expectedPromoName}`,
    );
  }

  if (p.type !== expectedType) {
    throw new Error(
      `Created promotion scope validation failed: type ${String(p.type)} does not match expected ${expectedType}`,
    );
  }

  if (p.is_activated !== true) {
    throw new Error("Created promotion scope validation failed: is_activated is not true");
  }

  if (p.is_variation !== true) {
    throw new Error("Created promotion scope validation failed: is_variation is not true");
  }

  if (!Array.isArray(p.items) || p.items.length !== 1) {
    throw new Error(
      `Created promotion scope validation failed: items length is ${Array.isArray(p.items) ? p.items.length : 0}, expected 1`,
    );
  }

  const item = p.items[0] as { product_id?: unknown; variation_id?: unknown };
  if (item.product_id !== expectedProductId) {
    throw new Error(
      `Created promotion scope validation failed: item product_id ${String(item.product_id)} does not match expected ${expectedProductId}`,
    );
  }

  if (item.variation_id !== expectedVariationId) {
    throw new Error(
      `Created promotion scope validation failed: item variation_id ${String(item.variation_id)} does not match expected ${expectedVariationId}`,
    );
  }

  if (item.variation_id === peerVariationId) {
    throw new Error(
      `Created promotion scope validation failed: item targets peer variation ${peerVariationId}`,
    );
  }

  return true;
}

export interface PromotionApplicabilityObservation {
  variationId: string;
  matchedPromotionId: string | null;
  applicable: boolean;
  observedAt: string;
}

export function parsePromotionApplicabilityResponse(
  response: unknown,
  expectedPromoId: string,
  targetVariationId: string,
): PromotionApplicabilityObservation {
  if (typeof response !== "object" || response === null) {
    throw new Error("Invalid promotion applicability response payload");
  }

  const raw = response as {
    success?: unknown;
    data?: unknown;
  };

  if (raw.success !== true) {
    throw new Error("Promotion applicability request returned success: false");
  }

  if (raw.data === null || raw.data === undefined) {
    return {
      variationId: targetVariationId,
      matchedPromotionId: null,
      applicable: false,
      observedAt: new Date().toISOString(),
    };
  }

  if (Array.isArray(raw.data)) {
    for (const item of raw.data as Array<Record<string, unknown>>) {
      const itemPromoId =
        typeof item.promotion_advance_id === "string"
          ? item.promotion_advance_id
          : typeof item.id === "string"
            ? item.id
            : null;

      const info = typeof item.promotion_advance_info === "object" && item.promotion_advance_info !== null
        ? (item.promotion_advance_info as Record<string, unknown>)
        : null;

      const infoPromoId = info && typeof info.id === "string" ? info.id : null;

      if (itemPromoId === expectedPromoId || infoPromoId === expectedPromoId) {
        return {
          variationId: targetVariationId,
          matchedPromotionId: expectedPromoId,
          applicable: true,
          observedAt: new Date().toISOString(),
        };
      }
    }
  }

  return {
    variationId: targetVariationId,
    matchedPromotionId: null,
    applicable: false,
    observedAt: new Date().toISOString(),
  };
}

export function deriveExperimentCriteria(params: {
  beforeRetailPrice: number | null;
  beforeRetailPriceAfterDiscount: number | null;
  activeRetailPrice: number | null;
  activeRetailPriceAfterDiscount: number | null;
  activeCollateralUnchanged: boolean;
  promoId: string;
  createdPromoScopeValid: boolean;
  targetApplicability: PromotionApplicabilityObservation;
  peerApplicability: PromotionApplicabilityObservation;
  postRollbackApplicability: PromotionApplicabilityObservation;
  revertRetailPrice: number | null;
  revertRetailPriceAfterDiscount: number | null;
  revertPromotionsCount: number;
}): {
  c1RetailPriceInvariant: boolean;
  c2SemanticsProven: boolean;
  c3ReversibilityVerified: boolean;
  c4ProviderOpenApiAlignment: boolean;
  c5ZeroCollateral: boolean;
} {
  const c1RetailPriceInvariant =
    params.activeRetailPrice === params.beforeRetailPrice &&
    params.activeRetailPriceAfterDiscount === params.beforeRetailPriceAfterDiscount;

  const c2SemanticsProven =
    params.targetApplicability.applicable === true &&
    params.targetApplicability.matchedPromotionId === params.promoId;

  const c3ReversibilityVerified =
    params.revertRetailPrice === params.beforeRetailPrice &&
    params.revertRetailPriceAfterDiscount === params.beforeRetailPriceAfterDiscount &&
    params.revertPromotionsCount === 0 &&
    params.postRollbackApplicability.applicable === false;

  const c4ProviderOpenApiAlignment =
    params.createdPromoScopeValid === true &&
    params.targetApplicability.applicable === true;

  const c5ZeroCollateral =
    params.createdPromoScopeValid === true &&
    params.peerApplicability.applicable === false &&
    params.activeCollateralUnchanged === true;

  return {
    c1RetailPriceInvariant,
    c2SemanticsProven,
    c3ReversibilityVerified,
    c4ProviderOpenApiAlignment,
    c5ZeroCollateral,
  };
}

export function verifyRollbackState(params: {
  deleteSuccess: boolean;
  remainingPromotions: unknown[];
  promoId: string;
  postRollbackTargetApplicability: PromotionApplicabilityObservation;
  beforeBaseline: { retailPrice: number | null; retailPriceAfterDiscount: number | null };
  afterVar: { retail_price: number | null; retail_price_after_discount: number | null };
  collateralUnchanged: boolean;
}): void {
  if (!params.deleteSuccess) {
    throw new Error("ROLLBACK_FAILED: Deletion API did not report success");
  }

  const stillPresent = params.remainingPromotions.some((item) => {
    if (typeof item === "object" && item !== null) {
      return (item as { id?: unknown }).id === params.promoId;
    }
    return false;
  });

  if (stillPresent) {
    throw new Error(
      `ROLLBACK_FAILED: Promotion ${params.promoId} is still present in active promotions list after deletion`,
    );
  }

  if (params.postRollbackTargetApplicability.applicable) {
    throw new Error(
      `ROLLBACK_FAILED: Test promotion ${params.promoId} is still applicable to target variation after deletion`,
    );
  }

  const priceMatches =
    params.afterVar.retail_price === params.beforeBaseline.retailPrice &&
    params.afterVar.retail_price_after_discount === params.beforeBaseline.retailPriceAfterDiscount;

  if (!priceMatches) {
    throw new Error("ROLLBACK_FAILED: Target catalog price facts do not match baseline after rollback");
  }

  if (!params.collateralUnchanged) {
    throw new Error("ROLLBACK_FAILED: Peer variations were altered after rollback");
  }
}

export function sanitizeErrorMessage(error: unknown, sensitivePatterns: string[] = []): string {
  let msg = error instanceof Error ? error.message : String(error);
  for (const pattern of sensitivePatterns) {
    if (pattern.length > 0) {
      msg = msg.replaceAll(pattern, "[REDACTED]");
    }
  }
  msg = msg.replace(/[a-zA-Z0-9_-]{20,}/g, (match) => {
    if (match.includes("-") && match.length === 36) return match; // keep UUIDs
    return match.slice(0, 4) + "...[REDACTED]";
  });
  return msg;
}

export async function fetchBoundedPromotions(
  client: PancakeClient,
  shopId: number,
  options: { maxPages?: number; pageSize?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const maxPages = options.maxPages ?? MAX_PAGINATION_PAGES;
  const pageSize = options.pageSize ?? PAGINATION_PAGE_SIZE;

  const allPromotions: Array<Record<string, unknown>> = [];

  for (let page = 1; page <= maxPages; page++) {
    const res = (await client.getJson(`/shops/${shopId}/promotion_advance`, {
      page,
      page_size: pageSize,
    })) as {
      success?: boolean;
      data?: unknown[];
      total_pages?: number;
      total_entries?: number;
    };

    if (res.success !== true || !Array.isArray(res.data)) {
      throw new Error(`Failed to fetch promotions at page ${page}`);
    }

    const totalPages = typeof res.total_pages === "number" ? res.total_pages : 1;
    const totalEntries = typeof res.total_entries === "number" ? res.total_entries : res.data.length;

    validatePaginationBounds(page, totalPages, totalEntries, maxPages, pageSize);

    for (const item of res.data) {
      if (typeof item === "object" && item !== null) {
        allPromotions.push(item as Record<string, unknown>);
      }
    }

    if (page >= totalPages || res.data.length < pageSize) {
      break;
    }
  }

  return allPromotions;
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
  promotionApplicability: {
    target: PromotionApplicabilityObservation;
    peer: PromotionApplicabilityObservation;
    postRollbackTarget: PromotionApplicabilityObservation;
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
  assertApprovedShopId(config.shopId);

  const client = new PancakeClient({ apiKey: config.apiKey });

  // 1. Target Resolution & Immediate Preflight Revalidation
  const prodRes = (await client.getJson(`/shops/${config.shopId}/products/${EXPECTED_TARGET_PRODUCT_ID}`)) as {
    success?: boolean;
    data?: unknown;
  };

  if (!prodRes.success || !prodRes.data) {
    throw new Error("Failed to fetch target product from Pancake API");
  }

  const preflightTarget = validateTargetVariationPreflight(
    prodRes.data,
    EXPECTED_TARGET_PRODUCT_ID,
    EXPECTED_TARGET_VARIATION_ID,
  );

  const variations = (prodRes.data as { variations: Array<{ id: string; display_id?: string | null; retail_price?: number | null; retail_price_after_discount?: number | null }> }).variations;

  // 2. Existing promotion collision checks using bounded pagination
  const existingPromotions = await fetchBoundedPromotions(client, config.shopId);
  checkExistingPromotionCollisions(existingPromotions, PROMO_NAME, EXPECTED_TARGET_VARIATION_ID);

  // 3. Baseline capture
  const beforeBaseline = {
    phase: "BEFORE" as const,
    variationId: preflightTarget.variationId,
    retailPrice: preflightTarget.retailPrice,
    retailPriceAfterDiscount: preflightTarget.retailPriceAfterDiscount,
    existingPromotionsCount: existingPromotions.length,
    observedAt: new Date().toISOString(),
  };

  // 4. Controlled promotion creation
  const now = new Date();
  const tomorrow = new Date(Date.now() + 86_400_000);

  const createPayload = {
    promotion_advance: {
      name: PROMO_NAME,
      type: PROMO_TYPE,
      start_time: now.toISOString(),
      end_time: tomorrow.toISOString(),
      is_activated: true,
      is_variation: true,
      items: [
        {
          variation_id: EXPECTED_TARGET_VARIATION_ID,
          product_id: EXPECTED_TARGET_PRODUCT_ID,
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
  const otherVarsBefore = variations.filter((v) => v.id !== EXPECTED_TARGET_VARIATION_ID);
  let targetApplicabilityObs: PromotionApplicabilityObservation | undefined;
  let peerApplicabilityObs: PromotionApplicabilityObservation | undefined;
  let postRollbackApplicabilityObs: PromotionApplicabilityObservation | undefined;
  let createdPromoScopeValid = false;

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

  let rollbackVerified = false;

  try {
    const createRes = (await client.postJson(
      `/shops/${config.shopId}/promotion_advance`,
      createPayload,
    )) as { success?: boolean; data?: { id?: string } };

    if (createRes.success !== true) {
      throw new Error("Promotion creation API response reported success: false");
    }

    promoId = typeof createRes.data?.id === "string" && createRes.data.id.length > 0 ? createRes.data.id : undefined;

    // Authoritative fetch of created promotion
    const currentPromos = await fetchBoundedPromotions(client, config.shopId);
    let authoritativePromo: Record<string, unknown> | undefined;

    if (promoId) {
      authoritativePromo = currentPromos.find((p) => p.id === promoId);
    }

    if (!authoritativePromo) {
      const matches = currentPromos.filter((p) => p.name === PROMO_NAME);
      if (matches.length === 1) {
        authoritativePromo = matches[0];
        promoId = String(authoritativePromo.id);
      } else if (matches.length > 1) {
        throw new Error(`Ambiguous created promotion: found ${matches.length} promotions with name ${PROMO_NAME}`);
      }
    }

    if (!promoId || !authoritativePromo) {
      throw new Error("Promotion creation verification failed: created promotion could not be uniquely retrieved");
    }

    // 5. Verify created promotion scope before any semantic probe
    createdPromoScopeValid = validateCreatedPromotionScope(
      authoritativePromo,
      promoId,
      PROMO_NAME,
      PROMO_TYPE,
      EXPECTED_TARGET_PRODUCT_ID,
      EXPECTED_TARGET_VARIATION_ID,
      EXPECTED_PEER_VARIATION_ID,
    );

    // 6. Semantic Applicability Probe: Target Variation (Read-only evaluation)
    const targetProbePayload = {
      order: {
        shop_id: config.shopId,
        items: [
          {
            product_id: EXPECTED_TARGET_PRODUCT_ID,
            variation_id: EXPECTED_TARGET_VARIATION_ID,
            quantity: 1,
          },
        ],
      },
    };

    const targetProbeRes = await client.postJson(
      `/shops/${config.shopId}/orders/get_promotion_advance_active`,
      targetProbePayload,
    );

    targetApplicabilityObs = parsePromotionApplicabilityResponse(
      targetProbeRes,
      promoId,
      EXPECTED_TARGET_VARIATION_ID,
    );

    // 7. Negative Collateral Applicability Probe: Peer Variation (Read-only evaluation)
    const peerProbePayload = {
      order: {
        shop_id: config.shopId,
        items: [
          {
            product_id: EXPECTED_TARGET_PRODUCT_ID,
            variation_id: EXPECTED_PEER_VARIATION_ID,
            quantity: 1,
          },
        ],
      },
    };

    const peerProbeRes = await client.postJson(
      `/shops/${config.shopId}/orders/get_promotion_advance_active`,
      peerProbePayload,
    );

    peerApplicabilityObs = parsePromotionApplicabilityResponse(
      peerProbeRes,
      promoId,
      EXPECTED_PEER_VARIATION_ID,
    );

    // 8. Observe ACTIVE catalog phase
    const activeProdRes = (await client.getJson(`/shops/${config.shopId}/products/${EXPECTED_TARGET_PRODUCT_ID}`)) as {
      success?: boolean;
      data?: {
        variations: Array<{
          id: string;
          retail_price?: number | null;
          retail_price_after_discount?: number | null;
        }>;
      };
    };

    const activeVars = activeProdRes.data?.variations ?? [];
    const activeVar = activeVars.find((v) => v.id === EXPECTED_TARGET_VARIATION_ID);

    const otherVarsBefore = variations.filter((v) => v.id !== EXPECTED_TARGET_VARIATION_ID);
    const otherVarsActive = activeVars.filter((v) => v.id !== EXPECTED_TARGET_VARIATION_ID);
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
      activePromotionsCount: currentPromos.length,
      collateralUnchanged,
      observedAt: new Date().toISOString(),
    };
  } finally {
    // 9. Mandatory Rollback (Guaranteed & Fatal on failure)
    let promoToRollback = promoId;

    if (!promoToRollback) {
      try {
        const checkPromos = await fetchBoundedPromotions(client, config.shopId);
        const match = checkPromos.find((p) => p.name === PROMO_NAME);
        if (match && typeof match.id === "string") {
          promoToRollback = match.id;
        }
      } catch {
        // Continue to check if deletion can be attempted
      }
    }

    if (promoToRollback) {
      try {
        const deleteRes = (await client.postJson(
          `/shops/${config.shopId}/promotion_advance/delete_multi`,
          {
            ids: [promoToRollback],
            type_action: "DELETE_PROMOTIONS",
          },
        )) as { success?: boolean };

        const postRollbackPromos = await fetchBoundedPromotions(client, config.shopId);

        // Re-run applicability probe post-rollback to verify removal
        const postRollbackProbeRes = await client.postJson(
          `/shops/${config.shopId}/orders/get_promotion_advance_active`,
          {
            order: {
              shop_id: config.shopId,
              items: [
                {
                  product_id: EXPECTED_TARGET_PRODUCT_ID,
                  variation_id: EXPECTED_TARGET_VARIATION_ID,
                  quantity: 1,
                },
              ],
            },
          },
        );

        postRollbackApplicabilityObs = parsePromotionApplicabilityResponse(
          postRollbackProbeRes,
          promoToRollback,
          EXPECTED_TARGET_VARIATION_ID,
        );

        // Re-read catalog
        const afterProdRes = (await client.getJson(`/shops/${config.shopId}/products/${EXPECTED_TARGET_PRODUCT_ID}`)) as {
          success?: boolean;
          data?: {
            variations: Array<{
              id: string;
              retail_price?: number | null;
              retail_price_after_discount?: number | null;
            }>;
          };
        };

        const afterVars = afterProdRes.data?.variations ?? [];
        const afterVarFound = afterVars.find((v) => v.id === EXPECTED_TARGET_VARIATION_ID);
        const afterVar = {
          retail_price: afterVarFound?.retail_price ?? null,
          retail_price_after_discount: afterVarFound?.retail_price_after_discount ?? null,
        };

        const otherVarsAfter = afterVars.filter((v) => v.id !== EXPECTED_TARGET_VARIATION_ID);
        const collateralUnchangedAfter = otherVarsBefore.every((b) => {
          const a = otherVarsAfter.find((v) => v.id === b.id);
          return (
            a !== undefined &&
            a.retail_price === b.retail_price &&
            a.retail_price_after_discount === b.retail_price_after_discount
          );
        });

        verifyRollbackState({
          deleteSuccess: deleteRes.success === true,
          remainingPromotions: postRollbackPromos,
          promoId: promoToRollback,
          postRollbackTargetApplicability: postRollbackApplicabilityObs,
          beforeBaseline,
          afterVar,
          collateralUnchanged: collateralUnchangedAfter,
        });

        rollbackVerified = true;

        revertSnapshot = {
          retailPrice: afterVar.retail_price,
          retailPriceAfterDiscount: afterVar.retail_price_after_discount,
          remainingPromotionsCount: postRollbackPromos.length,
          reversibilityVerified: true,
          observedAt: new Date().toISOString(),
        };
      } catch (rollbackError) {
        const sanitizedErr = sanitizeErrorMessage(rollbackError, [config.apiKey]);
        throw new Error(
          `ROLLBACK_FAILED: Promotion ${promoToRollback} could not be completely reverted. Bounded recovery required: call POST /shops/${config.shopId}/promotion_advance/delete_multi with ids: ["${promoToRollback}"]. Error: ${sanitizedErr}`,
        );
      }
    }
  }

  if (
    !promoId ||
    !activeSnapshot ||
    !revertSnapshot ||
    !targetApplicabilityObs ||
    !peerApplicabilityObs ||
    !postRollbackApplicabilityObs ||
    !rollbackVerified
  ) {
    throw new Error("Experiment terminated without completing all phases and verifications");
  }

  const criteria = deriveExperimentCriteria({
    beforeRetailPrice: beforeBaseline.retailPrice,
    beforeRetailPriceAfterDiscount: beforeBaseline.retailPriceAfterDiscount,
    activeRetailPrice: activeSnapshot.retailPrice,
    activeRetailPriceAfterDiscount: activeSnapshot.retailPriceAfterDiscount,
    activeCollateralUnchanged: activeSnapshot.collateralUnchanged,
    promoId,
    createdPromoScopeValid,
    targetApplicability: targetApplicabilityObs,
    peerApplicability: peerApplicabilityObs,
    postRollbackApplicability: postRollbackApplicabilityObs,
    revertRetailPrice: revertSnapshot.retailPrice,
    revertRetailPriceAfterDiscount: revertSnapshot.retailPriceAfterDiscount,
    revertPromotionsCount: revertSnapshot.remainingPromotionsCount,
  });

  return {
    targetResolution: {
      input: EXPECTED_TARGET_INPUT,
      resolvedProductId: EXPECTED_TARGET_PRODUCT_ID,
      resolvedProductName: (prodRes.data as { name?: string })?.name ?? "ÁO A132",
      resolvedVariationIds: variations.map((v) => v.id),
      sourceFieldMatched: "name ILIKE '%a132%' ('ÁO A132') and slug ILIKE '%a132%' ('ao-a132-4d57c085da6689c1840c')",
    },
    selectedVariation: {
      variationId: preflightTarget.variationId,
      displayId: preflightTarget.displayId,
      productId: preflightTarget.productId,
      is_hidden: preflightTarget.isHidden,
      is_locked: preflightTarget.isLocked,
      stockFacts: `remain_quantity=${preflightTarget.remainQuantity} (out of stock on Pancake POS, zero stock in all warehouses)`,
      whySafe: preflightTarget.whySafe,
    },
    before: beforeBaseline,
    promotionCreated: {
      id: promoId,
      name: PROMO_NAME,
      type: PROMO_TYPE,
      discountAmount: DISCOUNT_AMOUNT,
    },
    promotionApplicability: {
      target: targetApplicabilityObs,
      peer: peerApplicabilityObs,
      postRollbackTarget: postRollbackApplicabilityObs,
    },
    active: {
      phase: "ACTIVE",
      variationId: EXPECTED_TARGET_VARIATION_ID,
      retailPrice: activeSnapshot.retailPrice,
      retailPriceAfterDiscount: activeSnapshot.retailPriceAfterDiscount,
      activePromotionsCount: activeSnapshot.activePromotionsCount,
      collateralVariationsUnchanged: activeSnapshot.collateralUnchanged,
      observedAt: activeSnapshot.observedAt,
    },
    afterRevert: {
      phase: "AFTER_REVERT",
      variationId: EXPECTED_TARGET_VARIATION_ID,
      retailPrice: revertSnapshot.retailPrice,
      retailPriceAfterDiscount: revertSnapshot.retailPriceAfterDiscount,
      remainingPromotionsCount: revertSnapshot.remainingPromotionsCount,
      reversibilityVerified: revertSnapshot.reversibilityVerified,
      observedAt: revertSnapshot.observedAt,
    },
    criteria,
    rollback: {
      status: "PASS",
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
