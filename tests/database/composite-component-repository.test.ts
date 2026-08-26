import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { createCompositeComponentRepository } from "../../src/commerce/composite-component-repository.ts";
import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const repository = createCompositeComponentRepository(prisma);
const shopId = 920_021;
const syncedAt = new Date("2026-08-24T00:00:00.000Z");

async function cleanup() {
  await prisma.productMirror.deleteMany({ where: { pancakeShopId: shopId } });
}

test.beforeEach(cleanup);
test.afterEach(cleanup);
test.after(async () => {
  await prisma.$disconnect();
});

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
  const unlinkedParentVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "activation-parent-l",
      productId: parent.id,
      size: "L",
      isPresent: true,
      isActive: false,
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
  const otherVariant = await prisma.variantMirror.create({
    data: {
      pancakeVariationId: "activation-other-child-m",
      productId: otherChild.id,
      size: "M",
      isPresent: true,
      isActive: false,
      syncedAt,
    },
  });

  await prisma.compositeComponentMirror.create({
    data: {
      parentVariantId: parentVariant.id,
      componentVariantId: linkedVariant.id,
      quantity: 1,
      syncedAt,
    },
  });

  return {
    parent,
    child,
    otherChild,
    parentVariant,
    unlinkedParentVariant,
    linkedVariant,
    unlinkedVariant,
    otherVariant,
  };
}

test("component activation updates only the present relation-linked variant owned by the supplied child product", async () => {
  const fixture = await createFixture();

  assert.equal(
    await repository.setLinkedVariantActivation({
      productId: fixture.child.id,
      variantId: fixture.linkedVariant.id,
      isActive: true,
    }),
    true,
  );

  const childAfterActivation = await prisma.productMirror.findUniqueOrThrow({
    where: { id: fixture.child.id },
    include: {
      variants: {
        orderBy: { size: "asc" },
      },
    },
  });
  assert.equal(childAfterActivation.isActive, false);
  assert.deepEqual(
    childAfterActivation.variants.map(({ size, isActive }) => ({ size, isActive })),
    [
      { size: "L", isActive: false },
      { size: "M", isActive: true },
    ],
  );
  assert.equal(
    await prisma.compositeComponentMirror.count({
      where: { componentVariantId: fixture.linkedVariant.id },
    }),
    1,
  );

  assert.equal(
    await repository.setLinkedVariantActivation({
      productId: fixture.child.id,
      variantId: fixture.linkedVariant.id,
      isActive: true,
    }),
    true,
  );

  assert.equal(
    await repository.setLinkedVariantActivation({
      productId: fixture.child.id,
      variantId: fixture.linkedVariant.id,
      isActive: false,
    }),
    true,
  );
  assert.equal(
    (
      await prisma.variantMirror.findUniqueOrThrow({
        where: { id: fixture.linkedVariant.id },
        select: { isActive: true },
      })
    ).isActive,
    false,
  );
});

test("component activation rejects unlinked, cross-product, and stale component targets without changing activation", async () => {
  const fixture = await createFixture();

  for (const input of [
    {
      productId: fixture.child.id,
      variantId: fixture.unlinkedVariant.id,
      isActive: true,
    },
    {
      productId: fixture.otherChild.id,
      variantId: fixture.linkedVariant.id,
      isActive: true,
    },
    {
      productId: fixture.child.id,
      variantId: fixture.otherVariant.id,
      isActive: true,
    },
  ]) {
    assert.equal(await repository.setLinkedVariantActivation(input), false);
  }

  await prisma.variantMirror.update({
    where: { id: fixture.linkedVariant.id },
    data: { isPresent: false },
  });
  assert.equal(
    await repository.setLinkedVariantActivation({
      productId: fixture.child.id,
      variantId: fixture.linkedVariant.id,
      isActive: true,
    }),
    false,
  );

  await prisma.variantMirror.update({
    where: { id: fixture.linkedVariant.id },
    data: { isPresent: true },
  });
  await prisma.productMirror.update({
    where: { id: fixture.child.id },
    data: { isPresent: false },
  });
  assert.equal(
    await repository.setLinkedVariantActivation({
      productId: fixture.child.id,
      variantId: fixture.linkedVariant.id,
      isActive: true,
    }),
    false,
  );

  const variants = await prisma.variantMirror.findMany({
    where: {
      id: {
        in: [
          fixture.linkedVariant.id,
          fixture.unlinkedVariant.id,
          fixture.otherVariant.id,
        ],
      },
    },
    orderBy: { id: "asc" },
    select: { id: true, isActive: true },
  });
  assert.equal(variants.every(({ isActive }) => isActive === false), true);
});

