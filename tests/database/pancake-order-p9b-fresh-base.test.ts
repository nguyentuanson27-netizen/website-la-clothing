import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createGuestCheckoutSnapshotService } from "../../src/commerce/guest-checkout-snapshot.ts";
import { createPancakeOrderSubmissionService } from "../../src/commerce/pancake-order-submit.ts";
import { acceptAnyRenderedQuote } from "../fixtures/rendered-quote-authority.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";
import type { PancakeCatalogVariation } from "../../src/integrations/pancake/catalog-contract.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const shopId = 920_007;
const now = new Date("2026-09-04T03:00:00.000Z");
const prefix = "u22-p9b";

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
  await prisma.promotionCampaign.deleteMany({ where: { name: { startsWith: prefix } } });
  await prisma.productMirror.deleteMany({ where: { pancakeProductId: { startsWith: prefix } } });
}

test.before(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

function liveVariation(
  id: string,
  productId: string,
  retailPrice: number,
  retailPriceAfterDiscount = retailPrice,
): PancakeCatalogVariation {
  return {
    id,
    productId,
    displayId: `${id}-display`,
    barcode: `${id}-barcode`,
    fields: [],
    imageUrls: [],
    isHidden: false,
    isLocked: false,
    retailPrice,
    retailPriceAfterDiscount,
    product: { id: productId, name: productId },
    warehouseStocks: [{ warehouseId: `${id}-warehouse`, remainQuantity: 9 }],
    sellableStock: 9,
  };
}

async function seedVariant(label: string, mirroredBaseVnd: number) {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: `${prefix}-product-${label}`,
      slug: `${prefix}-${label}`,
      name: `P9B ${label}`,
      isPresent: true,
      isActive: true,
      syncedAt: now,
      variants: {
        create: {
          pancakeVariationId: `${prefix}-variation-${label}`,
          color: "Black",
          size: "M",
          isPresent: true,
          isActive: true,
          pancakeRetailPrice: mirroredBaseVnd,
          pancakeRetailPriceAfterDiscount: mirroredBaseVnd,
          syncedAt: now,
          warehouseStocks: {
            create: { pancakeWarehouseId: `${prefix}-wh-${label}`, quantity: 9, syncedAt: now },
          },
        },
      },
    },
    include: { variants: true },
  });
  return { product, variant: product.variants[0]! };
}

async function seedCampaign(
  variantId: string,
  campaign:
    | { discountType: "PERCENTAGE"; percentageValue: number }
    | { discountType: "FIXED_PRICE"; fixedPriceVnd: bigint },
) {
  return prisma.promotionCampaign.create({
    data: {
      kind: "PROMOTION",
      name: `${prefix}-${campaign.discountType}`,
      discountType: campaign.discountType,
      percentageValue: "percentageValue" in campaign ? campaign.percentageValue : null,
      fixedPriceVnd: "fixedPriceVnd" in campaign ? campaign.fixedPriceVnd : null,
      startsAt: new Date(now.getTime() - 60_000),
      endsAt: new Date(now.getTime() + 600_000),
      isEnabled: true,
      enabledAt: new Date(now.getTime() - 60_000),
      targets: { create: { variantId } },
    },
  });
}

async function createDraft(variantId: string, publicCode: string) {
  const cart = await prisma.cart.create({
    data: {
      expiresAt: new Date(now.getTime() + 600_000),
      items: { create: { variantId, quantity: 1 } },
    },
  });
  const result = await createGuestCheckoutSnapshotService(prisma, {
    checkoutInputValidated: true,
    verifyRenderedQuote: acceptAnyRenderedQuote,
  }).create({ cartId: cart.id, shopId, publicCode, checkoutInput, now });
  assert.equal(result.ok, true, "the DRAFT must be snapshotted before submission");
  return cart;
}

/** A gateway whose catalog reports `freshBaseVnd`, counting any create-order attempt. */
function gatewayWithFreshBase(variationId: string, productId: string, freshBaseVnd: number) {
  const created: unknown[] = [];
  return {
    created,
    gateway: {
      async fetchCompleteCatalog() {
        return [liveVariation(variationId, productId, freshBaseVnd)];
      },
      async createOrder(request: unknown) {
        created.push(request);
        return { id: 900_001 };
      },
    },
  };
}

function submissionService(gateway: Parameters<typeof createPancakeOrderSubmissionService>[1]) {
  return createPancakeOrderSubmissionService(prisma, gateway, { now: () => now });
}

