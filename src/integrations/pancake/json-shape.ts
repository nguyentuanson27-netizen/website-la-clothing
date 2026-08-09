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
  rejectUnknownObjectKeys?: boolean;
};

type TrustedJsonShapeOptions = Omit<
  JsonShapeOptions,
  "allowedObjectKeys" | "rejectUnknownObjectKeys"
>;

type ResolvedOptions = {
  maxDepth: number;
  maxDistinctArrayShapes: number;
  maxArrayItems: number;
  maxObjectFields: number;
  allowedObjectKeys: ReadonlySet<string>;
  rejectUnknownObjectKeys: boolean;
  exposeAllObjectKeys: boolean;
};

const DEFAULT_OPTIONS = {
  maxDepth: 8,
  maxDistinctArrayShapes: 5,
  maxArrayItems: 50,
  maxObjectFields: 50,
} as const;

const DYNAMIC_KEY_MARKER = "<dynamic-key>";

function resolveOptions(
  options: JsonShapeOptions,
  exposeAllObjectKeys = false,
): ResolvedOptions {
  const {
    allowedObjectKeys = [],
    rejectUnknownObjectKeys = false,
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

  if (typeof rejectUnknownObjectKeys !== "boolean") {
    throw new TypeError("rejectUnknownObjectKeys must be a boolean");
  }

  return {
    ...numericOptions,
    allowedObjectKeys: new Set(allowedObjectKeys),
    rejectUnknownObjectKeys,
    exposeAllObjectKeys,
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
  if (options.exposeAllObjectKeys || options.allowedObjectKeys.has(key)) {
    return key;
  }

  if (options.rejectUnknownObjectKeys) {
    throw new TypeError("External object contains an unreviewed field name");
  }

  return DYNAMIC_KEY_MARKER;
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

    if (options.rejectUnknownObjectKeys && !options.exposeAllObjectKeys) {
      for (const key of keys) {
        if (!options.allowedObjectKeys.has(key)) {
          throw new TypeError("External object contains an unreviewed field name");
        }
      }
    }

    const sampledKeys = keys.slice(0, options.maxObjectFields);
    let truncated = keys.length > sampledKeys.length;

    const boundedFields = sampledKeys.map((key) => {
      const outputKey = safeObjectKey(key, options);
      const shape = describe((value as Record<string, unknown>)[key], options, depth + 1);

      return {
        outputKey,
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

export function describeTrustedJsonShape(
  value: unknown,
  options: TrustedJsonShapeOptions = {},
): JsonShape {
  return describe(value, resolveOptions(options, true), 0);
}
