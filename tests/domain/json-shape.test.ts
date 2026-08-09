import assert from "node:assert/strict";
import test from "node:test";

import * as jsonShapeModule from "../../src/integrations/pancake/json-shape.ts";

const { describeJsonShape, describeReviewedJsonShape } = jsonShapeModule;

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

  const shape = describeJsonShape(payload, {
    allowedObjectKeys: [
      "success",
      "token_like_value",
      "products",
      "id",
      "price",
      "active",
      "nullable",
      "warehouses",
      "warehouse_id",
      "quantity",
    ],
  });
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

test("redacts non-allowlisted object keys before shape serialization", () => {
  const payload = {
    safe_schema_key: true,
    "customer@email.com": { value: 1 },
    "SKU-PRIVATE-123": { value: 2 },
    "dynamic-token-value": { value: 3 },
  };

  const serialized = JSON.stringify(
    describeJsonShape(payload, { allowedObjectKeys: ["safe_schema_key"] }),
  );

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
  assert.equal(serialized.includes('"<dynamic-key>"'), true);
});

test("trusted discovery preserves exact field names and value types without scalar values", () => {
  const describeTrustedJsonShape = Reflect.get(jsonShapeModule, "describeTrustedJsonShape");

  assert.equal(typeof describeTrustedJsonShape, "function");

  const shape = describeTrustedJsonShape({
    id: "p1",
    price: 790000,
    active: true,
  });

  assert.deepEqual(shape, {
    type: "object",
    fields: {
      active: "boolean",
      id: "string",
      price: "number",
    },
  });
  assert.equal(JSON.stringify(shape).includes("p1"), false);
  assert.equal(JSON.stringify(shape).includes("790000"), false);
});

test("reviewed-contract verification rejects an unknown object key without echoing it", () => {
  const unknownKey = "sk_live_ABC123SECRET";

  assert.throws(
    () =>
      describeReviewedJsonShape(
        { success: true, [unknownKey]: "value" },
        { allowedObjectKeys: ["success"] },
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(unknownKey), false);
      return true;
    },
  );
});

test("reviewed-contract verification reaches unknown keys after the rendered array sample", () => {
  const unknownKey = "secret_identifier_after_sample";
  const payload = Array.from({ length: 51 }, (_, index) =>
    index === 50 ? { id: "late", [unknownKey]: true } : { id: `item-${index}` },
  );

  assert.throws(
    () =>
      describeReviewedJsonShape(payload, {
        allowedObjectKeys: ["id"],
        maxArrayItems: 50,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(unknownKey), false);
      return true;
    },
  );
});

test("reviewed-contract verification reaches unknown keys below the rendered depth limit", () => {
  const unknownKey = "secret_identifier_below_depth";
  const payload = {
    level1: {
      level2: {
        [unknownKey]: "hidden",
      },
    },
  };

  assert.throws(
    () =>
      describeReviewedJsonShape(payload, {
        allowedObjectKeys: ["level1", "level2"],
        maxDepth: 2,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(unknownKey), false);
      return true;
    },
  );
});

test("reviewed-contract verification fails closed when the full-validation work budget is exceeded", () => {
  const payload = [{ id: "a" }, { id: "b" }, { id: "c" }];

  assert.throws(
    () =>
      describeReviewedJsonShape(payload, {
        allowedObjectKeys: ["id"],
        maxArrayItems: 1,
        maxValidationNodes: 2,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /validation|inspection|budget/i);
      assert.equal(error.message.includes("a"), false);
      assert.equal(error.message.includes("b"), false);
      assert.equal(error.message.includes("c"), false);
      return true;
    },
  );
});

test("caps inspected object fields and marks the object shape truncated", () => {
  const shape = describeJsonShape(
    {
      alpha: 1,
      beta: 2,
      gamma: 3,
    },
    {
      maxObjectFields: 2,
      allowedObjectKeys: ["alpha", "beta", "gamma"],
    },
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

  const shape = describeJsonShape(payload, {
    maxDistinctArrayShapes: 2,
    allowedObjectKeys: ["id", "value"],
  });

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
  const shape = describeJsonShape(
    [
      { alpha: 1, beta: 2 },
      { beta: 3, alpha: 4 },
    ],
    { allowedObjectKeys: ["alpha", "beta"] },
  );

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
    {
      maxDepth: 2,
      allowedObjectKeys: ["level1", "level2"],
    },
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
