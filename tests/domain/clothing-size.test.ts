import assert from "node:assert/strict";
import test from "node:test";

import { compareClothingSizes, sortClothingSizes } from "../../src/commerce/clothing-size.ts";

test("sortClothingSizes sorts standard apparel letter sizes in natural order", () => {
  const input = ["L", "M", "XL", "S", "XXL"];
  assert.deepEqual(sortClothingSizes(input), ["S", "M", "L", "XL", "XXL"]);

  const extended = ["3XL", "XS", "XXL", "M", "2XS", "L", "S", "XL", "Freesize"];
  assert.deepEqual(sortClothingSizes(extended), [
    "2XS",
    "XS",
    "S",
    "M",
    "L",
    "XL",
    "XXL",
    "3XL",
    "Freesize",
  ]);
});

test("sortClothingSizes sorts numeric clothing sizes in ascending order", () => {
  const numeric = ["32", "28", "30", "29", "31"];
  assert.deepEqual(sortClothingSizes(numeric), ["28", "29", "30", "31", "32"]);
});

test("sortClothingSizes places standard letter sizes before numeric and unknown sizes", () => {
  const mixed = ["Custom", "30", "M", "28", "S"];
  assert.deepEqual(sortClothingSizes(mixed), ["S", "M", "28", "30", "Custom"]);
});
