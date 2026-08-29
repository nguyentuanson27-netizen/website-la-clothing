import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { issueAdminCatalogConfirmationProof } from "../../src/commerce/admin-catalog-confirmation.ts";
import { createProductCommerceRepository } from "../../src/commerce/product-commerce-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const repository = createProductCommerceRepository(prisma);

const shopId = 920_141;
const syncedAt = new Date("2026-08-28T00:00:00.000Z");
const actorId = "bulk-catalog-admin";
const secret = "bulk-catalog-repository-secret-1234567890";
const nowMs = Date.parse("2026-08-28T09:00:00.000Z");

async function cleanup() {
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: shopId } });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

type SeedInput = Readonly<{
  key: string;
  isActive?: boolean;
  isPresent?: boolean;
  variants?: readonly Readonly<{
    key: string;
    isActive?: boolean;
    isPresent?: boolean;
    stock?: number;
  }>[];
}>;

async function seedProduct(input: SeedInput): Promise<string> {
  const product = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: `bulk-${input.key}`,
      slug: `bulk-${input.key}`,
      name: `Bulk ${input.key}`,
      isPresent: input.isPresent ?? true,
      isActive: input.isActive ?? false,
      syncedAt,
    },
  });

  for (const variant of input.variants ?? []) {
    const createdVariant = await prisma.variantMirror.create({
      data: {
        pancakeVariationId: `bulk-${input.key}-${variant.key}`,
        productId: product.id,
        isPresent: variant.isPresent ?? true,
        isActive: variant.isActive ?? false,
        syncedAt,
      },
    });

    if (variant.stock !== undefined) {
      await prisma.warehouseStock.create({
        data: {
          pancakeWarehouseId: "1",
          variantId: createdVariant.id,
          quantity: variant.stock,
          syncedAt,
        },
      });
    }
  }

  return product.id;
}

async function readProduct(productId: string) {
  return prisma.productMirror.findUniqueOrThrow({ where: { id: productId } });
}

async function readVariantActivity(productId: string): Promise<boolean[]> {
  const variants = await prisma.variantMirror.findMany({
    where: { productId },
    orderBy: { pancakeVariationId: "asc" },
    select: { isActive: true },
  });
  return variants.map(({ isActive }) => isActive);
}

function proofFor(
  productIds: readonly string[],
  warning: Readonly<{ zeroActive?: readonly string[]; compositeChildren?: readonly string[] }> = {},
): string {
  return issueAdminCatalogConfirmationProof({
    secret,
    nowMs,
    actorId,
    operation: "enable",
    targetProductIds: productIds,
    zeroActiveProductIds: warning.zeroActive ?? [],
    compositeChildProductIds: warning.compositeChildren ?? [],
  }).proof;
}

async function linkComposite(parentVariantKey: string, componentProductId: string) {
  const parent = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: `bulk-parent-${parentVariantKey}`,
      slug: `bulk-parent-${parentVariantKey}`,
      name: `Bulk parent ${parentVariantKey}`,
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });
  const parentVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: `bulk-parent-${parentVariantKey}-variant`,
      productId: parent.id,
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });
  const componentVariant = await prisma.variantMirror.findFirstOrThrow({
    where: { productId: componentProductId },
    orderBy: { pancakeVariationId: "asc" },
  });

  await prisma.compositeComponentMirror.create({
    data: {
      parentVariantId: parentVariant.id,
      componentVariantId: componentVariant.id,
      quantity: 1,
      syncedAt,
    },
  });
}

test("bulk warning state reports exact zero-active and composite-child selections", async () => {
  const active = await seedProduct({
    key: "warn-active",
    variants: [{ key: "v1", isActive: true }],
  });
  const zeroActive = await seedProduct({
    key: "warn-zero",
    variants: [{ key: "v1", isActive: false }],
  });
  const child = await seedProduct({
    key: "warn-child",
    variants: [{ key: "v1", isActive: true }],
  });
  await linkComposite("warn", child);

  assert.deepEqual(
    await repository.readBulkCatalogEnableWarningState([active, zeroActive, child]),
    {
      zeroActiveProductIds: [zeroActive],
      compositeChildProductIds: [child],
    },
  );

  const stale = await seedProduct({ key: "warn-stale", isPresent: false });
  assert.equal(await repository.readBulkCatalogEnableWarningState([active, stale]), null);
  assert.equal(
    await repository.readBulkCatalogEnableWarningState([active, `${active}-missing`]),
    null,
  );
});

