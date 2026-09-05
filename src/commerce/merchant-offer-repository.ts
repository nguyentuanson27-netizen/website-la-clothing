import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";

import {
  mapMerchantOffers,
  type MerchantCandidateProduct,
  type MerchantCandidateVariation,
  type MerchantMappingResult,
} from "./merchant-offer-mapper.ts";
import {
  MAX_MERCHANT_CANDIDATE_VARIANTS,
  MAX_MERCHANT_PROMOTION_VARIANTS_PER_QUERY,
} from "./merchant-feed-limits.ts";
import {
  readApplicablePromotionCampaignsForKnownVariants,
  type PromotionCandidateReadClient,
} from "./promotion-candidate-repository.ts";
import type { ApplicablePromotionCampaign } from "./promotion-pricing.ts";
import {
  resolveStorefrontProductMedia,
  resolveVariantGalleryIndexes,
} from "./product-media.ts";
import { buildStorefrontProductProjection } from "./storefront-projection.ts";
import { buildPromotionalStorefrontPricing } from "./storefront-promotion-projection.ts";
import type { StorefrontVariantFacts } from "./storefront-product.ts";
import { toMerchantApparelWireValues } from "./merchant-apparel-facts.ts";
import { INHERITED_APPAREL_OVERRIDES } from "./product-merchant-facts-repository.ts";

const MAX_POSTGRES_INTEGER = 2_147_483_647;
export const MAX_MERCHANT_CANDIDATE_PRODUCTS = 5_000;
export class MerchantOfferReadError extends Error {}

const candidateSelection = {
  id: true,
  pancakeProductId: true,
  slug: true,
  name: true,
  primaryImageUrl: true,
  content: { select: { status: true, editorialDescription: true } },
  merchantFacts: { select: { gender: true, ageGroup: true, condition: true } },
  variants: {
    where: { isPresent: true, isActive: true },
    orderBy: [{ pancakeVariationId: "asc" }],
    select: {
      id: true,
      pancakeVariationId: true,
      pancakeDisplayId: true,
      color: true,
      size: true,
      pancakeRetailPrice: true,
      pancakeRetailPriceAfterDiscount: true,
      pancakeImageUrls: true,
      warehouseStocks: { orderBy: [{ pancakeWarehouseId: "asc" }], select: { quantity: true } },
      compositeParents: { select: { parentVariantId: true }, take: 1 },
      compositeComponents: { select: { componentVariantId: true }, take: 1 },
    },
  },
} satisfies Prisma.ProductMirrorSelect;

type SelectedCandidateProduct = Prisma.ProductMirrorGetPayload<{ select: typeof candidateSelection }>;

function aggregateWarehouseStock(quantities: readonly number[]): number {
  for (const quantity of quantities) {
    if (!Number.isFinite(quantity) || quantity < 0) return Number.NaN;
  }
  return quantities.reduce((total, quantity) => total + quantity, 0);
}

