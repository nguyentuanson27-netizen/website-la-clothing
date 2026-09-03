import { prisma } from "../db/prisma.ts";
import { readPancakeShopId } from "../integrations/pancake/config.ts";
import { createStorefrontCatalogRepository } from "./storefront-catalog.ts";
import {
  parseStorefrontDiscoverySearchParams,
  type StorefrontDiscoveryQuery,
} from "./storefront-discovery.ts";
import { createStorefrontProductDetailRepository } from "./storefront-product-detail.ts";
import { listRelatedStorefrontProducts } from "./storefront-related-products.ts";
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
  now,
}: {
  discovery: StorefrontDiscoveryQuery;
  pageSize: number;
  /** The caller's request clock, so counting, ordering and card pricing share one instant. */
  now?: Date;
}) {
  const shopId = readPancakeShopId();
  return createStorefrontCatalogRepository(prisma).listDiscoveryPage({
    shopId,
    discovery,
    pageSize,
    now,
  });
}

export async function listConfiguredStorefrontDiscoveryFacets() {
  const shopId = readPancakeShopId();
  return createStorefrontCatalogRepository(prisma).listDiscoveryFacets({ shopId });
}

export async function getConfiguredStorefrontProductBySlug(slug: string, now?: Date) {
  const shopId = readPancakeShopId();
  // `now` is threaded rather than defaulted deeper so a caller that already owns a request clock
  // can price every surface of one request against the same instant.
  return createStorefrontProductDetailRepository(prisma).getProductBySlug({ shopId, slug, now });
}

export async function listConfiguredRelatedStorefrontProducts(
  currentProduct: Readonly<{
    id: string;
    collections: readonly Readonly<{ slug: string }>[];
  }>,
) {
  const shopId = readPancakeShopId();
  const catalog = createStorefrontCatalogRepository(prisma);

  return listRelatedStorefrontProducts({
    currentProduct,
    listCollectionProducts: async (collectionSlug, limit) => {
      const discovery = parseStorefrontDiscoverySearchParams({
        collection: collectionSlug,
      });
      const page = await catalog.listDiscoveryPage({
        shopId,
        discovery,
        pageSize: limit,
      });
      return page.products;
    },
  });
}

export async function resolveConfiguredStorefrontProductSlug(slug: string) {
  const shopId = readPancakeShopId();
  return createStorefrontProductSlugResolver(prisma)({ shopId, slug });
}