test("bulk catalog enable commits only product activation for a current proof", async () => {
  const first = await seedProduct({
    key: "enable-first",
    variants: [{ key: "v1", isActive: true }],
  });
  const second = await seedProduct({
    key: "enable-second",
    variants: [{ key: "v1", isActive: false }],
  });
  const productIds = [first, second];

  assert.deepEqual(
    await repository.commitBulkCatalogEnable({
      productIds,
      actorId,
      secret,
      nowMs,
      proof: proofFor(productIds, { zeroActive: [second] }),
    }),
    { ok: true, updatedCount: 2 },
  );

  assert.equal((await readProduct(first)).isActive, true);
  assert.equal((await readProduct(second)).isActive, true);
  assert.deepEqual(await readVariantActivity(first), [true]);
  assert.deepEqual(
    await readVariantActivity(second),
    [false],
    "bulk catalog enable never activates variants",
  );
});

test("a composite edge added after prepare forces reconfirmation with zero batch writes", async () => {
  const plain = await seedProduct({
    key: "drift-plain",
    variants: [{ key: "v1", isActive: true }],
  });
  const drifting = await seedProduct({
    key: "drift-child",
    variants: [{ key: "v1", isActive: true }],
  });
  const productIds = [plain, drifting];
  const preparedProof = proofFor(productIds);

  await linkComposite("drift", drifting);

  const result = await repository.commitBulkCatalogEnable({
    productIds,
    actorId,
    secret,
    nowMs,
    proof: preparedProof,
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "RECONFIRM_REQUIRED");
  assert.deepEqual(result.warningState, {
    zeroActiveProductIds: [],
    compositeChildProductIds: [drifting],
  });

  assert.equal((await readProduct(plain)).isActive, false, "the whole batch is left unwritten");
  assert.equal((await readProduct(drifting)).isActive, false);
});

test("an active-variant change after prepare forces reconfirmation with zero batch writes", async () => {
  const stable = await seedProduct({
    key: "active-drift-stable",
    variants: [{ key: "v1", isActive: true }],
  });
  const drifting = await seedProduct({
    key: "active-drift-target",
    variants: [{ key: "v1", isActive: true }],
  });
  const productIds = [stable, drifting];
  const preparedProof = proofFor(productIds);

  await prisma.variantMirror.updateMany({
    where: { productId: drifting },
    data: { isActive: false },
  });

  const result = await repository.commitBulkCatalogEnable({
    productIds,
    actorId,
    secret,
    nowMs,
    proof: preparedProof,
  });
  assert.ok(!result.ok && result.reason === "RECONFIRM_REQUIRED");
  assert.deepEqual(result.warningState.zeroActiveProductIds, [drifting]);
  assert.equal((await readProduct(stable)).isActive, false);
  assert.equal((await readProduct(drifting)).isActive, false);
});

test("a proof for a different selection, actor or expiry cannot enable the batch", async () => {
  const first = await seedProduct({
    key: "proof-first",
    variants: [{ key: "v1", isActive: true }],
  });
  const second = await seedProduct({
    key: "proof-second",
    variants: [{ key: "v1", isActive: true }],
  });
  const productIds = [first, second];

  const rejected = [
    { proof: proofFor([first]), nowMs },
    { proof: proofFor([...productIds, `${first}-extra`]), nowMs },
    {
      proof: issueAdminCatalogConfirmationProof({
        secret,
        nowMs,
        actorId: "another-admin",
        operation: "enable",
        targetProductIds: productIds,
        zeroActiveProductIds: [],
        compositeChildProductIds: [],
      }).proof,
      nowMs,
    },
    { proof: proofFor(productIds), nowMs: nowMs + 6 * 60_000 },
    { proof: "v1.not-a-real-proof.signature", nowMs },
  ];

  for (const attempt of rejected) {
    const result = await repository.commitBulkCatalogEnable({
      productIds,
      actorId,
      secret,
      nowMs: attempt.nowMs,
      proof: attempt.proof,
    });
    assert.ok(!result.ok && result.reason === "RECONFIRM_REQUIRED");
  }

  assert.equal((await readProduct(first)).isActive, false);
  assert.equal((await readProduct(second)).isActive, false);
});

test("a missing or no-longer-present target aborts the batch before any write", async () => {
  const valid = await seedProduct({
    key: "target-valid",
    variants: [{ key: "v1", isActive: true }],
  });
  const stale = await seedProduct({ key: "target-stale", isPresent: false });

  assert.deepEqual(
    await repository.commitBulkCatalogEnable({
      productIds: [valid, stale],
      actorId,
      secret,
      nowMs,
      proof: proofFor([valid, stale]),
    }),
    { ok: false, reason: "PRODUCT_NOT_AVAILABLE" },
  );
  assert.deepEqual(await repository.disableBulkCatalog([valid, stale]), {
    ok: false,
    reason: "PRODUCT_NOT_AVAILABLE",
  });
  assert.deepEqual(await repository.disableBulkCatalog([valid, `${valid}-missing`]), {
    ok: false,
    reason: "PRODUCT_NOT_AVAILABLE",
  });

  assert.equal((await readProduct(valid)).isActive, false);
});

test("bulk catalog disable is atomic, idempotent and leaves variants untouched", async () => {
  const first = await seedProduct({
    key: "disable-first",
    isActive: true,
    variants: [{ key: "v1", isActive: true }],
  });
  const second = await seedProduct({
    key: "disable-second",
    isActive: false,
    variants: [{ key: "v1", isActive: true }],
  });
  const productIds = [first, second];

  assert.deepEqual(await repository.disableBulkCatalog(productIds), {
    ok: true,
    updatedCount: 2,
  });
  assert.deepEqual(await repository.disableBulkCatalog(productIds), {
    ok: true,
    updatedCount: 2,
  });

  assert.equal((await readProduct(first)).isActive, false);
  assert.equal((await readProduct(second)).isActive, false);
  assert.deepEqual(await readVariantActivity(first), [true]);
  assert.deepEqual(await readVariantActivity(second), [true]);
});

test("bulk variant activation enable-all and disable-all mutate all present variants atomically", async () => {
  const first = await seedProduct({
    key: "v-all-1",
    isActive: false,
    variants: [
      { key: "v1", isActive: false },
      { key: "v2", isActive: true },
    ],
  });
  const second = await seedProduct({
    key: "v-all-2",
    isActive: true,
    variants: [
      { key: "v1", isActive: false },
      { key: "v2", isActive: false },
    ],
  });
  const productIds = [first, second];

  // Enable all
  assert.deepEqual(await repository.updateBulkVariantActivation(productIds, "enable-all"), {
    ok: true,
    updatedProductCount: 2,
    updatedVariantCount: 4,
  });

  assert.deepEqual(await readVariantActivity(first), [true, true]);
  assert.deepEqual(await readVariantActivity(second), [true, true]);
  // ProductMirror.isActive is untouched
  assert.equal((await readProduct(first)).isActive, false);
  assert.equal((await readProduct(second)).isActive, true);

  // Disable all
  assert.deepEqual(await repository.updateBulkVariantActivation(productIds, "disable-all"), {
    ok: true,
    updatedProductCount: 2,
    updatedVariantCount: 4,
  });

  assert.deepEqual(await readVariantActivity(first), [false, false]);
  assert.deepEqual(await readVariantActivity(second), [false, false]);
  assert.equal((await readProduct(first)).isActive, false);
  assert.equal((await readProduct(second)).isActive, true);
});

test("bulk variant activation enable-stocked activates only variants with positive stock", async () => {
  const first = await seedProduct({
    key: "v-stock-1",
    variants: [
      { key: "v1", isActive: false, stock: 10 },
      { key: "v2", isActive: false, stock: 0 },
    ],
  });
  const second = await seedProduct({
    key: "v-stock-2",
    variants: [
      { key: "v1", isActive: false, stock: 5 },
      { key: "v2", isActive: false }, // no warehouse stock record -> 0
    ],
  });
  const productIds = [first, second];

  assert.deepEqual(await repository.updateBulkVariantActivation(productIds, "enable-stocked"), {
    ok: true,
    updatedProductCount: 2,
    updatedVariantCount: 2,
  });

  assert.deepEqual(await readVariantActivity(first), [true, false]);
  assert.deepEqual(await readVariantActivity(second), [true, false]);
});

test("bulk variant activation fails closed when a selected product is missing or not present", async () => {
  const valid = await seedProduct({
    key: "v-stale-valid",
    variants: [{ key: "v1", isActive: false, stock: 10 }],
  });
  const stale = await seedProduct({
    key: "v-stale-product",
    isPresent: false,
    variants: [{ key: "v1", isActive: false, stock: 10 }],
  });

  assert.deepEqual(await repository.updateBulkVariantActivation([valid, stale], "enable-all"), {
    ok: false,
    reason: "PRODUCT_NOT_AVAILABLE",
  });
  assert.deepEqual(await repository.updateBulkVariantActivation([valid, "missing-id"], "enable-stocked"), {
    ok: false,
    reason: "PRODUCT_NOT_AVAILABLE",
  });

  // Rollback verified: valid product's variant remains inactive
  assert.deepEqual(await readVariantActivity(valid), [false]);
});
