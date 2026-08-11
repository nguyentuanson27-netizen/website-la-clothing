const MAX_VARIANT_ID_LENGTH = 128;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

type StorefrontCartLineStatus = {
  variantId: string;
  available: boolean;
};

type CartMutationResult = { ok: true; [key: string]: unknown } | { ok: false; [key: string]: unknown };

type StorefrontCartPublicActionDependencies = {
  getLines(): Promise<readonly StorefrontCartLineStatus[]>;
  canSetQuantity(input: { variantId: string; quantity: number }): Promise<boolean>;
  setQuantity(input: { variantId: string; quantity: number }): Promise<CartMutationResult>;
  remove(input: { variantId: string }): Promise<CartMutationResult>;
};

function parseVariantId(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_VARIANT_ID_LENGTH ||
    value !== value.trim()
  ) {
    return null;
  }
  return value;
}

function parseUpdateInput(input: unknown): { variantId: string; quantity: number } | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const variantId = parseVariantId(record.variantId);
  const quantity = record.quantity;
  if (
    !variantId ||
    typeof quantity !== "number" ||
    !Number.isSafeInteger(quantity) ||
    quantity <= 0 ||
    quantity > MAX_POSTGRES_INTEGER
  ) {
    return null;
  }
  return { variantId, quantity };
}

function parseRemoveInput(input: unknown): { variantId: string } | null {
  if (!input || typeof input !== "object") return null;
  const variantId = parseVariantId((input as Record<string, unknown>).variantId);
  return variantId ? { variantId } : null;
}

export function createStorefrontCartPublicActions({
  getLines,
  canSetQuantity,
  setQuantity,
  remove,
}: StorefrontCartPublicActionDependencies) {
  async function update(input: unknown) {
    const parsed = parseUpdateInput(input);
    if (!parsed) return { ok: false, reason: "INVALID_INPUT" } as const;

    const line = (await getLines()).find(({ variantId }) => variantId === parsed.variantId);
    if (!line) {
      return { ok: false, reason: "LINE_UNAVAILABLE" } as const;
    }

    if (!(await canSetQuantity(parsed))) {
      return { ok: false, reason: "LINE_UNAVAILABLE" } as const;
    }

    const result = await setQuantity(parsed);
    return result.ok
      ? ({ ok: true } as const)
      : ({ ok: false, reason: "UPDATE_FAILED" } as const);
  }

  async function removeLine(input: unknown) {
    const parsed = parseRemoveInput(input);
    if (!parsed) return { ok: false, reason: "INVALID_INPUT" } as const;

    const line = (await getLines()).find(({ variantId }) => variantId === parsed.variantId);
    if (!line) {
      return { ok: false, reason: "LINE_UNAVAILABLE" } as const;
    }

    const result = await remove(parsed);
    return result.ok
      ? ({ ok: true } as const)
      : ({ ok: false, reason: "REMOVE_FAILED" } as const);
  }

  return { update, remove: removeLine };
}
