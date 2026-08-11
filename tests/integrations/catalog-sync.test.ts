import assert from "node:assert/strict";
import test from "node:test";

import { syncPancakeCatalog } from "../../src/commerce/catalog-sync.ts";

type Query = Readonly<Record<string, string | number | boolean>>;

function catalogPage(pageNumber: number, totalPages: number) {
  return {
    success: true,
    page_number: pageNumber,
    page_size: 100,
    total_entries: 0,
    total_pages: totalPages,
    data: [],
  };
}

test("catalog sync completes the full validated traversal before handing one snapshot to persistence", async () => {
  const events: string[] = [];
  const client = {
    async getJson(_endpoint: string, query: Query) {
      const page = Number(query.page_number);
      events.push(`fetch:${page}`);
      return catalogPage(page, 2);
    },
  };
  const repository = {
    async syncSnapshot(input: { shopId: number; variations: readonly unknown[]; syncedAt: Date }) {
      events.push("persist");
      assert.equal(input.shopId, 123);
      assert.deepEqual(input.variations, []);
      assert.deepEqual(input.syncedAt, new Date("2026-08-11T00:00:00.000Z"));
      return { products: 0, variations: 0 };
    },
  };

  const result = await syncPancakeCatalog({
    client,
    repository,
    shopId: 123,
    syncedAt: new Date("2026-08-11T00:00:00.000Z"),
  });

  assert.deepEqual(events, ["fetch:1", "fetch:2", "persist"]);
  assert.deepEqual(result, { products: 0, variations: 0 });
});

test("catalog sync never mutates the mirror when any remote page fails validation", async () => {
  let persisted = false;
  const client = {
    async getJson(_endpoint: string, query: Query) {
      const page = Number(query.page_number);
      return page === 1
        ? catalogPage(1, 2)
        : { ...catalogPage(2, 2), success: false };
    },
  };
  const repository = {
    async syncSnapshot() {
      persisted = true;
      return { products: 0, variations: 0 };
    },
  };

  await assert.rejects(
    () =>
      syncPancakeCatalog({
        client,
        repository,
        shopId: 123,
        syncedAt: new Date("2026-08-11T00:00:00.000Z"),
      }),
    /unsuccessful/i,
  );
  assert.equal(persisted, false);
});
