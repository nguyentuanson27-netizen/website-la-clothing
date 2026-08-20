import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database smoke tests");

const schema = `p6_slug_migration_${process.pid}`;
const migrationPath = resolve(
  import.meta.dirname,
  "../../prisma/migrations/20260820140000_add_product_slug_history/migration.sql",
);

async function withMigrationDatabase(run: (client: pg.Client) => Promise<void>) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    await client.query(`
      CREATE TABLE "ProductMirror" (
        "id" TEXT PRIMARY KEY,
        "slug" TEXT NOT NULL UNIQUE,
        "name" TEXT NOT NULL,
        "updatedAt" TIMESTAMP(3) NOT NULL
      )
    `);
    await run(client);
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  }
}

test("P6 migration preserves opaque slugs as history and assigns readable Vietnamese-friendly current slugs", async () => {
  await withMigrationDatabase(async (client) => {
    await client.query(
      `INSERT INTO "ProductMirror" ("id", "slug", "name", "updatedAt") VALUES
        ('product-a', 'p-aaaaaaaaaaaaaaaaaaaa', 'Áo Sơ Mi Đen', NOW()),
        ('product-b', 'p-bbbbbbbbbbbbbbbbbbbb', 'Đầm hè', NOW()),
        ('product-p', 'p-cccccccccccccccccccc', 'P', NOW()),
        ('product-readable', 'already-readable', 'Tên Không Cần Migrate', NOW())`,
    );

    const migrationSql = await readFile(migrationPath, "utf8");
    await client.query(migrationSql);

    const products = await client.query<{ id: string; slug: string }>(
      `SELECT "id", "slug" FROM "ProductMirror" ORDER BY "id"`,
    );
    assert.deepEqual(products.rows, [
      { id: "product-a", slug: "ao-so-mi-den-aaaaaaaaaaaaaaaaaaaa" },
      { id: "product-b", slug: "dam-he-bbbbbbbbbbbbbbbbbbbb" },
      { id: "product-p", slug: "san-pham-cccccccccccccccccccc" },
      { id: "product-readable", slug: "already-readable" },
    ]);

    const history = await client.query<{ slug: string; productId: string }>(
      `SELECT "slug", "productId" FROM "ProductSlugHistory" ORDER BY "slug"`,
    );
    assert.deepEqual(history.rows, [
      { slug: "p-aaaaaaaaaaaaaaaaaaaa", productId: "product-a" },
      { slug: "p-bbbbbbbbbbbbbbbbbbbb", productId: "product-b" },
      { slug: "p-cccccccccccccccccccc", productId: "product-p" },
    ]);
  });
});
