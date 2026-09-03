/**
 * U19 / T6 — absolute cart update and removal, against a real database.
 *
 * Three things here only mean something with real rows and a real lock.
 *
 * The pre-check is advisory: a catalog, stock or price change between it and the write must be
 * caught inside the transaction, and only a database can put those two reads at different instants.
 *
 * A removal's snapshot must be taken before the row is deleted. Afterwards there is nothing to read,
 * so an implementation that resolves after the delete looks correct until you check what it
 * reported.
 *
 * And a concurrent absolute update must leave a committed quantity that matches the transition the
 * accepted response described — the losing writer must not report a delta computed from a quantity
 * that was already stale when it read it.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createAnonymousCartService } from "../../src/commerce/anonymous-cart.ts";
import { createCartLineAuthorityResolver } from "../../src/commerce/cart-line-authority.ts";
import { buildCanonicalCartAnalyticsProjection } from "../../src/commerce/cart-analytics-projection.ts";
import { createStorefrontCartRepository } from "../../src/commerce/storefront-cart-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const carts = createAnonymousCartService(prisma);

const P = "u19-cart";
const SHOP = 920_952;
const NOW = new Date("2026-09-21T00:00:00.000Z");
const resolveLine = createCartLineAuthorityResolver({ shopId: SHOP, now: NOW });

const createdCartIds = new Set<string>();

async function cleanup() {
  if (createdCartIds.size > 0) {
    await prisma.cart.deleteMany({ where: { id: { in: [...createdCartIds] } } });
    createdCartIds.clear();
  }
  await prisma.$executeRaw`DELETE FROM "PromotionTarget" WHERE "campaignId" LIKE ${`${P}-%`}`;
  await prisma.$executeRaw`DELETE FROM "PromotionCampaign" WHERE "id" LIKE ${`${P}-%`}`;
  await prisma.$executeRaw`DELETE FROM "ProductMirror" WHERE "pancakeProductId" LIKE ${`${P}-%`}`;
}

async function seedProduct({
  key,
  name = "U19 Linen Shirt",
  priceVnd = 500_000,
  stock = 25,
}: {
  key: string;
  name?: string;
  priceVnd?: number | null;
  stock?: number;
}) {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: SHOP,
      pancakeProductId: `${P}-${key}`,
      slug: `${P}-${key}`,
      name,
      isPresent: true,
      isActive: true,
      syncedAt: NOW,
    },
  });
  const variant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: `${P}-pv-${key}`,
      productId: product.id,
      color: "Đen",
      size: "M",
      pancakeRetailPrice: priceVnd,
      pancakeRetailPriceAfterDiscount: priceVnd,
      isPresent: true,
      isActive: true,
      syncedAt: NOW,
    },
  });
  await prisma.warehouseStock.create({
    data: {
      variantId: variant.id,
      pancakeWarehouseId: `${P}-wh-${key}`,
      quantity: stock,
      syncedAt: NOW,
    },
  });
  return { product, variant };
}

async function seedPercentageCampaign(key: string, productId: string, percentageValue: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionCampaign"
       ("id","kind","name","discountType","percentageValue","isEnabled","enabledAt","createdAt","updatedAt")
     VALUES ($1,'PROMOTION'::"PromotionCampaignKind",$2,'PERCENTAGE'::"PromotionDiscountType",$3,true,$4,$4,$4)`,
    `${P}-${key}`, `U19 ${key}`, percentageValue, NOW,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionTarget" ("id","campaignId","productId","createdAt") VALUES ($1,$2,$3,$4)`,
    `${P}-t-${key}`, `${P}-${key}`, productId, NOW,
  );
}

async function seededCart(variantId: string, quantity: number) {
  const cart = await carts.create({ now: NOW });
  createdCartIds.add(cart.id);
  await prisma.cartItem.create({ data: { cartId: cart.id, variantId, quantity } });
  return cart;
}

async function committedQuantity(cartId: string, variantId: string) {
  const item = await prisma.cartItem.findUnique({
    where: { cartId_variantId: { cartId, variantId } },
    select: { quantity: true },
  });
  return item?.quantity ?? 0;
}

test.beforeEach(cleanup);
test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("T6 an absolute update returns the committed transition in both directions", async () => {
  const { variant } = await seedProduct({ key: "transition" });
  const cart = await seededCart(variant.id, 3);

  const increased = await carts.updateExistingItemQuantity({
    cartId: cart.id,
    variantId: variant.id,
    quantity: 5,
    now: NOW,
    resolveLine,
  });
  assert.ok(increased.ok);
  assert.deepEqual(
    { previous: increased.previousQuantity, committed: increased.item.quantity },
    { previous: 3, committed: 5 },
  );
  assert.equal(increased.snapshot?.unitPriceVnd, 500_000);

  const decreased = await carts.updateExistingItemQuantity({
    cartId: cart.id,
    variantId: variant.id,
    quantity: 2,
    now: NOW,
    resolveLine,
  });
  assert.ok(decreased.ok);
  assert.deepEqual(
    { previous: decreased.previousQuantity, committed: decreased.item.quantity },
    { previous: 5, committed: 2 },
  );

  // Two successive absolute updates each report their own transition, not a cumulative one.
  const unchanged = await carts.updateExistingItemQuantity({
    cartId: cart.id,
    variantId: variant.id,
    quantity: 2,
    now: NOW,
    resolveLine,
  });
  assert.ok(unchanged.ok);
  assert.equal(unchanged.previousQuantity, 2);
  assert.equal(unchanged.item.quantity, 2);
});

test("T6 an update snapshot prices through the promotion resolver", async () => {
  const { product, variant } = await seedProduct({ key: "promoted" });
  await seedPercentageCampaign("c-promoted", product.id, 20);
  const cart = await seededCart(variant.id, 1);

  const result = await carts.updateExistingItemQuantity({
    cartId: cart.id,
    variantId: variant.id,
    quantity: 3,
    now: NOW,
    resolveLine,
  });

  assert.ok(result.ok);
  assert.equal(result.snapshot?.unitPriceVnd, 400_000);
  assert.equal(result.snapshot?.variantExternalId, `${P}-pv-promoted`);
});

test("T6 a stock change after the advisory pre-check is refused at the mutation boundary", async () => {
  const { variant } = await seedProduct({ key: "stock-change", stock: 10 });
  const cart = await seededCart(variant.id, 2);
  const repository = createStorefrontCartRepository(prisma);

  // The pre-check the public action would run, before anything changes.
  const [precheck] = await repository.getLines({
    shopId: SHOP,
    items: [{ variantId: variant.id, quantity: 8 }],
    now: NOW,
  });
  assert.equal(precheck?.available, true, "the pre-check allows it at this instant");

  await prisma.warehouseStock.updateMany({
    where: { variantId: variant.id },
    data: { quantity: 3 },
  });

  assert.deepEqual(
    await carts.updateExistingItemQuantity({
      cartId: cart.id,
      variantId: variant.id,
      quantity: 8,
      now: NOW,
      resolveLine,
    }),
    { ok: false, reason: "VARIANT_UNAVAILABLE" },
  );
  assert.equal(await committedQuantity(cart.id, variant.id), 2, "a refused update commits nothing");
});

test("T6 a catalog change after the pre-check is refused at the mutation boundary", async () => {
  const { variant } = await seedProduct({ key: "catalog-change" });
  const cart = await seededCart(variant.id, 1);

  await prisma.variantMirror.update({ where: { id: variant.id }, data: { isActive: false } });

  assert.deepEqual(
    await carts.updateExistingItemQuantity({
      cartId: cart.id,
      variantId: variant.id,
      quantity: 4,
      now: NOW,
      resolveLine,
    }),
    { ok: false, reason: "VARIANT_UNAVAILABLE" },
  );
  assert.equal(await committedQuantity(cart.id, variant.id), 1);
});

test("T6 an update that commits but cannot be described emits nothing and still commits", async () => {
  const { variant } = await seedProduct({ key: "nameless", name: "   " });
  const cart = await seededCart(variant.id, 1);

  const result = await carts.updateExistingItemQuantity({
    cartId: cart.id,
    variantId: variant.id,
    quantity: 4,
    now: NOW,
    resolveLine,
  });

  assert.ok(result.ok);
  assert.equal(result.snapshot, null);
  assert.equal(await committedQuantity(cart.id, variant.id), 4);
});

test("T6 a removal captures what left the cart before the row is deleted", async () => {
  const { variant } = await seedProduct({ key: "remove" });
  const cart = await seededCart(variant.id, 4);

  const result = await carts.removeItem({
    cartId: cart.id,
    variantId: variant.id,
    now: NOW,
    resolveLine,
  });

  assert.ok(result.ok);
  assert.equal(result.removedQuantity, 4);
  assert.deepEqual(result.snapshot, {
    variantExternalId: `${P}-pv-remove`,
    productExternalId: `${P}-remove`,
    itemName: "U19 Linen Shirt",
    unitPriceVnd: 500_000,
    quantity: 4,
    color: "Đen",
    size: "M",
  });
  assert.equal(await committedQuantity(cart.id, variant.id), 0, "the line is genuinely gone");
});

test("T6 removing a line that is already gone is a no-op, not a RemoveFromCart", async () => {
  const { variant } = await seedProduct({ key: "already-gone" });
  const cart = await seededCart(variant.id, 2);

  assert.ok((await carts.removeItem({ cartId: cart.id, variantId: variant.id, now: NOW, resolveLine })).ok);

  const second = await carts.removeItem({
    cartId: cart.id,
    variantId: variant.id,
    now: NOW,
    resolveLine,
  });
  assert.deepEqual(second, { ok: true, removedQuantity: 0, snapshot: null });
});

test("T6 an unavailable line can still be removed, and still reports what left", async () => {
  const { variant } = await seedProduct({ key: "out-of-stock", stock: 0 });
  const cart = await seededCart(variant.id, 2);

  const result = await carts.removeItem({
    cartId: cart.id,
    variantId: variant.id,
    now: NOW,
    resolveLine,
  });

  assert.ok(result.ok, "a shopper must always be able to clear an unavailable line");
  assert.equal(result.removedQuantity, 2);
  assert.equal(result.snapshot?.unitPriceVnd, 500_000);
});

test("T6 concurrent absolute updates leave a committed quantity matching the last transition", async () => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await cleanup();
    const { variant } = await seedProduct({ key: `race-${attempt}`, stock: 50 });
    const cart = await seededCart(variant.id, 1);

    const requested = [2, 3, 4, 5, 6, 7];
    const results = await Promise.all(
      requested.map((quantity) =>
        carts.updateExistingItemQuantity({
          cartId: cart.id,
          variantId: variant.id,
          quantity,
          now: NOW,
          resolveLine,
        }),
      ),
    );

    const accepted = results.filter((result) => result.ok);
    assert.equal(accepted.length, requested.length);

    const committed = await committedQuantity(cart.id, variant.id);
    // Serialization means every accepted transition chains: one writer's committed quantity is the
    // next writer's previous quantity, and the final row equals the last accepted commit.
    const byPrevious = new Map(
      accepted.map((result) => [
        result.ok ? result.previousQuantity : -1,
        result.ok ? result.item.quantity : -1,
      ]),
    );
    assert.equal(byPrevious.size, accepted.length, "no two updates read the same previous quantity");
    let current = 1;
    for (let step = 0; step < accepted.length; step += 1) {
      const next = byPrevious.get(current);
      assert.notEqual(next, undefined, `transition chain broke at ${current}`);
      current = next!;
    }
    assert.equal(current, committed, "the chain ends at the quantity actually committed");
  }
});

test("T6 the cart projection over real resolved lines totals exactly the emitted item set", async () => {
  const { variant: first } = await seedProduct({ key: "proj-a", priceVnd: 300_000 });
  const { variant: second } = await seedProduct({ key: "proj-b", priceVnd: 450_000 });
  const cart = await seededCart(first.id, 2);
  await prisma.cartItem.create({ data: { cartId: cart.id, variantId: second.id, quantity: 3 } });

  const lines = await createStorefrontCartRepository(prisma).getLines({
    shopId: SHOP,
    items: [
      { variantId: first.id, quantity: 2 },
      { variantId: second.id, quantity: 3 },
    ],
    now: NOW,
  });

  const projection = buildCanonicalCartAnalyticsProjection(lines);
  assert.equal(projection?.items.length, 2);
  assert.equal(projection?.merchandiseValueVnd, 300_000 * 2 + 450_000 * 3);

  // One unresolvable line among safe ones takes the whole projection down.
  await prisma.variantMirror.update({ where: { id: second.id }, data: { isActive: false } });
  const mixedLines = await createStorefrontCartRepository(prisma).getLines({
    shopId: SHOP,
    items: [
      { variantId: first.id, quantity: 2 },
      { variantId: second.id, quantity: 3 },
    ],
    now: NOW,
  });
  assert.equal(buildCanonicalCartAnalyticsProjection(mixedLines), null);
});

test("T6 the cart projection prices through the promotion resolver", async () => {
  const { product, variant } = await seedProduct({ key: "proj-promo" });
  await seedPercentageCampaign("c-proj-promo", product.id, 10);
  const cart = await seededCart(variant.id, 2);

  const lines = await createStorefrontCartRepository(prisma).getLines({
    shopId: SHOP,
    items: [{ variantId: variant.id, quantity: 2 }],
    now: NOW,
  });

  const projection = buildCanonicalCartAnalyticsProjection(lines);
  assert.equal(projection?.items[0]?.unitPriceVnd, 450_000);
  assert.equal(projection?.merchandiseValueVnd, 900_000);
  assert.equal(cart.id.length > 0, true);
});
