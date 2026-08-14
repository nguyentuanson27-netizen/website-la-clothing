import type { StorefrontSelectableOption } from "./storefront-product.ts";

type StorefrontSelection = {
  color: string | null;
  size: string | null;
};

type StorefrontChoiceState = {
  value: string;
  disabled: boolean;
};

function uniqueMappedValues(
  options: readonly StorefrontSelectableOption[],
  key: "color" | "size",
): string[] {
  const values = new Set<string>();
  for (const option of options) {
    const value = option[key];
    if (value) values.add(value);
  }
  return [...values];
}

function supportsSelection(
  option: StorefrontSelectableOption,
  selection: StorefrontSelection,
): boolean {
  if (!option.purchasable) return false;
  if (selection.color !== null && option.color !== selection.color) return false;
  if (selection.size !== null && option.size !== selection.size) return false;
  return true;
}

export function deriveStorefrontSelection(
  options: readonly StorefrontSelectableOption[],
  selection: StorefrontSelection,
) {
  const colors: StorefrontChoiceState[] = uniqueMappedValues(options, "color").map((value) => ({
    value,
    disabled: !options.some((option) =>
      supportsSelection(option, { color: value, size: null }),
    ),
  }));
  const hasColorOptions = colors.length > 0;

  const sizes: StorefrontChoiceState[] = uniqueMappedValues(options, "size").map((value) => ({
    value,
    disabled: !options.some((option) =>
      supportsSelection(option, {
        color: hasColorOptions ? selection.color : null,
        size: value,
      }),
    ),
  }));

  const selected =
    selection.size !== null && (!hasColorOptions || selection.color !== null)
      ? options.find(
          (option) =>
            option.purchasable &&
            option.size === selection.size &&
            (hasColorOptions ? option.color === selection.color : option.color === null),
        ) ?? null
      : null;

  return {
    hasColorOptions,
    colors,
    sizes,
    selectedVariantId: selected?.id ?? null,
    selectedPrice: selected?.price ?? null,
    canAdd: selected !== null,
  };
}
