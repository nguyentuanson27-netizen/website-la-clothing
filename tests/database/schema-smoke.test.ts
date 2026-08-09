import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required for database smoke tests");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

test.after(async () => {
  await prisma.$disconnect();
});

test("deployed migrations support catalog mirror relations and cascades", async () => {
  const pancakeProductId = "db-smoke-product";
  const pancakeVariationId = "db-smoke-variation";

  await prisma.productMirror.deleteMany({ where: { pancakeProductId } });

  const product = await prisma.productMirror.create({
    data: {
      pancakeProductId,
      slug: "db-smoke-product",
      name: "DB Smoke Product",
      syncedAt: new Date("2026-08-09T00:00:00.000Z"),
      variants: {
        create: {
          pancakeVariationId,
          sku: "DB-SMOKE-SKU",
          color: "Black",
          size: "M",
          syncedAt: new Date("2026-08-09T00:00:00.000Z"),
          warehouseStocks: {
            create: {
              pancakeWarehouseId: "warehouse-online",
              quantity: 7,
              syncedAt: new Date("2026-08-09T00:00:00.000Z"),
            },
          },
        },
      },
    },
    include: {
      variants: {
        include: { warehouseStocks: true },
      },
    },
  });

  assert.equal(product.variants.length, 1);
  assert.equal(product.variants[0]?.warehouseStocks[0]?.quantity, 7);

  await prisma.productMirror.delete({ where: { pancakeProductId } });

  assert.equal(
    await prisma.variantMirror.count({ where: { pancakeVariationId } }),
    0,
  );
  assert.equal(
    await prisma.warehouseStock.count({ where: { pancakeWarehouseId: "warehouse-online" } }),
    0,
  );
});

test("deployed auth schema applies the server-owned CUSTOMER role default", async () => {
  const id = "db-smoke-customer";
  const email = "db-smoke@example.invalid";

  await prisma.user.deleteMany({ where: { id } });

  const user = await prisma.user.create({
    data: {
      id,
      name: "Database Smoke Customer",
      email,
      emailVerified: false,
      createdAt: new Date("2026-08-09T00:00:00.000Z"),
      updatedAt: new Date("2026-08-09T00:00:00.000Z"),
    },
  });

  assert.equal(user.role, "CUSTOMER");

  await prisma.user.delete({ where: { id } });
});

test("deployed auth schema includes Better Auth database rate-limit storage", async () => {
  const columns = await prisma.$queryRaw<Array<{ column_name: string; data_type: string }>>`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rateLimit'
    ORDER BY ordinal_position
  `;

  assert.deepEqual(columns, [
    { column_name: "id", data_type: "text" },
    { column_name: "key", data_type: "text" },
    { column_name: "count", data_type: "integer" },
    { column_name: "lastRequest", data_type: "bigint" },
  ]);
});

test("deployed auth schema indexes session/account ownership and verification lookup fields", async () => {
  const indexes = await prisma.$queryRaw<Array<{ tablename: string; indexdef: string }>>`
    SELECT tablename, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('session', 'account', 'verification')
    ORDER BY tablename, indexname
  `;

  function hasIndex(table: string, column: string): boolean {
    return indexes.some(
      ({ tablename, indexdef }) =>
        tablename === table && indexdef.includes(`("${column}")`),
    );
  }

  assert.equal(hasIndex("session", "userId"), true);
  assert.equal(hasIndex("account", "userId"), true);
  assert.equal(hasIndex("verification", "identifier"), true);
});
