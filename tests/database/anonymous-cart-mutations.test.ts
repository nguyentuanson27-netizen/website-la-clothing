import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  ANONYMOUS_CART_COOKIE_NAME,
  type AnonymousCartCookieWrite,
} from "../../src/commerce/anonymous-cart-cookie.ts";
import {
  ANONYMOUS_CART_MAX_DISTINCT_ITEMS,
  createAnonymousCartService,
} from "../../src/commerce/anonymous-cart.ts";
import { createAnonymousCartMutationService } from "../../src/commerce/anonymous-cart-mutation.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const carts = createAnonymousCartService(prisma);
const productExternalId = "anonymous-cart-mutation-product";
const variantExternalPrefix = "anonymous-cart-mutation-variant";
const accountUserId = "anonymous-cart-mutation-user";
const createdCartIds = new Set<string>();
let variantIds: string[] = [];

function mutableCookieStore(initialValue?: string) {
  let value = initialValue;
  const writes: AnonymousCartCookieWrite[] = [];

  return {
    store: {
      get(name: string) {
        return name === ANONYMOUS_CART_COOKIE_NAME && value ? { value } : undefined;
      },
      set(cookie: AnonymousCartCookieWrite) {
        writes.push(cookie);
        value = cookie.value || undefined;
      },
    },
    writes,
    value: () => value,
  };
}

async function cleanup() {
  if (createdCartIds.size > 0) {
    await prisma.cart.deleteMany({ where: { id: { in: [...createdCartIds] } } });
    createdCartIds.clear();
  }
  await prisma.cart.deleteMany({ where: { userId: accountUserId } });
  await prisma.user.deleteMany({ where: { id: accountUserId } });
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: productExternalId } });
}

test.beforeEach(async () => {
  await cleanup();
  const product = await prisma.productMirror.create({
    data: {
      pancakeProductId: productExternalId,
      slug: productExternalId,
      name: "Anonymous Cart Mutation Product",
      syncedAt: new Date("2026-08-10T00:00:00.000Z"),
      variants: {
        create: Array.from({ length: ANONYMOUS_CART_MAX_DISTINCT_ITEMS + 1 }, (_, index) => ({
          pancakeVariationId: `${variantExternalPrefix}-${index + 1}`,
          isActive: true,
          syncedAt: new Date("2026-08-10T00:00:00.000Z"),
        })),
      },
    },
    include: { variants: { orderBy: { pancakeVariationId: "asc" } } },
  });
  variantIds = product.variants.map(({ id }) => id);
  assert.equal(variantIds.length, ANONYMOUS_CART_MAX_DISTINCT_ITEMS + 1);
});

test.afterEach(cleanup);
test.after(async () => prisma.$disconnect());

test("first successful mutation creates one cart and emits its DB-owned cookie", async () => {
  const now = new Date("2026-08-10T00:00:00.000Z");
  const cookies = mutableCookieStore();
  const mutations = createAnonymousCartMutationService(prisma, cookies.store, { production: true });

  const result = await mutations.setItemQuantity({ variantId: variantIds[0], quantity: 2, now });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  createdCartIds.add(result.cartId);

  assert.equal(await prisma.cart.count({ where: { id: result.cartId, userId: null } }), 1);
  assert.equal(
    (await prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: result.cartId, variantId: variantIds[0] } },
    }))?.quantity,
    2,
  );
  assert.equal(cookies.writes.length, 1);
  assert.deepEqual(cookies.writes[0], {
    name: ANONYMOUS_CART_COOKIE_NAME,
    value: result.cartId,
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    expires: result.expiresAt,
  });
});

test("invalid first mutation creates no cart and emits no cookie", async () => {
  const now = new Date("2026-08-10T00:00:00.000Z");
  const cookies = mutableCookieStore();
  const mutations = createAnonymousCartMutationService(prisma, cookies.store);
  const before = await prisma.cart.count();

  assert.deepEqual(
    await mutations.setItemQuantity({ variantId: variantIds[0], quantity: 0, now }),
    { ok: false, reason: "INVALID_QUANTITY" },
  );
  assert.deepEqual(
    await mutations.setItemQuantity({ variantId: "missing-variant", quantity: 1, now }),
    { ok: false, reason: "VARIANT_UNAVAILABLE" },
  );
  assert.equal(await prisma.cart.count(), before);
  assert.equal(cookies.writes.length, 0);
});

