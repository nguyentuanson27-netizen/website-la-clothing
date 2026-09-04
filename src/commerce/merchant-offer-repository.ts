/**
 * U25 / #153 M3 — the bounded canonical loader behind the Merchant offer mapper.
 *
 * It answers one question — "what does the storefront currently publish?" — and hands the answer to
 * a pure function. The split matters: the mapper never queries, so a catalog of 5,000 offers costs
 * the same number of round trips as a catalog of five, and the whole feed is testable without a
 * database.
 *
 * Every fact here is loaded through the authority that already owns it:
 *
 *   - visibility is the storefront's own predicate: present and active product, present and active
 *     variants. A hidden product has no landing page, so it has no offer;
 *   - pricing is `buildPromotionalStorefrontPricing`, the same rule object the product page, the
 *     listings, the cart and the checkout price from, resolved against one instant per read;
 *   - media is `resolveStorefrontProductMedia` plus `resolveVariantGalleryIndexes`, so raw mirrored
 *     URLs never leave this module;
 *   - the option projection is `buildStorefrontProductProjection`, so the feed's notion of an option
 *     is the page's notion of an option;
 *   - apparel overrides are the website-owned `ProductMerchantFacts` row, read as untrusted values
 *     that the pure resolver validates.
 *
 * Query shape is deliberately flat: one bounded product read that carries its variants, warehouse
 * stock, composite edges, published content and overrides, then bounded promotion-candidate batches.
 * There is no per-offer lookup anywhere, and the read refuses an over-large catalog rather than
 * silently truncating the feed to whatever fitted.
 *
 * Composite products are still fetched. They are excluded by the mapper with `COMPOSITE_DEFERRED`
 * rather than filtered out here, so the diagnostics can account for every catalog row the way the
 * M1 audit does.
 */

import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";

import {
  mapMerchantOffers,
  type MerchantCandidateProduct,
  type MerchantCandidateVariation,
  type MerchantMappingResult,
  type MerchantMarketPolicy,
} from "./merchant-offer-mapper.ts";
import { readApplicablePromotionCampaignsBatched } from "./promotion-candidate-batching.ts";
import type { PromotionCandidateReadClient } from "./promotion-candidate-repository.ts";
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

/**
 * The loader's own safety bound. It refuses rather than truncates, because a feed that quietly
 * dropped half the catalog would look healthy. The public feed's offer and byte envelope is a
 * separate contract and belongs to U26 / M4.
 */
export const MAX_MERCHANT_CANDIDATE_PRODUCTS = 5_000;

export class MerchantOfferReadError extends Error {}

const candidateSelection = {
  id: true,
  pancakeProductId: true,
  slug: true,
  name: true,
  primaryImageUrl: true,
  // Only a PUBLISHED description is a fact the storefront shows, so only that is a Merchant fact.
  content: { select: { status: true, editorialDescription: true } },
  // Website-owned ADR 0007 overrides. Absent row means every fact inherits the shop default.
  merchantFacts: { select: { gender: true, ageGroup: true, condition: true } },
  variants: {
    where: { isPresent: true, isActive: true },
    orderBy: [{ pancakeVariationId: "asc" }],
    select: {
      id: true,
      pancakeVariationId: true,
      // ADR 0008: the manufacturer MPN is the mirrored Pancake display_id. `sku` is a distinct
      // website-owned field and is deliberately not selected, so it cannot become a fallback.
      pancakeDisplayId: true,
      color: true,
      size: true,
      pancakeRetailPrice: true,
      pancakeRetailPriceAfterDiscount: true,
      pancakeImageUrls: true,
      warehouseStocks: { orderBy: [{ pancakeWarehouseId: "asc" }], select: { quantity: true } },
      // Either side of a composite edge defers the variation in Merchant v1, so both are probed.
      compositeParents: { select: { parentVariantId: true }, take: 1 },
      compositeComponents: { select: { componentVariantId: true }, take: 1 },
    },
  },
} satisfies Prisma.ProductMirrorSelect;

