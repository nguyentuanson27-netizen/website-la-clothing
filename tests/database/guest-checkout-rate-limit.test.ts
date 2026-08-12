import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createGuestCheckoutRateLimiter } from "../../src/commerce/guest-checkout-rate-limit.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const cartId = "22222222-2222-4222-8222-222222222222";
const otherCartId = "33333333-3333-4333-8333-333333333333";
const clientKey = `v1:${"a".repeat(64)}`;
const otherClientKey = `v1:${"b".repeat(64)}`;
const bucketIds = [
  `checkout:${cartId}`,
  `checkout:${otherCartId}`,
  `checkout-client:${clientKey}`,
  `checkout-client:${otherClientKey}`,
];
const start = new Date("2026-08-12T05:40:00.000Z");

async function cleanup() {
  await prisma.rateLimit.deleteMany({ where: { id: { in: bucketIds } } });
}

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("guest checkout limiter atomically allows five attempts per cart and resets after the window", async () => {
  await cleanup();
  const limiter = createGuestCheckoutRateLimiter(prisma, {
    maxAttempts: 5,
    windowMs: 60_000,
  });

  const concurrent = await Promise.all(
    Array.from({ length: 6 }, () => limiter.consume({ cartId, now: start })),
  );
  assert.equal(concurrent.filter(Boolean).length, 5);
  assert.equal(concurrent.filter((allowed) => !allowed).length, 1);

  assert.equal(await limiter.consume({ cartId: otherCartId, now: start }), true);

  const saturated = await prisma.rateLimit.findUniqueOrThrow({
    where: { id: `checkout:${cartId}` },
  });
  assert.equal(saturated.key, `checkout:${cartId}`);
  assert.equal(saturated.count, 6);
  assert.equal(saturated.lastRequest, BigInt(start.getTime()));

  const resetAt = new Date(start.getTime() + 60_001);
  assert.equal(await limiter.consume({ cartId, now: resetAt }), true);

  const reset = await prisma.rateLimit.findUniqueOrThrow({
    where: { id: `checkout:${cartId}` },
  });
  assert.equal(reset.count, 1);
  assert.equal(reset.lastRequest, BigInt(resetAt.getTime()));
});

test("guest checkout limiter atomically caps one trusted client across cart rotations", async () => {
  await cleanup();
  const limiter = createGuestCheckoutRateLimiter(prisma, {
    maxClientAttempts: 3,
    clientWindowMs: 60_000,
  });

  const concurrent = await Promise.all(
    Array.from({ length: 4 }, () => limiter.consumeClient({ clientKey, now: start })),
  );
  assert.equal(concurrent.filter(Boolean).length, 3);
  assert.equal(concurrent.filter((allowed) => !allowed).length, 1);
  assert.equal(await limiter.consumeClient({ clientKey: otherClientKey, now: start }), true);

  const saturated = await prisma.rateLimit.findUniqueOrThrow({
    where: { id: `checkout-client:${clientKey}` },
  });
  assert.equal(saturated.key, `checkout-client:${clientKey}`);
  assert.equal(saturated.count, 4);
  assert.equal(saturated.lastRequest, BigInt(start.getTime()));
});

test("guest checkout limiter rejects malformed local configuration before database access", async () => {
  assert.throws(
    () => createGuestCheckoutRateLimiter(prisma, { maxAttempts: 0 }),
    /Checkout max attempts must be a positive safe integer/,
  );
  assert.throws(
    () => createGuestCheckoutRateLimiter(prisma, { windowMs: 0 }),
    /Checkout rate-limit window must be a positive safe integer/,
  );
  assert.throws(
    () => createGuestCheckoutRateLimiter(prisma, { maxClientAttempts: 0 }),
    /Checkout client max attempts must be a positive safe integer/,
  );
  assert.throws(
    () => createGuestCheckoutRateLimiter(prisma, { clientWindowMs: 0 }),
    /Checkout client rate-limit window must be a positive safe integer/,
  );

  const limiter = createGuestCheckoutRateLimiter(prisma);
  await assert.rejects(
    () => limiter.consume({ cartId: "", now: start }),
    /Checkout cart id must be a bounded non-empty string/,
  );
  await assert.rejects(
    () => limiter.consume({ cartId, now: new Date(Number.NaN) }),
    /Checkout rate-limit time must be valid/,
  );
  await assert.rejects(
    () => limiter.consumeClient({ clientKey: "203.0.113.10", now: start }),
    /Checkout client key must be a pseudonymous v1 key/,
  );
});
