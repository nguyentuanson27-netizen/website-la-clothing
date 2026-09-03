/**
 * U18 / T5 — the PDP "add one unit" mutation, against a real database.
 *
 * The property under test is a transaction property, so it needs a real one. Whether an increment
 * survives a concurrent increment, whether a stock bound is enforced against the *prospective*
 * total, and whether the price a mutation accepts is the price a campaign currently sets are all
 * questions about rows and locks. A mocked cart would agree with any implementation, including the
 * absolute set-quantity path this unit exists to replace.
 *
 * The race test is the centre of it: N concurrent accepted adds must move the line by exactly N,
 * with every accepted response reporting `addedQuantity = 1`. A lost update shows up here as a
 * final quantity below N while every response still claimed success.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createAnonymousCartService } from "../../src/commerce/anonymous-cart.ts";
import { createCartLineAuthorityResolver } from "../../src/commerce/cart-line-authority.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const carts = createAnonymousCartService(prisma);

const P = "u18-add";
const SHOP = 920_951;
const NOW = new Date("2026-09-20T00:00:00.000Z");

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
  name = "U18 Linen Shirt",
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
    `${P}-${key}`, `U18 ${key}`, percentageValue, NOW,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionTarget" ("id","campaignId","productId","createdAt") VALUES ($1,$2,$3,$4)`,
    `${P}-t-${key}`, `${P}-${key}`, productId, NOW,
  );
}

async function seedFixedPriceCampaign(key: string, productId: string, fixedPriceVnd: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionCampaign"
       ("id","kind","name","discountType","fixedPriceVnd","isEnabled","enabledAt","createdAt","updatedAt")
     VALUES ($1,'FLASH_SALE'::"PromotionCampaignKind",$2,'FIXED_PRICE'::"PromotionDiscountType",$3,true,$4,$4,$4)`,
    `${P}-${key}`, `U18 ${key}`, BigInt(fixedPriceVnd), NOW,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO "PromotionTarget" ("id","campaignId","productId","createdAt") VALUES ($1,$2,$3,$4)`,
    `${P}-t-${key}`, `${P}-${key}`, productId, NOW,
  );
}

async function newCart() {
  const cart = await carts.create({ now: NOW });
  createdCartIds.add(cart.id);
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

test("T5 a PDP add commits exactly one unit from absent, from one, and from many", async () => {
  const { variant } = await seedProduct({ key: "increments" });
  const cart = await newCart();

  const first = await carts.addItemUnit({ cartId: cart.id, variantId: variant.id, now: NOW, resolveLine });
  assert.ok(first.ok);
  assert.equal(first.previousQuantity, 0);
  assert.equal(first.quantity, 1);
  assert.equal(first.addedQuantity, 1);

  const second = await carts.addItemUnit({ cartId: cart.id, variantId: variant.id, now: NOW, resolveLine });
  assert.ok(second.ok);
  assert.deepEqual(
    { previousQuantity: second.previousQuantity, quantity: second.quantity },
    { previousQuantity: 1, quantity: 2 },
  );

  // From an existing quantity greater than one: the absolute set-quantity path would have reset
  // this line to 1 and still reported success.
  await prisma.cartItem.update({
    where: { cartId_variantId: { cartId: cart.id, variantId: variant.id } },
    data: { quantity: 7 },
  });
  const third = await carts.addItemUnit({ cartId: cart.id, variantId: variant.id, now: NOW, resolveLine });
  assert.ok(third.ok);
  assert.deepEqual(
    { previousQuantity: third.previousQuantity, quantity: third.quantity, added: third.addedQuantity },
    { previousQuantity: 7, quantity: 8, added: 1 },
  );
  assert.equal(await committedQuantity(cart.id, variant.id), 8);
});

test("T5 the accepted snapshot carries external identity and server-current money, never a local id", async () => {
  const { product, variant } = await seedProduct({ key: "snapshot" });
  const cart = await newCart();

  const result = await carts.addItemUnit({ cartId: cart.id, variantId: variant.id, now: NOW, resolveLine });
  assert.ok(result.ok);
  assert.deepEqual(result.snapshot, {
    variantExternalId: `${P}-pv-snapshot`,
    productExternalId: `${P}-snapshot`,
    itemName: "U18 Linen Shirt",
    unitPriceVnd: 500_000,
    // The event's quantity is the one unit that was added, not the line's committed total.
    quantity: 1,
    color: "Đen",
    size: "M",
  });
  assert.equal(
    JSON.stringify(result.snapshot).includes(variant.id),
    false,
    "the internal VariantMirror id is never a vendor identity",
  );
  assert.equal(JSON.stringify(result.snapshot).includes(product.id), false);
});

test("T5 the accepted price is the promotion resolver's, for every campaign shape", async () => {
  for (const [key, seed, expectedPriceVnd] of [
    ["no-promo", null, 500_000],
    ["percentage", "percentage", 450_000],
    ["fixed", "fixed", 399_000],
  ] as const) {
    await cleanup();
    const { product, variant } = await seedProduct({ key });
    if (seed === "percentage") await seedPercentageCampaign(`c-${key}`, product.id, 10);
    if (seed === "fixed") await seedFixedPriceCampaign(`c-${key}`, product.id, 399_000);

    const cart = await newCart();
    const result = await carts.addItemUnit({
      cartId: cart.id,
      variantId: variant.id,
      now: NOW,
      resolveLine,
    });
    assert.ok(result.ok);
    assert.equal(result.snapshot?.unitPriceVnd, expectedPriceVnd, `${key} price`);
  }
});

test("T5 two campaigns on one variant conflict, so the add commits the undiscounted base price", async () => {
  const { product, variant } = await seedProduct({ key: "conflict" });
  await seedPercentageCampaign("c-conflict-a", product.id, 10);
  await seedFixedPriceCampaign("c-conflict-b", product.id, 250_000);

  const cart = await newCart();
  const result = await carts.addItemUnit({ cartId: cart.id, variantId: variant.id, now: NOW, resolveLine });

  assert.ok(result.ok, "a pricing conflict falls back to base price, it does not block the cart");
  assert.equal(result.snapshot?.unitPriceVnd, 500_000);
});

test("T5 a scheduled campaign prices by the mutation's instant, not by its existence", async () => {
  const { product, variant } = await seedProduct({ key: "scheduled" });
  await seedPercentageCampaign("c-scheduled", product.id, 20);
  const endsAt = new Date("2026-09-20T12:00:00.000Z");
  await prisma.$executeRawUnsafe(
    `UPDATE "PromotionCampaign" SET "startsAt" = $2, "endsAt" = $3 WHERE "id" = $1`,
    `${P}-c-scheduled`, new Date("2026-09-20T06:00:00.000Z"), endsAt,
  );

  const before = await newCart();
  const beforeResult = await carts.addItemUnit({
    cartId: before.id,
    variantId: variant.id,
    now: NOW,
    resolveLine: createCartLineAuthorityResolver({ shopId: SHOP, now: NOW }),
  });
  assert.ok(beforeResult.ok);
  assert.equal(beforeResult.snapshot?.unitPriceVnd, 500_000, "outside the window: base price");

  const during = await newCart();
  const duringResult = await carts.addItemUnit({
    cartId: during.id,
    variantId: variant.id,
    now: new Date("2026-09-20T08:00:00.000Z"),
    resolveLine: createCartLineAuthorityResolver({
      shopId: SHOP,
      now: new Date("2026-09-20T08:00:00.000Z"),
    }),
  });
  assert.ok(duringResult.ok);
  assert.equal(duringResult.snapshot?.unitPriceVnd, 400_000, "inside the window: effective price");

  // Half-open [startsAt, endsAt): the campaign is over at exactly `endsAt`.
  const after = await newCart();
  const afterResult = await carts.addItemUnit({
    cartId: after.id,
    variantId: variant.id,
    now: endsAt,
    resolveLine: createCartLineAuthorityResolver({ shopId: SHOP, now: endsAt }),
  });
  assert.ok(afterResult.ok);
  assert.equal(afterResult.snapshot?.unitPriceVnd, 500_000);
});

test("T5 the stock bound is enforced against the prospective total, under the lock", async () => {
  const { variant } = await seedProduct({ key: "stock", stock: 2 });
  const cart = await newCart();

  assert.ok((await carts.addItemUnit({ cartId: cart.id, variantId: variant.id, now: NOW, resolveLine })).ok);
  assert.ok((await carts.addItemUnit({ cartId: cart.id, variantId: variant.id, now: NOW, resolveLine })).ok);

  const refused = await carts.addItemUnit({
    cartId: cart.id,
    variantId: variant.id,
    now: NOW,
    resolveLine,
  });
  assert.deepEqual(refused, { ok: false, reason: "VARIANT_UNAVAILABLE" });
  assert.equal(await committedQuantity(cart.id, variant.id), 2, "a refused add commits nothing");
});

test("T5 a catalog change after render is caught at the mutation boundary", async () => {
  const { variant } = await seedProduct({ key: "deactivated" });
  const cart = await newCart();
  assert.ok((await carts.addItemUnit({ cartId: cart.id, variantId: variant.id, now: NOW, resolveLine })).ok);

  // The shopper's page still shows a purchasable option; the catalog no longer does.
  await prisma.variantMirror.update({ where: { id: variant.id }, data: { isActive: false } });

  assert.deepEqual(
    await carts.addItemUnit({ cartId: cart.id, variantId: variant.id, now: NOW, resolveLine }),
    { ok: false, reason: "VARIANT_UNAVAILABLE" },
  );
  assert.equal(await committedQuantity(cart.id, variant.id), 1);
});

test("T5 an unpriceable option is never committed by the PDP add", async () => {
  const { variant } = await seedProduct({ key: "unpriced", priceVnd: null });
  const cart = await newCart();

  assert.deepEqual(
    await carts.addItemUnit({ cartId: cart.id, variantId: variant.id, now: NOW, resolveLine }),
    { ok: false, reason: "VARIANT_UNAVAILABLE" },
  );
});

test("T5 commerce succeeds and analytics fails closed when the snapshot cannot be built", async () => {
  // A whitespace-only mirrored name resolves to a purchasable line but cannot name a vendor item.
  const { variant } = await seedProduct({ key: "nameless", name: "   " });
  const cart = await newCart();

  const result = await carts.addItemUnit({ cartId: cart.id, variantId: variant.id, now: NOW, resolveLine });

  assert.ok(result.ok, "an unusable snapshot must not roll back the cart mutation");
  assert.equal(result.quantity, 1);
  assert.equal(result.snapshot, null, "no event facts rather than fabricated ones");
  assert.equal(await committedQuantity(cart.id, variant.id), 1, "the unit is genuinely in the cart");
});

test("T5 concurrent PDP adds on one cart each commit exactly one unit with no lost update", async () => {
  const CONCURRENT_ADDS = 8;
  // Repeated because a lost update is a race: one green run proves very little.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await cleanup();
    const { variant } = await seedProduct({ key: `race-${attempt}`, stock: 100 });
    const cart = await newCart();

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_ADDS }, () =>
        carts.addItemUnit({ cartId: cart.id, variantId: variant.id, now: NOW, resolveLine }),
      ),
    );

    const accepted = results.filter((result) => result.ok);
    assert.equal(accepted.length, CONCURRENT_ADDS, "every allowed concurrent add is accepted");
    for (const result of accepted) {
      assert.ok(result.ok);
      assert.equal(result.addedQuantity, 1);
      assert.equal(result.quantity, result.previousQuantity + 1);
    }

    assert.equal(
      await committedQuantity(cart.id, variant.id),
      CONCURRENT_ADDS,
      "N accepted adds move the line by exactly N",
    );
    // Serialization also means every add saw a distinct previous quantity.
    assert.deepEqual(
      accepted.map((result) => (result.ok ? result.previousQuantity : -1)).sort((a, b) => a - b),
      Array.from({ length: CONCURRENT_ADDS }, (_unused, index) => index),
    );
  }
});

test("T5 concurrent adds against a scarce stock accept only what stock allows", async () => {
  const AVAILABLE = 3;
  const { variant } = await seedProduct({ key: "race-stock", stock: AVAILABLE });
  const cart = await newCart();

  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      carts.addItemUnit({ cartId: cart.id, variantId: variant.id, now: NOW, resolveLine }),
    ),
  );

  assert.equal(results.filter((result) => result.ok).length, AVAILABLE);
  assert.equal(await committedQuantity(cart.id, variant.id), AVAILABLE);
});
