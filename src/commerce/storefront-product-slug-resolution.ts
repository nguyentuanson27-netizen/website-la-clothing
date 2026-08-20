import type { PrismaClient } from "../generated/prisma/client.ts";

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_STOREFRONT_SLUG_LENGTH = 160;

export type StorefrontProductSlugResolution =
  | { kind: "CURRENT" }
  | { kind: "HISTORICAL"; currentSlug: string }
  | { kind: "UNKNOWN" };

function parseShopId(shopId: number): number {
  if (!Number.isSafeInteger(shopId) || shopId <= 0 || shopId > MAX_POSTGRES_INTEGER) {
    throw new RangeError("Storefront shop id must fit a positive PostgreSQL INTEGER");
  }
  return shopId;
}

function parsePublicSlug(slug: string): string | null {
  if (
    typeof slug !== "string" ||
    slug.length < 1 ||
    slug.length > MAX_STOREFRONT_SLUG_LENGTH ||
    slug !== slug.trim()
  ) {
    return null;
  }
  return slug;
}

export function createStorefrontProductSlugResolver(client: PrismaClient) {
  return async function resolveProductSlug({
    shopId,
    slug,
  }: {
    shopId: number;
    slug: string;
  }): Promise<StorefrontProductSlugResolution> {
    const safeShopId = parseShopId(shopId);
    const safeSlug = parsePublicSlug(slug);
    if (!safeSlug) return { kind: "UNKNOWN" };

    const current = await client.productMirror.findFirst({
      where: {
        pancakeShopId: safeShopId,
        isPresent: true,
        isActive: true,
        slug: safeSlug,
      },
      select: { id: true },
    });
    if (current) return { kind: "CURRENT" };

    const historical = await client.productSlugHistory.findUnique({
      where: { slug: safeSlug },
      select: {
        product: {
          select: {
            slug: true,
            pancakeShopId: true,
            isPresent: true,
            isActive: true,
          },
        },
      },
    });

    if (
      !historical ||
      historical.product.pancakeShopId !== safeShopId ||
      !historical.product.isPresent ||
      !historical.product.isActive
    ) {
      return { kind: "UNKNOWN" };
    }

    return { kind: "HISTORICAL", currentSlug: historical.product.slug };
  };
}
