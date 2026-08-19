import { pathToFileURL } from "node:url";

import type { PrismaClient } from "../src/generated/prisma/client.ts";
import {
  runCurrentPancakeCatalogAudit,
  type CurrentCatalogScope,
} from "../src/integrations/pancake/catalog-audit-current.ts";
import { PancakeClient } from "../src/integrations/pancake/client.ts";
import { readPancakeConfig } from "../src/integrations/pancake/config.ts";

const CI_REFUSAL_MESSAGE = "Trusted Pancake catalog audit refuses CI execution";
const GENERIC_FAILURE_MESSAGE =
  "Trusted Pancake catalog audit failed without logging credentials or raw Pancake payload values";
const CURRENT_SCOPE_LIMIT = 50_000;

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

export async function readCurrentStorefrontScope(
  client: PrismaClient,
  shopId: number,
): Promise<CurrentCatalogScope> {
  const [products, variations] = await Promise.all([
    client.productMirror.findMany({
      where: {
        pancakeShopId: shopId,
        isPresent: true,
        isActive: true,
      },
      select: {
        pancakeProductId: true,
      },
      orderBy: {
        pancakeProductId: "asc",
      },
      take: CURRENT_SCOPE_LIMIT + 1,
    }),
    client.variantMirror.findMany({
      where: {
        isPresent: true,
        isActive: true,
        product: {
          is: {
            pancakeShopId: shopId,
            isPresent: true,
            isActive: true,
          },
        },
      },
      select: {
        pancakeVariationId: true,
      },
      orderBy: {
        pancakeVariationId: "asc",
      },
      take: CURRENT_SCOPE_LIMIT + 1,
    }),
  ]);

  if (products.length > CURRENT_SCOPE_LIMIT || variations.length > CURRENT_SCOPE_LIMIT) {
    throw new Error("Current storefront scope exceeds Pancake catalog audit limits");
  }

  return {
    productIds: new Set(products.map(({ pancakeProductId }) => pancakeProductId)),
    variationIds: new Set(variations.map(({ pancakeVariationId }) => pancakeVariationId)),
  };
}

async function runCatalogAudit(): Promise<void> {
  assertTrustedCatalogAuditEnvironment();

  const config = readPancakeConfig();
  const pancake = new PancakeClient({ apiKey: config.apiKey });
  const { prisma } = await import("../src/db/prisma.ts");

  try {
    const currentScope = await readCurrentStorefrontScope(prisma, config.shopId);
    const report = await runCurrentPancakeCatalogAudit({
      client: pancake,
      shopId: config.shopId,
      currentScope,
    });

    console.log("PANCAKE_CATALOG_AUDIT_BEGIN");
    console.log(JSON.stringify(report, null, 2));
    console.log("PANCAKE_CATALOG_AUDIT_END");
  } finally {
    await prisma.$disconnect();
  }
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
