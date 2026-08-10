import assert from "node:assert/strict";
import test from "node:test";

import { describeTrustedJsonContract } from "../../src/integrations/pancake/trusted-json-contract.ts";

type ContractPath = {
  path: string;
  types: readonly string[];
};

function pathMap(paths: readonly ContractPath[]): Map<string, readonly string[]> {
  return new Map(paths.map(({ path, types }) => [path, types]));
}

test("trusted contract discovery reaches fields after item 50 and below the old depth limit", () => {
  const deepValue = {
    level1: {
      level2: {
        level3: {
          level4: {
            level5: {
              level6: {
                level7: {
                  level8: {
                    level9: {
                      level10: "deep-secret-value",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  const payload = {
    data: Array.from({ length: 60 }, (_, index) =>
      index === 59
        ? {
            id: "late-product-id",
            late_only: deepValue,
            variations_warehouses: [
              { warehouse_id: "warehouse-text", remain_quantity: 3 },
              { warehouse_id: 123, remain_quantity: null },
              { warehouse_id: null, remain_quantity: 7 },
            ],
          }
        : { id: `product-${index}` },
    ),
  };

  const contract = describeTrustedJsonContract(payload);
  const paths = pathMap(contract.paths);

  assert.deepEqual(paths.get("$.data[].late_only.level1.level2.level3.level4.level5.level6.level7.level8.level9.level10"), [
    "string",
  ]);
  assert.deepEqual(paths.get("$.data[].variations_warehouses[].warehouse_id"), [
    "null",
    "number",
    "string",
  ]);
  assert.deepEqual(paths.get("$.data[].variations_warehouses[].remain_quantity"), [
    "null",
    "number",
  ]);

  const serialized = JSON.stringify(contract);
  assert.equal(serialized.includes("deep-secret-value"), false);
  assert.equal(serialized.includes("late-product-id"), false);
  assert.equal(serialized.includes("warehouse-text"), false);
});

test("trusted contract discovery fails closed instead of returning partial evidence when its budget is exceeded", () => {
  const secretKey = "must_not_be_echoed_from_budget_failure";
  const secretValue = "must-not-be-echoed-value";

  assert.throws(
    () =>
      describeTrustedJsonContract(
        { root: [{ id: 1 }, { [secretKey]: secretValue }] },
        { maxNodes: 2 },
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /inspection|budget/i);
      assert.equal(error.message.includes(secretKey), false);
      assert.equal(error.message.includes(secretValue), false);
      return true;
    },
  );
});

test("trusted contract discovery fails closed instead of emitting max-depth markers", () => {
  const secretKey = "must_not_be_echoed_from_depth_failure";

  assert.throws(
    () =>
      describeTrustedJsonContract(
        { level1: { level2: { [secretKey]: "deep-value" } } },
        { maxDepth: 1 },
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /depth|budget/i);
      assert.equal(error.message.includes(secretKey), false);
      return true;
    },
  );
});
