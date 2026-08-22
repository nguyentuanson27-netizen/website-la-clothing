import { pathToFileURL } from "node:url";

import type { PancakeCompositeSnapshot } from "../src/integrations/pancake/composite-contract.ts";
import { fetchPancakeCompositeSnapshot } from "../src/integrations/pancake/composite-pages.ts";

const CI_REFUSAL_MESSAGE = "Trusted Pancake composite invariant probe refuses CI execution";
const GENERIC_FAILURE_MESSAGE =
  "Trusted Pancake composite invariant probe failed without logging external scalar values";

type Environment = Readonly<Record<string, string | undefined>>;

function environmentFlagIsEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0" || value.toLowerCase() === "false") {
    return false;
  }
  return true;
}

export function assertTrustedCompositeInvariantEnvironment(
  env: Environment = process.env,
): void {
  if (environmentFlagIsEnabled(env.CI) || environmentFlagIsEnabled(env.GITHUB_ACTIONS)) {
    throw new Error(CI_REFUSAL_MESSAGE);
  }
}

export function compositeInvariantFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message === CI_REFUSAL_MESSAGE) {
    return CI_REFUSAL_MESSAGE;
  }
  return GENERIC_FAILURE_MESSAGE;
}

export function buildCompositeInvariantReport(snapshot: PancakeCompositeSnapshot) {
  return {
    format: "pancake-composite-invariants-v1" as const,
    complete: true,
    counts: {
      parentVariations: snapshot.parentVariationIds.length,
      componentVariations: snapshot.componentVariationIds.length,
      edges: snapshot.edges.length,
    },
    invariants: {
      parentIdentityConsistent: true,
      componentIdentityConsistent: true,
      configuredShopConsistent: true,
      directComponentsOnly: true,
      positiveIntegerQuantities: true,
      duplicateParentComponentPairs: false,
      unresolvedComponents: false,
      overlappingParentChildRoles: false,
    },
  };
}

async function runCompositeInvariantProbe(): Promise<void> {
  assertTrustedCompositeInvariantEnvironment();

  const [{ PancakeClient }, { readPancakeConfig }] = await Promise.all([
    import("../src/integrations/pancake/client.ts"),
    import("../src/integrations/pancake/config.ts"),
  ]);
  const config = readPancakeConfig();
  const snapshot = await fetchPancakeCompositeSnapshot({
    client: new PancakeClient({ apiKey: config.apiKey }),
    shopId: config.shopId,
  });
  const report = buildCompositeInvariantReport(snapshot);

  console.log("PANCAKE_COMPOSITE_INVARIANTS_BEGIN");
  console.log(JSON.stringify(report, null, 2));
  console.log("PANCAKE_COMPOSITE_INVARIANTS_END");
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isDirectExecution()) {
  try {
    await runCompositeInvariantProbe();
  } catch (error) {
    console.error(compositeInvariantFailureMessage(error));
    process.exitCode = 1;
  }
}
