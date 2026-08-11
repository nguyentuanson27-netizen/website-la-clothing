import { prisma } from "../db/prisma.ts";
import { readPancakeConfig } from "../integrations/pancake/config.ts";
import { createStorefrontCatalogRepository } from "./storefront-catalog.ts";

export async function listConfiguredStorefrontProducts(limit: number) {
  const { shopId } = readPancakeConfig();
  return createStorefrontCatalogRepository(prisma).listProducts({ shopId, limit });
}

export async function getConfiguredStorefrontProductBySlug(slug: string) {
  const { shopId } = readPancakeConfig();
  return createStorefrontCatalogRepository(prisma).getProductBySlug({ shopId, slug });
}
