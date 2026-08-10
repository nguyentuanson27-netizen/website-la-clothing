import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  parsePancakeCatalogVariations,
  parsePancakeWarehouses,
} from "../../src/integrations/pancake/catalog-contract.ts";

function readFixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../fixtures/pancake/${name}`, import.meta.url), "utf8"),
  ) as unknown;
}

test("sanitized Pancake product-variation fixture remains compatible with the reviewed parser", () => {
  const variations = parsePancakeCatalogVariations(readFixture("product-variations.json"));

  assert.equal(variations.length, 1);
  assert.equal(variations[0]?.sellableStock, 7);
  assert.equal(variations[0]?.product.name, "Sanitized Test Shirt");
});

test("sanitized Pancake warehouse fixture remains compatible with the reviewed parser", () => {
  assert.deepEqual(parsePancakeWarehouses(readFixture("warehouses.json")), [
    {
      id: "warehouse-fixture-a",
      name: "Sanitized Warehouse A",
      allowCreateOrder: true,
    },
  ]);
});
