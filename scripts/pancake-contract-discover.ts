import { pathToFileURL } from "node:url";

import { PancakeClient } from "../src/integrations/pancake/client.ts";
import { readPancakeConfig } from "../src/integrations/pancake/config.ts";
import { describeTrustedJsonContract } from "../src/integrations/pancake/trusted-json-contract.ts";

const CI_REFUSAL_MESSAGE = "Trusted Pancake contract discovery refuses CI execution";
const SAFE_DISCOVERY_BUDGET_PREFIX = "Trusted JSON discovery exceeded";

function environmentFlagIsEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0" || value.toLowerCase() === "false") {
    return false;
  }

  return true;
}

export function assertTrustedDiscoveryEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (environmentFlagIsEnabled(env.CI) || environmentFlagIsEnabled(env.GITHUB_ACTIONS)) {
    throw new Error(CI_REFUSAL_MESSAGE);
  }
}

async function discoverContracts(): Promise<void> {
  assertTrustedDiscoveryEnvironment();

  const config = readPancakeConfig();
  const client = new PancakeClient({ apiKey: config.apiKey });

  const [productVariations, warehouses] = await Promise.all([
    client.getJson(`/shops/${config.shopId}/products/variations`),
    client.getJson(`/shops/${config.shopId}/warehouses`),
  ]);

  const contracts = {
    productVariations: describeTrustedJsonContract(productVariations),
    warehouses: describeTrustedJsonContract(warehouses),
  };

  console.log("PANCAKE_TRUSTED_CONTRACT_DISCOVERY_BEGIN");
  console.log(JSON.stringify(contracts, null, 2));
  console.log("PANCAKE_TRUSTED_CONTRACT_DISCOVERY_END");
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isDirectExecution()) {
  try {
    await discoverContracts();
  } catch (error) {
    if (error instanceof Error && error.message === CI_REFUSAL_MESSAGE) {
      console.error(CI_REFUSAL_MESSAGE);
    } else if (error instanceof Error && error.message.startsWith(SAFE_DISCOVERY_BUDGET_PREFIX)) {
      console.error(error.message);
    } else {
      console.error("Trusted Pancake contract discovery failed without logging external scalar values");
    }

    process.exitCode = 1;
  }
}
