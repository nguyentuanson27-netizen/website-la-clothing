import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";

const MAX_STOREFRONT_PRODUCTS = 48;
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_STOREFRONT_SLUG_LENGTH = 160;

function parseShopId(shopId: number): number {
  if (!Number.isSafeInteger(shopId) || shopId <= 0 || shopId > MAX_POSTGRES_INTEGER) {
    throw new RangeError("Storefront shop id must fit a positive PostgreSQL INTEGER");
  }
  return shopId;
}

function parseListLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_STOREFRONT_PRODUCTS) {
    throw new RangeError(
      `Storefront product list limit must be between 1 and ${MAX_STOREFRONT_PRODUCTS}`,
    );
  }
  return limit;
}

function parseSlug(slug: string): string {
  if (
    typeof slug !== "string" ||
    slug.length < 1 ||
    slug.length > MAX_STOREFRONT_SLUG_LENGTH ||
    slug !== slug.trim()
  ) {
    throw new RangeError("Storefront product slug is invalid");
  }
  return slug;
}

function sumWarehouseStocks(stocks: readonly { quantity: number }[]): number {
  let total = 0;
  for (const stock of stocks) {
    if (!Number.isFinite(stock.quantity)) {
      throw new Error("Storefront catalog contains malformed warehouse quantity");
    }
    total += stock.quantity;
    if (!Number.isFinite(total)) {
      throw new Error("Storefront catalog stock total is outside numeric bounds");
    }
  }
  return total;
}

const productSelection = {
  id: true,
  slug: true,
  name: true,
  content: {
    select: {
      editorialDescription: true,
      careInstructions: true,
      sizeGuide: true,
      seoTitle: true,
      seoDescription: true,
    },
  },
  variants: {
    where: { isPresent: true, isActive: true },
    orderBy: [{ pancakeVariationId: "asc" }],
    select: {
      id: true,
      pancakeVariationId: true,
      color: true,
      size: true,
      pancakeRetailPrice: true,
      pancakeRetailPriceAfterDiscount: true,
      warehouseStocks: {
        orderBy: [{ pancakeWarehouseId: "asc" }],
        select: { quantity: true },
      },
    },
  },
} satisfies Prisma.ProductMirrorSelect;

type SelectedProduct = Prisma.ProductMirrorGetPayload<{ select: typeof productSelection }>;

function toStorefrontProduct(product: SelectedProduct) {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    editorialDescription: product.content?.editorialDescription ?? null,
    careInstructions: product.content?.careInstructions ?? null,
    sizeGuide: product.content?.sizeGuide ?? null,
    seoTitle: product.content?.seoTitle ?? null,
    seoDescription: product.content?.seoDescription ?? null,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      pancakeVariationId: variant.pancakeVariationId,
      color: variant.color,
      size: variant.size,
      retailPrice: variant.pancakeRetailPrice,
      retailPriceAfterDiscount: variant.pancakeRetailPriceAfterDiscount,
      sellableStock: sumWarehouseStocks(variant.warehouseStocks),
    })),
  };
}

export function createStorefrontCatalogRepository(client: PrismaClient) {
  async function listProducts({ shopId, limit }: { shopId: number; limit: number }) {
    const products = await client.productMirror.findMany({
      where: {
        pancakeShopId: parseShopId(shopId),
        isPresent: true,
        isActive: true,
      },
      take: parseListLimit(limit),
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: productSelection,
    });

    return products.map((product) => toStorefrontProduct(product));
  }

  async function getProductBySlug({ shopId, slug }: { shopId: number; slug: string }) {
    const product = await client.productMirror.findFirst({
      where: {
        pancakeShopId: parseShopId(shopId),
        slug: parseSlug(slug),
        isPresent: true,
        isActive: true,
      },
      select: productSelection,
    });

    return product ? toStorefrontProduct(product) : null;
  }

  return { listProducts, getProductBySlug };
}