function parseJsonStringArray(value: Prisma.JsonValue): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function toCandidateProduct(
  product: SelectedCandidateProduct,
  campaignsByVariantId: ReadonlyMap<string, readonly ApplicablePromotionCampaign[]>,
  now: Date,
): MerchantCandidateProduct {
  const variantImageUrls = product.variants.map((variant) => parseJsonStringArray(variant.pancakeImageUrls));
  const media = resolveStorefrontProductMedia({
    productName: product.name,
    primaryImageUrl: product.primaryImageUrl,
    variantImageUrls,
  });
  const galleryIndexByVariantId = resolveVariantGalleryIndexes({
    gallery: media.gallery,
    variants: product.variants.map((variant, index) => ({
      id: variant.id,
      imageUrls: variantImageUrls[index] ?? [],
    })),
  });
  const stockByVariantId = new Map(
    product.variants.map((variant) => [
      variant.id,
      aggregateWarehouseStock(variant.warehouseStocks.map((stock) => stock.quantity)),
    ]),
  );
  const parentVariants: StorefrontVariantFacts[] = product.variants.map((variant) => ({
    id: variant.id,
    pancakeVariationId: variant.pancakeVariationId,
    color: variant.color,
    size: variant.size,
    sellableStock: stockByVariantId.get(variant.id) ?? Number.NaN,
    retailPrice: variant.pancakeRetailPrice,
    retailPriceAfterDiscount: variant.pancakeRetailPriceAfterDiscount,
  }));
  const hasCompositeGraph = product.variants.some((variant) => variant.compositeComponents.length > 0);
  const variations: MerchantCandidateVariation[] = product.variants.map((variant) => ({
    variantId: variant.id,
    pancakeVariationId: variant.pancakeVariationId,
    pancakeDisplayId: variant.pancakeDisplayId,
    isComposite: variant.compositeParents.length > 0 || variant.compositeComponents.length > 0,
    stockQuantity: stockByVariantId.get(variant.id) ?? Number.NaN,
  }));

  return {
    pancakeProductId: product.pancakeProductId,
    slug: product.slug,
    name: product.name,
    publishedDescription:
      product.content?.status === "PUBLISHED" ? product.content.editorialDescription : null,
    media,
    galleryIndexByVariantId,
    projection: buildStorefrontProductProjection({
      parentVariants,
      componentGroups: [],
      hasCompositeGraph,
      pricingRule: buildPromotionalStorefrontPricing({ campaignsByVariantId, now }),
    }),
    apparelOverrides:
      product.merchantFacts === null
        ? INHERITED_APPAREL_OVERRIDES
        : toMerchantApparelWireValues(product.merchantFacts),
    variations,
  };
}

export function createMerchantOfferRepository(client: PrismaClient) {
  async function readCandidateProducts({
    shopId,
    now = new Date(),
  }: Readonly<{ shopId: number; now?: Date }>): Promise<MerchantCandidateProduct[]> {
    if (!Number.isSafeInteger(shopId) || shopId <= 0 || shopId > MAX_POSTGRES_INTEGER) {
      throw new MerchantOfferReadError("Merchant shop id must fit a positive PostgreSQL INTEGER");
    }

    const products = await client.productMirror.findMany({
      relationLoadStrategy: "join",
      where: { pancakeShopId: shopId, isPresent: true, isActive: true },
      select: candidateSelection,
      orderBy: [{ pancakeProductId: "asc" }],
      take: MAX_MERCHANT_CANDIDATE_PRODUCTS + 1,
    });
    if (products.length > MAX_MERCHANT_CANDIDATE_PRODUCTS) {
      throw new MerchantOfferReadError(
        `Catalog exceeds the Merchant candidate bound of ${MAX_MERCHANT_CANDIDATE_PRODUCTS} products; refusing a truncated feed`,
      );
    }

    const knownVariants = products.flatMap((product) =>
      product.variants.map((variant) => ({ id: variant.id, productId: product.id })),
    );
    if (knownVariants.length > MAX_MERCHANT_CANDIDATE_VARIANTS) {
      throw new MerchantOfferReadError(
        `Catalog exceeds the Merchant candidate-variant query envelope of ${MAX_MERCHANT_CANDIDATE_VARIANTS}; refusing rather than exceeding the public-feed DB budget`,
      );
    }

    const campaignsByVariantId = new Map<string, readonly ApplicablePromotionCampaign[]>();
    for (
      let offset = 0;
      offset < knownVariants.length;
      offset += MAX_MERCHANT_PROMOTION_VARIANTS_PER_QUERY
    ) {
      const result = await readApplicablePromotionCampaignsForKnownVariants({
        variants: knownVariants.slice(offset, offset + MAX_MERCHANT_PROMOTION_VARIANTS_PER_QUERY),
        client: client as unknown as PromotionCandidateReadClient,
      });
      for (const [variantId, campaigns] of result.campaignsByVariantId) {
        campaignsByVariantId.set(variantId, campaigns);
      }
    }
    return products.map((product) => toCandidateProduct(product, campaignsByVariantId, now));
  }

  async function readMerchantOffers({
    shopId,
    origin,
    now = new Date(),
  }: Readonly<{ shopId: number; origin: string; now?: Date }>): Promise<MerchantMappingResult> {
    const products = await readCandidateProducts({ shopId, now });
    return mapMerchantOffers({ products, origin });
  }

  return { readCandidateProducts, readMerchantOffers };
}
