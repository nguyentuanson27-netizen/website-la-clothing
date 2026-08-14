export type StorefrontVariantFacts = {
  id: string;
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
  purchasable: boolean;
  unavailableReason: StorefrontVariantUnavailableReason | null;
};

export type StorefrontSelectableOption = Pick<
  StorefrontVariantOption,
  "id" | "color" | "size" | "price" | "purchasable" | "unavailableReason"
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

export function resolveStorefrontPrice({
  retailPrice,
  retailPriceAfterDiscount,
}: StorefrontPriceFacts): number | null {
  if (!isUsablePrice(retailPrice) || !isUsablePrice(retailPriceAfterDiscount)) {
    return null;
  }

  return retailPrice === retailPriceAfterDiscount ? retailPrice : null;
}

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
  return options.map(({ id, color, size, price, purchasable, unavailableReason }) => ({
    id,
    color,
    size,
    price,
    purchasable,
    unavailableReason,
  }));
}

export function buildStorefrontVariantOptions(
  variants: readonly StorefrontVariantFacts[],
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
    const price = resolveStorefrontPrice(variant);
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
      purchasable: unavailableReason === null,
      unavailableReason,
    };
  });
}
