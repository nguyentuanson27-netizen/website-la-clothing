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
const testShopId = 920_002;
const productExternalId = "anonymous-cart-concurrency-product";
const variationExternalId = "anonymous-cart-concurrency-variant";
const accountUserId = "anonymous-cart-concurrency-user";
const accountUserEmail = "anonymous-cart-concurrency@example.invalid";
const PAUSE_SET_QUANTITY = 2_147_483_646;
const PAUSE_DELETE_QUANTITY = 2_147_483_645;
const OVERFLOW_QUANTITY = 2_147_483_648;

let variantId = "";
const createdCartIds = new Set<string>();

async function dropPauseTrigger() {
  await prisma.$executeRaw`DROP TRIGGER IF EXISTS anonymous_cart_test_pause_mutation ON "CartItem"`;
  await prisma.$executeRaw`DROP FUNCTION IF EXISTS anonymous_cart_test_pause_mutation()`;
}

async function installPauseTrigger() {
  await dropPauseTrigger();

  await prisma.$executeRaw`
    CREATE FUNCTION anonymous_cart_test_pause_mutation()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF OLD."quantity" = 2147483645 THEN
          PERFORM pg_sleep(1.0);
        END IF;
        RETURN OLD;
      END IF;

      IF NEW."quantity" = 2147483646 THEN
        PERFORM pg_sleep(1.0);
      END IF;

      RETURN NEW;
    END;
    $function$
  `;

  await prisma.$executeRaw`
    CREATE TRIGGER anonymous_cart_test_pause_mutation
    BEFORE INSERT OR UPDATE OR DELETE ON "CartItem"
    FOR EACH ROW
    EXECUTE FUNCTION anonymous_cart_test_pause_mutation()
  `;
}

async function waitForPausedCartItemMutation() {
  const deadline = Date.now() + 4_000;

  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ paused: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event = 'PgSleep'
          AND query ILIKE '%CartItem%'
      ) AS paused
    `;

    if (rows[0]?.paused) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error("Timed out waiting for the test CartItem mutation to pause");
}

async function observeClaimState(isCompleted: () => boolean): Promise<"blocked" | "completed"> {
  const deadline = Date.now() + 4_000;

  while (Date.now() < deadline) {
    if (isCompleted()) {
      return "completed";
    }

    const rows = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query ILIKE '%UPDATE%Cart%userId%'
      ) AS blocked
    `;

    if (rows[0]?.blocked) {
      return "blocked";
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error("Timed out observing the concurrent cart ownership claim");
}

async function createAccountUser(now: Date) {
  await prisma.user.create({
    data: {
      id: accountUserId,
      name: "Anonymous Cart Concurrency User",
      email: accountUserEmail,
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    },
  });
}

async function cleanup() {
  await dropPauseTrigger();

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
      name: "Anonymous Cart Concurrency Product",
      syncedAt: new Date("2026-08-09T00:00:00.000Z"),
      variants: {
        create: {
          pancakeVariationId: variationExternalId,
          isActive: true,
          syncedAt: new Date("2026-08-09T00:00:00.000Z"),
        },
      },
    },
    include: { variants: true },
  });

  variantId = product.variants[0]?.id ?? "";
  assert.ok(variantId);
});

test.afterEach(cleanup);

test.after(async () => {
  await dropPauseTrigger();
  await prisma.$disconnect();
});

test("rejects fractional and PostgreSQL INTEGER overflow quantities without persistence", async () => {
  const now = new Date("2026-08-09T12:00:00.000Z");
  const cart = await carts.create({ now });
  createdCartIds.add(cart.id);

  assert.deepEqual(
    await carts.setItemQuantity({ cartId: cart.id, variantId, quantity: 1.5, now }),
    { ok: false, reason: "INVALID_QUANTITY" },
  );
  assert.deepEqual(
    await carts.setItemQuantity({ cartId: cart.id, variantId, quantity: OVERFLOW_QUANTITY, now }),
    { ok: false, reason: "INVALID_QUANTITY" },
  );
  assert.equal(await prisma.cartItem.count({ where: { cartId: cart.id } }), 0);
});

test("set quantity holds the anonymous ownership boundary until the mutation commits", async () => {
  const now = new Date("2026-08-09T12:00:00.000Z");
  await createAccountUser(now);

  const cart = await carts.create({ now });
  createdCartIds.add(cart.id);
  await installPauseTrigger();

  const mutationPromise = carts.setItemQuantity({
    cartId: cart.id,
    variantId,
    quantity: PAUSE_SET_QUANTITY,
    now,
  });

  await waitForPausedCartItemMutation();

  let claimCompleted = false;
  const claimPromise = prisma.cart
    .update({
      where: { id: cart.id },
      data: { userId: accountUserId },
    })
    .then((claimedCart) => {
      claimCompleted = true;
      return claimedCart;
    });

  const claimState = await observeClaimState(() => claimCompleted);
  const [mutationResult, claimedCart] = await Promise.all([mutationPromise, claimPromise]);

  assert.equal(claimState, "blocked");
  assert.deepEqual(mutationResult, {
    ok: true,
    item: { variantId, quantity: PAUSE_SET_QUANTITY },
  });
  assert.equal(claimedCart.userId, accountUserId);
  assert.equal(
    (await prisma.cartItem.findUnique({
      where: { cartId_variantId: { cartId: cart.id, variantId } },
    }))?.quantity,
    PAUSE_SET_QUANTITY,
  );
});

test("remove holds the anonymous ownership boundary until the mutation commits", async () => {
  const now = new Date("2026-08-09T12:00:00.000Z");
  await createAccountUser(now);

  const cart = await carts.create({ now });
  createdCartIds.add(cart.id);

  assert.deepEqual(
    await carts.setItemQuantity({
      cartId: cart.id,
      variantId,
      quantity: PAUSE_DELETE_QUANTITY,
      now,
    }),
    { ok: true, item: { variantId, quantity: PAUSE_DELETE_QUANTITY } },
  );

  await installPauseTrigger();

  const mutationPromise = carts.removeItem({
    cartId: cart.id,
    variantId,
    now,
    resolveLine: allowAnyCartLine,
  });
  await waitForPausedCartItemMutation();

  let claimCompleted = false;
  const claimPromise = prisma.cart
    .update({
      where: { id: cart.id },
      data: { userId: accountUserId },
    })
    .then((claimedCart) => {
      claimCompleted = true;
      return claimedCart;
    });

  const claimState = await observeClaimState(() => claimCompleted);
  const [mutationResult, claimedCart] = await Promise.all([mutationPromise, claimPromise]);

  assert.equal(claimState, "blocked");
  assert.deepEqual(mutationResult, {
    ok: true,
    removedQuantity: PAUSE_DELETE_QUANTITY,
    snapshot: null,
  });
  assert.equal(claimedCart.userId, accountUserId);
  assert.equal(await prisma.cartItem.count({ where: { cartId: cart.id } }), 0);
});
