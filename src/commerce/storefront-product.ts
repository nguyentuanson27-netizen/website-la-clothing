export type StorefrontVariantFacts = {
  /** Internal mutation/authorization identity. Never a vendor-facing external id. */
  id: string;
  /** The external variation identity a selected or committed option refers to. */
  pancakeVariationId: string;
  color: string | null;
  size: string | null;
  sellableStock: number;
  retailPrice: number | null;
  retailPriceAfterDiscount: number | null;
};

export type StorefrontVariantUnavailableReason =
  | "MAPPING_REQUIRED"
  | "AMBIGUOUS_OPTION"
  | "OUT_OF_STOCK"
  | "PRICE_UNRESOLVED";

export type StorefrontVariantOption = StorefrontVariantFacts & {
  color: string | null;
  size: string | null;
  price: number | null;
  /**
   * The undiscounted base price behind `price`, when a promotion-aware pricing rule supplied one.
   * `null` under the default rule, which has no notion of a promotion.
   */
  basePriceVnd: number | null;
  isDiscounted: boolean;
  purchasable: boolean;
  unavailableReason: StorefrontVariantUnavailableReason | null;
};

/**
 * What a pricing rule decides for one variant.
 *
 * `price` is the money the shopper pays and the only value the selection model uses. `basePriceVnd`
 * and `isDiscounted` are presentation facts that let a surface strike through the old price without
 * recomputing anything.
 */
export type StorefrontResolvedPrice = Readonly<{
  price: number | null;
  basePriceVnd: number | null;
  isDiscounted: boolean;
}>;

/**
 * A per-variant pricing rule.
 *
 * Injected rather than branched on so that switching one surface to promotional pricing cannot
 * change any other. The default is the shared equality-gated rule below; U15 passes a
 * promotion-aware rule for the product page only.
 */
export type StorefrontPricingRule = (variant: StorefrontVariantFacts) => StorefrontResolvedPrice;

export type StorefrontSelectableOption = Pick<
  StorefrontVariantOption,
  | "id"
  | "pancakeVariationId"
  | "color"
  | "size"
  | "price"
  | "basePriceVnd"
  | "isDiscounted"
  | "purchasable"
  | "unavailableReason"
>;

type StorefrontPriceFacts = Pick<
  StorefrontVariantFacts,
  "retailPrice" | "retailPriceAfterDiscount"
>;

function normalizeOptionValue(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function optionKey(color: string | null, size: string, hasColorDimension: boolean): string {
  return hasColorDimension
    ? `${color?.toLowerCase() ?? ""}\u0000${size.toLowerCase()}`
    : size.toLowerCase();
}

function isUsablePrice(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}

/**
 * The current storefront price gate, still equality-gated on the mirrored Pancake fields.
 *
 * `src/commerce/promotion-pricing.ts` is the central effective-price authority this will defer to.
 * The switch is deliberately not made here: removing the
 * `retailPrice === retailPriceAfterDiscount` availability gate requires the approved real-catalog
 * evidence W3 demands, and doing it early would change what buyers are charged on the strength of
 * an assumption. Do not add a third price path in the meantime.
 */
export function resolveStorefrontPrice({
  retailPrice,
  retailPriceAfterDiscount,
}: StorefrontPriceFacts): number | null {
  if (!isUsablePrice(retailPrice) || !isUsablePrice(retailPriceAfterDiscount)) {
    return null;
  }

  return retailPrice === retailPriceAfterDiscount ? retailPrice : null;
}

/**
 * The default pricing rule: the shared equality-gated behaviour, with no promotion concept.
 *
 * Every consumer that has not been switched deliberately — cart, checkout, Pancake submission,
 * Merchant audit, product cards, structured data — still resolves through this.
 */
export const defaultStorefrontPricingRule: StorefrontPricingRule = (variant) =>
  Object.freeze({
    price: resolveStorefrontPrice(variant),
    basePriceVnd: null,
    isDiscounted: false,
  });

export function getStorefrontResolvedPriceRange(
  options: readonly Pick<StorefrontVariantOption, "price">[],
): { minimum: number; maximum: number } | null {
  let minimum: number | null = null;
  let maximum: number | null = null;

  for (const option of options) {
    if (option.price === null) continue;
    minimum = minimum === null ? option.price : Math.min(minimum, option.price);
    maximum = maximum === null ? option.price : Math.max(maximum, option.price);
  }

  return minimum === null || maximum === null ? null : { minimum, maximum };
}

export function toStorefrontSelectableOptions(
  options: readonly StorefrontVariantOption[],
): StorefrontSelectableOption[] {
  return options.map((
    {
      id, pancakeVariationId, color, size, price, basePriceVnd, isDiscounted,
      purchasable, unavailableReason,
    },
  ) => ({
    id,
    pancakeVariationId,
    color,
    size,
    price,
    basePriceVnd,
    isDiscounted,
    purchasable,
    unavailableReason,
  }));
}

export function buildStorefrontVariantOptions(
  variants: readonly StorefrontVariantFacts[],
  pricingRule: StorefrontPricingRule = defaultStorefrontPricingRule,
): StorefrontVariantOption[] {
  const normalized = variants.map((variant) => ({
    ...variant,
    color: normalizeOptionValue(variant.color),
    size: normalizeOptionValue(variant.size),
  }));
  const hasColorDimension = normalized.some((variant) => variant.color !== null);
  const optionCounts = new Map<string, number>();

  for (const variant of normalized) {
    if (!variant.size || (hasColorDimension && !variant.color)) continue;
    const key = optionKey(variant.color, variant.size, hasColorDimension);
    optionCounts.set(key, (optionCounts.get(key) ?? 0) + 1);
  }

  return normalized.map((variant) => {
    const { price, basePriceVnd, isDiscounted } = pricingRule(variant);
    let unavailableReason: StorefrontVariantUnavailableReason | null = null;

    if (!variant.size || (hasColorDimension && !variant.color)) {
      unavailableReason = "MAPPING_REQUIRED";
    } else if (
      (optionCounts.get(optionKey(variant.color, variant.size, hasColorDimension)) ?? 0) > 1
    ) {
      unavailableReason = "AMBIGUOUS_OPTION";
    } else if (!Number.isFinite(variant.sellableStock) || variant.sellableStock <= 0) {
      unavailableReason = "OUT_OF_STOCK";
    } else if (price === null) {
      unavailableReason = "PRICE_UNRESOLVED";
    }

    return {
      ...variant,
      price,
      basePriceVnd,
      // A variant the shopper cannot buy is not on sale, whatever the campaign says. Keeping the
      // discounted flag tied to a usable price stops an unavailable option rendering sale styling.
      isDiscounted: isDiscounted && unavailableReason === null,
      purchasable: unavailableReason === null,
      unavailableReason,
    };
  });
}
