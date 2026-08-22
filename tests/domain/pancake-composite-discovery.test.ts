import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { discoverPancakeCompositeContracts } from "../../scripts/pancake-composite-discover.ts";

type QueryValue = string | number | boolean;

test("composite discovery uses Pancake's documented parent/children filters without exposing raw values", async () => {
  const calls: Array<{
    endpoint: string;
    query: Readonly<Record<string, QueryValue>> | undefined;
  }> = [];
  const parentSecret = "parent-variation-private-value";
  const childSecret = "child-variation-private-value";
  const privateNote = "PRIVATE PANCAKE NOTE MUST NOT LEAK";

  const report = await discoverPancakeCompositeContracts({
    shopId: 47,
    client: {
      async getJson(endpoint, query) {
        calls.push({ endpoint, query });
        const role = query?.included_composite;
        return role === "parent"
          ? {
              success: true,
              data: [
                {
                  id: parentSecret,
                  note: privateNote,
                  composite_products: [{ component_id: childSecret, quantity: 1 }],
                },
              ],
            }
          : {
              success: true,
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
      query: { page_number: 1, page_size: 100, included_composite: "children" },
    },
  ]);

  const serialized = JSON.stringify(report);
  assert.match(serialized, /\$\.data\[\]\.composite_products\[\]\.component_id/);
  assert.match(serialized, /\$\.data\[\]\.component\.variation_id/);
  assert.equal(serialized.includes(parentSecret), false);
  assert.equal(serialized.includes(childSecret), false);
  assert.equal(serialized.includes(privateNote), false);
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
