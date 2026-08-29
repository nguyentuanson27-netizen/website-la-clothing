import { requireAdminSession } from "../auth/authorization.ts";
import {
  ADMIN_CATALOG_CONFIRMATION_LIMITS,
  issueAdminCatalogConfirmationProof,
} from "./admin-catalog-confirmation.ts";
import type {
  BulkCatalogDisableResult,
  BulkCatalogEnableCommitInput,
  BulkCatalogEnableCommitResult,
  BulkVariantActivationMode,
  BulkVariantActivationResult,
  CatalogEnableCommitInput,
  CatalogEnableCommitResult,
  CatalogEnableWarningState,
  ProductVariantActivationUpdate,
  StockedQuickActionResult,
} from "./product-commerce-repository.ts";

export const PRODUCT_COMMERCE_ADMIN_LIMITS = {
  productId: 128,
  variantId: 128,
  variantCount: 100,
  bulkProductCount: 100,
} as const;

export const BULK_VARIANT_ACTIVATION_MODES = [
  "enable-all",
  "enable-stocked",
  "disable-all",
] as const;

type AdminSessionCandidate =
  | {
      user: {
        id: string;
        role?: string | null;
      };
      session: {
        id: string;
      };
    }
  | null
  | undefined;

export type ProductVariantActivationInput = {
  variantIds: readonly string[];
  isActive: boolean;
};

export type BulkVariantActivationInput = {
  productIds: readonly string[];
  mode: BulkVariantActivationMode;
};

type ProductCatalogBulkAdminDependencies = {
  readBulkCatalogEnableWarningState(
    productIds: readonly string[],
  ): Promise<CatalogEnableWarningState | null>;
  commitBulkCatalogEnable(
    input: BulkCatalogEnableCommitInput,
  ): Promise<BulkCatalogEnableCommitResult>;
  disableBulkCatalog(productIds: readonly string[]): Promise<BulkCatalogDisableResult>;
  updateBulkVariantActivation(
    productIds: readonly string[],
    mode: BulkVariantActivationMode,
  ): Promise<BulkVariantActivationResult>;
  readConfirmationSecret(): string;
  nowMs(): number;
};

type ProductCommerceAdminDependencies = {
  setVariantActivation(input: ProductVariantActivationUpdate): Promise<boolean>;
  readCatalogEnableWarningState(productId: string): Promise<CatalogEnableWarningState | null>;
  commitCatalogEnable(input: CatalogEnableCommitInput): Promise<CatalogEnableCommitResult>;
  disableCatalog(productId: string): Promise<boolean>;
  activateProductAndStockedVariants(productId: string): Promise<StockedQuickActionResult>;
  readConfirmationSecret(): string;
  nowMs(): number;
};

function isBoundedTrimmedId(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim()
  );
}

function parseRouteProductId(productId: unknown): string | null {
  return isBoundedTrimmedId(productId, PRODUCT_COMMERCE_ADMIN_LIMITS.productId)
    ? productId
    : null;
}

function parseCatalogProof(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const proof = (input as Record<string, unknown>).proof;
  if (
    typeof proof !== "string" ||
    proof.length < 1 ||
    proof.length > ADMIN_CATALOG_CONFIRMATION_LIMITS.proofLength
  ) {
    return null;
  }
  return proof;
}

function parseBulkProductIdsInput(input: unknown): string[] | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const productIds = (input as Record<string, unknown>).productIds;
  if (
    !Array.isArray(productIds) ||
    productIds.length < 1 ||
    productIds.length > PRODUCT_COMMERCE_ADMIN_LIMITS.bulkProductCount
  ) {
    return null;
  }

  const canonical: string[] = [];
  const seen = new Set<string>();
  for (const productId of productIds) {
    if (
      !isBoundedTrimmedId(productId, PRODUCT_COMMERCE_ADMIN_LIMITS.productId) ||
      seen.has(productId)
    ) {
      return null;
    }
    seen.add(productId);
    canonical.push(productId);
  }

  return canonical;
}

function parseBulkVariantActivationInput(
  input: unknown,
): { productIds: string[]; mode: BulkVariantActivationMode } | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const record = input as Record<string, unknown>;
  const productIds = parseBulkProductIdsInput(record);
  if (!productIds) return null;

  const mode = record.mode;
  if (
    typeof mode !== "string" ||
    !BULK_VARIANT_ACTIVATION_MODES.includes(mode as BulkVariantActivationMode)
  ) {
    return null;
  }

  return { productIds, mode: mode as BulkVariantActivationMode };
}

