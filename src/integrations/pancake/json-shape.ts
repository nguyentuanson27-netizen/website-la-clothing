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
  allowedObjectKeys?: readonly string[];
};

type ResolvedOptions = {
  maxDepth: number;
  maxDistinctArrayShapes: number;
  maxArrayItems: number;
  maxObjectFields: number;
  allowedObjectKeys: ReadonlySet<string>;
};

const DEFAULT_OPTIONS = {
  maxDepth: 8,
  maxDistinctArrayShapes: 5,
  maxArrayItems: 50,
  maxObjectFields: 50,
} as const;

const DYNAMIC_KEY_MARKER = "<dynamic-key>";

function resolveOptions(options: JsonShapeOptions): ResolvedOptions {
  const {
    allowedObjectKeys = [],
    maxDepth = DEFAULT_OPTIONS.maxDepth,
    maxDistinctArrayShapes = DEFAULT_OPTIONS.maxDistinctArrayShapes,
    maxArrayItems = DEFAULT_OPTIONS.maxArrayItems,
    maxObjectFields = DEFAULT_OPTIONS.maxObjectFields,
  } = options;

  const numericOptions = {
    maxDepth,
    maxDistinctArrayShapes,
    maxArrayItems,
    maxObjectFields,
  };

  for (const [name, value] of Object.entries(numericOptions)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive integer`);
    }
  }

  if (!Array.isArray(allowedObjectKeys)) {
    throw new TypeError("allowedObjectKeys must be an array of trusted field names");
  }

  for (const key of allowedObjectKeys) {
    if (typeof key !== "string" || key.length === 0) {
      throw new TypeError("allowedObjectKeys must contain non-empty strings");
    }
  }

  return {
    ...numericOptions,
    allowedObjectKeys: new Set(allowedObjectKeys),
  };
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function safeObjectKey(key: string, options: ResolvedOptions): string {
  return options.allowedObjectKeys.has(key) ? key : DYNAMIC_KEY_MARKER;
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
    const keys = Object.keys(value);
    const sampledKeys = keys.slice(0, options.maxObjectFields);
    let truncated = keys.length > sampledKeys.length;

    const boundedFields = sampledKeys.map((key) => {
      const shape = describe((value as Record<string, unknown>)[key], options, depth + 1);

      return {
        outputKey: safeObjectKey(key, options),
        shape,
        shapeFingerprint: JSON.stringify(shape),
      };
    });

    boundedFields.sort(
      (left, right) =>
        compareStrings(left.outputKey, right.outputKey) ||
        compareStrings(left.shapeFingerprint, right.shapeFingerprint),
    );

    const fieldEntries: Array<[string, JsonShape]> = [];
    const emittedKeys = new Set<string>();

    for (const field of boundedFields) {
      if (emittedKeys.has(field.outputKey)) {
        truncated = true;
        continue;
      }

      emittedKeys.add(field.outputKey);
      fieldEntries.push([field.outputKey, field.shape]);
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
