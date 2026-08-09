import assert from "node:assert/strict";
import test from "node:test";

import { describeJsonShape } from "../../src/integrations/pancake/json-shape.ts";

test("describes external JSON structure without retaining scalar values", () => {
  const payload = {
    success: true,
    token_like_value: "super-secret-value",
    products: [
      {
        id: "product-123",
        price: 790000,
        active: true,
        nullable: null,
        warehouses: [
          { warehouse_id: "warehouse-a", quantity: 5 },
          { warehouse_id: "warehouse-b", quantity: 0 },
        ],
      },
    ],
  };

  const shape = describeJsonShape(payload);
  const serialized = JSON.stringify(shape);

  assert.equal(serialized.includes("super-secret-value"), false);
  assert.equal(serialized.includes("product-123"), false);
  assert.equal(serialized.includes("warehouse-a"), false);
  assert.equal(serialized.includes("790000"), false);
  assert.equal(serialized.includes('"quantity"'), true);
  assert.equal(serialized.includes('"number"'), true);
  assert.equal(serialized.includes('"boolean"'), true);
  assert.equal(serialized.includes('"null"'), true);
});

test("redacts data-like object keys before shape serialization", () => {
  const payload = {
    safe_schema_key: true,
    "customer@email.com": { value: 1 },
    "SKU-PRIVATE-123": { value: 2 },
    "dynamic-token-value": { value: 3 },
  };

  const serialized = JSON.stringify(describeJsonShape(payload));

  assert.equal(serialized.includes("customer@email.com"), false);
  assert.equal(serialized.includes("SKU-PRIVATE-123"), false);
  assert.equal(serialized.includes("dynamic-token-value"), false);
  assert.equal(serialized.includes('"safe_schema_key"'), true);
  assert.equal(serialized.includes('"<dynamic-key>"'), true);
});

test("redacts identifier-shaped external keys because syntax does not prove metadata", () => {
  const payload = {
    sk_live_ABC123SECRET: { value: 1 },
    Customer123456789: { value: 2 },
    eyJhbGciOiJIUzI1NiJ9: { value: 3 },
  };

  const serialized = JSON.stringify(describeJsonShape(payload));

  assert.equal(serialized.includes("sk_live_ABC123SECRET"), false);
  assert.equal(serialized.includes("Customer123456789"), false);
  assert.equal(serialized.includes("eyJhbGciOiJIUzI1NiJ9"), false);
});

test("caps inspected object fields and marks the object shape truncated", () => {
  const shape = describeJsonShape(
    {
      alpha: 1,
      beta: 2,
      gamma: 3,
    },
    { maxObjectFields: 2 },
  );

  assert.deepEqual(shape, {
    type: "object",
    fields: {
      alpha: "number",
      beta: "number",
    },
    truncated: true,
  });
});

test("deduplicates repeated array item shapes and caps distinct shapes", () => {
  const payload = [
    { id: "a", value: 1 },
    { id: "b", value: 2 },
    { id: 3, value: "different" },
    { id: true, value: null },
    { id: null, value: false },
  ];

  const shape = describeJsonShape(payload, { maxDistinctArrayShapes: 2 });

  assert.deepEqual(shape, {
    type: "array",
    itemShapes: [
      {
        type: "object",
        fields: {
          id: "string",
          value: "number",
        },
      },
      {
        type: "object",
        fields: {
          id: "number",
          value: "string",
        },
      },
    ],
    truncated: true,
  });
});

test("canonicalizes bounded object fields before array shape fingerprinting", () => {
  const shape = describeJsonShape([
    { alpha: 1, beta: 2 },
    { beta: 3, alpha: 4 },
  ]);

  assert.deepEqual(shape, {
    type: "array",
    itemShapes: [
      {
        type: "object",
        fields: {
          alpha: "number",
          beta: "number",
        },
      },
    ],
    truncated: false,
  });
});

test("stops at the configured nesting depth instead of expanding indefinitely", () => {
  const shape = describeJsonShape(
    { level1: { level2: { secret: "must-not-appear" } } },
    { maxDepth: 2 },
  );

  assert.deepEqual(shape, {
    type: "object",
    fields: {
      level1: {
        type: "object",
        fields: {
          level2: "max-depth",
        },
      },
    },
  });
  assert.equal(JSON.stringify(shape).includes("must-not-appear"), false);
});