function parseVariantActivationInput(input: unknown): ProductVariantActivationInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  if (
    !Array.isArray(record.variantIds) ||
    record.variantIds.length < 1 ||
    record.variantIds.length > PRODUCT_COMMERCE_ADMIN_LIMITS.variantCount ||
    typeof record.isActive !== "boolean"
  ) {
    return null;
  }

  const variantIds: string[] = [];
  const seen = new Set<string>();
  for (const variantId of record.variantIds) {
    if (
      !isBoundedTrimmedId(variantId, PRODUCT_COMMERCE_ADMIN_LIMITS.variantId) ||
      seen.has(variantId)
    ) {
      return null;
    }
    seen.add(variantId);
    variantIds.push(variantId);
  }

  return {
    variantIds,
    isActive: record.isActive,
  };
}

export function createProductCommerceAdminService({
  setVariantActivation,
  readCatalogEnableWarningState,
  commitCatalogEnable,
  disableCatalog,
  activateProductAndStockedVariants,
  readConfirmationSecret,
  nowMs,
}: ProductCommerceAdminDependencies) {
  function issueCatalogEnableConfirmation(
    actorId: string,
    productId: string,
    warningState: CatalogEnableWarningState,
  ) {
    return issueAdminCatalogConfirmationProof({
      secret: readConfirmationSecret(),
      nowMs: nowMs(),
      actorId,
      operation: "enable",
      targetProductIds: [productId],
      zeroActiveProductIds: warningState.zeroActiveProductIds,
      compositeChildProductIds: warningState.compositeChildProductIds,
    });
  }

  async function reconfirmCatalogEnable(actorId: string, productId: string) {
    const warningState = await readCatalogEnableWarningState(productId);
    if (!warningState) {
      return { ok: false, reason: "PRODUCT_NOT_AVAILABLE" } as const;
    }

    const issued = issueCatalogEnableConfirmation(actorId, productId, warningState);
    return {
      ok: false,
      reason: "RECONFIRM_REQUIRED",
      warningState,
      proof: issued.proof,
      expiresAtMs: issued.expiresAtMs,
    } as const;
  }

  async function setVariantActivationForProduct(
    session: AdminSessionCandidate,
    routeProductId: string,
    input: unknown,
  ) {
    requireAdminSession(session);

    const productId = parseRouteProductId(routeProductId);
    const parsed = parseVariantActivationInput(input);
    if (!productId || !parsed) {
      return { ok: false, reason: "INVALID_INPUT" } as const;
    }

    if (!(await setVariantActivation({ productId, ...parsed }))) {
      return { ok: false, reason: "VARIANT_NOT_AVAILABLE" } as const;
    }

    return {
      ok: true,
      variantIds: parsed.variantIds,
      isActive: parsed.isActive,
    } as const;
  }

  async function prepareCatalogEnable(session: AdminSessionCandidate, routeProductId: string) {
    const admin = requireAdminSession(session);
    const productId = parseRouteProductId(routeProductId);
    if (!productId) {
      return { ok: false, reason: "INVALID_INPUT" } as const;
    }

    const warningState = await readCatalogEnableWarningState(productId);
    if (!warningState) {
      return { ok: false, reason: "PRODUCT_NOT_AVAILABLE" } as const;
    }

    const issued = issueCatalogEnableConfirmation(admin.user.id, productId, warningState);
    return {
      ok: true,
      warningState,
      proof: issued.proof,
      expiresAtMs: issued.expiresAtMs,
    } as const;
  }

  async function commitCatalogEnableForProduct(
    session: AdminSessionCandidate,
    routeProductId: string,
    input: unknown,
  ) {
    const admin = requireAdminSession(session);
    const productId = parseRouteProductId(routeProductId);
    if (!productId) {
      return { ok: false, reason: "INVALID_INPUT" } as const;
    }

    const proof = parseCatalogProof(input);
    if (!proof) {
      return reconfirmCatalogEnable(admin.user.id, productId);
    }

    const result = await commitCatalogEnable({
      productId,
      actorId: admin.user.id,
      proof,
      secret: readConfirmationSecret(),
      nowMs: nowMs(),
    });
    if (!result.ok && result.reason === "RECONFIRM_REQUIRED") {
      const issued = issueCatalogEnableConfirmation(admin.user.id, productId, result.warningState);
      return {
        ...result,
        proof: issued.proof,
        expiresAtMs: issued.expiresAtMs,
      } as const;
    }

    return result;
  }

  async function disableCatalogForProduct(
    session: AdminSessionCandidate,
    routeProductId: string,
  ) {
    requireAdminSession(session);
    const productId = parseRouteProductId(routeProductId);
    if (!productId) {
      return { ok: false, reason: "INVALID_INPUT" } as const;
    }
    if (!(await disableCatalog(productId))) {
      return { ok: false, reason: "PRODUCT_NOT_AVAILABLE" } as const;
    }
    return { ok: true } as const;
  }

  async function activateStockedVariantsForProduct(
    session: AdminSessionCandidate,
    routeProductId: string,
  ) {
    requireAdminSession(session);
    const productId = parseRouteProductId(routeProductId);
    if (!productId) {
      return { ok: false, reason: "INVALID_INPUT" } as const;
    }
    return activateProductAndStockedVariants(productId);
  }

  return {
    setVariantActivation: setVariantActivationForProduct,
    prepareCatalogEnable,
    commitCatalogEnable: commitCatalogEnableForProduct,
    disableCatalog: disableCatalogForProduct,
    activateProductAndStockedVariants: activateStockedVariantsForProduct,
  };
}

