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

test("deployed schema stores the immutable guest checkout snapshot fields", async () => {
  const orderColumns = await prisma.$queryRaw<Array<{ column_name: string; data_type: string }>>`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'OrderMirror'
      AND column_name IN (
        'checkoutSnapshottedAt',
        'guestName',
        'guestPhone',
        'provinceRef',
        'districtRef',
        'communeRef',
        'addressDetail',
        'note',
        'pancakeShopId',
        'merchandiseSubtotalVnd',
        'shippingFeeVnd',
        'totalVnd'
      )
    ORDER BY column_name
  `;

  assert.deepEqual(orderColumns, [
    { column_name: "addressDetail", data_type: "text" },
    { column_name: "checkoutSnapshottedAt", data_type: "timestamp without time zone" },
    { column_name: "communeRef", data_type: "text" },
    { column_name: "districtRef", data_type: "text" },
    { column_name: "guestName", data_type: "text" },
    { column_name: "guestPhone", data_type: "text" },
    { column_name: "merchandiseSubtotalVnd", data_type: "bigint" },
    { column_name: "note", data_type: "text" },
    { column_name: "pancakeShopId", data_type: "integer" },
    { column_name: "provinceRef", data_type: "text" },
    { column_name: "shippingFeeVnd", data_type: "bigint" },
    { column_name: "totalVnd", data_type: "bigint" },
  ]);

  const lineColumns = await prisma.$queryRaw<Array<{ column_name: string; data_type: string }>>`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'OrderLineSnapshot'
    ORDER BY ordinal_position
  `;

  assert.deepEqual(lineColumns, [
    { column_name: "id", data_type: "text" },
    { column_name: "orderId", data_type: "text" },
    { column_name: "variantId", data_type: "text" },
    { column_name: "pancakeVariationId", data_type: "text" },
    { column_name: "productName", data_type: "text" },
    { column_name: "color", data_type: "text" },
    { column_name: "size", data_type: "text" },
    { column_name: "quantity", data_type: "integer" },
    { column_name: "unitPriceVnd", data_type: "bigint" },
    { column_name: "lineTotalVnd", data_type: "bigint" },
    { column_name: "createdAt", data_type: "timestamp without time zone" },
  ]);
});
