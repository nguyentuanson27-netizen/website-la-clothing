import type { PrismaClient } from "../generated/prisma/client.ts";

const DEFAULT_STALE_AFTER_MS = 15 * 60_000;
const MAX_CART_ID_LENGTH = 128;

type RecoveryOptions = Readonly<{
  now?: Date;
  staleAfterMs?: number;
  cartId?: string;
}>;

function requireNow(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError("Checkout recovery time must be valid");
  }
  return value;
}

function requirePositiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function requireCartId(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CART_ID_LENGTH ||
    value.trim() !== value
  ) {
    throw new TypeError("Checkout recovery cart id must be a bounded non-empty string");
  }
  return value;
}

export async function recoverStrandedGuestCheckouts(
  client: PrismaClient,
  options: RecoveryOptions = {},
): Promise<{ validatingRejected: number; submittingUnknown: number }> {
  const now = requireNow(options.now ?? new Date());
  const staleAfterMs = requirePositiveSafeInteger(
    options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS,
    "Checkout recovery stale threshold",
  );
  const cutoffMs = now.getTime() - staleAfterMs;
  if (!Number.isSafeInteger(cutoffMs)) {
    throw new TypeError("Checkout recovery cutoff is outside the supported range");
  }
  const cutoff = new Date(cutoffMs);
  const cartId = options.cartId === undefined ? undefined : requireCartId(options.cartId);
  const sourceCartFilter = cartId === undefined ? { not: null } : cartId;

  return client.$transaction(async (tx) => {
    const validating = await tx.orderMirror.updateMany({
      where: {
        sourceCartId: sourceCartFilter,
        state: "VALIDATING",
        updatedAt: { lte: cutoff },
      },
      data: {
        state: "REJECTED",
        syncErrorCode: "VALIDATION_INTERRUPTED",
      },
    });

    const submitting = await tx.orderMirror.updateMany({
      where: {
        sourceCartId: sourceCartFilter,
        state: "POS_SUBMITTING",
        updatedAt: { lte: cutoff },
      },
      data: {
        state: "SYNC_UNKNOWN",
        syncErrorCode: "CREATE_OUTCOME_UNKNOWN",
      },
    });

    return {
      validatingRejected: validating.count,
      submittingUnknown: submitting.count,
    };
  });
}

export async function recoverStrandedGuestCheckoutForCart(
  client: PrismaClient,
  cartId: string,
  now: Date = new Date(),
): Promise<void> {
  await recoverStrandedGuestCheckouts(client, { cartId, now });
}
