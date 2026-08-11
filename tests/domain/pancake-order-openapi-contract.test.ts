import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectPancakeCreateOrderOpenApi,
  PancakeOrderOpenApiError,
} from "../../src/integrations/pancake/order-openapi-contract.ts";

const syntheticOpenApi = {
  openapi: "3.0.3",
  paths: {
    "/shops/{shop_id}/orders": {
      post: {
        parameters: [
          {
            name: "shop_id",
            in: "path",
            required: true,
            schema: { type: "integer", example: 999999 },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateOrderRequest" },
              example: { customer: { name: "external-customer-name" } },
            },
          },
        },
        responses: {
          "200": {
            description: "contains external text that must not be copied",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateOrderResponse" },
                example: { order: { id: "real-external-order-id" } },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      CreateOrderRequest: {
        type: "object",
        required: ["customer", "items"],
        properties: {
          customer: {
            type: "object",
            required: ["name", "phone"],
            properties: {
              name: { type: "string", example: "external-customer-name" },
              phone: { type: "string", default: "0900000000" },
            },
          },
          items: {
            type: "array",
            items: {
              type: "object",
              required: ["variation_id", "quantity"],
              properties: {
                variation_id: { type: "string" },
                quantity: { type: "integer", minimum: 1 },
              },
            },
          },
        },
      },
      CreateOrderResponse: {
        type: "object",
        required: ["order"],
        properties: {
          order: {
            type: "object",
            required: ["id"],
            properties: {
              id: { type: "string", example: "real-external-order-id" },
            },
          },
        },
      },
    },
  },
};

test("inspects only structural create-order request/response contract and resolves local refs", () => {
  const result = inspectPancakeCreateOrderOpenApi(syntheticOpenApi);

  assert.equal(result.path, "/shops/{shop_id}/orders");
  assert.equal(result.method, "POST");
  assert.deepEqual(result.parameters, [
    {
      name: "shop_id",
      in: "path",
      required: true,
      schema: { type: "integer" },
    },
  ]);

  assert.deepEqual(result.requestBody, {
    required: true,
    content: {
      "application/json": {
        type: "object",
        required: ["customer", "items"],
        properties: {
          customer: {
            type: "object",
            required: ["name", "phone"],
            properties: {
              name: { type: "string" },
              phone: { type: "string" },
            },
          },
          items: {
            type: "array",
            items: {
              type: "object",
              required: ["variation_id", "quantity"],
              properties: {
                variation_id: { type: "string" },
                quantity: { type: "integer" },
              },
            },
          },
        },
      },
    },
  });

  assert.deepEqual(result.responses, {
    "200": {
      content: {
        "application/json": {
          type: "object",
          required: ["order"],
          properties: {
            order: {
              type: "object",
              required: ["id"],
              properties: { id: { type: "string" } },
            },
          },
        },
      },
    },
  });

  const rendered = JSON.stringify(result);
  assert.equal(rendered.includes("external-customer-name"), false);
  assert.equal(rendered.includes("0900000000"), false);
  assert.equal(rendered.includes("real-external-order-id"), false);
  assert.equal(rendered.includes("contains external text"), false);
});

test("matches the create-order route without guessing the path parameter name", () => {
  const document = {
    openapi: "3.1.0",
    paths: {
      "/shops/{SHOP_ID}/orders": {
        post: {
          responses: { "201": { description: "created" } },
        },
      },
    },
  };

  const result = inspectPancakeCreateOrderOpenApi(document);
  assert.equal(result.path, "/shops/{SHOP_ID}/orders");
  assert.deepEqual(result.responses, { "201": {} });
});

test("fails closed when the create-order operation is absent or ambiguous", () => {
  assert.throws(
    () => inspectPancakeCreateOrderOpenApi({ openapi: "3.0.0", paths: {} }),
    (error: unknown) =>
      error instanceof PancakeOrderOpenApiError && error.code === "CREATE_ORDER_OPERATION_NOT_FOUND",
  );

  const ambiguous = {
    openapi: "3.0.0",
    paths: {
      "/shops/{shop_id}/orders": { post: { responses: {} } },
      "/shops/{id}/orders/": { post: { responses: {} } },
    },
  };
  assert.throws(
    () => inspectPancakeCreateOrderOpenApi(ambiguous),
    (error: unknown) =>
      error instanceof PancakeOrderOpenApiError && error.code === "CREATE_ORDER_OPERATION_AMBIGUOUS",
  );
});

test("rejects external refs and malformed schema nodes instead of following or coercing them", () => {
  const externalRef = structuredClone(syntheticOpenApi);
  externalRef.paths["/shops/{shop_id}/orders"].post.requestBody.content[
    "application/json"
  ].schema = { $ref: "https://example.invalid/order-schema.json" };

  assert.throws(
    () => inspectPancakeCreateOrderOpenApi(externalRef),
    (error: unknown) =>
      error instanceof PancakeOrderOpenApiError && error.code === "UNSUPPORTED_EXTERNAL_REF",
  );

  const malformed = structuredClone(syntheticOpenApi) as Record<string, unknown>;
  Reflect.set(malformed, "paths", []);
  assert.throws(
    () => inspectPancakeCreateOrderOpenApi(malformed),
    (error: unknown) =>
      error instanceof PancakeOrderOpenApiError && error.code === "MALFORMED_OPENAPI_DOCUMENT",
  );
});

test("resolves chained local refs before inspecting structural schema", () => {
  const document = {
    openapi: "3.1.0",
    paths: {
      "/shops/{SHOP_ID}/orders": {
        post: {
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateOrderAlias" },
              },
            },
          },
          responses: { "201": { description: "created" } },
        },
      },
    },
    components: {
      schemas: {
        CreateOrderAlias: { $ref: "#/components/schemas/CreateOrderRequest" },
        CreateOrderRequest: {
          type: "object",
          required: ["items"],
          properties: {
            items: { type: "array", items: { type: "object" } },
          },
        },
      },
    },
  };

  const result = inspectPancakeCreateOrderOpenApi(document);
  assert.deepEqual(result.requestBody?.content["application/json"], {
    type: "object",
    required: ["items"],
    properties: {
      items: { type: "array", items: { type: "object" } },
    },
  });
});

test("fails closed for circular local refs instead of returning an empty schema", () => {
  const document = {
    openapi: "3.1.0",
    paths: {
      "/shops/{SHOP_ID}/orders": {
        post: {
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/A" },
              },
            },
          },
          responses: { "201": { description: "created" } },
        },
      },
    },
    components: {
      schemas: {
        A: { $ref: "#/components/schemas/B" },
        B: { $ref: "#/components/schemas/A" },
      },
    },
  };

  assert.throws(
    () => inspectPancakeCreateOrderOpenApi(document),
    (error: unknown) =>
      error instanceof PancakeOrderOpenApiError && error.code === "CIRCULAR_LOCAL_REF",
  );
});
