import { pathToFileURL } from "node:url";

import type { PancakeParsedCatalogVariation } from "../src/integrations/pancake/catalog-contract.ts";
import { fetchAllPancakeCatalogVariations } from "../src/integrations/pancake/catalog-pages.ts";
import type {
  PancakeCompositeSnapshot,
  PancakeCompositeVariationIdentity,
} from "../src/integrations/pancake/composite-contract.ts";
import { fetchPancakeCompositeSnapshot } from "../src/integrations/pancake/composite-pages.ts";

const CI_REFUSAL_MESSAGE = "Trusted Pancake composite invariant probe refuses CI execution";
const GENERIC_FAILURE_MESSAGE =
  "Trusted Pancake composite invariant probe failed without logging external scalar values";

type Environment = Readonly<Record<string, string | undefined>>;
type CatalogIdentity = Readonly<Pick<PancakeParsedCatalogVariation, "id" | "productId">>;

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

function buildCatalogIdentityIndex(catalogIdentities: readonly CatalogIdentity[]) {
  const productIdByVariationId = new Map<string, string>();
  const duplicateVariationIds = new Set<string>();

  for (const identity of catalogIdentities) {
    if (productIdByVariationId.has(identity.id)) {
      duplicateVariationIds.add(identity.id);
      continue;
    }
    productIdByVariationId.set(identity.id, identity.productId);
  }

  return { productIdByVariationId, duplicateVariationIds };
}

function compositeIdentitiesMatchCatalog(
  identities: readonly PancakeCompositeVariationIdentity[],
  productIdByVariationId: ReadonlyMap<string, string>,
  duplicateVariationIds: ReadonlySet<string>,
): boolean {
  return identities.every(
    ({ variationId, productId }) =>
      !duplicateVariationIds.has(variationId) &&
      productIdByVariationId.get(variationId) === productId,
  );
}

export function buildCompositeInvariantReport(
  snapshot: PancakeCompositeSnapshot,
  catalogIdentities: readonly CatalogIdentity[],
) {
  const { productIdByVariationId, duplicateVariationIds } =
    buildCatalogIdentityIndex(catalogIdentities);
  const parentIdentityConsistent = compositeIdentitiesMatchCatalog(
    snapshot.parentIdentities,
    productIdByVariationId,
    duplicateVariationIds,
  );
  const componentIdentityConsistent = compositeIdentitiesMatchCatalog(
    snapshot.componentIdentities,
    productIdByVariationId,
    duplicateVariationIds,
  );

  return {
    format: "pancake-composite-invariants-v1" as const,
    complete: true,
    counts: {
      parentVariations: snapshot.parentVariationIds.length,
      componentVariations: snapshot.componentVariationIds.length,
      edges: snapshot.edges.length,
    },
    invariants: {
      parentIdentityConsistent,
      componentIdentityConsistent,
      configuredShopConsistent: true,
      directComponentsOnly: true,
      positiveIntegerQuantities: true,
      duplicateParentComponentPairs: false,
      unresolvedComponents: false,
      overlappingParentChildRoles: false,
    },
  };
}

function reportIdentityReady(report: ReturnType<typeof buildCompositeInvariantReport>): boolean {
  return (
    report.invariants.parentIdentityConsistent && report.invariants.componentIdentityConsistent
  );
}

async function runCompositeInvariantProbe(): Promise<void> {
  assertTrustedCompositeInvariantEnvironment();

  const [{ PancakeClient }, { readPancakeConfig }] = await Promise.all([
    import("../src/integrations/pancake/client.ts"),
    import("../src/integrations/pancake/config.ts"),
  ]);
  const config = readPancakeConfig();
  const client = new PancakeClient({ apiKey: config.apiKey });
  const catalogVariations = await fetchAllPancakeCatalogVariations({
    client,
    shopId: config.shopId,
  });
  const snapshot = await fetchPancakeCompositeSnapshot({
    client,
    shopId: config.shopId,
  });
  const report = buildCompositeInvariantReport(snapshot, catalogVariations);

  console.log("PANCAKE_COMPOSITE_INVARIANTS_BEGIN");
  console.log(JSON.stringify(report, null, 2));
  console.log("PANCAKE_COMPOSITE_INVARIANTS_END");

  if (!reportIdentityReady(report)) {
    process.exitCode = 1;
  }
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
