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

  const sizes: StorefrontChoiceState[] = uniqueMappedValues(options, "size").map((value) => ({
    value,
    disabled: !options.some((option) =>
      supportsSelection(option, { color: selection.color, size: value }),
    ),
  }));

  const selected =
    selection.color !== null && selection.size !== null
      ? options.find(
          (option) =>
            option.purchasable &&
            option.color === selection.color &&
            option.size === selection.size,
        ) ?? null
      : null;

  return {
    colors,
    sizes,
    selectedVariantId: selected?.id ?? null,
    selectedPrice: selected?.price ?? null,
    canAdd: selected !== null,
  };
}
