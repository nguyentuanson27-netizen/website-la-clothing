import assert from "node:assert/strict";
import test from "node:test";

import { fetchAllPancakeCatalogVariations } from "../../src/integrations/pancake/catalog-pages.ts";

type Query = Readonly<Record<string, string | number | boolean>>;

function catalogPage(pageNumber: number, totalPages: number) {
  return {
    success: true,
    page_number: pageNumber,
    page_size: 100,
    total_entries: totalPages,
    total_pages: totalPages,
    data: [],
  };
}

test("catalog pagination deliberately fetches every verified page exactly once", async () => {
  const calls: Array<{ endpoint: string; query: Query }> = [];
  const client = {
    async getJson(endpoint: string, query: Query) {
      calls.push({ endpoint, query });
      const page = Number(query.page_number);
      return catalogPage(page, 3);
    },
  };

  const result = await fetchAllPancakeCatalogVariations({ client, shopId: 123 });

  assert.deepEqual(result, []);
  assert.deepEqual(
    calls.map(({ endpoint, query }) => ({ endpoint, query })),
    [1, 2, 3].map((page_number) => ({
      endpoint: "/shops/123/products/variations",
      query: { page_number, page_size: 100 },
    })),
  );
});

test("catalog pagination fails closed if Pancake changes total_pages mid-traversal", async () => {
  const client = {
    async getJson(_endpoint: string, query: Query) {
      const page = Number(query.page_number);
      return catalogPage(page, page === 1 ? 2 : 3);
    },
  };

  await assert.rejects(
    () => fetchAllPancakeCatalogVariations({ client, shopId: 123 }),
    /pagination changed during traversal/i,
  );
});

test("catalog pagination fails closed if a response does not match the requested page", async () => {
  const client = {
    async getJson(_endpoint: string, query: Query) {
      const page = Number(query.page_number);
      return catalogPage(page === 2 ? 1 : page, 2);
    },
  };

  await assert.rejects(
    () => fetchAllPancakeCatalogVariations({ client, shopId: 123 }),
    /requested page/i,
  );
});

test("catalog pagination refuses an unreasonable remote page count before unbounded traversal", async () => {
  let calls = 0;
  const client = {
    async getJson() {
      calls += 1;
      return catalogPage(1, 10_001);
    },
  };

  await assert.rejects(
    () => fetchAllPancakeCatalogVariations({ client, shopId: 123 }),
    /page limit/i,
  );
  assert.equal(calls, 1);
});

test("catalog pagination validates the local shop id before making a request", async () => {
  let calls = 0;
  const client = {
    async getJson() {
      calls += 1;
      return catalogPage(1, 1);
    },
  };

  await assert.rejects(
    () => fetchAllPancakeCatalogVariations({ client, shopId: 0 }),
    /shop id/i,
  );
  assert.equal(calls, 0);
});
