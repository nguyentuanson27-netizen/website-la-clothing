import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createGuestCheckoutSnapshotService } from "../../src/commerce/guest-checkout-snapshot.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const shopId = 920_007;
const now = new Date("2026-09-03T04:00:00.000Z");
const prefix = "u20-p8-boundary";

const checkoutInput = {
  name: "Nguyễn Văn A",
  phone: "0901234567",
  provinceRef: "province-01",
  districtRef: "district-001",
  communeRef: "commune-0001",
  detail: "12 Đường A",
  note: null,
};

async function cleanup() {
  await prisma.orderMirror.deleteMany({ where: { publicCode: { startsWith: prefix } } });
  await prisma.cart.deleteMany({
    where: { items: { some: { variant: { pancakeVariationId: { startsWith: prefix } } } } },
  });
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: prefix } } });
}

async function snapshot(cartId: string, publicCode: string, input: unknown = checkoutInput) {
  return createGuestCheckoutSnapshotService(prisma, { checkoutInputValidated: true }).create({
    cartId,
    shopId,
    publicCode,
    checkoutInput: input,
    now,
  });
}

test.before(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("P8 invalid base price fails closed without creating a partial DRAFT", async () => {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: `${prefix}-invalid-product`,
      slug: `${prefix}-invalid-product`,
      name: "Invalid base product",
      isPresent: true,
      isActive: true,
      syncedAt: now,
      variants: {
        create: {
          pancakeVariationId: `${prefix}-invalid-variation`,
          color: "Black",
          size: "M",
          isPresent: true,
          isActive: true,
          pancakeRetailPrice: 0,
          pancakeRetailPriceAfterDiscount: 0,
          syncedAt: now,
          warehouseStocks: {
            create: {
              pancakeWarehouseId: `${prefix}-invalid-warehouse`,
              quantity: 5,
              syncedAt: now,
            },
          },
        },
      },
    },
    include: { variants: true },
  });
  const cart = await prisma.cart.create({
    data: {
      expiresAt: new Date(now.getTime() + 60_000),
      items: { create: { variantId: product.variants[0]!.id, quantity: 1 } },
    },
  });
  const publicCode = `${prefix}-invalid-order`;

  assert.deepEqual(await snapshot(cart.id, publicCode), {
    ok: false,
    reason: "CART_LINE_UNAVAILABLE",
  });
  assert.equal(await prisma.orderMirror.count({ where: { publicCode } }), 0);
});

test("P8 composite DRAFT preserves the actual purchased component pancakeVariationId", async () => {
  const parent = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: `${prefix}-parent-product`,
      slug: `${prefix}-parent-product`,
      name: "Public composite parent",
      isPresent: true,
      isActive: true,
      syncedAt: now,
      variants: {
        create: {
          pancakeVariationId: `${prefix}-parent-variation`,
          color: "Set",
          size: "M",
          isPresent: true,
          isActive: true,
          pancakeRetailPrice: 900_000,
          pancakeRetailPriceAfterDiscount: 900_000,
          syncedAt: now,
        },
      },
    },
    include: { variants: true },
  });
  const component = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: `${prefix}-component-product`,
      slug: `${prefix}-component-product`,
      name: "Private component",
      isPresent: false,
      isActive: false,
      syncedAt: now,
      variants: {
        create: {
          pancakeVariationId: `${prefix}-component-variation`,
          color: "Black",
          size: "M",
          isPresent: true,
          isActive: true,
          pancakeRetailPrice: 420_000,
          pancakeRetailPriceAfterDiscount: 420_000,
          syncedAt: now,
          warehouseStocks: {
            create: {
              pancakeWarehouseId: `${prefix}-component-warehouse`,
              quantity: 5,
              syncedAt: now,
            },
          },
        },
      },
    },
    include: { variants: true },
  });
  await prisma.compositeComponentMirror.create({
    data: {
      parentVariantId: parent.variants[0]!.id,
      componentVariantId: component.variants[0]!.id,
      quantity: 1,
      syncedAt: now,
    },
  });
  const cart = await prisma.cart.create({
    data: {
      expiresAt: new Date(now.getTime() + 60_000),
      items: { create: { variantId: component.variants[0]!.id, quantity: 1 } },
    },
  });
  const publicCode = `${prefix}-composite-order`;

  const result = await snapshot(cart.id, publicCode);
  assert.equal(result.ok, true);
  const persisted = await prisma.orderMirror.findUniqueOrThrow({
    where: { publicCode },
    include: { lines: true },
  });
  assert.equal(persisted.lines.length, 1);
  assert.equal(persisted.lines[0]!.variantId, component.variants[0]!.id);
  assert.equal(
    persisted.lines[0]!.pancakeVariationId,
    component.variants[0]!.pancakeVariationId,
  );
  assert.notEqual(persisted.lines[0]!.pancakeVariationId, parent.variants[0]!.pancakeVariationId);
  assert.equal(persisted.lines[0]!.baseUnitPriceVnd, BigInt(420_000));
  assert.equal(persisted.lines[0]!.unitPriceVnd, BigInt(420_000));
});

test("P8 unsigned browser quote facts alone cannot create a DRAFT or become price authority", async () => {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: `${prefix}-browser-product`,
      slug: `${prefix}-browser-product`,
      name: "Browser authority product",
      isPresent: true,
      isActive: true,
      syncedAt: now,
      variants: {
        create: {
          pancakeVariationId: `${prefix}-browser-variation`,
          color: "Black",
          size: "M",
          isPresent: true,
          isActive: true,
          pancakeRetailPrice: 500_000,
          pancakeRetailPriceAfterDiscount: 500_000,
          syncedAt: now,
          warehouseStocks: {
            create: {
              pancakeWarehouseId: `${prefix}-browser-warehouse`,
              quantity: 5,
              syncedAt: now,
            },
          },
        },
      },
    },
    include: { variants: true },
  });
  const cart = await prisma.cart.create({
    data: {
      expiresAt: new Date(now.getTime() + 60_000),
      items: { create: { variantId: product.variants[0]!.id, quantity: 1 } },
    },
  });
  const publicCode = `${prefix}-browser-only-order`;

  assert.deepEqual(
    await snapshot(cart.id, publicCode, {
      items: [{ variantExternalId: product.variants[0]!.pancakeVariationId, quantity: 1, unitPriceVnd: 1 }],
      merchandiseSubtotalVnd: 1,
      shippingFeeVnd: 0,
      totalVnd: 1,
      promotionCampaignId: "forged",
    }),
    { ok: false, reason: "INVALID_INPUT" },
  );
  assert.equal(await prisma.orderMirror.count({ where: { publicCode } }), 0);
});
