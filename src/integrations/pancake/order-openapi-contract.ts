type JsonRecord = Record<string, unknown>;

type InspectedParameter = PancakeCreateOrderOpenApiInspection["parameters"][number];
type InspectedResponses = PancakeCreateOrderOpenApiInspection["responses"];

export type PancakeOrderOpenApiErrorCode =
  | "MALFORMED_OPENAPI_DOCUMENT"
  | "CREATE_ORDER_OPERATION_NOT_FOUND"
  | "CREATE_ORDER_OPERATION_AMBIGUOUS"
  | "GEO_OPERATION_SET_INCOMPLETE"
  | "GEO_OPERATION_AMBIGUOUS"
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

export type PancakeGeoOpenApiOperationInspection = {
  path: string;
  method: "GET";
  parameters: PancakeCreateOrderOpenApiInspection["parameters"];
  responses: PancakeCreateOrderOpenApiInspection["responses"];
};

export type PancakeGeoOpenApiInspection = {
  provinces: PancakeGeoOpenApiOperationInspection;
  districts: PancakeGeoOpenApiOperationInspection;
  communes: PancakeGeoOpenApiOperationInspection;
};

const CREATE_ORDER_PATH = /^\/shops\/\{([^/{}]+)\}\/orders\/?$/;
const GEO_PATHS = {
  provinces: /^\/geo\/provinces\/?$/,
  districts: /^\/geo\/districts\/?$/,
  communes: /^\/geo\/communes\/?$/,
} as const;
const MAX_INSPECTION_DEPTH = 32;
const MAX_INSPECTION_WORK_UNITS = 10_000;
const PARAMETER_LOCATIONS = new Set(["query", "header", "path", "cookie"]);
const STRUCTURAL_SCHEMA_KEYS = [
  "type",
  "format",
  "required",
  "properties",
  "items",
  "oneOf",
  "anyOf",
  "allOf",
  "additionalProperties",
];

type GeoOperationName = keyof typeof GEO_PATHS;

