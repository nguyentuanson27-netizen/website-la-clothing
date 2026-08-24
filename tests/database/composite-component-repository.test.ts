import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createCompositeComponentRepository } from "../../src/commerce/composite-component-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const repository = createCompositeComponentRepository(prisma);
const shopId = 920_105;
const syncedAt = new Date("2026-08-24T00:00:00.000Z");

async function cleanup() {
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: shopId } });
}

async function createFixture() {
  const parent = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "activation-parent",
      slug: "activation-parent",
      name: "Activation Parent",
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });
  const child = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "activation-child",
      slug: "activation-child",
      name: "Activation Child",
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });
  const otherChild = await prisma.productMirror.create({
    data: {
      pancakeShopId: shopId,
      pancakeProductId: "activation-other-child",
      slug: "activation-other-child",
      name: "Activation Other Child",
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });

  const parentVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "activation-parent-m",
      productId: parent.id,
      size: "M",
      isPresent: true,
      isActive: true,
      syncedAt,
    },
  });
  const linkedVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "activation-child-m",
      productId: child.id,
      size: "M",
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });
  const unlinkedVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "activation-child-l",
      productId: child.id,
      size: "L",
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });
  const otherLinkedVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "activation-other-child-m",
      productId: otherChild.id,
      size: "M",
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });

  await prisma.compositeComponentMirror.createMany({
    data: [
      {
        parentVariantId: parentVariant.id,
        componentVariantId: linkedVariant.id,
        quantity: 1,
        syncedAt,
      },
      {
        parentVariantId: parentVariant.id,
        componentVariantId: otherLinkedVariant.id,
        quantity: 1,
        syncedAt,
      },
    ],
  });

  return { parent, child, otherChild, linkedVariant, unlinkedVariant, otherLinkedVariant };
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => prisma.$disconnect());

test("repository atomically activates only a present variant owned by the child product with an incoming composite edge", async () => {
  const { child, linkedVariant } = await createFixture();

  assert.deepEqual(
    await repository.setRelationLinkedVariantActive({
      productId: child.id,
      variantId: linkedVariant.id,
      isActive: true,
    }),
    {
      productId: child.id,
      variantId: linkedVariant.id,
      isActive: true,
    },
  );

  const persisted = await prisma.variantMirror.findUniqueOrThrow({
    where: { id: linkedVariant.id },
    select: {
      isActive: true,
      product: { select: { isActive: true, isPresent: true } },
      compositeParents: { select: { parentVariantId: true } },
    },
  });
  assert.equal(persisted.isActive, true);
  assert.equal(persisted.product.isActive, false);
  assert.equal(persisted.product.isPresent, true);
  assert.equal(persisted.compositeParents.length, 1);

  assert.deepEqual(
    await repository.setRelationLinkedVariantActive({
      productId: child.id,
      variantId: linkedVariant.id,
      isActive: true,
    }),
    {
      productId: child.id,
      variantId: linkedVariant.id,
      isActive: true,
    },
  );
});

test("repository rejects unlinked, cross-product, and stale component variants without changing activation", async () => {
  const { child, otherChild, linkedVariant, unlinkedVariant, otherLinkedVariant } =
    await createFixture();

  assert.equal(
    await repository.setRelationLinkedVariantActive({
      productId: child.id,
      variantId: unlinkedVariant.id,
      isActive: true,
    }),
    null,
  );
  assert.equal(
    await repository.setRelationLinkedVariantActive({
      productId: child.id,
      variantId: otherLinkedVariant.id,
      isActive: true,
    }),
    null,
  );

  await prisma.variantMirror.update({
    where: { id: linkedVariant.id },
    data: { isPresent: false },
  });
  assert.equal(
    await repository.setRelationLinkedVariantActive({
      productId: child.id,
      variantId: linkedVariant.id,
      isActive: true,
    }),
    null,
  );

  await prisma.variantMirror.update({
    where: { id: linkedVariant.id },
    data: { isPresent: true },
  });
  await prisma.productMirror.update({
    where: { id: child.id },
    data: { isPresent: false },
  });
  assert.equal(
    await repository.setRelationLinkedVariantActive({
      productId: child.id,
      variantId: linkedVariant.id,
      isActive: true,
    }),
    null,
  );

  const states = await prisma.variantMirror.findMany({
    where: { id: { in: [linkedVariant.id, unlinkedVariant.id, otherLinkedVariant.id] } },
    select: { id: true, isActive: true, productId: true },
    orderBy: { id: "asc" },
  });
  assert.ok(states.every(({ isActive }) => isActive === false));
  assert.equal(states.find(({ id }) => id === otherLinkedVariant.id)?.productId, otherChild.id);
});