test("P9b a promoted DRAFT is compared against the fresh effective quote, not raw Pancake retail", async () => {
  // The whole point of the unit. Mirror base 500k with a 20% campaign gives a DRAFT at 400k. The
  // fresh Pancake base is unchanged at 500k, so nothing has actually drifted — but a comparison
  // against raw retail would see 400k != 500k and refuse a correctly priced order.
  const { product, variant } = await seedVariant("effective", 500_000);
  await seedCampaign(variant.id, { discountType: "PERCENTAGE", percentageValue: 20 });
  const publicCode = `${prefix}-effective-order`;
  await createDraft(variant.id, publicCode);

  const draft = await prisma.orderMirror.findUniqueOrThrow({
    where: { publicCode },
    include: { lines: true },
  });
  assert.equal(draft.lines[0]!.unitPriceVnd, BigInt(400_000));

  const { created, gateway } = gatewayWithFreshBase(
    variant.pancakeVariationId,
    product.pancakeProductId,
    500_000,
  );
  const result = await submissionService(gateway).submit({ publicCode, shopId });

  assert.equal(result.ok, true, "an unchanged effective quote must not be refused");
  assert.equal(created.length, 1, "the order must reach Pancake exactly once");
});

test("P9b a fresher base recalculates a percentage campaign and reprices the DRAFT", async () => {
  const { product, variant } = await seedVariant("percentage", 500_000);
  await seedCampaign(variant.id, { discountType: "PERCENTAGE", percentageValue: 20 });
  const publicCode = `${prefix}-percentage-order`;
  await createDraft(variant.id, publicCode);

  // Pancake now reports 600k. The campaign still applies, so the fresh effective price is 480k.
  const { created, gateway } = gatewayWithFreshBase(
    variant.pancakeVariationId,
    product.pancakeProductId,
    600_000,
  );
  const result = await submissionService(gateway).submit({ publicCode, shopId });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.state, "DRAFT");
  assert.equal(result.reason, "PRICE_CHANGED");
  assert.equal(created.length, 0, "a drifted price must never reach Pancake");

  const repriced = await prisma.orderMirror.findUniqueOrThrow({
    where: { publicCode },
    include: { lines: true },
  });
  assert.equal(repriced.state, "DRAFT", "the order stays reconfirmable, never terminally rejected");
  assert.equal(repriced.syncErrorCode, "PRICE_CHANGED");
  assert.equal(repriced.lines.length, 1);
  assert.equal(repriced.lines[0]!.unitPriceVnd, BigInt(480_000), "20% off the fresher 600k base");
  assert.equal(repriced.lines[0]!.baseUnitPriceVnd, BigInt(600_000));
  assert.equal(repriced.lines[0]!.lineTotalVnd, BigInt(480_000));
  assert.equal(repriced.merchandiseSubtotalVnd, BigInt(480_000));
  assert.equal(
    repriced.totalVnd,
    BigInt(480_000) + repriced.shippingFeeVnd!,
    "totals are refreshed together with the line, never left disagreeing",
  );
});

test("P9b a fixed-price campaign is revalidated against the fresher base, not blindly kept", async () => {
  // FIXED_PRICE stays the configured final price only while it is actually a discount. A fresher
  // base below it means the campaign no longer discounts anything, and the buyer should get the
  // cheaper base rather than the now-higher configured price.
  const { product, variant } = await seedVariant("fixed", 500_000);
  await seedCampaign(variant.id, { discountType: "FIXED_PRICE", fixedPriceVnd: BigInt(400_000) });
  const publicCode = `${prefix}-fixed-order`;
  await createDraft(variant.id, publicCode);

  const draft = await prisma.orderMirror.findUniqueOrThrow({
    where: { publicCode },
    include: { lines: true },
  });
  assert.equal(draft.lines[0]!.unitPriceVnd, BigInt(400_000));

  const { created, gateway } = gatewayWithFreshBase(
    variant.pancakeVariationId,
    product.pancakeProductId,
    350_000,
  );
  const result = await submissionService(gateway).submit({ publicCode, shopId });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.state, "DRAFT");
  assert.equal(result.reason, "PRICE_CHANGED");
  assert.equal(created.length, 0);

  const repriced = await prisma.orderMirror.findUniqueOrThrow({
    where: { publicCode },
    include: { lines: true },
  });
  assert.equal(repriced.lines[0]!.unitPriceVnd, BigInt(350_000));
  assert.equal(repriced.lines[0]!.baseUnitPriceVnd, BigInt(350_000));
  assert.equal(
    repriced.lines[0]!.promotionCampaignId,
    null,
    "a campaign that no longer discounts must not be recorded as one",
  );
});

