import { requireAdminSession } from "../auth/authorization.ts";

export const COMPOSITE_COMPONENT_ADMIN_LIMITS = {
  productId: 128,
  variantId: 128,
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

export type CompositeComponentActivationInput = {
  productId: string;
  variantId: string;
  isActive: boolean;
};

type CompositeComponentAdminDependencies = {
  setLinkedVariantActivation(input: CompositeComponentActivationInput): Promise<boolean>;
};

function isBoundedTrimmedId(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value === value.trim()
  );
}

function parseActivationInput(input: unknown): CompositeComponentActivationInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  if (
    !isBoundedTrimmedId(record.productId, COMPOSITE_COMPONENT_ADMIN_LIMITS.productId) ||
    !isBoundedTrimmedId(record.variantId, COMPOSITE_COMPONENT_ADMIN_LIMITS.variantId) ||
    typeof record.isActive !== "boolean"
  ) {
    return null;
  }

  return {
    productId: record.productId,
    variantId: record.variantId,
    isActive: record.isActive,
  };
}

export function createCompositeComponentAdminService({
  setLinkedVariantActivation,
}: CompositeComponentAdminDependencies) {
  async function setActivation(session: AdminSessionCandidate, input: unknown) {
    requireAdminSession(session);

    const parsed = parseActivationInput(input);
    if (!parsed) {
      return { ok: false, reason: "INVALID_INPUT" } as const;
    }

    if (!(await setLinkedVariantActivation(parsed))) {
      return { ok: false, reason: "COMPONENT_NOT_AVAILABLE" } as const;
    }

    return {
      ok: true,
      variantId: parsed.variantId,
      isActive: parsed.isActive,
    } as const;
  }

  return { setActivation };
}
