import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import {
  ANONYMOUS_CART_COOKIE_NAME,
  type AnonymousCartCookieWrite,
} from "../../src/commerce/anonymous-cart-cookie.ts";
import { createAnonymousCartMutationService } from "../../src/commerce/anonymous-cart-mutation.ts";
import { createAnonymousCartService } from "../../src/commerce/anonymous-cart.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const REMOVE_APPLICATION_NAME = "storefront-cart-update-race-remove";
const PAUSE_DELETE_QUANTITY = 2_147_483_644;
const testShopId = 920_003;
const productExternalId = "storefront-cart-update-race-product";
const variationExternalId = "storefront-cart-update-race-variant";

function connectionStringWithApplicationName(value: string): string {
  const url = new URL(value);
  url.searchParams.set("application_name", REMOVE_APPLICATION_NAME);
  return url.toString();
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const removePrisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: connectionStringWithApplicationName(connectionString) }),
});
const carts = createAnonymousCartService(prisma);
const removeCarts = createAnonymousCartService(removePrisma);

let variantId = "";
const createdCartIds = new Set<string>();

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

async function dropPauseTrigger() {
  await prisma.$executeRaw`DROP TRIGGER IF EXISTS storefront_cart_update_race_pause_delete ON "CartItem"`;
  await prisma.$executeRaw`DROP FUNCTION IF EXISTS storefront_cart_update_race_pause_delete()`;
}

async function installPauseTrigger() {
  await dropPauseTrigger();

  await prisma.$executeRaw`
    CREATE FUNCTION storefront_cart_update_race_pause_delete()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    BEGIN
      IF OLD."quantity" = 2147483644 THEN
        PERFORM pg_sleep(1.0);
      END IF;
      RETURN OLD;
    END;
    $function$
  `;

  await prisma.$executeRaw`
    CREATE TRIGGER storefront_cart_update_race_pause_delete
    BEFORE DELETE ON "CartItem"
    FOR EACH ROW
    EXECUTE FUNCTION storefront_cart_update_race_pause_delete()
  `;
}

async function waitForRemoveToPause() {
  const deadline = Date.now() + 4_000;

  while (Date.now() < deadline) {
    const rows = await prisma.$queryRaw<Array<{ paused: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND application_name = ${REMOVE_APPLICATION_NAME}
          AND wait_event = 'PgSleep'
      ) AS paused
    `;

    if (rows[0]?.paused) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error("Timed out waiting for the storefront cart remove mutation to pause");
}

async function cleanup() {
  await dropPauseTrigger();
  if (createdCartIds.size > 0) {
    await prisma.cart.deleteMany({ where: { id: { in: [...createdCartIds] } } });
    createdCartIds.clear();
  }
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: productExternalId } });
}

test.beforeEach(async () => {
  await cleanup();
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: testShopId,
      pancakeProductId: productExternalId,
      slug: productExternalId,
      name: "Storefront Cart Update Race Product",
      syncedAt: new Date("2026-08-11T00:00:00.000Z"),
      variants: {
        create: {
          pancakeVariationId: variationExternalId,
          isActive: true,
          syncedAt: new Date("2026-08-11T00:00:00.000Z"),
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
  await Promise.all([prisma.$disconnect(), removePrisma.$disconnect()]);
});

test("update-existing cannot resurrect a line removed after the storefront precheck", async () => {
  const now = new Date("2026-08-11T07:00:00.000Z");
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

  // This models the public precheck having already observed the line. The remove
  // commits before the later update mutation can acquire the same cart row lock.
  await installPauseTrigger();
  const removePromise = removeCarts.removeItem({ cartId: cart.id, variantId, now });
  await waitForRemoveToPause();

  const updatePromise = carts.updateExistingItemQuantity({
    cartId: cart.id,
    variantId,
    quantity: 2,
    now,
  });

  const [removeResult, updateResult] = await Promise.all([removePromise, updatePromise]);

  assert.deepEqual(removeResult, { ok: true });
  assert.deepEqual(updateResult, { ok: false, reason: "CART_ITEM_UNAVAILABLE" });
  assert.equal(await prisma.cartItem.count({ where: { cartId: cart.id, variantId } }), 0);
});

test("storefront update-existing never rotates an unavailable cart into a new anonymous cart", async () => {
  const now = new Date("2026-08-11T07:00:00.000Z");
  const cart = await carts.create({ now });
  createdCartIds.add(cart.id);

  assert.deepEqual(
    await carts.setItemQuantity({ cartId: cart.id, variantId, quantity: 1, now }),
    { ok: true, item: { variantId, quantity: 1 } },
  );

  const cookies = mutableCookieStore(cart.id);
  const mutations = createAnonymousCartMutationService(prisma, cookies.store);
  const result = await mutations.updateExistingItemQuantity({
    variantId,
    quantity: 2,
    now: cart.expiresAt,
  });

  assert.deepEqual(result, { ok: false, reason: "CART_UNAVAILABLE" });
  assert.equal(
    await prisma.cartItem.count({
      where: { variantId, cartId: { not: cart.id } },
    }),
    0,
  );
  assert.notEqual(cookies.value(), cart.id);
  assert.equal(cookies.writes.length, 1);
  assert.equal(cookies.writes[0]?.value, "");
});