test("P9b the fresher base is written back, so reconfirming terminates instead of looping", async () => {
  // Without this, the mirror still says 500k: the buyer reconfirms, the snapshot re-derives 500k
  // from stale mirror data, submission finds 600k again, and the handshake never ends.
  const { product, variant } = await seedVariant("loop", 500_000);
  const publicCode = `${prefix}-loop-order`;
  const cart = await createDraft(variant.id, publicCode);

  const first = gatewayWithFreshBase(
    variant.pancakeVariationId,
    product.pancakeProductId,
    600_000,
  );
  const refused = await submissionService(first.gateway).submit({ publicCode, shopId });
  assert.equal(refused.ok, false);
  if (refused.ok) return;
  assert.equal(refused.reason, "PRICE_CHANGED");

  const mirrored = await prisma.variantMirror.findUniqueOrThrow({ where: { id: variant.id } });
  assert.equal(
    mirrored.pancakeRetailPrice,
    600_000,
    "checkout observed a fresher trusted base and must record it as the latest",
  );
  assert.equal(
    mirrored.pancakeRetailPriceAfterDiscount,
    600_000,
    "the after-discount column carries what Pancake reported, never a copy of the base",
  );

  // The buyer reconfirms: the snapshot now re-derives the same 600k the submission will check.
  const resnapshot = await createGuestCheckoutSnapshotService(prisma, {
    checkoutInputValidated: true,
    verifyRenderedQuote: acceptAnyRenderedQuote,
  }).create({ cartId: cart.id, shopId, publicCode, checkoutInput, now });
  assert.equal(resnapshot.ok, true);

  const second = gatewayWithFreshBase(
    variant.pancakeVariationId,
    product.pancakeProductId,
    600_000,
  );
  const result = await submissionService(second.gateway).submit({ publicCode, shopId });
  assert.equal(result.ok, true, "the second, explicit confirmation must succeed");
  assert.equal(second.created.length, 1);
});

test("P9b the write-back records Pancake's own after-discount, not a copy of the base", async () => {
  // The central resolver ignores this column, but the Merchant identity audit and the default
  // equality-gated price rule read it. Writing the base into it would hand them an observation no
  // upstream ever sent.
  const { product, variant } = await seedVariant("afterdiscount", 500_000);
  const publicCode = `${prefix}-afterdiscount-order`;
  await createDraft(variant.id, publicCode);

  const created: unknown[] = [];
  const result = await submissionService({
    async fetchCompleteCatalog() {
      return [liveVariation(variant.pancakeVariationId, product.pancakeProductId, 600_000, 550_000)];
    },
    async createOrder(request: unknown) {
      created.push(request);
      return { id: 900_002 };
    },
  }).submit({ publicCode, shopId });

  assert.equal(result.ok, false);
  assert.equal(created.length, 0);

  const mirrored = await prisma.variantMirror.findUniqueOrThrow({ where: { id: variant.id } });
  assert.equal(mirrored.pancakeRetailPrice, 600_000);
  assert.equal(mirrored.pancakeRetailPriceAfterDiscount, 550_000);
});

test("P9b an unusable fresher base fails closed without repricing to nonsense", async () => {
  const { product, variant } = await seedVariant("invalid", 500_000);
  const publicCode = `${prefix}-invalid-order`;
  await createDraft(variant.id, publicCode);

  const { created, gateway } = gatewayWithFreshBase(
    variant.pancakeVariationId,
    product.pancakeProductId,
    0,
  );
  const result = await submissionService(gateway).submit({ publicCode, shopId });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "PRICE_UNAVAILABLE");
  assert.equal(created.length, 0);

  const after = await prisma.orderMirror.findUniqueOrThrow({
    where: { publicCode },
    include: { lines: true },
  });
  assert.equal(
    after.lines[0]!.unitPriceVnd,
    BigInt(500_000),
    "an unusable base must leave the confirmed line untouched",
  );
});

test("P9b repeated upstream drift repeats the handshake rather than sticking", async () => {
  const { product, variant } = await seedVariant("repeat", 500_000);
  const publicCode = `${prefix}-repeat-order`;
  const cart = await createDraft(variant.id, publicCode);

  for (const freshBase of [600_000, 700_000]) {
    const drift = gatewayWithFreshBase(
      variant.pancakeVariationId,
      product.pancakeProductId,
      freshBase,
    );
    const refusal = await submissionService(drift.gateway).submit({ publicCode, shopId });
    assert.equal(refusal.ok, false, `drift to ${freshBase} must reconfirm again`);
    if (refusal.ok) return;
    assert.equal(refusal.reason, "PRICE_CHANGED");
    assert.equal(drift.created.length, 0);

    const repriced = await prisma.orderMirror.findUniqueOrThrow({
      where: { publicCode },
      include: { lines: true },
    });
    assert.equal(repriced.lines[0]!.unitPriceVnd, BigInt(freshBase));

    const resnapshot = await createGuestCheckoutSnapshotService(prisma, {
      checkoutInputValidated: true,
      verifyRenderedQuote: acceptAnyRenderedQuote,
    }).create({ cartId: cart.id, shopId, publicCode, checkoutInput, now });
    assert.equal(resnapshot.ok, true);
  }

  const settled = gatewayWithFreshBase(
    variant.pancakeVariationId,
    product.pancakeProductId,
    700_000,
  );
  assert.equal((await submissionService(settled.gateway).submit({ publicCode, shopId })).ok, true);
  assert.equal(settled.created.length, 1);
});
