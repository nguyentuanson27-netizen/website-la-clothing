import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { ANONYMOUS_CART_MAX_DISTINCT_ITEMS } from "./anonymous-cart.ts";
import { buildStorefrontCartLines } from "./storefront-cart.ts";

const MAX_POSTGRES_INTEGER = 2_147_483_647;

type CartItemIdentity = {
  variantId: string;
  quantity: number;
};

function parseShopId(shopId: number): number {
  if (!Number.isSafeInteger(shopId) || shopId <= 0 || shopId > MAX_POSTGRES_INTEGER) {
    throw new RangeError("Storefront cart shop id must fit a positive PostgreSQL INTEGER");
  }
  return shopId;
}

function parseItems(items: readonly CartItemIdentity[]): readonly CartItemIdentity[] {
  if (items.length > ANONYMOUS_CART_MAX_DISTINCT_ITEMS) {
    throw new RangeError(
      `Storefront cart cannot resolve more than ${ANONYMOUS_CART_MAX_DISTINCT_ITEMS} lines`,
    );
  }
  return items;
}

function sumWarehouseStocks(stocks: readonly { quantity: number }[]): number {
  let total = 0;
  for (const stock of stocks) {
    if (!Number.isFinite(stock.quantity)) {
      throw new Error("Storefront cart contains malformed warehouse quantity");
    }
    total += stock.quantity;
    if (!Number.isFinite(total)) {
      throw new Error("Storefront cart stock total is outside numeric bounds");
    }
  }
  return total;
}

function parseJsonStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

const productSelection = {
  slug: true,
  name: true,
  primaryImageUrl: true,
  isPresent: true,
  isActive: true,
  variants: {
    orderBy: [{ pancakeVariationId: "asc" as const }],
    select: {
      id: true,
      isPresent: true,
      isActive: true,
      color: true,
      size: true,
      pancakeRetailPrice: true,
      pancakeRetailPriceAfterDiscount: true,
      pancakeImageUrls: true,
      warehouseStocks: {
        orderBy: [{ pancakeWarehouseId: "asc" as const }],
        select: { quantity: true },
      },
    },
  },
} satisfies Prisma.ProductMirrorSelect;

type SelectedProduct = Prisma.ProductMirrorGetPayload<{ select: typeof productSelection }>;

function toCartProduct(product: SelectedProduct) {
  return {
    slug: product.slug,
    name: product.name,
    primaryImageUrl: product.primaryImageUrl,
    isPresent: product.isPresent,
    isActive: product.isActive,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      isPresent: variant.isPresent,
      isActive: variant.isActive,
      color: variant.color,
      size: variant.size,
      sellableStock: sumWarehouseStocks(variant.warehouseStocks),
      retailPrice: variant.pancakeRetailPrice,
      retailPriceAfterDiscount: variant.pancakeRetailPriceAfterDiscount,
      imageUrls: parseJsonStringArray(variant.pancakeImageUrls),
    })),
  };
}

export function createStorefrontCartRepository(client: PrismaClient) {
  async function getLines({
    shopId,
    items,
  }: {
    shopId: number;
    items: readonly CartItemIdentity[];
  }) {
    const safeItems = parseItems(items);
    if (safeItems.length === 0) return [];

    const variantIds = safeItems.map(({ variantId }) => variantId);
    const products = await client.productMirror.findMany({
      where: {
        pancakeShopId: parseShopId(shopId),
        variants: {
          some: {
            id: { in: variantIds },
          },
        },
      },
      select: productSelection,
    });

    return buildStorefrontCartLines({
      items: safeItems,
      products: products.map(toCartProduct),
    });
  }

  return { getLines };
}