test("parent activation updates only a present composite parent variant owned by the supplied product", async () => {
  const fixture = await createFixture();

  await prisma.variantMirror.update({
    where: { id: fixture.parentVariant.id },
    data: { isActive: false },
  });

  assert.equal(
    await repository.setParentVariantActivation({
      productId: fixture.parent.id,
      variantId: fixture.parentVariant.id,
      isActive: true,
    }),
    true,
  );

  const parentAfterActivation = await prisma.productMirror.findUniqueOrThrow({
    where: { id: fixture.parent.id },
    include: { variants: { orderBy: { size: "asc" } } },
  });
  assert.equal(parentAfterActivation.isActive, true);
  assert.deepEqual(
    parentAfterActivation.variants.map(({ size, isActive }) => ({ size, isActive })),
    [
      { size: "L", isActive: false },
      { size: "M", isActive: true },
    ],
  );
  assert.equal(
    await prisma.compositeComponentMirror.count({
      where: { parentVariantId: fixture.parentVariant.id },
    }),
    1,
  );

  assert.equal(
    await repository.setParentVariantActivation({
      productId: fixture.parent.id,
      variantId: fixture.parentVariant.id,
      isActive: false,
    }),
    true,
  );
  assert.equal(
    (
      await prisma.variantMirror.findUniqueOrThrow({
        where: { id: fixture.parentVariant.id },
        select: { isActive: true },
      })
    ).isActive,
    false,
  );
});

test("parent activation rejects unlinked, cross-product, child, and stale targets", async () => {
  const fixture = await createFixture();
  await prisma.variantMirror.update({
    where: { id: fixture.parentVariant.id },
    data: { isActive: false },
  });

  for (const input of [
    {
      productId: fixture.parent.id,
      variantId: fixture.unlinkedParentVariant.id,
      isActive: true,
    },
    {
      productId: fixture.child.id,
      variantId: fixture.parentVariant.id,
      isActive: true,
    },
    {
      productId: fixture.child.id,
      variantId: fixture.linkedVariant.id,
      isActive: true,
    },
  ]) {
    assert.equal(await repository.setParentVariantActivation(input), false);
  }

  await prisma.variantMirror.update({
    where: { id: fixture.parentVariant.id },
    data: { isPresent: false },
  });
  assert.equal(
    await repository.setParentVariantActivation({
      productId: fixture.parent.id,
      variantId: fixture.parentVariant.id,
      isActive: true,
    }),
    false,
  );

  await prisma.variantMirror.update({
    where: { id: fixture.parentVariant.id },
    data: { isPresent: true },
  });
  await prisma.productMirror.update({
    where: { id: fixture.parent.id },
    data: { isPresent: false },
  });
  assert.equal(
    await repository.setParentVariantActivation({
      productId: fixture.parent.id,
      variantId: fixture.parentVariant.id,
      isActive: true,
    }),
    false,
  );

  const parentVariants = await prisma.variantMirror.findMany({
    where: { id: { in: [fixture.parentVariant.id, fixture.unlinkedParentVariant.id] } },
    orderBy: { id: "asc" },
    select: { isActive: true },
  });
  assert.equal(parentVariants.every(({ isActive }) => isActive === false), true);
});