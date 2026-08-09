import assert from "node:assert/strict";
import test from "node:test";

import {
  PancakeConfigError,
  readPancakeConfig,
  readPancakeOnlineWarehouseIds,
} from "../../src/integrations/pancake/config.ts";

test("reads explicit Pancake API key and shop ID from server environment", () => {
  const config = readPancakeConfig({
    PANCAKE_API_KEY: "  secret-key  ",
    PANCAKE_SHOP_ID: "6036602",
  });

  assert.deepEqual(config, {
    apiKey: "secret-key",
    shopId: 6036602,
  });
});

test("reads only explicitly configured online warehouse ids as opaque values", () => {
  assert.deepEqual(
    readPancakeOnlineWarehouseIds({
      PANCAKE_ONLINE_WAREHOUSE_IDS: " warehouse-primary,6036602,warehouse-secondary ",
    }),
    ["warehouse-primary", "6036602", "warehouse-secondary"],
  );
});

test("online warehouse selection fails closed instead of inventing a default", async (t) => {
  const cases: Array<{ name: string; value?: string }> = [
    { name: "missing" },
    { name: "blank", value: "   " },
    { name: "empty member", value: "warehouse-a,,warehouse-b" },
    { name: "duplicate", value: "warehouse-a, warehouse-a" },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      assert.throws(
        () =>
          readPancakeOnlineWarehouseIds({
            PANCAKE_ONLINE_WAREHOUSE_IDS: scenario.value,
          }),
        PancakeConfigError,
      );
    });
  }
});

test("fails closed when required Pancake configuration is missing or invalid", async (t) => {
  const cases: Array<{ name: string; env: Record<string, string | undefined> }> = [
    { name: "missing key", env: { PANCAKE_SHOP_ID: "6036602" } },
    { name: "blank key", env: { PANCAKE_API_KEY: " ", PANCAKE_SHOP_ID: "6036602" } },
    { name: "missing shop", env: { PANCAKE_API_KEY: "secret" } },
    { name: "non-numeric shop", env: { PANCAKE_API_KEY: "secret", PANCAKE_SHOP_ID: "abc" } },
    { name: "non-positive shop", env: { PANCAKE_API_KEY: "secret", PANCAKE_SHOP_ID: "0" } },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      assert.throws(() => readPancakeConfig(scenario.env), PancakeConfigError);
    });
  }
});

test("configuration errors never include the API key value", () => {
  const apiKey = "super-sensitive-api-key";

  assert.throws(
    () => readPancakeConfig({ PANCAKE_API_KEY: apiKey, PANCAKE_SHOP_ID: "invalid" }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(apiKey), false);
      return true;
    },
  );
});
