type JsonRecord = Record<string, unknown>;

export type PancakeOrderOpenApiErrorCode =
  | "MALFORMED_OPENAPI_DOCUMENT"
  | "CREATE_ORDER_OPERATION_NOT_FOUND"
  | "CREATE_ORDER_OPERATION_AMBIGUOUS"
  | "UNSUPPORTED_EXTERNAL_REF"
  | "UNRESOLVED_LOCAL_REF"
  | "CIRCULAR_LOCAL_REF"
  | "OPENAPI_INSPECTION_LIMIT_EXCEEDED";

export class PancakeOrderOpenApiError extends Error {
  readonly code: PancakeOrderOpenApiErrorCode;

  constructor(code: PancakeOrderOpenApiErrorCode) {
    super(code);
    this.name = "PancakeOrderOpenApiError";
    this.code = code;
  }
}

export type OpenApiSchemaStructure = {
  type?: string | string[];
  format?: string;
  required?: string[];
  properties?: Record<string, OpenApiSchemaStructure>;
  items?: OpenApiSchemaStructure;
  oneOf?: OpenApiSchemaStructure[];
  anyOf?: OpenApiSchemaStructure[];
  allOf?: OpenApiSchemaStructure[];
  additionalProperties?: boolean | OpenApiSchemaStructure;
};

export type PancakeCreateOrderOpenApiInspection = {
  path: string;
  method: "POST";
  parameters: Array<{
    name: string;
    in: string;
    required: boolean;
    schema?: OpenApiSchemaStructure;
  }>;
  requestBody?: {
    required: boolean;
    content: Record<string, OpenApiSchemaStructure>;
  };
  responses: Record<
    string,
    {
      content?: Record<string, OpenApiSchemaStructure>;
    }
  >;
};

const CREATE_ORDER_PATH = /^\/shops\/\{[^/{}]+\}\/orders\/?$/;
const MAX_INSPECTION_DEPTH = 32;
const MAX_INSPECTED_NODES = 10_000;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformed(): never {
  throw new PancakeOrderOpenApiError("MALFORMED_OPENAPI_DOCUMENT");
}

function decodeJsonPointerSegment(value: string): string {
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}

class OpenApiStructureInspector {
  private inspectedNodes = 0;
  private readonly document: JsonRecord;

  constructor(document: JsonRecord) {
    this.document = document;
  }

  private countNode(depth: number): void {
    this.inspectedNodes += 1;
    if (depth > MAX_INSPECTION_DEPTH || this.inspectedNodes > MAX_INSPECTED_NODES) {
      throw new PancakeOrderOpenApiError("OPENAPI_INSPECTION_LIMIT_EXCEEDED");
    }
  }

  private countRefHop(refDepth: number): void {
    this.inspectedNodes += 1;
    if (refDepth > MAX_INSPECTION_DEPTH || this.inspectedNodes > MAX_INSPECTED_NODES) {
      throw new PancakeOrderOpenApiError("OPENAPI_INSPECTION_LIMIT_EXCEEDED");
    }
  }

  resolveLocalRef(ref: string, refStack: ReadonlySet<string>): unknown {
    if (!ref.startsWith("#/")) {
      throw new PancakeOrderOpenApiError("UNSUPPORTED_EXTERNAL_REF");
    }
    if (refStack.has(ref)) {
      throw new PancakeOrderOpenApiError("CIRCULAR_LOCAL_REF");
    }

    let current: unknown = this.document;
    for (const encodedSegment of ref.slice(2).split("/")) {
      if (!isRecord(current)) {
        throw new PancakeOrderOpenApiError("UNRESOLVED_LOCAL_REF");
      }
      const segment = decodeJsonPointerSegment(encodedSegment);
      if (!Object.hasOwn(current, segment)) {
        throw new PancakeOrderOpenApiError("UNRESOLVED_LOCAL_REF");
      }
      current = current[segment];
    }
    return current;
  }

  dereference(value: unknown, refStack: ReadonlySet<string>): {
    value: unknown;
    refStack: ReadonlySet<string>;
  } {
    let current = value;
    const nextStack = new Set(refStack);

    while (isRecord(current) && typeof current.$ref === "string") {
      const ref = current.$ref;
      this.countRefHop(nextStack.size + 1);
      current = this.resolveLocalRef(ref, nextStack);
      nextStack.add(ref);
    }

    return { value: current, refStack: nextStack };
  }

