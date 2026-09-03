/**
 * Product-level impression facts for the upper funnel.
 *
 * `view_item_list`, `select_item` and the unselected PDP `view_item` describe a *product*, because
 * that is all the shopper has expressed at those points. Reaching for a `pancakeVariationId` here —
 * the first option, the cheapest one — would report a selected variant the shopper never chose, and
 * would then flow into a Merchant offer match and a conversion path built on that fiction.
 *
 * So one rendered card produces exactly one impression, identified by `pancakeProductId`, whatever
 * the product's variant count. `VariantMirror.id`, `kindKey`, the array index and the slug are all
 * excluded: the first two are internal, the third is presentation order, and the slug is an
 * addressing key that has no meaning in a catalog feed.
 *
 * Money follows the card. The impression is derived from the same options and the same pricing rule
 * the card renders from, so an impression cannot quote a price the page never showed:
 *
 *   - one common resolved price → that exact value;
 *   - a spread of prices → a min/max range carried as first-party facts only, never as a vendor
 *     price, because the minimum is the price of a variant nobody selected;
 *   - nothing resolvable → no monetary fields, rather than a fabricated zero.
 */

import type { CommerceProductImpression } from "../tracking/commerce-events.ts";
import {
  buildStorefrontVariantOptions,
  getStorefrontResolvedPriceRange,
  type StorefrontPricingRule,
  type StorefrontVariantFacts,
  type StorefrontVariantOption,
} from "./storefront-product.ts";

export type StorefrontImpressionProduct = Readonly<{
  pancakeProductId: string;
  name: string;
  variants: readonly StorefrontVariantFacts[];
}>;

export type StorefrontProductListContext = Readonly<{
  listId: string;
  listName: string;
}>;

type ImpressionPriceFacts = Pick<
  CommerceProductImpression,
  "exactPriceVnd" | "minimumPriceVnd" | "maximumPriceVnd"
>;

function impressionPriceFromOptions(
  options: readonly Pick<StorefrontVariantOption, "price">[],
): ImpressionPriceFacts {
  const range = getStorefrontResolvedPriceRange(options);
  if (range === null) return {};
  if (range.minimum === range.maximum) return { exactPriceVnd: range.minimum };
  return { minimumPriceVnd: range.minimum, maximumPriceVnd: range.maximum };
}

function impressionPrice(
  product: StorefrontImpressionProduct,
  pricingRule: StorefrontPricingRule | undefined,
): ImpressionPriceFacts {
  return impressionPriceFromOptions(
    buildStorefrontVariantOptions(product.variants, pricingRule),
  );
}

/**
 * Builds one impression per product, or `null` when the product cannot supply a safe identity or
 * name. A card that cannot be described truthfully is dropped from the list rather than described
 * with a placeholder — an upper-funnel list is a set of observations, not a total that has to
 * reconcile.
 */
export function buildStorefrontProductImpression({
  product,
  list,
  index,
  pricingRule,
}: Readonly<{
  product: StorefrontImpressionProduct;
  list?: StorefrontProductListContext;
  index?: number;
  pricingRule?: StorefrontPricingRule;
}>): CommerceProductImpression | null {
  const productExternalId = product.pancakeProductId?.trim() ?? "";
  const itemName = product.name?.trim() ?? "";
  if (productExternalId.length === 0 || itemName.length === 0) return null;

  return Object.freeze({
    productExternalId,
    itemName,
    ...impressionPrice(product, pricingRule),
    ...(list === undefined ? {} : { listId: list.listId, listName: list.listName }),
    ...(index === undefined ? {} : { index }),
  });
}

/** Builds the ordered impressions for one rendered card grid. */
export function buildStorefrontProductImpressions({
  products,
  list,
  pricingRule,
}: Readonly<{
  products: readonly StorefrontImpressionProduct[];
  list?: StorefrontProductListContext;
  pricingRule?: StorefrontPricingRule;
}>): CommerceProductImpression[] {
  const impressions: CommerceProductImpression[] = [];
  products.forEach((product, index) => {
    const impression = buildStorefrontProductImpression({ product, list, index, pricingRule });
    if (impression !== null) impressions.push(impression);
  });
  return impressions;
}

/**
 * The product-page impression, derived from the projection the page is actually rendering.
 *
 * A product page has already resolved its options — including a composite product's component
 * groups — through the promotion-aware rule, so re-deriving a range from raw variant facts here
 * would risk quoting money the page never displayed.
 */
export function buildStorefrontProductImpressionFromOptions({
  pancakeProductId,
  name,
  options,
}: Readonly<{
  pancakeProductId: string;
  name: string;
  options: readonly Pick<StorefrontVariantOption, "price">[];
}>): CommerceProductImpression | null {
  const productExternalId = pancakeProductId?.trim() ?? "";
  const itemName = name?.trim() ?? "";
  if (productExternalId.length === 0 || itemName.length === 0) return null;

  return Object.freeze({
    productExternalId,
    itemName,
    ...impressionPriceFromOptions(options),
  });
}
