import { requireAdminSession } from "../auth/authorization.ts";

export const COMPOSITE_COMPONENT_ADMIN_LIMITS = {
  productId: 128,
  variantId: 200,
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

export type CompositeComponentVariantActivation = {
  productId: string;
  variantId: string;
  isActive: boolean;
};

type CompositeComponentAdminDependencies = {
  setRelationLinkedVariantActive(
    input: CompositeComponentVariantActivation,
  ): Promise<CompositeComponentVariantActivation | null>;
};

function parseIdentifier(value: unknown, maxLength: number): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value !== value.trim()
  ) {
    return null;
  }
  return value;
}

function parseActivationInput(input: unknown): CompositeComponentVariantActivation | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  const productId = parseIdentifier(
    record.productId,
    COMPOSITE_COMPONENT_ADMIN_LIMITS.productId,
  );
  const variantId = parseIdentifier(
    record.variantId,
    COMPOSITE_COMPONENT_ADMIN_LIMITS.variantId,
  );

  if (productId === null || variantId === null || typeof record.isActive !== "boolean") {
    return null;
  }

  return {
    productId,
    variantId,
    isActive: record.isActive,
  };
}

export function createCompositeComponentAdminService({
  setRelationLinkedVariantActive,
}: CompositeComponentAdminDependencies) {
  async function setVariantActive(session: AdminSessionCandidate, input: unknown) {
    requireAdminSession(session);

    const activation = parseActivationInput(input);
    if (!activation) {
      return { ok: false, reason: "INVALID_INPUT" } as const;
    }

    const variant = await setRelationLinkedVariantActive(activation);
    if (!variant) {
      return { ok: false, reason: "VARIANT_NOT_ELIGIBLE" } as const;
    }

    return { ok: true, variant } as const;
  }

  return { setVariantActive };
}