  schema(value: unknown, depth = 0, refStack: ReadonlySet<string> = new Set()): OpenApiSchemaStructure {
    this.countNode(depth);
    const resolved = this.dereference(value, refStack);
    if (!isRecord(resolved.value)) {
      malformed();
    }

    const source = resolved.value;
    const result: OpenApiSchemaStructure = {};

    if (typeof source.type === "string") {
      result.type = source.type;
    } else if (Array.isArray(source.type)) {
      if (!source.type.every((entry) => typeof entry === "string")) {
        malformed();
      }
      result.type = [...source.type] as string[];
    }

    if (typeof source.format === "string") {
      result.format = source.format;
    }

    if (source.required !== undefined) {
      if (!Array.isArray(source.required) || !source.required.every((entry) => typeof entry === "string")) {
        malformed();
      }
      result.required = [...source.required] as string[];
    }

    if (source.properties !== undefined) {
      if (!isRecord(source.properties)) {
        malformed();
      }
      const properties: Record<string, OpenApiSchemaStructure> = {};
      for (const [name, property] of Object.entries(source.properties)) {
        properties[name] = this.schema(property, depth + 1, resolved.refStack);
      }
      result.properties = properties;
    }

    if (source.items !== undefined) {
      result.items = this.schema(source.items, depth + 1, resolved.refStack);
    }

    for (const key of ["oneOf", "anyOf", "allOf"] as const) {
      const alternatives = source[key];
      if (alternatives === undefined) {
        continue;
      }
      if (!Array.isArray(alternatives)) {
        malformed();
      }
      result[key] = alternatives.map((alternative) =>
        this.schema(alternative, depth + 1, resolved.refStack),
      );
    }

    if (source.additionalProperties !== undefined) {
      if (typeof source.additionalProperties === "boolean") {
        result.additionalProperties = source.additionalProperties;
      } else {
        result.additionalProperties = this.schema(
          source.additionalProperties,
          depth + 1,
          resolved.refStack,
        );
      }
    }

    return result;
  }

  object(value: unknown, refStack: ReadonlySet<string> = new Set()): JsonRecord {
    const resolved = this.dereference(value, refStack);
    if (!isRecord(resolved.value)) {
      malformed();
    }
    return resolved.value;
  }
}

function structuralContent(
  inspector: OpenApiStructureInspector,
  value: unknown,
): Record<string, OpenApiSchemaStructure> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    malformed();
  }

  const content: Record<string, OpenApiSchemaStructure> = {};
  for (const [mediaType, mediaTypeObject] of Object.entries(value)) {
    if (!isRecord(mediaTypeObject)) {
      malformed();
    }
    if (mediaTypeObject.schema !== undefined) {
      content[mediaType] = inspector.schema(mediaTypeObject.schema);
    } else {
      content[mediaType] = {};
    }
  }
  return content;
}

function structuralParameters(
  inspector: OpenApiStructureInspector,
  pathItem: JsonRecord,
  operation: JsonRecord,
): PancakeCreateOrderOpenApiInspection["parameters"] {
  const rawParameters = [pathItem.parameters, operation.parameters]
    .filter((value) => value !== undefined)
    .flatMap((value) => {
      if (!Array.isArray(value)) {
        malformed();
      }
      return value;
    });

  return rawParameters.map((parameter) => {
    const source = inspector.object(parameter);
    if (typeof source.name !== "string" || typeof source.in !== "string") {
      malformed();
    }

    const result: PancakeCreateOrderOpenApiInspection["parameters"][number] = {
      name: source.name,
      in: source.in,
      required: source.required === true,
    };
    if (source.schema !== undefined) {
      result.schema = inspector.schema(source.schema);
    }
    return result;
  });
}

export function inspectPancakeCreateOrderOpenApi(
  document: unknown,
): PancakeCreateOrderOpenApiInspection {
  if (!isRecord(document) || typeof document.openapi !== "string" || !isRecord(document.paths)) {
    malformed();
  }

  const matches = Object.entries(document.paths).filter(([path, pathItem]) => {
    if (!CREATE_ORDER_PATH.test(path) || !isRecord(pathItem)) {
      return false;
    }
    return isRecord(pathItem.post);
  });

  if (matches.length === 0) {
    throw new PancakeOrderOpenApiError("CREATE_ORDER_OPERATION_NOT_FOUND");
  }
  if (matches.length !== 1) {
    throw new PancakeOrderOpenApiError("CREATE_ORDER_OPERATION_AMBIGUOUS");
  }

  const [path, rawPathItem] = matches[0];
  if (!isRecord(rawPathItem) || !isRecord(rawPathItem.post)) {
    malformed();
  }

  const operation = rawPathItem.post;
  const inspector = new OpenApiStructureInspector(document);
  const result: PancakeCreateOrderOpenApiInspection = {
    path,
    method: "POST",
    parameters: structuralParameters(inspector, rawPathItem, operation),
    responses: {},
  };

  if (operation.requestBody !== undefined) {
    const requestBody = inspector.object(operation.requestBody);
    const content = structuralContent(inspector, requestBody.content) ?? {};
    result.requestBody = {
      required: requestBody.required === true,
      content,
    };
  }

  if (!isRecord(operation.responses)) {
    malformed();
  }
  for (const [status, rawResponse] of Object.entries(operation.responses)) {
    const response = inspector.object(rawResponse);
    const content = structuralContent(inspector, response.content);
    result.responses[status] = content === undefined ? {} : { content };
  }

  return result;
}
