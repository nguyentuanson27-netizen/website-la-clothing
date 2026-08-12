import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectPancakeGeoOpenApi,
  PancakeOrderOpenApiError,
} from "../../src/integrations/pancake/order-openapi-contract.ts";

const syntheticOpenApi = {
  openapi: "3.1.0",
  paths: {
    "/geo/provinces": {
      get: {
        parameters: [
          {
            name: "country_code",
            in: "query",
            required: false,
            schema: { type: "string", example: "external-country" },
          },
        ],
        responses: {
          "200": {
            description: "external province response description",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Province" },
                },
                example: [{ id: "external-province-id", name: "External Province" }],
              },
            },
          },
        },
      },
    },
    "/geo/districts": {
      get: {
        parameters: [
          {
            $ref: "#/components/parameters/ProvinceFilter",
          },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/District" },
                },
              },
            },
          },
        },
      },
    },
    "/geo/communes": {
      get: {
        parameters: [
          {
            name: "district_ref",
            in: "query",
            required: true,
            schema: { type: "string", default: "external-district" },
          },
        ],
        responses: {
          "200": {
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Commune" },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    parameters: {
      ProvinceFilter: {
        name: "province_ref",
        in: "query",
        required: true,
        schema: { type: "string" },
      },
    },
    schemas: {
      Province: {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "string", example: "external-province-id" },
          name: { type: "string", example: "External Province" },
          code: { type: "integer" },
        },
      },
      District: {
        type: "object",
        required: ["id", "name", "province_ref"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          province_ref: { type: "string" },
        },
      },
      Commune: {
        type: "object",
        required: ["id", "name", "district_ref"],
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          district_ref: { type: "string" },
        },
      },
    },
  },
};

test("inspects all Pancake geo GET operations without guessing child lookup parameter names", () => {
  const result = inspectPancakeGeoOpenApi(syntheticOpenApi);

  assert.deepEqual(result, {
    provinces: {
      path: "/geo/provinces",
      method: "GET",
      parameters: [
        {
          name: "country_code",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          content: {
            "application/json": {
              type: "array",
              items: {
                type: "object",
                required: ["id", "name"],
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  code: { type: "integer" },
                },
              },
            },
          },
        },
      },
    },
    districts: {
      path: "/geo/districts",
      method: "GET",
      parameters: [
        {
          name: "province_ref",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          content: {
            "application/json": {
              type: "array",
              items: {
                type: "object",
                required: ["id", "name", "province_ref"],
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  province_ref: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    communes: {
      path: "/geo/communes",
      method: "GET",
      parameters: [
        {
          name: "district_ref",
          in: "query",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        "200": {
          content: {
            "application/json": {
              type: "array",
              items: {
                type: "object",
                required: ["id", "name", "district_ref"],
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  district_ref: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  });

  const rendered = JSON.stringify(result);
  assert.equal(rendered.includes("external-country"), false);
  assert.equal(rendered.includes("external-district"), false);
  assert.equal(rendered.includes("external-province-id"), false);
  assert.equal(rendered.includes("External Province"), false);
  assert.equal(rendered.includes("external province response description"), false);
});

test("fails closed when any required geo operation is missing", () => {
  const document = structuredClone(syntheticOpenApi);
  delete (document.paths as Record<string, unknown>)["/geo/communes"];

  assert.throws(
    () => inspectPancakeGeoOpenApi(document),
    (error: unknown) =>
      error instanceof PancakeOrderOpenApiError &&
      error.code === "GEO_OPERATION_SET_INCOMPLETE",
  );
});

test("fails closed when duplicate slash variants make a geo operation ambiguous", () => {
  const document = structuredClone(syntheticOpenApi);
  (document.paths as Record<string, unknown>)["/geo/districts/"] =
    (document.paths as Record<string, unknown>)["/geo/districts"];

  assert.throws(
    () => inspectPancakeGeoOpenApi(document),
    (error: unknown) =>
      error instanceof PancakeOrderOpenApiError &&
      error.code === "GEO_OPERATION_AMBIGUOUS",
  );
});

test("geo inspection inherits bounded local-ref failures", () => {
  const document = structuredClone(syntheticOpenApi);
  const districts = (
    document.paths as unknown as Record<string, { get: { parameters: unknown[] } }>
  )["/geo/districts"];
  districts.get.parameters = [{ $ref: "https://example.test/parameter.json" }];

  assert.throws(
    () => inspectPancakeGeoOpenApi(document),
    (error: unknown) =>
      error instanceof PancakeOrderOpenApiError && error.code === "UNSUPPORTED_EXTERNAL_REF",
  );
});
