import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createAnonymousCartService } from "../../src/commerce/anonymous-cart.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const carts = createAnonymousCartService(prisma);
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

test("creates and reads only a live anonymous cart", async () => {
  const now = new Date("2026-08-09T12:00:00.000Z");
  const expiresAt = new Date("2026-08-16T12:00:00.000Z");

  const cart = await carts.create({ now, expiresAt });
  createdCartIds.add(cart.id);

  assert.equal(cart.userId, null);
  assert.deepEqual(cart.items, []);
  assert.equal((await carts.get({ cartId: cart.id, now }))?.id, cart.id);
  assert.equal(await carts.get({ cartId: cart.id, now: expiresAt }), null);
});

test("sets one active variant row per anonymous cart and replaces its quantity", async () => {
  const now = new Date("2026-08-09T12:00:00.000Z");
  const cart = await carts.create({
    now,
    expiresAt: new Date("2026-08-16T12:00:00.000Z"),
  });
  createdCartIds.add(cart.id);

  assert.deepEqual(
    await carts.setItemQuantity({ cartId: cart.id, variantId: activeVariantId, quantity: 2, now }),
    { ok: true, item: { variantId: activeVariantId, quantity: 2 } },
  );
  assert.deepEqual(
    await carts.setItemQuantity({ cartId: cart.id, variantId: activeVariantId, quantity: 3, now }),
    { ok: true, item: { variantId: activeVariantId, quantity: 3 } },
  );

  assert.equal(await prisma.cartItem.count({ where: { cartId: cart.id } }), 1);
});

test("rejects invalid quantity and unavailable catalog entries without creating an item", async () => {
  const now = new Date("2026-08-09T12:00:00.000Z");
  const cart = await carts.create({
    now,
    expiresAt: new Date("2026-08-16T12:00:00.000Z"),
  });
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

test("rejects mutations at and after cart expiry", async () => {
  const now = new Date("2026-08-09T12:00:00.000Z");
  const expiresAt = new Date("2026-08-16T12:00:00.000Z");
  const cart = await carts.create({ now, expiresAt });
  createdCartIds.add(cart.id);

  assert.deepEqual(
    await carts.setItemQuantity({
      cartId: cart.id,
      variantId: activeVariantId,
      quantity: 1,
      now: expiresAt,
    }),
    { ok: false, reason: "CART_UNAVAILABLE" },
  );
  assert.deepEqual(
    await carts.removeItem({ cartId: cart.id, variantId: activeVariantId, now: expiresAt }),
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
      expiresAt: new Date("2026-08-16T12:00:00.000Z"),
    },
  });

  assert.equal(await carts.get({ cartId: accountCart.id, now }), null);
  assert.deepEqual(
    await carts.setItemQuantity({ cartId: accountCart.id, variantId: activeVariantId, quantity: 1, now }),
    { ok: false, reason: "CART_UNAVAILABLE" },
  );
  assert.deepEqual(
    await carts.removeItem({ cartId: accountCart.id, variantId: activeVariantId, now }),
    { ok: false, reason: "CART_UNAVAILABLE" },
  );
  assert.equal(await prisma.cartItem.count({ where: { cartId: accountCart.id } }), 0);
});

test("removes an item only from a live anonymous cart", async () => {
  const now = new Date("2026-08-09T12:00:00.000Z");
  const cart = await carts.create({
    now,
    expiresAt: new Date("2026-08-16T12:00:00.000Z"),
  });
  createdCartIds.add(cart.id);

  await carts.setItemQuantity({ cartId: cart.id, variantId: activeVariantId, quantity: 2, now });

  assert.deepEqual(
    await carts.removeItem({ cartId: cart.id, variantId: activeVariantId, now }),
    { ok: true },
  );
  assert.equal(await prisma.cartItem.count({ where: { cartId: cart.id } }), 0);
});
