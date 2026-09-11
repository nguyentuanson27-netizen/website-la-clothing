type StorefrontDiscountOption = Readonly<{
  id: string;
  price: number | null;
  basePriceVnd: number | null;
  isDiscounted: boolean;
}>;

export type StorefrontDiscountPresentation = Readonly<{
  representativeVariantId: string;
  basePriceVnd: number;
  effectivePriceVnd: number;
  discountPercent: number;
  hasCheaperCurrentVariant: boolean;
}>;

function isDiscountedOption(
  option: StorefrontDiscountOption,
): option is StorefrontDiscountOption & Readonly<{ price: number; basePriceVnd: number }> {
  return (
    option.isDiscounted
    && option.price !== null
    && Number.isFinite(option.price)
    && option.price >= 0
    && option.basePriceVnd !== null
    && Number.isFinite(option.basePriceVnd)
    && option.basePriceVnd > option.price
  );
}

/**
 * Picks one exact discounted variant to speak for a product-level sale presentation.
 *
 * A card or unselected PDP must never combine the cheapest current price from one variant with the
 * base price or percentage from another. The lowest effective discounted price is the representative;
 * ties use the stable internal variant id so server renders stay deterministic.
 */
export function resolveStorefrontDiscountPresentation(
  options: readonly StorefrontDiscountOption[],
): StorefrontDiscountPresentation | null {
  const discounted = options.filter(isDiscountedOption);
  if (discounted.length === 0) return null;

  const representative = discounted.reduce((best, option) => {
    if (option.price < best.price) return option;
    if (option.price > best.price) return best;
    return option.id.localeCompare(best.id) < 0 ? option : best;
  });

  const cheaperCurrentVariant = options.some(
    (option) =>
      option.price !== null
      && Number.isFinite(option.price)
      && option.price < representative.price,
  );

  return Object.freeze({
    representativeVariantId: representative.id,
    basePriceVnd: representative.basePriceVnd,
    effectivePriceVnd: representative.price,
    discountPercent: Math.round(
      (1 - representative.price / representative.basePriceVnd) * 100,
    ),
    hasCheaperCurrentVariant: cheaperCurrentVariant,
  });
}
