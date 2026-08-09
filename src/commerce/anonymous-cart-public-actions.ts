const MAX_VARIANT_ID_LENGTH = 128;

type SetMutationFailureReason =
  | "INVALID_QUANTITY"
  | "VARIANT_UNAVAILABLE"
  | "CART_LINE_LIMIT";

type SetMutationResult =
  | {
      ok: true;
      cartId: string;
      expiresAt?: Date;
      item: { variantId: string; quantity: number };
    }
  | { ok: false; reason: SetMutationFailureReason };

type RemoveMutationResult = { ok: true } | { ok: false; reason: "CART_UNAVAILABLE" };

type AnonymousCartMutationPort = {
  setItemQuantity(input: {
    variantId: string;
    quantity: number;
    now: Date;
  }): Promise<SetMutationResult>;
  removeItem(input: { variantId: string; now: Date }): Promise<RemoveMutationResult>;
};

type PublicActionDependencies = {
  mutationService(): Promise<AnonymousCartMutationPort>;
  now?: () => Date;
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

function parseSetInput(input: unknown): { variantId: string; quantity: number } | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const variantId = parseVariantId(record.variantId);
  if (!variantId || typeof record.quantity !== "number") return null;
  return { variantId, quantity: record.quantity };
}

function parseRemoveInput(input: unknown): { variantId: string } | null {
  if (!input || typeof input !== "object") return null;
  const variantId = parseVariantId((input as Record<string, unknown>).variantId);
  return variantId ? { variantId } : null;
}

export function createAnonymousCartPublicActions({
  mutationService,
  now = () => new Date(),
}: PublicActionDependencies) {
  async function setItemQuantity(input: unknown) {
    const parsed = parseSetInput(input);
    if (!parsed) return { ok: false, reason: "INVALID_INPUT" } as const;

    const result = await (await mutationService()).setItemQuantity({ ...parsed, now: now() });
    if (!result.ok) return result;

    return { ok: true, item: result.item } as const;
  }

  async function removeItem(input: unknown) {
    const parsed = parseRemoveInput(input);
    if (!parsed) return { ok: false, reason: "INVALID_INPUT" } as const;

    return (await mutationService()).removeItem({ ...parsed, now: now() });
  }

  return { setItemQuantity, removeItem };
}
