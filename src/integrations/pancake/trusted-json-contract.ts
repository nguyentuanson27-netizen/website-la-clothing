export type TrustedJsonValueType =
  | "array"
  | "boolean"
  | "null"
  | "number"
  | "object"
  | "string";

export type TrustedJsonContractPath = {
  path: string;
  types: TrustedJsonValueType[];
};

export type TrustedJsonContract = {
  paths: TrustedJsonContractPath[];
};

type TrustedJsonContractOptions = {
  maxNodes?: number;
  maxDepth?: number;
  maxDistinctPaths?: number;
};

type ResolvedOptions = {
  maxNodes: number;
  maxDepth: number;
  maxDistinctPaths: number;
};

type PendingNode = {
  value: unknown;
  path: string;
  depth: number;
};

const DEFAULT_OPTIONS = {
  maxNodes: 1_000_000,
  maxDepth: 64,
  maxDistinctPaths: 50_000,
} as const;

const INSPECTION_BUDGET_ERROR = "Trusted JSON discovery exceeded the inspection budget";
const DEPTH_BUDGET_ERROR = "Trusted JSON discovery exceeded the depth budget";
const NON_JSON_ERROR = "External value is not JSON-compatible";
const SAFE_PATH_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
  return resolved;
}

function resolveOptions(options: TrustedJsonContractOptions): ResolvedOptions {
  return {
    maxNodes: positiveInteger(options.maxNodes, DEFAULT_OPTIONS.maxNodes, "maxNodes"),
    maxDepth: positiveInteger(options.maxDepth, DEFAULT_OPTIONS.maxDepth, "maxDepth"),
    maxDistinctPaths: positiveInteger(
      options.maxDistinctPaths,
      DEFAULT_OPTIONS.maxDistinctPaths,
      "maxDistinctPaths",
    ),
  };
}

function jsonType(value: unknown): TrustedJsonValueType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return "object";
  }
  throw new TypeError(NON_JSON_ERROR);
}

function objectChildPath(parent: string, key: string): string {
  return SAFE_PATH_KEY.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function addObservedType(
  pathTypes: Map<string, Set<TrustedJsonValueType>>,
  path: string,
  type: TrustedJsonValueType,
  maxDistinctPaths: number,
): void {
  let types = pathTypes.get(path);
  if (!types) {
    if (pathTypes.size >= maxDistinctPaths) {
      throw new TypeError(INSPECTION_BUDGET_ERROR);
    }
    types = new Set<TrustedJsonValueType>();
    pathTypes.set(path, types);
  }
  types.add(type);
}

function assertNodeBudget(
  visitedNodes: number,
  pendingNodes: number,
  newNodes: number,
  maxNodes: number,
): void {
  if (visitedNodes + pendingNodes + newNodes > maxNodes) {
    throw new TypeError(INSPECTION_BUDGET_ERROR);
  }
}

export function describeTrustedJsonContract(
  value: unknown,
  options: TrustedJsonContractOptions = {},
): TrustedJsonContract {
  const resolved = resolveOptions(options);
  const pending: PendingNode[] = [{ value, path: "$", depth: 0 }];
  const pathTypes = new Map<string, Set<TrustedJsonValueType>>();
  let visitedNodes = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;

    visitedNodes += 1;
    if (visitedNodes > resolved.maxNodes) {
      throw new TypeError(INSPECTION_BUDGET_ERROR);
    }
    if (current.depth > resolved.maxDepth) {
      throw new TypeError(DEPTH_BUDGET_ERROR);
    }

    const type = jsonType(current.value);
    addObservedType(pathTypes, current.path, type, resolved.maxDistinctPaths);

    if (type === "array") {
      const items = current.value as unknown[];
      assertNodeBudget(visitedNodes, pending.length, items.length, resolved.maxNodes);
      const childDepth = current.depth + 1;
      if (items.length > 0 && childDepth > resolved.maxDepth) {
        throw new TypeError(DEPTH_BUDGET_ERROR);
      }
      for (let index = items.length - 1; index >= 0; index -= 1) {
        pending.push({
          value: items[index],
          path: `${current.path}[]`,
          depth: childDepth,
        });
      }
      continue;
    }

    if (type === "object") {
      const record = current.value as Record<string, unknown>;
      const keys = Object.keys(record);
      assertNodeBudget(visitedNodes, pending.length, keys.length, resolved.maxNodes);
      const childDepth = current.depth + 1;
      if (keys.length > 0 && childDepth > resolved.maxDepth) {
        throw new TypeError(DEPTH_BUDGET_ERROR);
      }
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        pending.push({
          value: record[key],
          path: objectChildPath(current.path, key),
          depth: childDepth,
        });
      }
    }
  }

  return {
    paths: [...pathTypes.entries()]
      .map(([path, types]) => ({ path, types: [...types].sort() }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}
