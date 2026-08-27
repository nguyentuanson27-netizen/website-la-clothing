import { requireAdminSession } from "../auth/authorization.ts";
import {
  ADMIN_CATALOG_CONFIRMATION_LIMITS,
  issueAdminCatalogConfirmationProof,
} from "./admin-catalog-confirmation.ts";
import type {
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
} as const;

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

export type ProductVariantActivationInput = ProductVariantActivationUpdate;

type ProductCommerceAdminDependencies = {
  setVariantActivation(input: ProductVariantActivationInput): Promise<boolean>;
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

function parseProductInput(input: unknown): { productId: string } | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (!isBoundedTrimmedId(record.productId, PRODUCT_COMMERCE_ADMIN_LIMITS.productId)) {
    return null;
  }
  return { productId: record.productId };
}

function parseCatalogCommitInput(input: unknown): { productId: string; proof: string } | null {
  const product = parseProductInput(input);
  if (!product || !input || typeof input !== "object" || Array.isArray(input)) return null;
  const proof = (input as Record<string, unknown>).proof;
  if (
    typeof proof !== "string" ||
    proof.length < 1 ||
    proof.length > ADMIN_CATALOG_CONFIRMATION_LIMITS.proofLength
  ) {
    return null;
  }
  return { ...product, proof };
}

function parseVariantActivationInput(input: unknown): ProductVariantActivationInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  if (
    !isBoundedTrimmedId(record.productId, PRODUCT_COMMERCE_ADMIN_LIMITS.productId) ||
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
    productId: record.productId,
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
  async function setVariantActivationForProduct(session: AdminSessionCandidate, input: unknown) {
    requireAdminSession(session);

    const parsed = parseVariantActivationInput(input);
    if (!parsed) {
      return { ok: false, reason: "INVALID_INPUT" } as const;
    }

    if (!(await setVariantActivation(parsed))) {
      return { ok: false, reason: "VARIANT_NOT_AVAILABLE" } as const;
    }

    return {
      ok: true,
      variantIds: parsed.variantIds,
      isActive: parsed.isActive,
    } as const;
  }

  async function prepareCatalogEnable(session: AdminSessionCandidate, input: unknown) {
    const admin = requireAdminSession(session);
    const parsed = parseProductInput(input);
    if (!parsed) {
      return { ok: false, reason: "INVALID_INPUT" } as const;
    }

    const warningState = await readCatalogEnableWarningState(parsed.productId);
    if (!warningState) {
      return { ok: false, reason: "PRODUCT_NOT_AVAILABLE" } as const;
    }

    const issued = issueAdminCatalogConfirmationProof({
      secret: readConfirmationSecret(),
      nowMs: nowMs(),
      actorId: admin.user.id,
      operation: "enable",
      targetProductIds: [parsed.productId],
      zeroActiveProductIds: warningState.zeroActiveProductIds,
      compositeChildProductIds: warningState.compositeChildProductIds,
    });

    return {
      ok: true,
      warningState,
      proof: issued.proof,
      expiresAtMs: issued.expiresAtMs,
    } as const;
  }

  async function commitCatalogEnableForProduct(session: AdminSessionCandidate, input: unknown) {
    const admin = requireAdminSession(session);
    const parsed = parseCatalogCommitInput(input);
    if (!parsed) {
      return { ok: false, reason: "INVALID_INPUT" } as const;
    }

    const result = await commitCatalogEnable({
      productId: parsed.productId,
      actorId: admin.user.id,
      proof: parsed.proof,
      secret: readConfirmationSecret(),
      nowMs: nowMs(),
    });
    if (!result.ok && result.reason === "RECONFIRM_REQUIRED") {
      const issued = issueAdminCatalogConfirmationProof({
        secret: readConfirmationSecret(),
        nowMs: nowMs(),
        actorId: admin.user.id,
        operation: "enable",
        targetProductIds: [parsed.productId],
        zeroActiveProductIds: result.warningState.zeroActiveProductIds,
        compositeChildProductIds: result.warningState.compositeChildProductIds,
      });
      return {
        ...result,
        proof: issued.proof,
        expiresAtMs: issued.expiresAtMs,
      } as const;
    }

    return result;
  }

  async function disableCatalogForProduct(session: AdminSessionCandidate, input: unknown) {
    requireAdminSession(session);
    const parsed = parseProductInput(input);
    if (!parsed) {
      return { ok: false, reason: "INVALID_INPUT" } as const;
    }
    if (!(await disableCatalog(parsed.productId))) {
      return { ok: false, reason: "PRODUCT_NOT_AVAILABLE" } as const;
    }
    return { ok: true } as const;
  }

  async function activateStockedVariantsForProduct(session: AdminSessionCandidate, input: unknown) {
    requireAdminSession(session);
    const parsed = parseProductInput(input);
    if (!parsed) {
      return { ok: false, reason: "INVALID_INPUT" } as const;
    }
    return activateProductAndStockedVariants(parsed.productId);
  }

  return {
    setVariantActivation: setVariantActivationForProduct,
    prepareCatalogEnable,
    commitCatalogEnable: commitCatalogEnableForProduct,
    disableCatalog: disableCatalogForProduct,
    activateProductAndStockedVariants: activateStockedVariantsForProduct,
  };
}