test("a stale cart cookie is replaced only after a valid new cart mutation", async () => {
  const now = new Date("2026-08-10T00:00:00.000Z");
  const stale = await carts.create({ now });
  createdCartIds.add(stale.id);
  const replacementNow = stale.expiresAt;
  const cookies = mutableCookieStore(stale.id);
  const mutations = createAnonymousCartMutationService(prisma, cookies.store);

  const result = await mutations.setItemQuantity({
    variantId: variantIds[0],
    quantity: 1,
    now: replacementNow,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  createdCartIds.add(result.cartId);

  assert.notEqual(result.cartId, stale.id);
  assert.equal(cookies.value(), result.cartId);
  assert.equal(cookies.writes.length, 1);
  assert.deepEqual(
    (await prisma.cart.findUnique({ where: { id: stale.id }, select: { expiresAt: true } }))?.expiresAt,
    stale.expiresAt,
  );
});

test("an account-owned cart cookie is never mutated and rotates to a new anonymous cart", async () => {
  const now = new Date("2026-08-10T00:00:00.000Z");
  await prisma.user.create({
    data: {
      id: accountUserId,
      name: "Anonymous Cart Mutation User",
      email: "anonymous-cart-mutation@example.invalid",
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
  await prisma.cartItem.create({
    data: {
      cartId: accountCart.id,
      variantId: variantIds[0],
      quantity: 7,
    },
  });

  const cookies = mutableCookieStore(accountCart.id);
  const mutations = createAnonymousCartMutationService(prisma, cookies.store);
  const result = await mutations.setItemQuantity({ variantId: variantIds[0], quantity: 2, now });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  createdCartIds.add(result.cartId);

  assert.notEqual(result.cartId, accountCart.id);
  assert.equal(cookies.value(), result.cartId);
  assert.equal(cookies.writes.length, 1);
  assert.equal(
    (await prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: accountCart.id, variantId: variantIds[0] } },
    }))?.quantity,
    7,
  );
  assert.equal(
    (await prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: result.cartId, variantId: variantIds[0] } },
    }))?.quantity,
    2,
  );
  assert.equal(
    (await prisma.cart.findUnique({ where: { id: accountCart.id }, select: { userId: true } }))?.userId,
    accountUserId,
  );
});

test("distinct-line ceiling is atomic and still allows updating an existing line", async () => {
  const now = new Date("2026-08-10T00:00:00.000Z");
  const cart = await carts.create({ now });
  createdCartIds.add(cart.id);

  await prisma.cartItem.createMany({
    data: variantIds.slice(0, ANONYMOUS_CART_MAX_DISTINCT_ITEMS - 1).map((variantId) => ({
      cartId: cart.id,
      variantId,
      quantity: 1,
    })),
  });

  const [first, second] = await Promise.all([
    carts.setItemQuantity({
      cartId: cart.id,
      variantId: variantIds[ANONYMOUS_CART_MAX_DISTINCT_ITEMS - 1],
      quantity: 1,
      now,
    }),
    carts.setItemQuantity({
      cartId: cart.id,
      variantId: variantIds[ANONYMOUS_CART_MAX_DISTINCT_ITEMS],
      quantity: 1,
      now,
    }),
  ]);

  assert.equal([first, second].filter((result) => result.ok).length, 1);
  assert.equal(
    [first, second].filter((result) => !result.ok && result.reason === "CART_LINE_LIMIT").length,
    1,
  );
  assert.equal(await prisma.cartItem.count({ where: { cartId: cart.id } }), ANONYMOUS_CART_MAX_DISTINCT_ITEMS);

  assert.deepEqual(
    await carts.setItemQuantity({ cartId: cart.id, variantId: variantIds[0], quantity: 3, now }),
    { ok: true, item: { variantId: variantIds[0], quantity: 3 } },
  );
  assert.equal(await prisma.cartItem.count({ where: { cartId: cart.id } }), ANONYMOUS_CART_MAX_DISTINCT_ITEMS);
});

test("remove clears a valid stale cookie but never mutates an unavailable cart", async () => {
  const now = new Date("2026-08-10T00:00:00.000Z");
  const cart = await carts.create({ now });
  createdCartIds.add(cart.id);
  const cookies = mutableCookieStore(cart.id);
  const mutations = createAnonymousCartMutationService(prisma, cookies.store);

  assert.deepEqual(
    await mutations.removeItem({ variantId: variantIds[0], now: cart.expiresAt }),
    { ok: false, reason: "CART_UNAVAILABLE" },
  );
  assert.equal(cookies.writes.length, 1);
  assert.deepEqual(cookies.writes[0], {
    name: ANONYMOUS_CART_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 0,
  });
  assert.equal(await prisma.cartItem.count({ where: { cartId: cart.id } }), 0);
});
