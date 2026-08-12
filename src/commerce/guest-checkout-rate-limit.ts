import type { PrismaClient } from "../generated/prisma/client.ts";

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_WINDOW_MS = 60_000;
const MAX_CART_ID_LENGTH = 128;

type GuestCheckoutRateLimiterOptions = Readonly<{
  maxAttempts?: number;
  windowMs?: number;
}>;

function requirePositiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function requireCartId(cartId: string): string {
  if (
    typeof cartId !== "string" ||
    cartId.length === 0 ||
    cartId.length > MAX_CART_ID_LENGTH ||
    cartId.trim() !== cartId
  ) {
    throw new TypeError("Checkout cart id must be a bounded non-empty string");
  }
  return cartId;
}

function requireNow(now: Date): Date {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("Checkout rate-limit time must be valid");
  }
  return now;
}

export function createGuestCheckoutRateLimiter(
  client: PrismaClient,
  options: GuestCheckoutRateLimiterOptions = {},
) {
  const maxAttempts = requirePositiveSafeInteger(
    options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    "Checkout max attempts",
  );
  const windowMs = requirePositiveSafeInteger(
    options.windowMs ?? DEFAULT_WINDOW_MS,
    "Checkout rate-limit window",
  );
  const cappedCount = maxAttempts + 1;
  if (!Number.isSafeInteger(cappedCount)) {
    throw new TypeError("Checkout max attempts is too large");
  }

  async function consume({
    cartId,
    now = new Date(),
  }: {
    cartId: string;
    now?: Date;
  }): Promise<boolean> {
    const safeCartId = requireCartId(cartId);
    const safeNow = requireNow(now);
    const nowMs = BigInt(safeNow.getTime());
    const resetBefore = nowMs - BigInt(windowMs);
    const bucketKey = `checkout:${safeCartId}`;

    const rows = await client.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "rateLimit" AS existing ("id", "key", "count", "lastRequest")
      VALUES (${bucketKey}, ${bucketKey}, 1, ${nowMs})
      ON CONFLICT ("id") DO UPDATE
      SET
        "count" = CASE
          WHEN existing."lastRequest" <= ${resetBefore} THEN 1
          ELSE LEAST(existing."count" + 1, ${cappedCount})
        END,
        "lastRequest" = CASE
          WHEN existing."lastRequest" <= ${resetBefore} THEN ${nowMs}
          ELSE existing."lastRequest"
        END
      RETURNING "count"
    `;

    if (rows.length !== 1 || !Number.isSafeInteger(rows[0]?.count)) {
      throw new Error("Checkout rate-limit storage returned an invalid result");
    }

    return rows[0].count <= maxAttempts;
  }

  return { consume };
}
