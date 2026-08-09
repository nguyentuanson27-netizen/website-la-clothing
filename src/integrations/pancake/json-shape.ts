export type JsonShape =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "max-depth"
  | {
      type: "array";
      itemShapes: JsonShape[];
      truncated: boolean;
    }
  | {
      type: "object";
      fields: Record<string, JsonShape>;
      truncated?: true;
    };

type JsonShapeOptions = {
  maxDepth?: number;
  maxDistinctArrayShapes?: number;
  maxArrayItems?: number;
  maxObjectFields?: number;
};

type ResolvedOptions = Required<JsonShapeOptions>;

const DEFAULT_OPTIONS: ResolvedOptions = {
  maxDepth: 8,
  maxDistinctArrayShapes: 5,
  maxArrayItems: 50,
  maxObjectFields: 50,
};

const SCHEMA_IDENTIFIER_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const DYNAMIC_KEY_MARKER = "<dynamic-key>";

function resolveOptions(options: JsonShapeOptions): ResolvedOptions {
  const resolved = { ...DEFAULT_OPTIONS, ...options };

  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive integer`);
    }
  }

  return resolved;
}

function safeObjectKey(key: string): string {
  return SCHEMA_IDENTIFIER_KEY.test(key) ? key : DYNAMIC_KEY_MARKER;
}

function describe(value: unknown, options: ResolvedOptions, depth: number): JsonShape {
  if (depth >= options.maxDepth) {
    return "max-depth";
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "string") {
    return "string";
  }

  if (typeof value === "number") {
    return "number";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  if (Array.isArray(value)) {
    const itemShapes: JsonShape[] = [];
    const fingerprints = new Set<string>();
    const sampledItems = value.slice(0, options.maxArrayItems);
    let truncated = value.length > sampledItems.length;

    for (const item of sampledItems) {
      const shape = describe(item, options, depth + 1);
      const fingerprint = JSON.stringify(shape);

      if (fingerprints.has(fingerprint)) {
        continue;
      }

      if (itemShapes.length >= options.maxDistinctArrayShapes) {
        truncated = true;
        break;
      }

      fingerprints.add(fingerprint);
      itemShapes.push(shape);
    }

    return { type: "array", itemShapes, truncated };
  }

  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const fieldEntries: Array<[string, JsonShape]> = [];
    const emittedKeys = new Set<string>();
    const keys = Object.keys(value).sort();
    const sampledKeys = keys.slice(0, options.maxObjectFields);
    let truncated = keys.length > sampledKeys.length;

    for (const key of sampledKeys) {
      const outputKey = safeObjectKey(key);

      if (emittedKeys.has(outputKey)) {
        truncated = true;
        continue;
      }

      emittedKeys.add(outputKey);
      fieldEntries.push([
        outputKey,
        describe((value as Record<string, unknown>)[key], options, depth + 1),
      ]);
    }

    const result: Extract<JsonShape, { type: "object" }> = {
      type: "object",
      fields: Object.fromEntries(fieldEntries),
    };

    if (truncated) {
      result.truncated = true;
    }

    return result;
  }

  throw new TypeError("External value is not JSON-compatible");
}

export function describeJsonShape(value: unknown, options: JsonShapeOptions = {}): JsonShape {
  return describe(value, resolveOptions(options), 0);
}