/**
 * Bulk catalog activation for an exact current-page selection.
 *
 * It reuses the single-product confirmation primitive rather than forking a second proof format:
 * one proof binds the admin actor, the `enable` operation, the exact selected product IDs and
 * both exact warning sets, so a confirmation shown for one selection or one warning state can
 * never commit a different one. Browser-rendered counts are never trusted as acknowledgement.
 */
export function createProductCatalogBulkAdminService({
  readBulkCatalogEnableWarningState,
  commitBulkCatalogEnable,
  disableBulkCatalog,
  updateBulkVariantActivation,
  readConfirmationSecret,
  nowMs,
}: ProductCatalogBulkAdminDependencies) {
  function issueBulkConfirmation(
    actorId: string,
    productIds: readonly string[],
    warningState: CatalogEnableWarningState,
  ) {
    return issueAdminCatalogConfirmationProof({
      secret: readConfirmationSecret(),
      nowMs: nowMs(),
      actorId,
      operation: "enable",
      targetProductIds: productIds,
      zeroActiveProductIds: warningState.zeroActiveProductIds,
      compositeChildProductIds: warningState.compositeChildProductIds,
    });
  }

  async function reconfirm(actorId: string, productIds: readonly string[]) {
    const warningState = await readBulkCatalogEnableWarningState(productIds);
    if (!warningState) {
      return { ok: false, reason: "PRODUCT_NOT_AVAILABLE" } as const;
    }

    const issued = issueBulkConfirmation(actorId, productIds, warningState);
    return {
      ok: false,
      reason: "RECONFIRM_REQUIRED",
      productIds,
      warningState,
      proof: issued.proof,
      expiresAtMs: issued.expiresAtMs,
    } as const;
  }

  async function prepareEnable(session: AdminSessionCandidate, input: unknown) {
    const admin = requireAdminSession(session);
    const productIds = parseBulkProductIdsInput(input);
    if (!productIds) {
      return { ok: false, reason: "INVALID_INPUT" } as const;
    }

    const warningState = await readBulkCatalogEnableWarningState(productIds);
    if (!warningState) {
      return { ok: false, reason: "PRODUCT_NOT_AVAILABLE" } as const;
    }

    const issued = issueBulkConfirmation(admin.user.id, productIds, warningState);
    return {
      ok: true,
      productIds,
      warningState,
      proof: issued.proof,
      expiresAtMs: issued.expiresAtMs,
    } as const;
  }

  async function commitEnable(session: AdminSessionCandidate, input: unknown) {
    const admin = requireAdminSession(session);
    const productIds = parseBulkProductIdsInput(input);
    if (!productIds) {
      return { ok: false, reason: "INVALID_INPUT" } as const;
    }

    const proof = parseCatalogProof(input);
    if (!proof) {
      return reconfirm(admin.user.id, productIds);
    }

    const result = await commitBulkCatalogEnable({
      productIds,
      actorId: admin.user.id,
      proof,
      secret: readConfirmationSecret(),
      nowMs: nowMs(),
    });
    if (!result.ok && result.reason === "RECONFIRM_REQUIRED") {
      const issued = issueBulkConfirmation(admin.user.id, productIds, result.warningState);
      return {
        ...result,
        productIds,
        proof: issued.proof,
        expiresAtMs: issued.expiresAtMs,
      } as const;
    }

    return result;
  }

  async function disable(session: AdminSessionCandidate, input: unknown) {
    requireAdminSession(session);
    const productIds = parseBulkProductIdsInput(input);
    if (!productIds) {
      return { ok: false, reason: "INVALID_INPUT" } as const;
    }
    return disableBulkCatalog(productIds);
  }

  async function updateVariantActivation(session: AdminSessionCandidate, input: unknown) {
    requireAdminSession(session);
    const parsed = parseBulkVariantActivationInput(input);
    if (!parsed) {
      return { ok: false, reason: "INVALID_INPUT" } as const;
    }

    const result = await updateBulkVariantActivation(parsed.productIds, parsed.mode);
    if (!result.ok) {
      return { ok: false, reason: result.reason } as const;
    }

    return {
      ok: true,
      mode: parsed.mode,
      productCount: result.productCount,
      matchedVariantCount: result.matchedVariantCount,
      changedVariantCount: result.changedVariantCount,
    } as const;
  }

  return {
    prepareEnable,
    commitEnable,
    disable,
    updateVariantActivation,
  };
}
