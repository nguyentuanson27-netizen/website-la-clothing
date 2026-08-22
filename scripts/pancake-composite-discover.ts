import { pathToFileURL } from "node:url";

import {
  describeTrustedJsonContract,
  type TrustedJsonContract,
  type TrustedJsonValueType,
} from "../src/integrations/pancake/trusted-json-contract.ts";

type QueryValue = string | number | boolean;
type CompositeDiscoveryClient = {
  getJson(endpoint: string, query?: Readonly<Record<string, QueryValue>>): Promise<unknown>;
};
type CompositeRole = "parent" | "children";
type JsonRecord = Record<string, unknown>;
type CompositeDiscoveryPage = {
  raw: unknown;
  totalEntries: number;
  totalPages: number;
  entryCount: number;
};

const CI_REFUSAL_MESSAGE = "Trusted Pancake composite discovery refuses CI execution";
const GENERIC_FAILURE_MESSAGE =
  "Trusted Pancake composite discovery failed without logging external scalar values";
const PAGE_SIZE = 100;
const MAX_COMPOSITE_PAGES = 500;
const MAX_COMPOSITE_ENTRIES = 50_000;
const PAGINATION_ERROR = "Pancake composite pagination payload is malformed";

function environmentFlagIsEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0" || value.toLowerCase() === "false") {
    return false;
  }
  return true;
}

export function assertTrustedCompositeDiscoveryEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (environmentFlagIsEnabled(env.CI) || environmentFlagIsEnabled(env.GITHUB_ACTIONS)) {
    throw new Error(CI_REFUSAL_MESSAGE);
  }
}

export function compositeDiscoveryFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message === CI_REFUSAL_MESSAGE) {
    return CI_REFUSAL_MESSAGE;
  }
  return GENERIC_FAILURE_MESSAGE;
}

function requireRecord(value: unknown): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(PAGINATION_ERROR);
  }
  return value as JsonRecord;
}

function requireNonNegativeSafeInteger(record: JsonRecord, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(PAGINATION_ERROR);
  }
  return value;
}

function parseCompositeDiscoveryPage(
  payload: unknown,
  expectedPageNumber: number,
): CompositeDiscoveryPage {
  const root = requireRecord(payload);
  if (root.success !== true || !Array.isArray(root.data)) {
    throw new TypeError(PAGINATION_ERROR);
  }

  const pageNumber = requireNonNegativeSafeInteger(root, "page_number");
  requireNonNegativeSafeInteger(root, "page_size");
  const totalEntries = requireNonNegativeSafeInteger(root, "total_entries");
  const totalPages = requireNonNegativeSafeInteger(root, "total_pages");

  if (pageNumber !== expectedPageNumber) {
    throw new Error(`Pancake composite response does not match requested page ${expectedPageNumber}`);
  }

  return {
    raw: payload,
    totalEntries,
    totalPages,
    entryCount: root.data.length,
  };
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function mergeTrustedJsonContracts(contracts: readonly TrustedJsonContract[]): TrustedJsonContract {
  const pathTypes = new Map<string, Set<TrustedJsonValueType>>();

  for (const contract of contracts) {
    for (const { path, types } of contract.paths) {
      let observedTypes = pathTypes.get(path);
      if (!observedTypes) {
        observedTypes = new Set<TrustedJsonValueType>();
        pathTypes.set(path, observedTypes);
      }
      for (const type of types) {
        observedTypes.add(type);
      }
    }
  }

  return {
    format: "normalized-path-types-v1",
    complete: true,
    paths: [...pathTypes.entries()]
      .map(([path, types]) => ({
        path,
        types: [...types].sort(compareStrings),
      }))
      .sort((left, right) => compareStrings(left.path, right.path)),
  };
}

async function discoverCompositeRoleContract({
  client,
  endpoint,
  role,
}: {
  client: CompositeDiscoveryClient;
  endpoint: string;
  role: CompositeRole;
}): Promise<TrustedJsonContract> {
  const firstRaw = await client.getJson(endpoint, {
    page_number: 1,
    page_size: PAGE_SIZE,
    included_composite: role,
  });
  const first = parseCompositeDiscoveryPage(firstRaw, 1);

  if (first.totalPages > MAX_COMPOSITE_PAGES) {
    throw new Error("Pancake composite page limit exceeded");
  }
  if (first.totalEntries > MAX_COMPOSITE_ENTRIES) {
    throw new Error("Pancake composite entry limit exceeded");
  }

  const contracts: TrustedJsonContract[] = [describeTrustedJsonContract(first.raw)];
  let traversedEntries = first.entryCount;
  const totalPages = Math.max(1, first.totalPages);

  for (let pageNumber = 2; pageNumber <= totalPages; pageNumber += 1) {
    const raw = await client.getJson(endpoint, {
      page_number: pageNumber,
      page_size: PAGE_SIZE,
      included_composite: role,
    });
    const page = parseCompositeDiscoveryPage(raw, pageNumber);

    if (page.totalPages !== first.totalPages || page.totalEntries !== first.totalEntries) {
      throw new Error("Pancake composite pagination changed during traversal");
    }

    traversedEntries += page.entryCount;
    if (traversedEntries > MAX_COMPOSITE_ENTRIES) {
      throw new Error("Pancake composite entry limit exceeded");
    }
    contracts.push(describeTrustedJsonContract(page.raw));
  }

  if (traversedEntries !== first.totalEntries) {
    throw new Error("Pancake composite entry count does not match the completed traversal");
  }

  return mergeTrustedJsonContracts(contracts);
}

export async function discoverPancakeCompositeContracts({
  client,
  shopId,
}: {
  client: CompositeDiscoveryClient;
  shopId: number;
}) {
  if (!Number.isSafeInteger(shopId) || shopId <= 0) {
    throw new TypeError("Pancake shop id must be a positive safe integer");
  }

  const endpoint = `/shops/${shopId}/products/variations`;
  const parent = await discoverCompositeRoleContract({ client, endpoint, role: "parent" });
  const children = await discoverCompositeRoleContract({ client, endpoint, role: "children" });

  return {
    format: "pancake-composite-contract-discovery-v1" as const,
    parent,
    children,
  };
}

async function runCompositeDiscovery(): Promise<void> {
  assertTrustedCompositeDiscoveryEnvironment();

  const [{ PancakeClient }, { readPancakeConfig }] = await Promise.all([
    import("../src/integrations/pancake/client.ts"),
    import("../src/integrations/pancake/config.ts"),
  ]);
  const config = readPancakeConfig();
  const client = new PancakeClient({ apiKey: config.apiKey });
  const report = await discoverPancakeCompositeContracts({ client, shopId: config.shopId });

  console.log("PANCAKE_COMPOSITE_DISCOVERY_BEGIN");
  console.log(JSON.stringify(report, null, 2));
  console.log("PANCAKE_COMPOSITE_DISCOVERY_END");
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isDirectExecution()) {
  try {
    await runCompositeDiscovery();
  } catch (error) {
    console.error(compositeDiscoveryFailureMessage(error));
    process.exitCode = 1;
  }
}
