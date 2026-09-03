import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createAnonymousCartService } from "../../src/commerce/anonymous-cart.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import { allowAnyCartLine } from "../fixtures/cart-line-authority.ts";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const carts = createAnonymousCartService(prisma);
const testShopId = 920_003;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const productExternalId = "anonymous-cart-runtime-product";
const activeVariationExternalId = "anonymous-cart-runtime-active";
const inactiveVariationExternalId = "anonymous-cart-runtime-inactive";
const accountUserId = "anonymous-cart-runtime-user";

let activeVariantId = "";
let inactiveVariantId = "";
const createdCartIds = new Set<string>();

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
      pancakeShopId: testShopId,
      pancakeProductId: productExternalId,
      slug: productExternalId,
      name: "Anonymous Cart Runtime Product",
      syncedAt: new Date("2026-08-09T00:00:00.000Z"),
      variants: {
        create: [
          {
            pancakeVariationId: activeVariationExternalId,
            isActive: true,
            syncedAt: new Date("2026-08-09T00:00:00.000Z"),
          },
          {
            pancakeVariationId: inactiveVariationExternalId,
            isActive: false,
            syncedAt: new Date("2026-08-09T00:00:00.000Z"),
          },
        ],
      },
    },
    include: { variants: true },
  });

  activeVariantId = product.variants.find(
    ({ pancakeVariationId }) => pancakeVariationId === activeVariationExternalId,
  )?.id ?? "";
  inactiveVariantId = product.variants.find(
    ({ pancakeVariationId }) => pancakeVariationId === inactiveVariationExternalId,
  )?.id ?? "";

  assert.ok(activeVariantId);
  assert.ok(inactiveVariantId);
});

test.afterEach(cleanup);

test.after(async () => {
  await prisma.$disconnect();
});

test("creates a live anonymous cart with a 30-day absolute expiry", async () => {
  const now = new Date("2026-08-09T12:00:00.000Z");
  const expiresAt = new Date(now.getTime() + THIRTY_DAYS_MS);

  const cart = await carts.create({ now });
  createdCartIds.add(cart.id);

  assert.equal(cart.userId, null);
  assert.deepEqual(cart.items, []);
  assert.deepEqual(cart.expiresAt, expiresAt);
  assert.equal((await carts.get({ cartId: cart.id, now }))?.id, cart.id);
  assert.equal(await carts.get({ cartId: cart.id, now: expiresAt }), null);
});

test("creates a new cart instead of reviving an expired anonymous cart", async () => {
  const firstNow = new Date("2026-08-09T12:00:00.000Z");
  const firstCart = await carts.create({ now: firstNow });
  createdCartIds.add(firstCart.id);

  const replacementNow = new Date(firstCart.expiresAt.getTime() + 1);
  assert.equal(await carts.get({ cartId: firstCart.id, now: replacementNow }), null);

  const replacementCart = await carts.create({ now: replacementNow });
  createdCartIds.add(replacementCart.id);

  assert.notEqual(replacementCart.id, firstCart.id);
  assert.deepEqual(
    replacementCart.expiresAt,
    new Date(replacementNow.getTime() + THIRTY_DAYS_MS),
  );
  assert.deepEqual(
    (await prisma.cart.findUnique({ where: { id: firstCart.id }, select: { expiresAt: true } }))
      ?.expiresAt,
    firstCart.expiresAt,
  );
});

test("sets one active variant row per anonymous cart without extending absolute expiry", async () => {
  const now = new Date("2026-08-09T12:00:00.000Z");
  const mutationNow = new Date("2026-08-19T12:00:00.000Z");
  const cart = await carts.create({ now });
  createdCartIds.add(cart.id);

  assert.deepEqual(
    await carts.setItemQuantity({
      cartId: cart.id,
      variantId: activeVariantId,
      quantity: 2,
      now: mutationNow,
    }),
    { ok: true, item: { variantId: activeVariantId, quantity: 2 } },
  );
  assert.deepEqual(
    await carts.setItemQuantity({
      cartId: cart.id,
      variantId: activeVariantId,
      quantity: 3,
      now: mutationNow,
    }),
    { ok: true, item: { variantId: activeVariantId, quantity: 3 } },
  );

  assert.equal(await prisma.cartItem.count({ where: { cartId: cart.id } }), 1);
  assert.deepEqual(
    (await prisma.cart.findUnique({ where: { id: cart.id }, select: { expiresAt: true } }))?.expiresAt,
    cart.expiresAt,
  );
});

