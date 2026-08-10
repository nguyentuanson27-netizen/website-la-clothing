import assert from "node:assert/strict";
import test from "node:test";

import { fetchAllPancakeCatalogVariations } from "../../src/integrations/pancake/catalog-pages.ts";

test("catalog traversal refuses an unreasonable remote entry count after the first page", async () => {
  let calls = 0;
  const client = {
    async getJson() {
      calls += 1;
      return {
        success: true,
        page_number: 1,
        page_size: 100,
        total_entries: 50_001,
        total_pages: 1,
        data: [],
      };
    },
  };

  await assert.rejects(
    () => fetchAllPancakeCatalogVariations({ client, shopId: 123 }),
    /entry limit/i,
  );
  assert.equal(calls, 1);
});
