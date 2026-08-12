import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

test.after(async () => {
  await prisma.$disconnect();
});

test("deployed schema stores Pancake order reconciliation fields separately from local order state", async () => {
  const columns = await prisma.$queryRaw<Array<{ column_name: string; data_type: string }>>`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'OrderMirror'
      AND column_name IN (
        'pancakeSystemId',
        'pancakeStatus',
        'pancakeStatusUpdatedAt'
      )
    ORDER BY column_name
  `;

  assert.deepEqual(columns, [
    { column_name: "pancakeStatus", data_type: "integer" },
    { column_name: "pancakeStatusUpdatedAt", data_type: "text" },
    { column_name: "pancakeSystemId", data_type: "text" },
  ]);
});