test("rejects invalid quantity and unavailable catalog entries without creating an item", async () => {
  const now = new Date("2026-08-09T12:00:00.000Z");
  const cart = await carts.create({ now });
  createdCartIds.add(cart.id);

  assert.deepEqual(
    await carts.setItemQuantity({ cartId: cart.id, variantId: activeVariantId, quantity: 0, now }),
    { ok: false, reason: "INVALID_QUANTITY" },
  );
  assert.deepEqual(
    await carts.setItemQuantity({ cartId: cart.id, variantId: inactiveVariantId, quantity: 1, now }),
    { ok: false, reason: "VARIANT_UNAVAILABLE" },
  );

  await prisma.productMirror.update({
    where: { pancakeProductId: productExternalId },
    data: { isActive: false },
  });

  assert.deepEqual(
    await carts.setItemQuantity({ cartId: cart.id, variantId: activeVariantId, quantity: 1, now }),
    { ok: false, reason: "VARIANT_UNAVAILABLE" },
  );
  assert.equal(await prisma.cartItem.count({ where: { cartId: cart.id } }), 0);
});

test("rejects mutations at and after the absolute cart expiry", async () => {
  const now = new Date("2026-08-09T12:00:00.000Z");
  const cart = await carts.create({ now });
  createdCartIds.add(cart.id);

  assert.deepEqual(
    await carts.setItemQuantity({
      cartId: cart.id,
      variantId: activeVariantId,
      quantity: 1,
      now: cart.expiresAt,
    }),
    { ok: false, reason: "CART_UNAVAILABLE" },
  );
  assert.deepEqual(
    await carts.removeItem({
      cartId: cart.id,
      variantId: activeVariantId,
      now: cart.expiresAt,
      resolveLine: allowAnyCartLine,
    }),
    { ok: false, reason: "CART_UNAVAILABLE" },
  );
  assert.equal(await prisma.cartItem.count({ where: { cartId: cart.id } }), 0);
});

test("never mutates an account-owned cart through the anonymous cart service", async () => {
  const now = new Date("2026-08-09T12:00:00.000Z");

  await prisma.user.create({
    data: {
      id: accountUserId,
      name: "Account Cart Owner",
      email: "anonymous-cart-runtime@example.invalid",
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    },
  });

  const accountCart = await prisma.cart.create({
    data: {
      userId: accountUserId,
      expiresAt: new Date(now.getTime() + THIRTY_DAYS_MS),
    },
  });

  assert.equal(await carts.get({ cartId: accountCart.id, now }), null);
  assert.deepEqual(
    await carts.setItemQuantity({ cartId: accountCart.id, variantId: activeVariantId, quantity: 1, now }),
    { ok: false, reason: "CART_UNAVAILABLE" },
  );
  assert.deepEqual(
    await carts.removeItem({
      cartId: accountCart.id,
      variantId: activeVariantId,
      now,
      resolveLine: allowAnyCartLine,
    }),
    { ok: false, reason: "CART_UNAVAILABLE" },
  );
  assert.equal(await prisma.cartItem.count({ where: { cartId: accountCart.id } }), 0);
});

test("removes an item only from a live anonymous cart", async () => {
  const now = new Date("2026-08-09T12:00:00.000Z");
  const cart = await carts.create({ now });
  createdCartIds.add(cart.id);

  await carts.setItemQuantity({ cartId: cart.id, variantId: activeVariantId, quantity: 2, now });

  assert.deepEqual(
    await carts.removeItem({
      cartId: cart.id,
      variantId: activeVariantId,
      now,
      resolveLine: allowAnyCartLine,
    }),
    { ok: true, removedQuantity: 2, snapshot: null },
  );
  assert.equal(await prisma.cartItem.count({ where: { cartId: cart.id } }), 0);
});
