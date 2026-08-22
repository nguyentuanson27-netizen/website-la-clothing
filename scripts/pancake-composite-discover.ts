import { pathToFileURL } from "node:url";

import { describeTrustedJsonContract } from "../src/integrations/pancake/trusted-json-contract.ts";

type QueryValue = string | number | boolean;
type CompositeDiscoveryClient = {
  getJson(endpoint: string, query?: Readonly<Record<string, QueryValue>>): Promise<unknown>;
};

const CI_REFUSAL_MESSAGE = "Trusted Pancake composite discovery refuses CI execution";
const GENERIC_FAILURE_MESSAGE =
  "Trusted Pancake composite discovery failed without logging external scalar values";
const PAGE_SIZE = 100;

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
  const parents = await client.getJson(endpoint, {
    page_number: 1,
    page_size: PAGE_SIZE,
    included_composite: "parent",
  });
  const children = await client.getJson(endpoint, {
    page_number: 1,
    page_size: PAGE_SIZE,
    included_composite: "children",
  });

  return {
    format: "pancake-composite-contract-discovery-v1" as const,
    parent: describeTrustedJsonContract(parents),
    children: describeTrustedJsonContract(children),
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
