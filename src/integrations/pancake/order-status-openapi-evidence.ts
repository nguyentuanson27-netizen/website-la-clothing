type JsonRecord = Record<string, unknown>;
type Primitive = string | number | boolean | null;

export type PancakeOrderStatusOpenApiErrorCode =
  | "MALFORMED_OPENAPI_DOCUMENT"
  | "ORDER_STATUS_OPERATION_NOT_FOUND"
  | "ORDER_STATUS_OPERATION_AMBIGUOUS"
  | "UNSUPPORTED_EXTERNAL_REF"
  | "UNRESOLVED_LOCAL_REF"
  | "CIRCULAR_LOCAL_REF"
  | "OPENAPI_INSPECTION_LIMIT_EXCEEDED";

export class PancakeOrderStatusOpenApiError extends Error {
  readonly code: PancakeOrderStatusOpenApiErrorCode;

  constructor(code: PancakeOrderStatusOpenApiErrorCode) {
    super(code);
    this.name = "PancakeOrderStatusOpenApiError";
    this.code = code;
  }
}

export type PancakeOrderStatusSchemaEvidence = {
  type?: string | string[];
  format?: string;
  enum?: Primitive[];
  required?: string[];
  properties?: Record<string, PancakeOrderStatusSchemaEvidence>;
};

export type PancakeOrderStatusOpenApiInspection = {
  path: string;
  method: "GET";
  parameters: Array<{
    name: string;
    in: string;
    required: boolean;
    schema?: PancakeOrderStatusSchemaEvidence;
  }>;
  responses: Record<
    string,
    {
      content?: Record<string, PancakeOrderStatusSchemaEvidence>;
    }
  >;
};

const ORDER_STATUS_PATH = /^\/shops\/\{([^/{}]+)\}\/orders\/\{([^/{}]+)\}\/?$/;
const SELECTED_RESPONSE_PROPERTIES = [
  "id",
  "system_id",
  "shop_id",
  "status",
  "inserted_at",
  "updated_at",
] as const;
const SELECTED_RESPONSE_PROPERTY_SET = new Set<string>(SELECTED_RESPONSE_PROPERTIES);
const PARAMETER_LOCATIONS = new Set(["query", "header", "path", "cookie"]);
const NON_STRUCTURAL_SCHEMA_REF_SIBLINGS = new Set([
  "title",
  "description",
  "$comment",
  "default",
  "examples",
  "example",
  "deprecated",
  "readOnly",
  "writeOnly",
]);
const MAX_WORK_UNITS = 10_000;
const MAX_REF_DEPTH = 32;
const MAX_ENUM_VALUES = 256;
const MAX_ENUM_STRING_LENGTH = 128;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(code: PancakeOrderStatusOpenApiErrorCode): never {
  throw new PancakeOrderStatusOpenApiError(code);
}

class Inspector {
  private work = 0;
  private readonly document: JsonRecord;

  constructor(document: JsonRecord) {
    this.document = document;
  }

  charge(units = 1): void {
    this.work += units;
    if (this.work > MAX_WORK_UNITS) fail("OPENAPI_INSPECTION_LIMIT_EXCEEDED");
  }

  private assertSafeSchemaRefSiblings(source: JsonRecord): void {
    for (const key of Object.keys(source)) {
      this.charge();
      if (
        key === "$ref" ||
        key.startsWith("x-") ||
        NON_STRUCTURAL_SCHEMA_REF_SIBLINGS.has(key)
      ) {
        continue;
      }
      fail("MALFORMED_OPENAPI_DOCUMENT");
    }
  }

  resolve(value: unknown, stack: readonly string[] = [], schemaContext = false): unknown {
    let current = value;
    const seen = new Set(stack);
    let depth = stack.length;

    while (isRecord(current) && Object.hasOwn(current, "$ref")) {
      this.charge();
      if (schemaContext) this.assertSafeSchemaRefSiblings(current);
      if (typeof current.$ref !== "string") fail("MALFORMED_OPENAPI_DOCUMENT");
      const ref = current.$ref;
      if (!ref.startsWith("#/")) fail("UNSUPPORTED_EXTERNAL_REF");
      if (seen.has(ref)) fail("CIRCULAR_LOCAL_REF");
      depth += 1;
      if (depth > MAX_REF_DEPTH) fail("OPENAPI_INSPECTION_LIMIT_EXCEEDED");
      seen.add(ref);

      let target: unknown = this.document;
      for (const encoded of ref.slice(2).split("/")) {
        this.charge();
        if (!isRecord(target)) fail("UNRESOLVED_LOCAL_REF");
        const segment = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
        if (!Object.hasOwn(target, segment)) fail("UNRESOLVED_LOCAL_REF");
        target = target[segment];
      }
      current = target;
    }

    return current;
  }

