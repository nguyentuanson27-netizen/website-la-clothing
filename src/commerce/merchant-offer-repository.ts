import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";

import {
  mapMerchantOffers,
  type MerchantCandidateProduct,
  type MerchantCandidateVariation,
  type MerchantMappingResult,
} from "./merchant-offer-mapper.ts";
import { MAX_MERCHANT_CANDIDATE_VARIANTS } from "./merchant-feed-limits.ts";
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

/**
 * U26 deliberately uses flat model reads here rather than Prisma relation loading. The public feed
 * has a reviewed whole-generation DB budget, while `relationLoadStrategy` is still a Prisma preview
 * feature that would require enabling `relationJoins` for the generated client. Keeping the reads
 * flat makes the eight-query ceiling local to this repository and avoids changing relation-loading
 * behaviour elsewhere in the application.
 */
const productSelection = {
  id: true,
  pancakeProductId: true,
  slug: true,
  name: true,
  primaryImageUrl: true,
} satisfies Prisma.ProductMirrorSelect;

const variantSelection = {
  id: true,
  productId: true,
  pancakeVariationId: true,
  pancakeDisplayId: true,
  color: true,
  size: true,
  pancakeRetailPrice: true,
  pancakeRetailPriceAfterDiscount: true,
  pancakeImageUrls: true,
} satisfies Prisma.VariantMirrorSelect;

const contentSelection = {
  productId: true,
  status: true,
  editorialDescription: true,
} satisfies Prisma.ProductContentSelect;

const merchantFactsSelection = {
  productId: true,
  gender: true,
  ageGroup: true,
  condition: true,
} satisfies Prisma.ProductMerchantFactsSelect;

const stockSelection = {
  variantId: true,
  pancakeWarehouseId: true,
  quantity: true,
} satisfies Prisma.WarehouseStockSelect;

const compositeSelection = {
  parentVariantId: true,
  componentVariantId: true,
} satisfies Prisma.CompositeComponentMirrorSelect;

const promotionTargetSelection = {
  campaignId: true,
  productId: true,
  variantId: true,
} satisfies Prisma.PromotionTargetSelect;

const promotionCampaignSelection = {
  id: true,
  name: true,
  kind: true,
  discountType: true,
  percentageValue: true,
  fixedPriceVnd: true,
  startsAt: true,
  endsAt: true,
} satisfies Prisma.PromotionCampaignSelect;

type SelectedProduct = Prisma.ProductMirrorGetPayload<{ select: typeof productSelection }>;
type SelectedVariant = Prisma.VariantMirrorGetPayload<{ select: typeof variantSelection }>;
type SelectedProductContent = Prisma.ProductContentGetPayload<{ select: typeof contentSelection }>;
type SelectedMerchantFacts = Prisma.ProductMerchantFactsGetPayload<{
  select: typeof merchantFactsSelection;
}>;
type SelectedWarehouseStock = Prisma.WarehouseStockGetPayload<{ select: typeof stockSelection }>;
type SelectedPromotionTarget = Prisma.PromotionTargetGetPayload<{
  select: typeof promotionTargetSelection;
}>;
type SelectedPromotionCampaign = Prisma.PromotionCampaignGetPayload<{
  select: typeof promotionCampaignSelection;
}>;

type LoadedCandidateVariant = SelectedVariant &
  Readonly<{
    warehouseStocks: readonly SelectedWarehouseStock[];
    isCompositeParent: boolean;
    isCompositeComponent: boolean;
  }>;

type LoadedCandidateProduct = SelectedProduct &
  Readonly<{
    content: SelectedProductContent | null;
    merchantFacts: SelectedMerchantFacts | null;
    variants: readonly LoadedCandidateVariant[];
  }>;

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

function buildCampaignsByVariantId({
  variants,
  targets,
  campaigns,
}: Readonly<{
  variants: readonly SelectedVariant[];
  targets: readonly SelectedPromotionTarget[];
  campaigns: readonly SelectedPromotionCampaign[];
}>): ReadonlyMap<string, readonly ApplicablePromotionCampaign[]> {
  const knownVariantIds = new Set(variants.map((variant) => variant.id));
  const variantsByProductId = new Map<string, string[]>();
  for (const variant of variants) {
    const owned = variantsByProductId.get(variant.productId);
    if (owned === undefined) variantsByProductId.set(variant.productId, [variant.id]);
    else owned.push(variant.id);
  }

  const campaignById = new Map(
    campaigns.map((campaign) => [
      campaign.id,
      Object.freeze({ ...campaign }) as ApplicablePromotionCampaign,
    ]),
  );
  const campaignsByVariantId = new Map<string, ApplicablePromotionCampaign[]>();
  const seenByVariantId = new Map<string, Set<string>>();
  for (const variantId of knownVariantIds) {
    campaignsByVariantId.set(variantId, []);
    seenByVariantId.set(variantId, new Set());
  }

  const attach = (variantId: string, campaign: ApplicablePromotionCampaign) => {
    const seen = seenByVariantId.get(variantId);
    if (seen === undefined || seen.has(campaign.id)) return;
    seen.add(campaign.id);
    campaignsByVariantId.get(variantId)?.push(campaign);
  };

  for (const target of targets) {
    const campaign = campaignById.get(target.campaignId);
    if (campaign === undefined) continue;
    if (target.variantId !== null) {
      attach(target.variantId, campaign);
      continue;
    }
    if (target.productId === null) continue;
    for (const variantId of variantsByProductId.get(target.productId) ?? []) {
      attach(variantId, campaign);
    }
  }

  return campaignsByVariantId;
}

