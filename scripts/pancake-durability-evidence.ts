import { pathToFileURL } from "node:url";

import { createCatalogMirrorRepository } from "../src/commerce/catalog-mirror-repository.ts";
import { syncPancakeCatalog } from "../src/commerce/catalog-sync.ts";
import {
  compareCatalogSnapshots,
  createCatalogIdSnapshot,
  type CatalogIdSnapshot,
} from "../src/commerce/merchant-identity-durability.ts";
import { PancakeClient } from "../src/integrations/pancake/client.ts";
import { readPancakeConfig } from "../src/integrations/pancake/config.ts";

const CI_REFUSAL_MESSAGE = "Trusted Pancake durability evidence script refuses CI execution";
const RUNS_COUNT = 3;

function environmentFlagIsEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0" || value.toLowerCase() === "false") {
    return false;
  }
  return true;
}

export function assertTrustedDurabilityEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (environmentFlagIsEnabled(env.CI) || environmentFlagIsEnabled(env.GITHUB_ACTIONS)) {
    throw new Error(CI_REFUSAL_MESSAGE);
  }
}

export async function runDurabilityEvidence(options: {
  runs?: number;
  delayMs?: number;
} = {}): Promise<ReturnType<typeof compareCatalogSnapshots>> {
  assertTrustedDurabilityEnvironment();

  const config = readPancakeConfig();
  const pancake = new PancakeClient({ apiKey: config.apiKey });
  const { prisma } = await import("../src/db/prisma.ts");
  const repository = createCatalogMirrorRepository(prisma);
  const runs = options.runs ?? RUNS_COUNT;
  const delayMs = options.delayMs ?? 1000;

  const snapshots: CatalogIdSnapshot[] = [];

  for (let runIndex = 0; runIndex < runs; runIndex += 1) {
    const syncedAt = new Date();
    await syncPancakeCatalog({
      client: pancake,
      repository,
      shopId: config.shopId,
      syncedAt,
    });

    const products = await prisma.productMirror.findMany({
      where: { pancakeShopId: config.shopId, isPresent: true },
      select: { pancakeProductId: true },
      orderBy: { pancakeProductId: "asc" },
    });

    const variants = await prisma.variantMirror.findMany({
      where: {
        isPresent: true,
        product: { is: { pancakeShopId: config.shopId, isPresent: true } },
      },
      select: { pancakeVariationId: true, id: true },
      orderBy: { pancakeVariationId: "asc" },
    });

    const internalVariantIdMap: Record<string, string> = {};
    for (const v of variants) {
      internalVariantIdMap[v.pancakeVariationId] = v.id;
    }

    const snapshot = createCatalogIdSnapshot({
      runIndex,
      timestamp: syncedAt.toISOString(),
      shopId: config.shopId,
      productExternalIds: products.map((p) => p.pancakeProductId),
      variationExternalIds: variants.map((v) => v.pancakeVariationId),
      internalVariantIdMap,
    });

    snapshots.push(snapshot);

    if (runIndex < runs - 1 && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return compareCatalogSnapshots(snapshots);
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isDirectExecution()) {
  try {
    const result = await runDurabilityEvidence();
    console.log("PANCAKE_DURABILITY_EVIDENCE_BEGIN");
    console.log(JSON.stringify(result, null, 2));
    console.log("PANCAKE_DURABILITY_EVIDENCE_END");
  } catch (error) {
    console.error(`Durability evidence failed: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  } finally {
    try {
      const { prisma } = await import("../src/db/prisma.ts");
      await prisma.$disconnect();
    } catch {
      // Ignore cleanup error if prisma was never initialized
    }
  }
}
