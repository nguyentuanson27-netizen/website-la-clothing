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

type TrustedJsonShapeOptions = Omit<JsonShapeOptions, "allowedObjectKeys">;

type ReviewedJsonShapeOptions = JsonShapeOptions & {
  allowedObjectKeys: readonly string[];
  maxValidationNodes?: number;
};

type ReviewedJsonValidationOptions = {
  allowedObjectKeys: readonly string[];
  maxValidationNodes?: number;
};

type ResolvedOptions = {
  maxDepth: number;
  maxDistinctArrayShapes: number;
  maxArrayItems: number;
  maxObjectFields: number;
  allowedObjectKeys: ReadonlySet<string>;
  exposeAllObjectKeys: boolean;
};

const DEFAULT_OPTIONS = {
  maxDepth: 8,
  maxDistinctArrayShapes: 5,
  maxArrayItems: 50,
  maxObjectFields: 50,
} as const;

const DEFAULT_VALIDATION_NODE_BUDGET = 100_000;
const DYNAMIC_KEY_MARKER = "<dynamic-key>";
const UNKNOWN_FIELD_ERROR = "External object contains an unreviewed field name";
const VALIDATION_BUDGET_ERROR = "External JSON validation exceeded the inspection budget";
const NON_JSON_ERROR = "External value is not JSON-compatible";

function resolveAllowedObjectKeys(allowedObjectKeys: readonly string[]): ReadonlySet<string> {
  if (!Array.isArray(allowedObjectKeys)) {
    throw new TypeError("allowedObjectKeys must be an array of trusted field names");
  }

  for (const key of allowedObjectKeys) {
    if (typeof key !== "string" || key.length === 0) {
      throw new TypeError("allowedObjectKeys must contain non-empty strings");
    }
  }

  return new Set(allowedObjectKeys);
}

function resolveOptions(
  options: JsonShapeOptions,
  exposeAllObjectKeys = false,
): ResolvedOptions {
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

  return {
    ...numericOptions,
    allowedObjectKeys: resolveAllowedObjectKeys(allowedObjectKeys),
    exposeAllObjectKeys,
  };
}

function resolveValidationNodeBudget(value: number | undefined): number {
  const budget = value ?? DEFAULT_VALIDATION_NODE_BUDGET;

  if (!Number.isSafeInteger(budget) || budget <= 0) {
    throw new TypeError("maxValidationNodes must be a positive integer");
  }

  return budget;
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

  throw new TypeError(NON_JSON_ERROR);
}

export function validateReviewedJsonKeys(
  value: unknown,
  options: ReviewedJsonValidationOptions,
): void {
  const allowedObjectKeys = resolveAllowedObjectKeys(options.allowedObjectKeys);
  const maxValidationNodes = resolveValidationNodeBudget(options.maxValidationNodes);
  const pending: unknown[] = [value];
  let visitedNodes = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    visitedNodes += 1;

    if (visitedNodes > maxValidationNodes) {
      throw new TypeError(VALIDATION_BUDGET_ERROR);
    }

    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "number" ||
      typeof current === "boolean"
    ) {
      continue;
    }

    if (Array.isArray(current)) {
      if (visitedNodes + pending.length + current.length > maxValidationNodes) {
        throw new TypeError(VALIDATION_BUDGET_ERROR);
      }

      for (let index = current.length - 1; index >= 0; index -= 1) {
        pending.push(current[index]);
      }
      continue;
    }

    if (typeof current === "object" && Object.getPrototypeOf(current) === Object.prototype) {
      const record = current as Record<string, unknown>;
      const keys = Object.keys(record);

      if (visitedNodes + pending.length + keys.length > maxValidationNodes) {
        throw new TypeError(VALIDATION_BUDGET_ERROR);
      }

      for (const key of keys) {
        if (!allowedObjectKeys.has(key)) {
          throw new TypeError(UNKNOWN_FIELD_ERROR);
        }
      }

      for (let index = keys.length - 1; index >= 0; index -= 1) {
        pending.push(record[keys[index]]);
      }
      continue;
    }

    throw new TypeError(NON_JSON_ERROR);
  }
}

export function describeJsonShape(value: unknown, options: JsonShapeOptions = {}): JsonShape {
  return describe(value, resolveOptions(options), 0);
}

export function describeReviewedJsonShape(
  value: unknown,
  options: ReviewedJsonShapeOptions,
): JsonShape {
  const { maxValidationNodes, ...shapeOptions } = options;

  validateReviewedJsonKeys(value, {
    allowedObjectKeys: options.allowedObjectKeys,
    maxValidationNodes,
  });

  return describeJsonShape(value, shapeOptions);
}

export function describeTrustedJsonShape(
  value: unknown,
  options: TrustedJsonShapeOptions = {},
): JsonShape {
  return describe(value, resolveOptions(options, true), 0);
}
