import { requireAdminSession } from "../auth/authorization.ts";

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

export type ProductVariantActivationInput = {
  productId: string;
  variantIds: readonly string[];
  isActive: boolean;
};

type ProductCommerceAdminDependencies = {
  setVariantActivation(input: ProductVariantActivationInput): Promise<boolean>;
};

function isBoundedTrimmedId(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim()
  );
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

  return {
    setVariantActivation: setVariantActivationForProduct,
  };
}