function toCandidateProduct(
  product: LoadedCandidateProduct,
  campaignsByVariantId: ReadonlyMap<string, readonly ApplicablePromotionCampaign[]>,
  now: Date,
): MerchantCandidateProduct {
  const variantImageUrls = product.variants.map((variant) =>
    parseJsonStringArray(variant.pancakeImageUrls),
  );
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
  const hasCompositeGraph = product.variants.some((variant) => variant.isCompositeParent);
  const variations: MerchantCandidateVariation[] = product.variants.map((variant) => ({
    variantId: variant.id,
    pancakeVariationId: variant.pancakeVariationId,
    pancakeDisplayId: variant.pancakeDisplayId,
    isComposite: variant.isCompositeParent || variant.isCompositeComponent,
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

    // 1/8 — bounded product authority.
    const products = await client.productMirror.findMany({
      where: { pancakeShopId: shopId, isPresent: true, isActive: true },
      select: productSelection,
      orderBy: [{ pancakeProductId: "asc" }],
      take: MAX_MERCHANT_CANDIDATE_PRODUCTS + 1,
    });
    if (products.length > MAX_MERCHANT_CANDIDATE_PRODUCTS) {
      throw new MerchantOfferReadError(
        `Catalog exceeds the Merchant candidate bound of ${MAX_MERCHANT_CANDIDATE_PRODUCTS} products; refusing a truncated feed`,
      );
    }
    if (products.length === 0) return [];

    const productIds = products.map((product) => product.id);

    // 2/8 — all active/present variants, bounded before any fan-out reads.
    const variants = await client.variantMirror.findMany({
      where: { productId: { in: productIds }, isPresent: true, isActive: true },
      select: variantSelection,
      orderBy: [{ productId: "asc" }, { pancakeVariationId: "asc" }],
      take: MAX_MERCHANT_CANDIDATE_VARIANTS + 1,
    });
    if (variants.length > MAX_MERCHANT_CANDIDATE_VARIANTS) {
      throw new MerchantOfferReadError(
        `Catalog exceeds the Merchant candidate-variant query envelope of ${MAX_MERCHANT_CANDIDATE_VARIANTS}; refusing rather than exceeding the public-feed DB budget`,
      );
    }

    const variantIds = variants.map((variant) => variant.id);

    // 3/8 and 4/8 — website-owned product facts, each flat and product-bounded.
    const contents = await client.productContent.findMany({
      where: { productId: { in: productIds } },
      select: contentSelection,
    });
    const merchantFacts = await client.productMerchantFacts.findMany({
      where: { productId: { in: productIds } },
      select: merchantFactsSelection,
    });

    // 5/8 and 6/8 — variant inventory and composite membership. Empty variant sets stay cheap.
    const stocks =
      variantIds.length === 0
        ? []
        : await client.warehouseStock.findMany({
            where: { variantId: { in: variantIds } },
            select: stockSelection,
            orderBy: [{ variantId: "asc" }, { pancakeWarehouseId: "asc" }],
          });
    const compositeEdges =
      variantIds.length === 0
        ? []
        : await client.compositeComponentMirror.findMany({
            where: {
              OR: [
                { parentVariantId: { in: variantIds } },
                { componentVariantId: { in: variantIds } },
              ],
            },
            select: compositeSelection,
          });

    // 7/8 and 8/8 — promotion membership and enabled campaign facts. Campaign rows are loaded flat,
    // so no preview relation strategy or hidden per-relation query is part of the budget.
    const promotionTargets =
      variantIds.length === 0
        ? []
        : await client.promotionTarget.findMany({
            where: {
              OR: [{ variantId: { in: variantIds } }, { productId: { in: productIds } }],
            },
            select: promotionTargetSelection,
          });
    const promotionCampaignIds = [
      ...new Set(promotionTargets.map((target) => target.campaignId)),
    ];
    const promotionCampaigns =
      promotionCampaignIds.length === 0
        ? []
        : await client.promotionCampaign.findMany({
            where: { id: { in: promotionCampaignIds }, isEnabled: true },
            select: promotionCampaignSelection,
          });

    const contentByProductId = new Map(contents.map((content) => [content.productId, content]));
    const merchantFactsByProductId = new Map(
      merchantFacts.map((facts) => [facts.productId, facts]),
    );
    const stocksByVariantId = new Map<string, SelectedWarehouseStock[]>();
    for (const stock of stocks) {
      const existing = stocksByVariantId.get(stock.variantId);
      if (existing === undefined) stocksByVariantId.set(stock.variantId, [stock]);
      else existing.push(stock);
    }
    const compositeParentIds = new Set(compositeEdges.map((edge) => edge.parentVariantId));
    const compositeComponentIds = new Set(compositeEdges.map((edge) => edge.componentVariantId));
    const variantsByProductId = new Map<string, LoadedCandidateVariant[]>();
    for (const variant of variants) {
      const loaded: LoadedCandidateVariant = {
        ...variant,
        warehouseStocks: stocksByVariantId.get(variant.id) ?? [],
        isCompositeParent: compositeParentIds.has(variant.id),
        isCompositeComponent: compositeComponentIds.has(variant.id),
      };
      const existing = variantsByProductId.get(variant.productId);
      if (existing === undefined) variantsByProductId.set(variant.productId, [loaded]);
      else existing.push(loaded);
    }

    const campaignsByVariantId = buildCampaignsByVariantId({
      variants,
      targets: promotionTargets,
      campaigns: promotionCampaigns,
    });
    const loadedProducts: LoadedCandidateProduct[] = products.map((product) => ({
      ...product,
      content: contentByProductId.get(product.id) ?? null,
      merchantFacts: merchantFactsByProductId.get(product.id) ?? null,
      variants: variantsByProductId.get(product.id) ?? [],
    }));

    return loadedProducts.map((product) => toCandidateProduct(product, campaignsByVariantId, now));
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
