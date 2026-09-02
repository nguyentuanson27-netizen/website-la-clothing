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

  const raw = productPayload as { id?: unknown; variations?: unknown };
  if (raw.id !== targetProductId) {
    throw new Error(
      `Target product preflight failed: product ID ${String(raw.id)} does not match expected ${targetProductId}`,
    );
  }
  if (!Array.isArray(raw.variations)) {
    throw new Error("Target product preflight failed: variations array missing");
  }

  const variations = raw.variations as Array<Record<string, unknown>>;
  const targetVar = variations.find((variation) => variation.id === targetVariationId);
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

  const rawRemainQuantity = targetVar.remain_quantity;
  if (
    typeof rawRemainQuantity !== "number" ||
    !Number.isSafeInteger(rawRemainQuantity) ||
    rawRemainQuantity < 0 ||
    rawRemainQuantity % 1 !== 0
  ) {
    throw new Error(
      `Target variation preflight failed: remain_quantity must be the safe integer 0 for ${targetVariationId}`,
    );
  }
  if (rawRemainQuantity > 0) {
    throw new Error(
      `Target variation preflight failed: variation ${targetVariationId} has stock ${rawRemainQuantity} > 0`,
    );
  }

  const warehouses = targetVar.variations_warehouses;
  if (warehouses !== undefined) {
    if (!Array.isArray(warehouses)) {
      throw new Error(
        `Target variation preflight failed: variations_warehouses must be an array when present for ${targetVariationId}`,
      );
    }

    let warehouseStockSum = 0;
    for (const [index, warehouse] of warehouses.entries()) {
      if (typeof warehouse !== "object" || warehouse === null) {
        throw new Error(
          `Target variation preflight failed: warehouse remain_quantity must be the safe integer 0 at index ${index}`,
        );
      }
      const warehouseRemain = (warehouse as { remain_quantity?: unknown }).remain_quantity;
      if (
        typeof warehouseRemain !== "number" ||
        !Number.isSafeInteger(warehouseRemain) ||
        warehouseRemain < 0 ||
        warehouseRemain % 1 !== 0
      ) {
        throw new Error(
          `Target variation preflight failed: warehouse remain_quantity must be the safe integer 0 at index ${index}`,
        );
      }
      warehouseStockSum += warehouseRemain;
    }

    if (warehouseStockSum > 0) {
      throw new Error(
        `Target variation preflight failed: warehouse remain_quantity must be the safe integer 0; warehouse stock sum ${warehouseStockSum} > 0 for ${targetVariationId}`,
      );
    }
  }

  if (
    targetVar.is_composite === true ||
    (Array.isArray(targetVar.composite_products) && targetVar.composite_products.length > 0)
  ) {
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
    remainQuantity: rawRemainQuantity,
    isHidden: Boolean(targetVar.is_hidden),
    isLocked: Boolean(targetVar.is_locked),
    isComposite: Boolean(targetVar.is_composite),
    whySafe:
      "Variation A132-S has verified aggregate stock 0, any present warehouse stock facts are valid and zero, it is not part of any composite, had no active promotions, and was isolated to a single variation mutation.",
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

function readOptionalPaginationInteger(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Invalid promotion pagination metadata: ${field} must be a non-negative safe integer`);
  }
  return value;
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
    if (typeof item !== "object" || item === null) {
      throw new Error("Invalid promotion entry in collision check");
    }
    const promotion = item as {
      id?: unknown;
      name?: unknown;
      is_activated?: unknown;
      items?: unknown;
    };

    if (promotion.name === promoName) {
      throw new Error(
        `Existing test promotion collision detected: promotion with name "${promoName}" already exists (id: ${String(promotion.id)})`,
      );
    }

    if (promotion.is_activated === true) {
      if (!Array.isArray(promotion.items)) {
        throw new Error(
          `Existing active promotion ${String(promotion.id)} has malformed items; refusing target-collision inference`,
        );
      }
      const targetsTarget = (promotion.items as Array<{ variation_id?: unknown }>).some(
        (entry) => entry.variation_id === targetVariationId,
      );
      if (targetsTarget) {
        throw new Error(
          `Existing active promotion collision on target variation ${targetVariationId} (promotion id: ${String(promotion.id)}, name: ${String(promotion.name)})`,
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

  const promotion = promo as {
    id?: unknown;
    name?: unknown;
    type?: unknown;
    is_activated?: unknown;
    is_variation?: unknown;
    items?: unknown;
  };

  if (promotion.id !== expectedPromoId) {
    throw new Error(
      `Created promotion scope validation failed: ID ${String(promotion.id)} does not match expected ${expectedPromoId}`,
    );
  }
  if (promotion.name !== expectedPromoName) {
    throw new Error(
      `Created promotion scope validation failed: name ${String(promotion.name)} does not match expected ${expectedPromoName}`,
    );
  }
  if (promotion.type !== expectedType) {
    throw new Error(
      `Created promotion scope validation failed: type ${String(promotion.type)} does not match expected ${expectedType}`,
    );
  }
  if (promotion.is_activated !== true) {
    throw new Error("Created promotion scope validation failed: is_activated is not true");
  }
  if (promotion.is_variation !== true) {
    throw new Error("Created promotion scope validation failed: is_variation is not true");
  }
  if (!Array.isArray(promotion.items) || promotion.items.length !== 1) {
    throw new Error(
      `Created promotion scope validation failed: items length is ${Array.isArray(promotion.items) ? promotion.items.length : 0}, expected 1`,
    );
  }

  const item = promotion.items[0] as { product_id?: unknown; variation_id?: unknown };
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

  const raw = response as { success?: unknown; data?: unknown };
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

  if (!Array.isArray(raw.data)) {
    throw new Error("Invalid promotion applicability response data: expected array or null");
  }

  for (const item of raw.data as Array<Record<string, unknown>>) {
    const itemPromoId =
      typeof item.promotion_advance_id === "string"
        ? item.promotion_advance_id
        : typeof item.id === "string"
          ? item.id
          : null;
    const info =
      typeof item.promotion_advance_info === "object" && item.promotion_advance_info !== null
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

  return {
    variationId: targetVariationId,
    matchedPromotionId: null,
    applicable: false,
    observedAt: new Date().toISOString(),
  };
}

export interface ExperimentCriteria {
  c1RetailPriceInvariant: boolean;
  c2SemanticsProven: boolean;
  c3ReversibilityVerified: boolean;
  c4ProviderOpenApiAlignment: boolean;
  c5ZeroCollateral: boolean;
}

export function deriveExperimentCriteria(params: {
  beforeRetailPrice: number | null;
  beforeRetailPriceAfterDiscount: number | null;
  beforePromotionsCount?: number;
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
}): ExperimentCriteria {
  const c1RetailPriceInvariant =
    params.activeRetailPrice === params.beforeRetailPrice &&
    params.activeRetailPriceAfterDiscount === params.beforeRetailPriceAfterDiscount;
  const c2SemanticsProven =
    params.targetApplicability.applicable === true &&
    params.targetApplicability.matchedPromotionId === params.promoId;
  const c3ReversibilityVerified =
    params.revertRetailPrice === params.beforeRetailPrice &&
    params.revertRetailPriceAfterDiscount === params.beforeRetailPriceAfterDiscount &&
    params.revertPromotionsCount === (params.beforePromotionsCount ?? 0) &&
    params.postRollbackApplicability.applicable === false;
  const c4ProviderOpenApiAlignment =
    params.createdPromoScopeValid === true &&
    params.targetApplicability.applicable === true &&
    params.targetApplicability.matchedPromotionId === params.promoId;
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

export function assertExperimentCriteriaSatisfied(criteria: ExperimentCriteria): void {
  const failedCriteria = Object.entries(criteria)
    .filter(([, passed]) => passed !== true)
    .map(([name]) => name);
  if (failedCriteria.length > 0) {
    throw new Error(`W3_EXPERIMENT_CRITERIA_FAILED: ${failedCriteria.join(", ")}`);
  }
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
  let message = error instanceof Error ? error.message : String(error);
  for (const pattern of sensitivePatterns) {
    if (pattern.length > 0) {
      message = message.replaceAll(pattern, "[REDACTED]");
    }
  }
  message = message.replace(/[a-zA-Z0-9_-]{20,}/g, (match) => {
    if (match.includes("-") && match.length === 36) return match;
    return `${match.slice(0, 4)}...[REDACTED]`;
  });
  return message;
}

export async function fetchBoundedPromotions(
  client: PancakeClient,
  shopId: number,
  options: { maxPages?: number; pageSize?: number } = {},
): Promise<Array<Record<string, unknown>>> {
  const maxPages = options.maxPages ?? MAX_PAGINATION_PAGES;
  const pageSize = options.pageSize ?? PAGINATION_PAGE_SIZE;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new Error("Promotion pagination safety bounds must be positive safe integers");
  }

  const allPromotions: Array<Record<string, unknown>> = [];
  let declaredTotalPages: number | null = null;
  let declaredTotalEntries: number | null = null;

  for (let page = 1; page <= maxPages; page += 1) {
    const response = (await client.getJson(`/shops/${shopId}/promotion_advance`, {
      page,
      page_size: pageSize,
    })) as {
      success?: unknown;
      data?: unknown;
      total_pages?: unknown;
      total_entries?: unknown;
    };

    if (response.success !== true || !Array.isArray(response.data)) {
      throw new Error(`Failed to fetch promotions at page ${page}`);
    }

    const currentTotalPages = readOptionalPaginationInteger(response.total_pages, "total_pages");
    const currentTotalEntries = readOptionalPaginationInteger(response.total_entries, "total_entries");

    if (currentTotalPages !== null) {
      if (declaredTotalPages !== null && currentTotalPages !== declaredTotalPages) {
        throw new Error("Promotion pagination metadata changed total_pages during traversal");
      }
      declaredTotalPages = currentTotalPages;
    }
    if (currentTotalEntries !== null) {
      if (declaredTotalEntries !== null && currentTotalEntries !== declaredTotalEntries) {
        throw new Error("Promotion pagination metadata changed total_entries during traversal");
      }
      declaredTotalEntries = currentTotalEntries;
    }

    const pagesFromEntries =
      declaredTotalEntries === null ? null : Math.max(1, Math.ceil(declaredTotalEntries / pageSize));
    if (
      declaredTotalPages !== null &&
      pagesFromEntries !== null &&
      declaredTotalPages < pagesFromEntries
    ) {
      throw new Error("Promotion pagination metadata is inconsistent and could truncate results");
    }

    const expectedPages = declaredTotalPages ?? pagesFromEntries;
    if (expectedPages !== null) {
      validatePaginationBounds(
        page,
        expectedPages,
        declaredTotalEntries ?? allPromotions.length + response.data.length,
        maxPages,
        pageSize,
      );
    }

    for (const [index, item] of response.data.entries()) {
      if (typeof item !== "object" || item === null) {
        throw new Error(`Invalid promotion entry at page ${page}, index ${index}`);
      }
      allPromotions.push(item as Record<string, unknown>);
    }

    if (expectedPages !== null) {
      if (page >= expectedPages) {
        if (declaredTotalEntries !== null && allPromotions.length !== declaredTotalEntries) {
          throw new Error(
            `Promotion pagination entry count mismatch: fetched ${allPromotions.length}, expected ${declaredTotalEntries}`,
          );
        }
        return allPromotions;
      }
      continue;
    }

    if (response.data.length < pageSize) {
      return allPromotions;
    }
    if (page === maxPages) {
      throw new Error(
        "Promotion pagination reached max pages with a full final page and no usable pagination metadata; refusing truncation",
      );
    }
  }

  throw new Error("Promotion pagination traversal ended without proving completion");
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
  criteria: ExperimentCriteria;
  rollback: {
    status: "PASS" | "FAIL";
    action: string;
    verifiedAt: string;
  };
}

type CatalogVariation = {
  id: string;
  display_id?: string | null;
  retail_price?: number | null;
  retail_price_after_discount?: number | null;
};

function readCatalogVariations(payload: unknown): CatalogVariation[] {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Invalid product data while reading catalog variations");
  }
  const variations = (payload as { variations?: unknown }).variations;
  if (!Array.isArray(variations)) {
    throw new Error("Invalid product data: variations array missing");
  }
  return variations as CatalogVariation[];
}

function collateralPricesUnchanged(before: CatalogVariation[], after: CatalogVariation[]): boolean {
  return before.every((baseline) => {
    const current = after.find((variation) => variation.id === baseline.id);
    return (
      current !== undefined &&
      current.retail_price === baseline.retail_price &&
      current.retail_price_after_discount === baseline.retail_price_after_discount
    );
  });
}

function makeApplicabilityPayload(shopId: number, variationId: string) {
  return {
    order: {
      shop_id: shopId,
      items: [
        {
          product_id: EXPECTED_TARGET_PRODUCT_ID,
          variation_id: variationId,
          quantity: 1,
        },
      ],
    },
  };
}

export async function runW3PricingExperiment(): Promise<W3ExperimentResult> {
  assertTrustedExperimentEnvironment();

  const config = readPancakeConfig();
  assertApprovedShopId(config.shopId);
  const client = new PancakeClient({ apiKey: config.apiKey });

  const productResponse = (await client.getJson(
    `/shops/${config.shopId}/products/${EXPECTED_TARGET_PRODUCT_ID}`,
  )) as { success?: unknown; data?: unknown };
  if (productResponse.success !== true || !productResponse.data) {
    throw new Error("Failed to fetch target product from Pancake API");
  }

  const preflightTarget = validateTargetVariationPreflight(productResponse.data);
  const variations = readCatalogVariations(productResponse.data);
  const otherVarsBefore = variations.filter((variation) => variation.id !== EXPECTED_TARGET_VARIATION_ID);

  const existingPromotions = await fetchBoundedPromotions(client, config.shopId);
  checkExistingPromotionCollisions(existingPromotions);

  const beforeBaseline = {
    phase: "BEFORE" as const,
    variationId: preflightTarget.variationId,
    retailPrice: preflightTarget.retailPrice,
    retailPriceAfterDiscount: preflightTarget.retailPriceAfterDiscount,
    existingPromotionsCount: existingPromotions.length,
    observedAt: new Date().toISOString(),
  };

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
  let targetApplicabilityObs: PromotionApplicabilityObservation | undefined;
  let peerApplicabilityObs: PromotionApplicabilityObservation | undefined;
  let postRollbackApplicabilityObs: PromotionApplicabilityObservation | undefined;
  let createdPromoScopeValid = false;
  let rollbackVerified = false;
  let activeSnapshot:
    | {
        retailPrice: number | null;
        retailPriceAfterDiscount: number | null;
        activePromotionsCount: number;
        collateralUnchanged: boolean;
        observedAt: string;
      }
    | undefined;
  let revertSnapshot:
    | {
        retailPrice: number | null;
        retailPriceAfterDiscount: number | null;
        remainingPromotionsCount: number;
        reversibilityVerified: boolean;
        observedAt: string;
      }
    | undefined;

  try {
    const createResponse = (await client.postJson(
      `/shops/${config.shopId}/promotion_advance`,
      createPayload,
    )) as { success?: unknown; data?: { id?: unknown } };
    if (createResponse.success !== true) {
      throw new Error("Promotion creation API response reported success: false");
    }

    promoId =
      typeof createResponse.data?.id === "string" && createResponse.data.id.length > 0
        ? createResponse.data.id
        : undefined;

    const currentPromotions = await fetchBoundedPromotions(client, config.shopId);
    let authoritativePromotion: Record<string, unknown> | undefined;
    if (promoId) {
      authoritativePromotion = currentPromotions.find((promotion) => promotion.id === promoId);
    }
    if (!authoritativePromotion) {
      const matches = currentPromotions.filter((promotion) => promotion.name === PROMO_NAME);
      if (matches.length === 1 && typeof matches[0]?.id === "string") {
        authoritativePromotion = matches[0];
        promoId = matches[0].id as string;
      } else if (matches.length > 1) {
        throw new Error(`Ambiguous created promotion: found ${matches.length} promotions with name ${PROMO_NAME}`);
      }
    }
    if (!promoId || !authoritativePromotion) {
      throw new Error("Promotion creation verification failed: created promotion could not be uniquely retrieved");
    }

    createdPromoScopeValid = validateCreatedPromotionScope(authoritativePromotion, promoId);

    targetApplicabilityObs = parsePromotionApplicabilityResponse(
      await client.postJson(
        `/shops/${config.shopId}/orders/get_promotion_advance_active`,
        makeApplicabilityPayload(config.shopId, EXPECTED_TARGET_VARIATION_ID),
      ),
      promoId,
      EXPECTED_TARGET_VARIATION_ID,
    );

    peerApplicabilityObs = parsePromotionApplicabilityResponse(
      await client.postJson(
        `/shops/${config.shopId}/orders/get_promotion_advance_active`,
        makeApplicabilityPayload(config.shopId, EXPECTED_PEER_VARIATION_ID),
      ),
      promoId,
      EXPECTED_PEER_VARIATION_ID,
    );

    const activeProductResponse = (await client.getJson(
      `/shops/${config.shopId}/products/${EXPECTED_TARGET_PRODUCT_ID}`,
    )) as { success?: unknown; data?: unknown };
    if (activeProductResponse.success !== true || !activeProductResponse.data) {
      throw new Error("Failed to fetch target product during ACTIVE phase");
    }
    const activeVariations = readCatalogVariations(activeProductResponse.data);
    const activeVariation = activeVariations.find(
      (variation) => variation.id === EXPECTED_TARGET_VARIATION_ID,
    );
    if (!activeVariation) {
      throw new Error("Target variation disappeared during ACTIVE phase");
    }

    activeSnapshot = {
      retailPrice: activeVariation.retail_price ?? null,
      retailPriceAfterDiscount: activeVariation.retail_price_after_discount ?? null,
      activePromotionsCount: currentPromotions.length,
      collateralUnchanged: collateralPricesUnchanged(otherVarsBefore, activeVariations),
      observedAt: new Date().toISOString(),
    };
  } finally {
    let promoToRollback = promoId;
    let recoveryLookupError: unknown;

    if (!promoToRollback) {
      try {
        const recoveryPromotions = await fetchBoundedPromotions(client, config.shopId);
        const matches = recoveryPromotions.filter((promotion) => promotion.name === PROMO_NAME);
        if (matches.length > 1) {
          throw new Error(`Ambiguous rollback recovery: found ${matches.length} matching test promotions`);
        }
        if (matches.length === 1 && typeof matches[0]?.id === "string") {
          promoToRollback = matches[0].id as string;
        }
      } catch (error) {
        recoveryLookupError = error;
      }
    }

    if (!promoToRollback && recoveryLookupError) {
      const sanitizedError = sanitizeErrorMessage(recoveryLookupError, [config.apiKey]);
      throw new Error(
        `ROLLBACK_FAILED: Could not establish whether the test promotion exists after an uncertain mutation state. Error: ${sanitizedError}`,
      );
    }

    if (promoToRollback) {
      try {
        const deleteResponse = (await client.postJson(
          `/shops/${config.shopId}/promotion_advance/delete_multi`,
          { ids: [promoToRollback], type_action: "DELETE_PROMOTIONS" },
        )) as { success?: unknown };
        const postRollbackPromotions = await fetchBoundedPromotions(client, config.shopId);

        postRollbackApplicabilityObs = parsePromotionApplicabilityResponse(
          await client.postJson(
            `/shops/${config.shopId}/orders/get_promotion_advance_active`,
            makeApplicabilityPayload(config.shopId, EXPECTED_TARGET_VARIATION_ID),
          ),
          promoToRollback,
          EXPECTED_TARGET_VARIATION_ID,
        );

        const afterProductResponse = (await client.getJson(
          `/shops/${config.shopId}/products/${EXPECTED_TARGET_PRODUCT_ID}`,
        )) as { success?: unknown; data?: unknown };
        if (afterProductResponse.success !== true || !afterProductResponse.data) {
          throw new Error("ROLLBACK_FAILED: Failed to fetch target product after rollback");
        }
        const afterVariations = readCatalogVariations(afterProductResponse.data);
        const afterVariation = afterVariations.find(
          (variation) => variation.id === EXPECTED_TARGET_VARIATION_ID,
        );
        if (!afterVariation) {
          throw new Error("ROLLBACK_FAILED: Target variation missing after rollback");
        }

        verifyRollbackState({
          deleteSuccess: deleteResponse.success === true,
          remainingPromotions: postRollbackPromotions,
          promoId: promoToRollback,
          postRollbackTargetApplicability: postRollbackApplicabilityObs,
          beforeBaseline,
          afterVar: {
            retail_price: afterVariation.retail_price ?? null,
            retail_price_after_discount: afterVariation.retail_price_after_discount ?? null,
          },
          collateralUnchanged: collateralPricesUnchanged(otherVarsBefore, afterVariations),
        });

        rollbackVerified = true;
        revertSnapshot = {
          retailPrice: afterVariation.retail_price ?? null,
          retailPriceAfterDiscount: afterVariation.retail_price_after_discount ?? null,
          remainingPromotionsCount: postRollbackPromotions.length,
          reversibilityVerified: true,
          observedAt: new Date().toISOString(),
        };
      } catch (rollbackError) {
        const sanitizedError = sanitizeErrorMessage(rollbackError, [config.apiKey]);
        throw new Error(
          `ROLLBACK_FAILED: Promotion ${promoToRollback} could not be completely reverted. Bounded recovery required: call POST /shops/${config.shopId}/promotion_advance/delete_multi with ids: ["${promoToRollback}"]. Error: ${sanitizedError}`,
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
    beforePromotionsCount: beforeBaseline.existingPromotionsCount,
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
  assertExperimentCriteriaSatisfied(criteria);

  return {
    targetResolution: {
      input: EXPECTED_TARGET_INPUT,
      resolvedProductId: EXPECTED_TARGET_PRODUCT_ID,
      resolvedProductName:
        (productResponse.data as { name?: string }).name ?? "ÁO A132",
      resolvedVariationIds: variations.map((variation) => variation.id),
      sourceFieldMatched:
        "name ILIKE '%a132%' ('ÁO A132') and slug ILIKE '%a132%' ('ao-a132-4d57c085da6689c1840c')",
    },
    selectedVariation: {
      variationId: preflightTarget.variationId,
      displayId: preflightTarget.displayId,
      productId: preflightTarget.productId,
      is_hidden: preflightTarget.isHidden,
      is_locked: preflightTarget.isLocked,
      stockFacts: `remain_quantity=${preflightTarget.remainQuantity} (verified aggregate zero; any present warehouse stock facts were also zero)`,
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
