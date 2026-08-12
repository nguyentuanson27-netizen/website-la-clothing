import { createHmac } from "node:crypto";

import type { PrismaClient } from "../generated/prisma/client.ts";

const DEFAULT_MAX_CLIENT_ATTEMPTS = 10;
const DEFAULT_MAX_ORDER_CODE_ATTEMPTS = 5;
const DEFAULT_WINDOW_MS = 60_000;
const MAX_PUBLIC_CODE_LENGTH = 128;
const ORDER_CODE_CLEANUP_BATCH_SIZE = 64;
const PSEUDONYMOUS_KEY = /^v1:[0-9a-f]{64}$/;
const ORDER_CODE_HMAC_CONTEXT = "la-clothing:guest-order-tracking-order-code:v1";

type RateLimiterOptions = Readonly<{
  maxClientAttempts?: number;
  maxOrderCodeAttempts?: number;
  windowMs?: number;
}>;

function requirePositiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function requirePseudonymousKey(value: string, label: string): string {
  if (typeof value !== "string" || !PSEUDONYMOUS_KEY.test(value)) {
    throw new TypeError(`${label} must be a pseudonymous v1 key`);
  }
  return value;
}

function requireNow(now: Date): Date {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError("Guest order tracking rate-limit time must be valid");
  }
  return now;
}

function cappedCount(maxAttempts: number, label: string): number {
  const value = maxAttempts + 1;
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} is too large`);
  }
  return value;
}

export function deriveGuestOrderTrackingCodeKey(publicCode: string, secret: string): string {
  if (
    typeof publicCode !== "string" ||
    publicCode.length === 0 ||
    publicCode.length > MAX_PUBLIC_CODE_LENGTH ||
    publicCode.trim() !== publicCode
  ) {
    throw new TypeError("Guest order tracking code must be a bounded non-empty string");
  }
  if (typeof secret !== "string" || secret.length < 32) {
    throw new TypeError("Guest order tracking HMAC secret is unavailable");
  }

  const digest = createHmac("sha256", secret)
    .update(ORDER_CODE_HMAC_CONTEXT)
    .update("\0")
    .update(publicCode)
    .digest("hex");
  return `v1:${digest}`;
}

export function createGuestOrderTrackingRateLimiter(
  client: PrismaClient,
  options: RateLimiterOptions = {},
) {
  const maxClientAttempts = requirePositiveSafeInteger(
    options.maxClientAttempts ?? DEFAULT_MAX_CLIENT_ATTEMPTS,
    "Guest order tracking client max attempts",
  );
  const maxOrderCodeAttempts = requirePositiveSafeInteger(
    options.maxOrderCodeAttempts ?? DEFAULT_MAX_ORDER_CODE_ATTEMPTS,
    "Guest order tracking code max attempts",
  );
  const windowMs = requirePositiveSafeInteger(
    options.windowMs ?? DEFAULT_WINDOW_MS,
    "Guest order tracking rate-limit window",
  );
  const clientCap = cappedCount(maxClientAttempts, "Guest order tracking client max attempts");
  const orderCodeCap = cappedCount(
    maxOrderCodeAttempts,
    "Guest order tracking code max attempts",
  );

  async function cleanupExpiredOrderCodeBuckets(now: Date): Promise<void> {
    const safeNow = requireNow(now);
    const staleBefore = BigInt(safeNow.getTime()) - BigInt(windowMs);

    const deletedCount = await client.$executeRaw`
      WITH stale AS (
        SELECT "id"
        FROM "rateLimit"
        WHERE "id" LIKE 'order-track-code:%'
          AND "lastRequest" <= ${staleBefore}
        ORDER BY "lastRequest" ASC, "id" ASC
        LIMIT ${ORDER_CODE_CLEANUP_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM "rateLimit" AS target
      USING stale
      WHERE target."id" = stale."id"
    `;

    if (
      !Number.isSafeInteger(deletedCount) ||
      deletedCount < 0 ||
      deletedCount > ORDER_CODE_CLEANUP_BATCH_SIZE
    ) {
      throw new Error("Guest order tracking rate-limit cleanup returned an invalid result");
    }
  }

  async function consumeBucket({
    bucketKey,
    now,
    maxAttempts,
    cap,
  }: {
    bucketKey: string;
    now: Date;
    maxAttempts: number;
    cap: number;
  }): Promise<boolean> {
    const safeNow = requireNow(now);
    const nowMs = BigInt(safeNow.getTime());
    const resetBefore = nowMs - BigInt(windowMs);

    const rows = await client.$queryRaw<Array<{ count: number }>>`
      INSERT INTO "rateLimit" AS existing ("id", "key", "count", "lastRequest")
      VALUES (${bucketKey}, ${bucketKey}, 1, ${nowMs})
      ON CONFLICT ("id") DO UPDATE
      SET
        "count" = CASE
          WHEN existing."lastRequest" <= ${resetBefore} THEN 1
          ELSE LEAST(existing."count" + 1, ${cap})
        END,
        "lastRequest" = CASE
          WHEN existing."lastRequest" <= ${resetBefore} THEN ${nowMs}
          ELSE existing."lastRequest"
        END
      RETURNING "count"
    `;

    if (rows.length !== 1 || !Number.isSafeInteger(rows[0]?.count)) {
      throw new Error("Guest order tracking rate-limit storage returned an invalid result");
    }
    return rows[0].count <= maxAttempts;
  }

  async function consumeClient({
    clientKey,
    now = new Date(),
  }: {
    clientKey: string;
    now?: Date;
  }): Promise<boolean> {
    const safeClientKey = requirePseudonymousKey(clientKey, "Guest order tracking client key");
    return consumeBucket({
      bucketKey: `order-track-client:${safeClientKey}`,
      now,
      maxAttempts: maxClientAttempts,
      cap: clientCap,
    });
  }

  async function consumeOrderCode({
    codeKey,
    now = new Date(),
  }: {
    codeKey: string;
    now?: Date;
  }): Promise<boolean> {
    const safeCodeKey = requirePseudonymousKey(codeKey, "Guest order tracking code key");
    const safeNow = requireNow(now);
    await cleanupExpiredOrderCodeBuckets(safeNow);
    return consumeBucket({
      bucketKey: `order-track-code:${safeCodeKey}`,
      now: safeNow,
      maxAttempts: maxOrderCodeAttempts,
      cap: orderCodeCap,
    });
  }

  return { consumeClient, consumeOrderCode };
}
