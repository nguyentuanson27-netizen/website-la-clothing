import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createGuestCheckoutSnapshotService } from "../../src/commerce/guest-checkout-snapshot.ts";
import { createPancakeOrderSubmissionService } from "../../src/commerce/pancake-order-submit.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import type { PancakeCatalogVariation } from "../../src/integrations/pancake/catalog-contract.ts";
import type { PancakeCreateOrderRequest } from "../../src/integrations/pancake/order-create.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const shopId = 920_007;
const now = new Date("2026-08-12T06:30:00.000Z");
const key = "checkout-draft-resnapshot";

function liveVariation(id: string, productId: string, price: number): PancakeCatalogVariation {
  return {
    id,
    productId,
    displayId: `${id}-display`,
    barcode: `${id}-barcode`,
    fields: [],
    imageUrls: [],
    isHidden: false,
    isLocked: false,
    retailPrice: price,
    retailPriceAfterDiscount: price,
    product: { id: productId, name: productId },
    warehouseStocks: [{ warehouseId: `${id}-warehouse`, remainQuantity: 5 }],
    sellableStock: 5,
  };
}

async function cleanup() {
  await prisma.orderMirror.deleteMany({ where: { publicCode: { startsWith: key } } });
  await prisma.cart.deleteMany({
    where: {
      items: {
        some: {
          variant: { pancakeVariationId: { startsWith: key } },
        },
      },
    },
  });
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: key } } });
}

async function createProduct(label: "a" | "b", price: number) {
  return prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: `${key}-product-${label}`,
      slug: `${key}-${label}`,
      name: `Retry Product ${label.toUpperCase()}`,
      isPresent: true,
      isActive: true,
      syncedAt: now,
      variants: {
        create: {
          pancakeVariationId: `${key}-variation-${label}`,
          color: label === "a" ? "Black" : "White",
          size: "M",
          isPresent: true,
          isActive: true,
          pancakeRetailPrice: price,
          pancakeRetailPriceAfterDiscount: price,
          syncedAt: now,
          warehouseStocks: {
            create: {
              pancakeWarehouseId: `${key}-warehouse-${label}`,
              quantity: 5,
              syncedAt: now,
            },
          },
        },
      },
    },
    include: { variants: true },
  });
}

test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("retryable DRAFT re-snapshots current cart and address before a later Pancake POST", async () => {
  await cleanup();
  const productA = await createProduct("a", 400_000);
  const productB = await createProduct("b", 650_000);
  const variantA = productA.variants[0]!;
  const variantB = productB.variants[0]!;

  const cart = await prisma.cart.create({
    data: {
      expiresAt: new Date(now.getTime() + 60_000),
      items: { create: { variantId: variantA.id, quantity: 1 } },
    },
  });

  const snapshot = createGuestCheckoutSnapshotService(prisma);
  const first = await snapshot.create({
    cartId: cart.id,
    shopId,
    publicCode: `${key}-order`,
    checkoutInput: {
      name: "Nguyễn Văn A",
      phone: "0901234567",
      provinceRef: "province-x",
      districtRef: "district-x",
      communeRef: "commune-x",
      detail: "12 Đường X",
      note: "Địa chỉ cũ",
    },
    now,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const unavailable = createPancakeOrderSubmissionService(prisma, {
    async fetchCompleteCatalog() {
      throw new Error("temporary validation transport failure");
    },
    async createOrder() {
      throw new Error("must not POST while validation is unavailable");
    },
  });
  assert.deepEqual(await unavailable.submit({ publicCode: first.order.publicCode, shopId }), {
    ok: false,
    state: "DRAFT",
    reason: "VALIDATION_UNAVAILABLE",
  });

  await prisma.$transaction([
    prisma.cartItem.deleteMany({ where: { cartId: cart.id } }),
    prisma.cartItem.create({ data: { cartId: cart.id, variantId: variantB.id, quantity: 1 } }),
  ]);

  const retry = await snapshot.create({
    cartId: cart.id,
    shopId,
    publicCode: `${key}-unused-new-code`,
    checkoutInput: {
      name: "Nguyễn Văn B",
      phone: "0987654321",
      provinceRef: "province-y",
      districtRef: "district-y",
      communeRef: "commune-y",
      detail: "34 Đường Y",
      note: "Địa chỉ mới",
    },
    now: new Date(now.getTime() + 1_000),
  });
  assert.equal(retry.ok, true);
  if (!retry.ok) return;
  assert.equal(retry.order.publicCode, first.order.publicCode);

  let request: PancakeCreateOrderRequest | undefined;
  const healthy = createPancakeOrderSubmissionService(prisma, {
    async fetchCompleteCatalog() {
      return [
        liveVariation(variantA.pancakeVariationId, productA.pancakeProductId, 400_000),
        liveVariation(variantB.pancakeVariationId, productB.pancakeProductId, 650_000),
      ];
    },
    async createOrder(input) {
      request = input;
      return { id: 800_001 };
    },
  });

  assert.deepEqual(await healthy.submit({ publicCode: first.order.publicCode, shopId }), {
    ok: true,
    state: "CONFIRMED",
    pancakeOrderId: "800001",
  });
  assert.ok(request);
  assert.equal(request.bill_full_name, "Nguyễn Văn B");
  assert.equal(request.bill_phone_number, "0987654321");
  assert.equal(request.shipping_address.address, "34 Đường Y");
  assert.equal(request.shipping_address.province_id, "province-y");
  assert.equal(request.shipping_address.district_id, "district-y");
  assert.equal(request.shipping_address.commune_id, "commune-y");
  assert.equal(request.note, "Địa chỉ mới");
  assert.deepEqual(request.items.map(({ variation_id }) => variation_id), [variantB.pancakeVariationId]);
});
