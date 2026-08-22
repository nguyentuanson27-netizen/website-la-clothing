import { prisma } from "../db/prisma.ts";
import { readPancakeShopId } from "../integrations/pancake/config.ts";
import { createStorefrontCatalogRepository } from "./storefront-catalog.ts";
import type { StorefrontDiscoveryQuery } from "./storefront-discovery.ts";
import { createStorefrontProductDetailRepository } from "./storefront-product-detail.ts";
import { createStorefrontProductSlugResolver } from "./storefront-product-slug-resolution.ts";

export async function listConfiguredStorefrontProducts(limit: number) {
  const shopId = readPancakeShopId();
  return createStorefrontCatalogRepository(prisma).listProducts({ shopId, limit });
}

export async function listConfiguredStorefrontProductPage({
  page,
  pageSize,
}: {
  page: number;
  pageSize: number;
}) {
  const shopId = readPancakeShopId();
  return createStorefrontCatalogRepository(prisma).listProductPage({ shopId, page, pageSize });
}

export async function listConfiguredStorefrontDiscoveryPage({
  discovery,
  pageSize,
}: {
  discovery: StorefrontDiscoveryQuery;
  pageSize: number;
}) {
  const shopId = readPancakeShopId();
  return createStorefrontCatalogRepository(prisma).listDiscoveryPage({
    shopId,
    discovery,
    pageSize,
  });
}

export async function listConfiguredStorefrontDiscoveryFacets() {
  const shopId = readPancakeShopId();
  return createStorefrontCatalogRepository(prisma).listDiscoveryFacets({ shopId });
}

export async function getConfiguredStorefrontProductBySlug(slug: string) {
  const shopId = readPancakeShopId();
  return createStorefrontProductDetailRepository(prisma).getProductBySlug({ shopId, slug });
}

export async function resolveConfiguredStorefrontProductSlug(slug: string) {
  const shopId = readPancakeShopId();
  return createStorefrontProductSlugResolver(prisma)({ shopId, slug });
}
