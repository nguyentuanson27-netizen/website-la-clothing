import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildPancakeOrderStatusEvidenceEnvelope,
} from "../../scripts/pancake-order-status-openapi-inspect.ts";
import {
  inspectPancakeOrderStatusOpenApi,
  PancakeOrderStatusOpenApiError,
} from "../../src/integrations/pancake/order-status-openapi-evidence.ts";

const STATUS_CODES = [0, 17, 11, 12, 13, 20, 1, 8, 9, 2, 3, 16, 4, 15, 5, 6, 7];

function evidenceDocument() {
  return {
    openapi: "3.1.0",
    info: { title: "Pancake POS Open API", version: "1.0.0" },
    servers: [{ url: "https://pos.pages.fm/api/v1", description: "do-not-emit" }],
    security: [{ ApiKeyAuth: [] }],
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: "apiKey", in: "query", name: "api_key", description: "do-not-emit" },
      },
      schemas: {
        OrderStatusCode: { type: "integer" },
      },
    },
    paths: {
      "/shops/{SHOP_ID}/orders/{ORDER_ID}": {
        get: {
          parameters: [
            {
              name: "SHOP_ID",
              in: "path",
              required: true,
              schema: { type: "integer", example: 920007 },
            },
            {
              name: "ORDER_ID",
              in: "path",
              required: true,
              schema: { type: "string", example: "987654321" },
            },
          ],
          responses: {
            "200": {
              description: "do-not-emit",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      id: { type: "integer", example: 987654321 },
                      system_id: { type: "integer", example: 123456 },
                      shop_id: { type: "integer", example: 920007 },
                      status: {
                        type: "integer",
                        enum: STATUS_CODES,
                        description: "do-not-emit",
                      },
                      inserted_at: {
                        type: "string",
                        format: "date-time",
                        example: "2026-08-12T10:00:00Z",
                      },
                      updated_at: {
                        type: "string",
                        format: "date-time",
                        example: "2026-08-12T10:01:00Z",
                      },
                      customer: {
                        type: "object",
                        properties: {
                          name: { type: "string", example: "real-person-must-not-emit" },
                          phone: { type: "string", example: "0900000000" },
                        },
                      },
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
}

test("order-status structural inspection preserves the primitive status enum but strips samples and descriptions", () => {
  const inspection = inspectPancakeOrderStatusOpenApi(evidenceDocument());
  const schema = inspection.responses["200"].content?.["application/json"];

  assert.equal(inspection.path, "/shops/{SHOP_ID}/orders/{ORDER_ID}");
  assert.equal(inspection.method, "GET");
  assert.deepEqual(schema?.properties?.status?.enum, STATUS_CODES);
  assert.equal(Object.hasOwn(schema?.properties?.status ?? {}, "description"), false);
  assert.equal(Object.hasOwn(schema?.properties?.status ?? {}, "example"), false);
});

test("order-status inspection fails closed instead of silently dropping a selected Schema $ref enum sibling", () => {
  const document = evidenceDocument();
  const statusSchema = document.paths["/shops/{SHOP_ID}/orders/{ORDER_ID}"].get.responses["200"].content[
    "application/json"
  ].schema.properties.status as Record<string, unknown>;
  delete statusSchema.type;
  statusSchema.$ref = "#/components/schemas/OrderStatusCode";

  assert.throws(
    () => inspectPancakeOrderStatusOpenApi(document),
    (error: unknown) =>
      error instanceof PancakeOrderStatusOpenApiError &&
      error.code === "MALFORMED_OPENAPI_DOCUMENT",
  );
});

test("sanitized order-status evidence is deterministic, fingerprinted, and excludes customer PII", () => {
  const document = evidenceDocument();
  const source = Buffer.from(JSON.stringify(document));
  const evidence = buildPancakeOrderStatusEvidenceEnvelope(source, document);

  assert.equal(evidence.source.sha256, createHash("sha256").update(source).digest("hex"));
  assert.equal(evidence.source.bytes, source.length);
  assert.deepEqual(evidence.auth, { type: "apiKey", in: "query", name: "api_key" });
  assert.equal(evidence.operation.path, "/shops/{SHOP_ID}/orders/{ORDER_ID}");
  assert.equal(evidence.operation.method, "GET");
  assert.deepEqual(
    evidence.operation.pathParameters.map(({ name, type }) => ({ name, type })),
    [
      { name: "SHOP_ID", type: "integer" },
      { name: "ORDER_ID", type: "string" },
    ],
  );
  assert.deepEqual(evidence.operation.response.selectedProperties, {
    id: { type: "integer" },
    system_id: { type: "integer" },
    shop_id: { type: "integer" },
    status: { type: "integer", enum: STATUS_CODES },
    inserted_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  });

  const serialized = JSON.stringify(evidence);
  assert.equal(serialized.includes("customer"), false);
  assert.equal(serialized.includes("real-person-must-not-emit"), false);
  assert.equal(serialized.includes("do-not-emit"), false);
  assert.equal(serialized.includes("0900000000"), false);
});

test("order-status inspection fails closed on ambiguous matching GET operations", () => {
  const document = evidenceDocument();
  const paths = document.paths as Record<string, unknown>;
  paths["/shops/{SHOP_ID}/orders/{ORDER_ID}/"] = paths["/shops/{SHOP_ID}/orders/{ORDER_ID}"];

  assert.throws(
    () => inspectPancakeOrderStatusOpenApi(document),
    (error: unknown) =>
      error instanceof PancakeOrderStatusOpenApiError &&
      error.code === "ORDER_STATUS_OPERATION_AMBIGUOUS",
  );
});
