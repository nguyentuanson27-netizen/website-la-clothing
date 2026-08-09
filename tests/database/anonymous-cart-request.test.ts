import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createAnonymousCartService } from "../../src/commerce/anonymous-cart.ts";
import { resolveAnonymousCartRequest } from "../../src/commerce/anonymous-cart-request.ts";
import { ANONYMOUS_CART_COOKIE_NAME } from "../../src/commerce/anonymous-cart-cookie.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const carts = createAnonymousCartService(prisma);
const accountUserId = "anonymous-cart-request-user";
const createdCartIds = new Set<string>();

function cookieStore(value?: string) {
  let writes = 0;

  return {
    store: {
      get(name: string) {
        return name === ANONYMOUS_CART_COOKIE_NAME && value ? { value } : undefined;
      },
      set() {
        writes += 1;
      },
    },
    writes: () => writes,
  };
}

async function cleanup() {
  if (createdCartIds.size > 0) {
    await prisma.cart.deleteMany({ where: { id: { in: [...createdCartIds] } } });
    createdCartIds.clear();
  }
  await prisma.cart.deleteMany({ where: { userId: accountUserId } });
  await prisma.user.deleteMany({ where: { id: accountUserId } });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => prisma.$disconnect());

test("request adapter resolves only a live anonymous cart without writing cookies", async () => {
  const now = new Date("2026-08-10T00:00:00.000Z");
  const liveCart = await carts.create({ now });
  createdCartIds.add(liveCart.id);

  const liveCookie = cookieStore(liveCart.id);
  assert.equal(
    (await resolveAnonymousCartRequest({ client: prisma, store: liveCookie.store, now }))?.id,
    liveCart.id,
  );
  assert.equal(liveCookie.writes(), 0);

  const missingCookie = cookieStore();
  assert.equal(
    await resolveAnonymousCartRequest({ client: prisma, store: missingCookie.store, now }),
    null,
  );
  assert.equal(missingCookie.writes(), 0);

  const malformedCookie = cookieStore(" not-a-cart-id ");
  assert.equal(
    await resolveAnonymousCartRequest({ client: prisma, store: malformedCookie.store, now }),
    null,
  );
  assert.equal(malformedCookie.writes(), 0);

  const expiredCookie = cookieStore(liveCart.id);
  assert.equal(
    await resolveAnonymousCartRequest({
      client: prisma,
      store: expiredCookie.store,
      now: liveCart.expiresAt,
    }),
    null,
  );
  assert.equal(expiredCookie.writes(), 0);
});

test("request adapter never resolves an account-owned cart", async () => {
  const now = new Date("2026-08-10T00:00:00.000Z");
  await prisma.user.create({
    data: {
      id: accountUserId,
      name: "Anonymous Cart Request User",
      email: "anonymous-cart-request@example.invalid",
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    },
  });

  const accountCart = await prisma.cart.create({
    data: {
      userId: accountUserId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  const accountCookie = cookieStore(accountCart.id);
  assert.equal(
    await resolveAnonymousCartRequest({ client: prisma, store: accountCookie.store, now }),
    null,
  );
  assert.equal(accountCookie.writes(), 0);
});
