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
    };

type JsonShapeOptions = {
  maxDepth?: number;
  maxDistinctArrayShapes?: number;
  maxArrayItems?: number;
};

type ResolvedOptions = Required<JsonShapeOptions>;

const DEFAULT_OPTIONS: ResolvedOptions = {
  maxDepth: 8,
  maxDistinctArrayShapes: 5,
  maxArrayItems: 50,
};

function resolveOptions(options: JsonShapeOptions): ResolvedOptions {
  const resolved = { ...DEFAULT_OPTIONS, ...options };

  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive integer`);
    }
  }

  return resolved;
}

function describe(value: unknown, options: ResolvedOptions, depth: number): JsonShape {
  if (depth >= options.maxDepth) {
    return "max-depth";
  }

  if (value === null) {
    return "null";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return typeof value;
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
    const fields: Record<string, JsonShape> = {};

    for (const key of Object.keys(value).sort()) {
      fields[key] = describe((value as Record<string, unknown>)[key], options, depth + 1);
    }

    return { type: "object", fields };
  }

  throw new TypeError("External value is not JSON-compatible");
}

export function describeJsonShape(value: unknown, options: JsonShapeOptions = {}): JsonShape {
  return describe(value, resolveOptions(options), 0);
}
