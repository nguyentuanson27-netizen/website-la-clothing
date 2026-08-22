import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { discoverPancakeCompositeContracts } from "../../scripts/pancake-composite-discover.ts";

type QueryValue = string | number | boolean;

test("composite discovery traverses every parent/children page and merges path/type evidence", async () => {
  const calls: Array<{
    endpoint: string;
    query: Readonly<Record<string, QueryValue>> | undefined;
  }> = [];
  const parentSecret = "parent-variation-private-value";
  const childSecret = "child-variation-private-value";
  const pageTwoSecret = "page-two-private-value";
  const privateNote = "PRIVATE PANCAKE NOTE MUST NOT LEAK";

  const report = await discoverPancakeCompositeContracts({
    shopId: 47,
    client: {
      async getJson(endpoint, query) {
        calls.push({ endpoint, query });
        const role = query?.included_composite;
        const pageNumber = query?.page_number;

        if (role === "parent" && pageNumber === 1) {
          return {
            success: true,
            page_number: 1,
            page_size: 100,
            total_entries: 2,
            total_pages: 2,
            data: [
              {
                id: parentSecret,
                note: privateNote,
                composite_products: [{ component_id: childSecret, quantity: 1 }],
              },
            ],
          };
        }

        if (role === "parent" && pageNumber === 2) {
          return {
            success: true,
            page_number: 2,
            page_size: 100,
            total_entries: 2,
            total_pages: 2,
            data: [
              {
                id: pageTwoSecret,
                page_two_only: { variation_id: childSecret },
                composite_products: [{ component_id: childSecret, quantity: "1" }],
              },
            ],
          };
        }

        return {
          success: true,
          page_number: 1,
          page_size: 100,
          total_entries: 1,
          total_pages: 1,
          data: [{ id: childSecret, component: { variation_id: parentSecret } }],
        };
      },
    },
  });

  assert.deepEqual(calls, [
    {
      endpoint: "/shops/47/products/variations",
      query: { page_number: 1, page_size: 100, included_composite: "parent" },
    },
    {
      endpoint: "/shops/47/products/variations",
      query: { page_number: 2, page_size: 100, included_composite: "parent" },
    },
    {
      endpoint: "/shops/47/products/variations",
      query: { page_number: 1, page_size: 100, included_composite: "children" },
    },
  ]);

  assert.deepEqual(
    report.parent.paths.find(({ path }) => path === "$.data[].composite_products[].quantity")?.types,
    ["number", "string"],
  );

  const serialized = JSON.stringify(report);
  assert.match(serialized, /\$\.data\[\]\.composite_products\[\]\.component_id/);
  assert.match(serialized, /\$\.data\[\]\.component\.variation_id/);
  assert.match(serialized, /\$\.data\[\]\.page_two_only\.variation_id/);
  assert.equal(serialized.includes(parentSecret), false);
  assert.equal(serialized.includes(childSecret), false);
  assert.equal(serialized.includes(pageTwoSecret), false);
  assert.equal(serialized.includes(privateNote), false);
});

test("composite discovery fails closed when Pancake pagination exceeds the bounded contract", async () => {
  const calls: Array<Readonly<Record<string, QueryValue>> | undefined> = [];

  await assert.rejects(
    discoverPancakeCompositeContracts({
      shopId: 47,
      client: {
        async getJson(_endpoint, query) {
          calls.push(query);
          return {
            success: true,
            page_number: 1,
            page_size: 100,
            total_entries: 50_001,
            total_pages: 501,
            data: [],
          };
        },
      },
    }),
    /composite (?:page|entry) limit exceeded/i,
  );

  assert.equal(calls.length, 1);
});

test("trusted composite discovery refuses CI before reading Pancake credentials", () => {
  const apiKey = "P17_COMPOSITE_API_KEY_SECRET";
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/pancake-composite-discover.ts"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        CI: "true",
        GITHUB_ACTIONS: "true",
        PANCAKE_API_KEY: apiKey,
        PANCAKE_SHOP_ID: "47",
      },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /composite discovery refuses CI execution/i);
  assert.equal(result.stderr.includes(apiKey), false);
});
