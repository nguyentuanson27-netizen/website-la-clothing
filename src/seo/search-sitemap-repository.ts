import type { PrismaClient } from "../generated/prisma/client.ts";

const MAX_POSTGRES_INTEGER = 2_147_483_647;
export const MAX_DYNAMIC_SITEMAP_PATHS = 49_996;

function parseShopId(shopId: number): number {
  if (!Number.isSafeInteger(shopId) || shopId <= 0 || shopId > MAX_POSTGRES_INTEGER) {
    throw new RangeError("Sitemap shop id must fit a positive PostgreSQL INTEGER");
  }
  return shopId;
}

export function createSearchSitemapRepository(client: PrismaClient) {
  return {
    async listCanonicalPaths({ shopId }: { shopId: number }): Promise<string[]> {
      const safeShopId = parseShopId(shopId);

      const [productCount, collectionCount] = await Promise.all([
        client.productMirror.count({
          where: {
            pancakeShopId: safeShopId,
            isPresent: true,
            isActive: true,
          },
        }),
        client.collectionDefinition.count({
          where: { isPublished: true },
        }),
      ]);

      if (productCount + collectionCount > MAX_DYNAMIC_SITEMAP_PATHS) {
        throw new RangeError("Canonical sitemap exceeds the single-sitemap URL budget");
      }

      const [products, collections] = await Promise.all([
        client.productMirror.findMany({
          where: {
            pancakeShopId: safeShopId,
            isPresent: true,
            isActive: true,
          },
          select: { slug: true },
          orderBy: { slug: "asc" },
        }),
        client.collectionDefinition.findMany({
          where: { isPublished: true },
          select: { slug: true },
          orderBy: { slug: "asc" },
        }),
      ]);

      return [
        ...collections.map((collection) => `/collections/${collection.slug}`),
        ...products.map((product) => `/shop/${product.slug}`),
      ];
    },
  };
}
