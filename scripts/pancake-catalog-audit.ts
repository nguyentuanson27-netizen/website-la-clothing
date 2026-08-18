import { pathToFileURL } from "node:url";

import { runPancakeCatalogAudit } from "../src/integrations/pancake/catalog-audit.ts";
import { PancakeClient } from "../src/integrations/pancake/client.ts";
import { readPancakeConfig } from "../src/integrations/pancake/config.ts";

const CI_REFUSAL_MESSAGE = "Trusted Pancake catalog audit refuses CI execution";
const GENERIC_FAILURE_MESSAGE =
  "Trusted Pancake catalog audit failed without logging credentials or raw Pancake payload values";

function environmentFlagIsEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0" || value.toLowerCase() === "false") {
    return false;
  }
  return true;
}

export function assertTrustedCatalogAuditEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (environmentFlagIsEnabled(env.CI) || environmentFlagIsEnabled(env.GITHUB_ACTIONS)) {
    throw new Error(CI_REFUSAL_MESSAGE);
  }
}

export function catalogAuditFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message === CI_REFUSAL_MESSAGE) {
    return CI_REFUSAL_MESSAGE;
  }
  return GENERIC_FAILURE_MESSAGE;
}

async function runCatalogAudit(): Promise<void> {
  assertTrustedCatalogAuditEnvironment();

  const config = readPancakeConfig();
  const client = new PancakeClient({ apiKey: config.apiKey });
  const report = await runPancakeCatalogAudit({ client, shopId: config.shopId });

  console.log("PANCAKE_CATALOG_AUDIT_BEGIN");
  console.log(JSON.stringify(report, null, 2));
  console.log("PANCAKE_CATALOG_AUDIT_END");
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isDirectExecution()) {
  try {
    await runCatalogAudit();
  } catch (error) {
    console.error(catalogAuditFailureMessage(error));
    process.exitCode = 1;
  }
}