type MatchedGeoOperation = {
  path: string;
  pathItem: JsonRecord;
  operation: JsonRecord;
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformed(): never {
  throw new PancakeOrderOpenApiError("MALFORMED_OPENAPI_DOCUMENT");
}

function decodeJsonPointerSegment(value: string): string {
  return value.replaceAll("~1", "/").replaceAll("~0", "~");
}

function pickStructuralSchemaSiblings(source: JsonRecord): JsonRecord {
  const result: JsonRecord = {};
  for (const key of STRUCTURAL_SCHEMA_KEYS) {
    if (Object.hasOwn(source, key)) {
      result[key] = source[key];
    }
  }
  return result;
}

class OpenApiStructureInspector {
  private inspectionWorkUnits = 0;
  private readonly document: JsonRecord;

  constructor(document: JsonRecord) {
    this.document = document;
  }

  chargeWork(units = 1): void {
    this.inspectionWorkUnits += units;
    if (this.inspectionWorkUnits > MAX_INSPECTION_WORK_UNITS) {
      throw new PancakeOrderOpenApiError("OPENAPI_INSPECTION_LIMIT_EXCEEDED");
    }
  }

  private countNode(depth: number): void {
    if (depth > MAX_INSPECTION_DEPTH) {
      throw new PancakeOrderOpenApiError("OPENAPI_INSPECTION_LIMIT_EXCEEDED");
    }
    this.chargeWork();
  }

  private countRefHop(refDepth: number): void {
    if (refDepth > MAX_INSPECTION_DEPTH) {
      throw new PancakeOrderOpenApiError("OPENAPI_INSPECTION_LIMIT_EXCEEDED");
    }
    this.chargeWork();
  }

  private copyStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      malformed();
    }

    const result: string[] = [];
    for (const entry of value) {
      this.chargeWork();
      if (typeof entry !== "string") {
        malformed();
      }
      result.push(entry);
    }
    return result;
  }

  resolveLocalRef(ref: string, refStack: ReadonlySet<string>): unknown {
    if (!ref.startsWith("#/")) {
      throw new PancakeOrderOpenApiError("UNSUPPORTED_EXTERNAL_REF");
    }
    if (refStack.has(ref)) {
      throw new PancakeOrderOpenApiError("CIRCULAR_LOCAL_REF");
    }

    let current: unknown = this.document;
    const pointer = ref.slice(2);
    let segmentStart = 0;

    while (true) {
      this.chargeWork();
      const nextSeparator = pointer.indexOf("/", segmentStart);
      const encodedSegment =
        nextSeparator === -1
          ? pointer.slice(segmentStart)
          : pointer.slice(segmentStart, nextSeparator);

      if (!isRecord(current)) {
        throw new PancakeOrderOpenApiError("UNRESOLVED_LOCAL_REF");
      }
      const segment = decodeJsonPointerSegment(encodedSegment);
      if (!Object.hasOwn(current, segment)) {
        throw new PancakeOrderOpenApiError("UNRESOLVED_LOCAL_REF");
      }
      current = current[segment];

      if (nextSeparator === -1) {
        break;
      }
      segmentStart = nextSeparator + 1;
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

  private inspectSchemaObject(
    source: JsonRecord,
    depth: number,
    refStack: ReadonlySet<string>,
  ): OpenApiSchemaStructure {
    const result: OpenApiSchemaStructure = {};

    if (typeof source.type === "string") {
      result.type = source.type;
    } else if (Array.isArray(source.type)) {
      const types: string[] = [];
      for (const entry of source.type) {
        this.chargeWork();
        if (typeof entry !== "string") {
          malformed();
        }
        types.push(entry);
      }
      result.type = types;
    }

    if (typeof source.format === "string") {
      result.format = source.format;
    }

    if (source.required !== undefined) {
      result.required = this.copyStringArray(source.required);
    }

    if (source.properties !== undefined) {
      if (!isRecord(source.properties)) {
        malformed();
      }
      const properties: Record<string, OpenApiSchemaStructure> = {};
      for (const name in source.properties) {
        this.chargeWork();
        if (!Object.hasOwn(source.properties, name)) {
          continue;
        }
        properties[name] = this.schema(source.properties[name], depth + 1, refStack);
      }
      result.properties = properties;
    }

    if (source.items !== undefined) {
      result.items = this.schema(source.items, depth + 1, refStack);
    }

    for (const key of ["oneOf", "anyOf", "allOf"] as const) {
      const alternatives = source[key];
      if (alternatives === undefined) {
        continue;
      }
      if (!Array.isArray(alternatives)) {
        malformed();
      }

      const inspectedAlternatives: OpenApiSchemaStructure[] = [];
      for (const alternative of alternatives) {
        this.chargeWork();
        inspectedAlternatives.push(this.schema(alternative, depth + 1, refStack));
      }
      result[key] = inspectedAlternatives;
    }

    if (source.additionalProperties !== undefined) {
      if (typeof source.additionalProperties === "boolean") {
        result.additionalProperties = source.additionalProperties;
      } else {
        result.additionalProperties = this.schema(
          source.additionalProperties,
          depth + 1,
          refStack,
        );
      }
    }

    return result;
  }

  schema(value: unknown, depth = 0, refStack: ReadonlySet<string> = new Set()): OpenApiSchemaStructure {
    this.countNode(depth);
    if (!isRecord(value)) {
      malformed();
    }

    if (Object.hasOwn(value, "$ref")) {
      if (typeof value.$ref !== "string") {
        malformed();
      }

      const ref = value.$ref;
      this.countRefHop(refStack.size + 1);
      const target = this.resolveLocalRef(ref, refStack);
      const nextStack = new Set(refStack);
      nextStack.add(ref);
      const referencedStructure = this.schema(target, depth, nextStack);
      const structuralSiblings = pickStructuralSchemaSiblings(value);

      if (Object.keys(structuralSiblings).length === 0) {
        return referencedStructure;
      }

      return {
        allOf: [
          referencedStructure,
          this.inspectSchemaObject(structuralSiblings, depth, nextStack),
        ],
      };
    }

    return this.inspectSchemaObject(value, depth, refStack);
  }

  object(value: unknown, refStack: ReadonlySet<string> = new Set()): JsonRecord {
    this.chargeWork();
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
  for (const mediaType in value) {
    inspector.chargeWork();
    if (!Object.hasOwn(value, mediaType)) {
      continue;
    }

    const mediaTypeObject = value[mediaType];
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

function structuralResponses(
  inspector: OpenApiStructureInspector,
  operation: JsonRecord,
): InspectedResponses {
  if (!isRecord(operation.responses)) {
    malformed();
  }

  const responses: InspectedResponses = {};
  for (const status in operation.responses) {
    inspector.chargeWork();
    if (!Object.hasOwn(operation.responses, status)) {
      continue;
    }

    const response = inspector.object(operation.responses[status]);
    const content = structuralContent(inspector, response.content);
    responses[status] = content === undefined ? {} : { content };
  }
  return responses;
}

function inspectParameter(
  inspector: OpenApiStructureInspector,
  parameter: unknown,
): InspectedParameter {
  const source = inspector.object(parameter);
  if (
    typeof source.name !== "string" ||
    typeof source.in !== "string" ||
    !PARAMETER_LOCATIONS.has(source.in)
  ) {
    malformed();
  }
  if (source.required !== undefined && typeof source.required !== "boolean") {
    malformed();
  }
  if (source.in === "path" && source.required !== true) {
    malformed();
  }

  const result: InspectedParameter = {
    name: source.name,
    in: source.in,
    required: source.required === true,
  };
  if (source.schema !== undefined) {
    result.schema = inspector.schema(source.schema);
  }
  return result;
}

function parameterKey(parameter: InspectedParameter): string {
  return `${parameter.in}\u0000${parameter.name}`;
}

function inspectParameterLevel(
  inspector: OpenApiStructureInspector,
  value: unknown,
): InspectedParameter[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    malformed();
  }

  const result: InspectedParameter[] = [];
  const seen = new Set<string>();
  for (const parameter of value) {
    inspector.chargeWork();
    const inspected = inspectParameter(inspector, parameter);
    const key = parameterKey(inspected);
    if (seen.has(key)) {
      malformed();
    }
    seen.add(key);
    result.push(inspected);
  }
  return result;
}

function structuralParameters(
  inspector: OpenApiStructureInspector,
  pathItem: JsonRecord,
  operation: JsonRecord,
): PancakeCreateOrderOpenApiInspection["parameters"] {
  const effective = new Map<string, InspectedParameter>();

  for (const parameter of inspectParameterLevel(inspector, pathItem.parameters)) {
    effective.set(parameterKey(parameter), parameter);
  }
  for (const parameter of inspectParameterLevel(inspector, operation.parameters)) {
    effective.set(parameterKey(parameter), parameter);
  }

  return [...effective.values()];
}

function validateCreateOrderPathParameters(
  templateName: string,
  parameters: PancakeCreateOrderOpenApiInspection["parameters"],
): void {
  let matchingPathParameterCount = 0;

  for (const parameter of parameters) {
    if (parameter.in !== "path") {
      continue;
    }
    if (parameter.name !== templateName) {
      malformed();
    }
    matchingPathParameterCount += 1;
  }

  if (matchingPathParameterCount !== 1) {
    malformed();
  }
}

function inspectMatchedGeoOperation(
  inspector: OpenApiStructureInspector,
  matched: MatchedGeoOperation,
): PancakeGeoOpenApiOperationInspection {
  return {
    path: matched.path,
    method: "GET",
    parameters: structuralParameters(inspector, matched.pathItem, matched.operation),
    responses: structuralResponses(inspector, matched.operation),
  };
}

export function inspectPancakeCreateOrderOpenApi(
  document: unknown,
): PancakeCreateOrderOpenApiInspection {
  if (!isRecord(document) || typeof document.openapi !== "string" || !isRecord(document.paths)) {
    malformed();
  }

  const inspector = new OpenApiStructureInspector(document);
  let matchedPath: string | undefined;
  let matchedPathParameterName: string | undefined;
  let matchedPathItem: JsonRecord | undefined;

  for (const path in document.paths) {
    inspector.chargeWork();
    if (!Object.hasOwn(document.paths, path)) {
      continue;
    }

    const pathMatch = CREATE_ORDER_PATH.exec(path);
    if (pathMatch === null) {
      continue;
    }

    const pathItem = inspector.object(document.paths[path]);
    if (!isRecord(pathItem.post)) {
      continue;
    }
    if (matchedPath !== undefined) {
      throw new PancakeOrderOpenApiError("CREATE_ORDER_OPERATION_AMBIGUOUS");
    }
    matchedPath = path;
    matchedPathParameterName = pathMatch[1];
    matchedPathItem = pathItem;
  }

  if (
    matchedPath === undefined ||
    matchedPathParameterName === undefined ||
    matchedPathItem === undefined
  ) {
    throw new PancakeOrderOpenApiError("CREATE_ORDER_OPERATION_NOT_FOUND");
  }
  if (!isRecord(matchedPathItem.post)) {
    malformed();
  }

  const operation = matchedPathItem.post;
  const parameters = structuralParameters(inspector, matchedPathItem, operation);
  validateCreateOrderPathParameters(matchedPathParameterName, parameters);

  const result: PancakeCreateOrderOpenApiInspection = {
    path: matchedPath,
    method: "POST",
    parameters,
    responses: structuralResponses(inspector, operation),
  };

  if (operation.requestBody !== undefined) {
    const requestBody = inspector.object(operation.requestBody);
    const content = structuralContent(inspector, requestBody.content) ?? {};
    result.requestBody = {
      required: requestBody.required === true,
      content,
    };
  }

  return result;
}

export function inspectPancakeGeoOpenApi(document: unknown): PancakeGeoOpenApiInspection {
  if (!isRecord(document) || typeof document.openapi !== "string" || !isRecord(document.paths)) {
    malformed();
  }

  const inspector = new OpenApiStructureInspector(document);
  const matched: Partial<Record<GeoOperationName, MatchedGeoOperation>> = {};

  for (const path in document.paths) {
    inspector.chargeWork();
    if (!Object.hasOwn(document.paths, path)) {
      continue;
    }

    for (const name of Object.keys(GEO_PATHS) as GeoOperationName[]) {
      if (!GEO_PATHS[name].test(path)) {
        continue;
      }

      const pathItem = inspector.object(document.paths[path]);
      if (!isRecord(pathItem.get)) {
        continue;
      }
      if (matched[name] !== undefined) {
        throw new PancakeOrderOpenApiError("GEO_OPERATION_AMBIGUOUS");
      }
      matched[name] = {
        path,
        pathItem,
        operation: pathItem.get,
      };
    }
  }

  if (
    matched.provinces === undefined ||
    matched.districts === undefined ||
    matched.communes === undefined
  ) {
    throw new PancakeOrderOpenApiError("GEO_OPERATION_SET_INCOMPLETE");
  }

  return {
    provinces: inspectMatchedGeoOperation(inspector, matched.provinces),
    districts: inspectMatchedGeoOperation(inspector, matched.districts),
    communes: inspectMatchedGeoOperation(inspector, matched.communes),
  };
}