  object(value: unknown): JsonRecord {
    this.charge();
    const resolved = this.resolve(value);
    if (!isRecord(resolved)) fail("MALFORMED_OPENAPI_DOCUMENT");
    return resolved;
  }

  schema(value: unknown, includeSelectedProperties = false): PancakeOrderStatusSchemaEvidence {
    this.charge();
    const resolved = this.resolve(value, [], true);
    if (!isRecord(resolved)) fail("MALFORMED_OPENAPI_DOCUMENT");
    const source = resolved;
    const result: PancakeOrderStatusSchemaEvidence = {};

    if (typeof source.type === "string") {
      result.type = source.type;
    } else if (Array.isArray(source.type)) {
      const types: string[] = [];
      for (const entry of source.type) {
        this.charge();
        if (typeof entry !== "string") fail("MALFORMED_OPENAPI_DOCUMENT");
        types.push(entry);
      }
      result.type = types;
    }

    if (typeof source.format === "string") result.format = source.format;

    if (source.enum !== undefined) {
      if (!Array.isArray(source.enum) || source.enum.length > MAX_ENUM_VALUES) {
        fail("MALFORMED_OPENAPI_DOCUMENT");
      }
      const values: Primitive[] = [];
      for (const entry of source.enum) {
        this.charge();
        if (
          entry !== null &&
          typeof entry !== "string" &&
          typeof entry !== "number" &&
          typeof entry !== "boolean"
        ) {
          fail("MALFORMED_OPENAPI_DOCUMENT");
        }
        if (typeof entry === "string" && entry.length > MAX_ENUM_STRING_LENGTH) {
          fail("MALFORMED_OPENAPI_DOCUMENT");
        }
        if (typeof entry === "number" && !Number.isFinite(entry)) {
          fail("MALFORMED_OPENAPI_DOCUMENT");
        }
        values.push(entry);
      }
      result.enum = values;
    }

    if (includeSelectedProperties) {
      if (!isRecord(source.properties)) fail("MALFORMED_OPENAPI_DOCUMENT");
      const properties: Record<string, PancakeOrderStatusSchemaEvidence> = {};
      for (const name of SELECTED_RESPONSE_PROPERTIES) {
        this.charge();
        if (!Object.hasOwn(source.properties, name)) fail("MALFORMED_OPENAPI_DOCUMENT");
        properties[name] = this.schema(source.properties[name]);
      }
      result.properties = properties;

      if (source.required !== undefined) {
        if (!Array.isArray(source.required)) fail("MALFORMED_OPENAPI_DOCUMENT");
        const required: string[] = [];
        for (const entry of source.required) {
          this.charge();
          if (typeof entry !== "string") fail("MALFORMED_OPENAPI_DOCUMENT");
          if (SELECTED_RESPONSE_PROPERTY_SET.has(entry)) required.push(entry);
        }
        result.required = required;
      }
    }

    return result;
  }
}

function inspectParameter(inspector: Inspector, value: unknown) {
  const source = inspector.object(value);
  if (
    typeof source.name !== "string" ||
    typeof source.in !== "string" ||
    !PARAMETER_LOCATIONS.has(source.in) ||
    (source.required !== undefined && typeof source.required !== "boolean") ||
    (source.in === "path" && source.required !== true)
  ) {
    fail("MALFORMED_OPENAPI_DOCUMENT");
  }

  return {
    name: source.name,
    in: source.in,
    required: source.required === true,
    ...(source.schema === undefined ? {} : { schema: inspector.schema(source.schema) }),
  };
}

function inspectParameterLevel(inspector: Inspector, value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) fail("MALFORMED_OPENAPI_DOCUMENT");

  const result: ReturnType<typeof inspectParameter>[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    inspector.charge();
    const parameter = inspectParameter(inspector, raw);
    const key = `${parameter.in}\u0000${parameter.name}`;
    if (seen.has(key)) fail("MALFORMED_OPENAPI_DOCUMENT");
    seen.add(key);
    result.push(parameter);
  }
  return result;
}

