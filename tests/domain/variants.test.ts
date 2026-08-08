import assert from "node:assert/strict";
import test from "node:test";

import { findPurchasableVariant } from "../../src/domain/variants.ts";

const variants = [
  { id: "black-m", color: "Black", size: "M", availableQuantity: 3, active: true },
  { id: "black-l", color: "Black", size: "L", availableQuantity: 0, active: true },
  { id: "white-m", color: "White", size: "M", availableQuantity: 5, active: false },
];

test("returns the matching in-stock active variant", () => {
  assert.equal(findPurchasableVariant(variants, "Black", "M")?.id, "black-m");
});

test("rejects a matching variant when stock is zero", () => {
  assert.equal(findPurchasableVariant(variants, "Black", "L"), undefined);
});

test("rejects a matching variant when it is inactive", () => {
  assert.equal(findPurchasableVariant(variants, "White", "M"), undefined);
});
