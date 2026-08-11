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

type StorefrontPriceFacts = Pick<
  StorefrontVariantFacts,
  "retailPrice" | "retailPriceAfterDiscount"
>;

function normalizeOptionValue(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function optionPairKey(color: string, size: string): string {
  return `${color.toLowerCase()}\u0000${size.toLowerCase()}`;
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

export function buildStorefrontVariantOptions(
  variants: readonly StorefrontVariantFacts[],
): StorefrontVariantOption[] {
  const normalized = variants.map((variant) => ({
    ...variant,
    color: normalizeOptionValue(variant.color),
    size: normalizeOptionValue(variant.size),
  }));
  const pairCounts = new Map<string, number>();

  for (const variant of normalized) {
    if (!variant.color || !variant.size) continue;
    const key = optionPairKey(variant.color, variant.size);
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }

  return normalized.map((variant) => {
    const price = resolveStorefrontPrice(variant);
    let unavailableReason: StorefrontVariantUnavailableReason | null = null;

    if (!variant.color || !variant.size) {
      unavailableReason = "MAPPING_REQUIRED";
    } else if ((pairCounts.get(optionPairKey(variant.color, variant.size)) ?? 0) > 1) {
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