function effectiveParameters(inspector: Inspector, pathItem: JsonRecord, operation: JsonRecord) {
  const byKey = new Map<string, ReturnType<typeof inspectParameter>>();
  for (const parameter of inspectParameterLevel(inspector, pathItem.parameters)) {
    byKey.set(`${parameter.in}\u0000${parameter.name}`, parameter);
  }
  for (const parameter of inspectParameterLevel(inspector, operation.parameters)) {
    byKey.set(`${parameter.in}\u0000${parameter.name}`, parameter);
  }
  return [...byKey.values()];
}

function assertExactPathParameters(
  parameters: ReturnType<typeof effectiveParameters>,
  shopParameterName: string,
  orderParameterName: string,
): void {
  const expected = new Set([shopParameterName, orderParameterName]);
  const seen = new Set<string>();
  for (const parameter of parameters) {
    if (parameter.in !== "path") continue;
    if (!expected.has(parameter.name)) fail("MALFORMED_OPENAPI_DOCUMENT");
    seen.add(parameter.name);
  }
  if (seen.size !== 2) fail("MALFORMED_OPENAPI_DOCUMENT");
}

export function inspectPancakeOrderStatusOpenApi(
  document: unknown,
): PancakeOrderStatusOpenApiInspection {
  if (!isRecord(document) || typeof document.openapi !== "string" || !isRecord(document.paths)) {
    fail("MALFORMED_OPENAPI_DOCUMENT");
  }

  const inspector = new Inspector(document);
  let match:
    | {
        path: string;
        shopParameterName: string;
        orderParameterName: string;
        pathItem: JsonRecord;
        operation: JsonRecord;
      }
    | undefined;

  for (const path in document.paths) {
    inspector.charge();
    if (!Object.hasOwn(document.paths, path)) continue;
    const pathMatch = ORDER_STATUS_PATH.exec(path);
    if (!pathMatch) continue;

    const rawPathItem = document.paths[path];
    if (!isRecord(rawPathItem) || Object.hasOwn(rawPathItem, "$ref")) {
      fail("MALFORMED_OPENAPI_DOCUMENT");
    }
    const pathItem = inspector.object(rawPathItem);
    if (!isRecord(pathItem.get)) continue;
    if (match !== undefined) fail("ORDER_STATUS_OPERATION_AMBIGUOUS");
    if (Object.hasOwn(pathItem, "servers")) fail("MALFORMED_OPENAPI_DOCUMENT");
    if (Object.hasOwn(pathItem.get, "security") || Object.hasOwn(pathItem.get, "servers")) {
      fail("MALFORMED_OPENAPI_DOCUMENT");
    }

    match = {
      path,
      shopParameterName: pathMatch[1],
      orderParameterName: pathMatch[2],
      pathItem,
      operation: pathItem.get,
    };
  }

  if (!match) fail("ORDER_STATUS_OPERATION_NOT_FOUND");

  const parameters = effectiveParameters(inspector, match.pathItem, match.operation);
  assertExactPathParameters(parameters, match.shopParameterName, match.orderParameterName);

  if (!isRecord(match.operation.responses)) fail("MALFORMED_OPENAPI_DOCUMENT");
  const statuses = Object.keys(match.operation.responses).sort();
  for (const _status of statuses) inspector.charge();
  const response200 = match.operation.responses["200"];
  if (response200 === undefined) fail("MALFORMED_OPENAPI_DOCUMENT");
  const response = inspector.object(response200);
  if (!isRecord(response.content) || !isRecord(response.content["application/json"])) {
    fail("MALFORMED_OPENAPI_DOCUMENT");
  }
  const media = response.content["application/json"];
  if (!isRecord(media) || media.schema === undefined) fail("MALFORMED_OPENAPI_DOCUMENT");
  const responseSchema = inspector.schema(media.schema, true);

  const responses: PancakeOrderStatusOpenApiInspection["responses"] = {};
  for (const status of statuses) {
    responses[status] =
      status === "200"
        ? { content: { "application/json": responseSchema } }
        : {};
  }

  return {
    path: match.path,
    method: "GET",
    parameters,
    responses,
  };
}
