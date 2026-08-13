import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  createGuestOrderTrackingRateLimiter,
  deriveGuestOrderTrackingCodeKey,
} from "../../src/commerce/guest-order-tracking-rate-limit.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const clientKey = `v1:${"a".repeat(64)}`;
const publicCode = "LA-11111111-2222-4333-8444-555555555555";
const phone = "0901234567";
const secret = "tracking-test-secret-0123456789abcdef";

async function cleanup() {
  await prisma.rateLimit.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "order-track-client:" } },
        { id: { startsWith: "order-track-code:" } },
      ],
    },
  });
}

test.beforeEach(cleanup);

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("guest order tracking rate limits client and order-code buckets atomically", async () => {
  const limiter = createGuestOrderTrackingRateLimiter(prisma, {
    maxClientAttempts: 2,
    maxOrderCodeAttempts: 1,
    windowMs: 60_000,
  });
  const now = new Date("2026-08-13T00:00:00Z");
  const codeKey = deriveGuestOrderTrackingCodeKey(publicCode, secret);

  assert.equal(await limiter.consumeClient({ clientKey, now }), true);
  assert.equal(await limiter.consumeClient({ clientKey, now }), true);
  assert.equal(await limiter.consumeClient({ clientKey, now }), false);

  assert.equal(await limiter.consumeOrderCode({ codeKey, now }), true);
  assert.equal(await limiter.consumeOrderCode({ codeKey, now }), false);

  const rows = await prisma.rateLimit.findMany({
    where: {
      OR: [
        { id: { startsWith: "order-track-client:" } },
        { id: { startsWith: "order-track-code:" } },
      ],
    },
    select: { id: true, count: true },
    orderBy: { id: "asc" },
  });
  assert.equal(rows.length, 2);
  assert.equal(rows.some(({ id }) => id.includes(publicCode)), false);
  assert.equal(rows.some(({ id }) => id.includes(phone)), false);
  assert.equal(rows.some(({ id }) => id.includes("203.0.113")), false);
});

test("guest order tracking rate limits reset after the fixed window", async () => {
  const limiter = createGuestOrderTrackingRateLimiter(prisma, {
    maxClientAttempts: 1,
    maxOrderCodeAttempts: 1,
    windowMs: 1_000,
  });
  const codeKey = deriveGuestOrderTrackingCodeKey(publicCode, secret);
  const start = new Date("2026-08-13T00:00:00.000Z");
  const afterWindow = new Date("2026-08-13T00:00:01.001Z");

  assert.equal(await limiter.consumeClient({ clientKey, now: start }), true);
  assert.equal(await limiter.consumeClient({ clientKey, now: start }), false);
  assert.equal(await limiter.consumeClient({ clientKey, now: afterWindow }), true);

  assert.equal(await limiter.consumeOrderCode({ codeKey, now: start }), true);
  assert.equal(await limiter.consumeOrderCode({ codeKey, now: start }), false);
  assert.equal(await limiter.consumeOrderCode({ codeKey, now: afterWindow }), true);
});

test("guest order tracking reclaims expired high-cardinality order-code buckets", async () => {
  const limiter = createGuestOrderTrackingRateLimiter(prisma, {
    maxClientAttempts: 10,
    maxOrderCodeAttempts: 5,
    windowMs: 1_000,
  });
  const start = new Date("2026-08-13T00:00:00.000Z");
  const afterWindow = new Date("2026-08-13T00:00:01.001Z");

  for (let index = 0; index < 70; index += 1) {
    const codeKey = deriveGuestOrderTrackingCodeKey(
      `LA-TRACK-${index.toString().padStart(4, "0")}`,
      secret,
    );
    assert.equal(await limiter.consumeOrderCode({ codeKey, now: start }), true);
  }

  assert.equal(
    await prisma.rateLimit.count({ where: { id: { startsWith: "order-track-code:" } } }),
    70,
  );

  for (let index = 0; index < 2; index += 1) {
    const codeKey = deriveGuestOrderTrackingCodeKey(`LA-FRESH-${index}`, secret);
    assert.equal(await limiter.consumeOrderCode({ codeKey, now: afterWindow }), true);
  }

  const retainedRows = await prisma.rateLimit.findMany({
    where: { id: { startsWith: "order-track-code:" } },
    select: { id: true, lastRequest: true },
  });
  assert.equal(retainedRows.length, 2);
  assert.equal(
    retainedRows.every(({ lastRequest }) => lastRequest === BigInt(afterWindow.getTime())),
    true,
  );
});

test("guest order tracking has an indexed cleanup path for stale order-code buckets", async () => {
  const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'rateLimit'
      AND indexname = 'rateLimit_order_track_code_cleanup_idx'
  `;

  assert.equal(rows.length, 1);
  assert.match(rows[0]?.indexdef ?? "", /lastRequest/);
  assert.match(rows[0]?.indexdef ?? "", /order-track-code/);
});

test("guest order tracking code key is deterministic, bounded, and secret keyed", () => {
  const first = deriveGuestOrderTrackingCodeKey(publicCode, secret);
  const second = deriveGuestOrderTrackingCodeKey(publicCode, secret);
  const otherSecret = deriveGuestOrderTrackingCodeKey(
    publicCode,
    "different-tracking-secret-0123456789abcdef",
  );

  assert.match(first, /^v1:[0-9a-f]{64}$/);
  assert.equal(first, second);
  assert.notEqual(first, otherSecret);
  assert.equal(first.includes(publicCode), false);
  assert.throws(() => deriveGuestOrderTrackingCodeKey("", secret), TypeError);
  assert.throws(() => deriveGuestOrderTrackingCodeKey(publicCode, "short"), TypeError);
});