type SelectedCandidateProduct = Prisma.ProductMirrorGetPayload<{
  select: typeof candidateSelection;
}>;

/**
 * M1 Merchant availability semantics: any unsafe or negative warehouse quantity poisons the whole
 * fact. Summing first would let a positive warehouse hide a negative mirrored one (-3 + 4 => 1).
 */
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
  campaignsByVariantId: ReadonlyMap<string, Parameters<typeof buildPromotionalStorefrontPricing>[0]["campaignsByVariantId"] extends ReadonlyMap<string, infer TValue> ? TValue : never>,
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

  const parentVariants: StorefrontVariantFacts[] = product.variants.map((variant) => ({
    id: variant.id,
    pancakeVariationId: variant.pancakeVariationId,
    color: variant.color,
    size: variant.size,
    sellableStock: aggregateWarehouseStock(variant.warehouseStocks.map((stock) => stock.quantity)),
    retailPrice: variant.pancakeRetailPrice,
    retailPriceAfterDiscount: variant.pancakeRetailPriceAfterDiscount,
  }));

  const hasCompositeGraph = product.variants.some(
    (variant) => variant.compositeComponents.length > 0,
  );

  const variations: MerchantCandidateVariation[] = product.variants.map((variant) => ({
    variantId: variant.id,
    pancakeVariationId: variant.pancakeVariationId,
    pancakeDisplayId: variant.pancakeDisplayId,
    isComposite: variant.compositeParents.length > 0 || variant.compositeComponents.length > 0,
    stockQuantity: aggregateWarehouseStock(
      variant.warehouseStocks.map((stock) => stock.quantity),
    ),
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
      // A composite product is deferred in Merchant v1, so its component groups are not assembled:
      // the projection only has to say "this is a set", which the presence of the graph decides.
      componentGroups: [],
      hasCompositeGraph,
      pricingRule: buildPromotionalStorefrontPricing({ campaignsByVariantId, now }),
    }),
    apparelOverrides: (product.merchantFacts === null
      ? INHERITED_APPAREL_OVERRIDES
      : toMerchantApparelWireValues(product.merchantFacts)) as MerchantCandidateProduct["apparelOverrides"],
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
      where: { pancakeShopId: shopId, isPresent: true, isActive: true },
      select: candidateSelection,
      // A stable catalog order makes the mapper's input — and therefore the feed and its
      // diagnostics — reproducible across reads.
      orderBy: [{ pancakeProductId: "asc" }],
      take: MAX_MERCHANT_CANDIDATE_PRODUCTS + 1,
    });

    if (products.length > MAX_MERCHANT_CANDIDATE_PRODUCTS) {
      throw new MerchantOfferReadError(
        `Catalog exceeds the Merchant candidate bound of ${MAX_MERCHANT_CANDIDATE_PRODUCTS} products; raise it deliberately rather than publishing a truncated feed`,
      );
    }

    const variantIds = products.flatMap((product) =>
      product.variants.map((variant) => variant.id),
    );
    // Bounded batching, not a per-offer lookup: each call stays inside the candidate repository's
    // own 200-id safety cap while the whole projection is still resolved.
    const { campaignsByVariantId } = await readApplicablePromotionCampaignsBatched({
      variantIds,
      // The same structural cast every other caller uses to hand the candidate repository a client;
      // the repository declares only the two model reads it performs.
      client: client as unknown as PromotionCandidateReadClient,
    });

    return products.map((product) => toCandidateProduct(product, campaignsByVariantId, now));
  }

  async function readMerchantOffers({
    shopId,
    origin,
    now = new Date(),
    market,
  }: Readonly<{
    shopId: number;
    origin: string;
    now?: Date;
    market?: MerchantMarketPolicy | null;
  }>): Promise<MerchantMappingResult> {
    const products = await readCandidateProducts({ shopId, now });
    return mapMerchantOffers({ products, origin, market });
  }

  return { readCandidateProducts, readMerchantOffers };
}
