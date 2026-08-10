import { pathToFileURL } from "node:url";

import { PancakeClient } from "../src/integrations/pancake/client.ts";
import { readPancakeConfig } from "../src/integrations/pancake/config.ts";
import {
  buildPancakeStockProbe,
  PancakeStockProbeError,
} from "../src/integrations/pancake/stock-probe.ts";

const CI_REFUSAL_MESSAGE = "Trusted Pancake stock probe refuses CI execution";
const USAGE_MESSAGE =
  "Usage: pnpm pancake:stock:probe -- <variation id | display_id | barcode>";

function environmentFlagIsEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0" || value.toLowerCase() === "false") {
    return false;
  }
  return true;
}

export function assertTrustedStockProbeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (environmentFlagIsEnabled(env.CI) || environmentFlagIsEnabled(env.GITHUB_ACTIONS)) {
    throw new Error(CI_REFUSAL_MESSAGE);
  }
}

async function runStockProbe(): Promise<void> {
  assertTrustedStockProbeEnvironment();

  const selector = process.argv[2]?.trim();
  if (!selector || process.argv.length !== 3) {
    throw new PancakeStockProbeError(USAGE_MESSAGE);
  }

  const config = readPancakeConfig();
  const client = new PancakeClient({ apiKey: config.apiKey });
  const payload = await client.getJson(`/shops/${config.shopId}/products/variations`);
  const probe = buildPancakeStockProbe(payload, selector);

  console.log("PANCAKE_STOCK_PROBE_BEGIN");
  console.log(JSON.stringify(probe, null, 2));
  console.log("PANCAKE_STOCK_PROBE_END");
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isDirectExecution()) {
  try {
    await runStockProbe();
  } catch (error) {
    if (error instanceof Error && error.message === CI_REFUSAL_MESSAGE) {
      console.error(CI_REFUSAL_MESSAGE);
    } else if (error instanceof PancakeStockProbeError) {
      console.error(error.message);
    } else {
      console.error("Trusted Pancake stock probe failed without logging Pancake credentials or raw payloads");
    }
    process.exitCode = 1;
  }
}
