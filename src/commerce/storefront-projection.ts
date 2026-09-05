import { sortClothingSizes } from "./clothing-size.ts";
import {
  buildStorefrontVariantOptions,
  defaultStorefrontPricingRule,
  toStorefrontSelectableOptions,
  type StorefrontPricingRule,
  type StorefrontSelectableOption,
  type StorefrontVariantFacts,
  type StorefrontVariantUnavailableReason,
} from "./storefront-product.ts";
import { deriveStorefrontSelection } from "./storefront-selection.ts";

export type StorefrontCompositeComponentGroup = Readonly<{
  label: string;
  variants: readonly StorefrontVariantFacts[];
}>;

export type StorefrontProjectionOption = StorefrontSelectableOption & {
  kindKey: string | null;
  kindLabel: string | null;
};

export type StorefrontProductProjection = Readonly<{
  mode: "standalone" | "composite";
  options: StorefrontProjectionOption[];
}>;

/**
 * The kind key a composite parent's own set options carry. Named here because this module mints it;
 * a consumer that needs to tell the set apart from its components must not re-spell the literal.
 */
export const COMPOSITE_PARENT_KIND_KEY = "parent";

type StorefrontProjectionSelection = Readonly<{
  kindKey: string | null;
  color: string | null;
  size: string | null;
}>;

type StorefrontKindChoice = {
  key: string;
  label: string;
  disabled: boolean;
};

type StorefrontValueChoice = {
  value: string;
  disabled: boolean;
};

function normalizeLabel(label: string): string {
  return label.trim();
}

function normalizedLabelKey(label: string): string {
  return normalizeLabel(label).toLocaleLowerCase("vi");
}

function projectOptions(
  variants: readonly StorefrontVariantFacts[],
  kindKey: string | null,
  kindLabel: string | null,
  forcedUnavailableReason: StorefrontVariantUnavailableReason | null = null,
  pricingRule: StorefrontPricingRule = defaultStorefrontPricingRule,
): StorefrontProjectionOption[] {
  return toStorefrontSelectableOptions(buildStorefrontVariantOptions(variants, pricingRule)).map((option) =>
    forcedUnavailableReason === null
      ? { ...option, kindKey, kindLabel }
      : {
          ...option,
          kindKey,
          kindLabel,
          purchasable: false,
          isDiscounted: false,
          unavailableReason: forcedUnavailableReason,
        },
  );
}

export function buildStorefrontProductProjection({
  parentVariants,
  componentGroups,
  hasCompositeGraph,
  pricingRule = defaultStorefrontPricingRule,
}: Readonly<{
  parentVariants: readonly StorefrontVariantFacts[];
  componentGroups: readonly StorefrontCompositeComponentGroup[];
  hasCompositeGraph: boolean;
  pricingRule?: StorefrontPricingRule;
}>): StorefrontProductProjection {
  if (!hasCompositeGraph) {
    return {
      mode: "standalone",
      options: projectOptions(parentVariants, null, null, null, pricingRule),
    };
  }

  const labelCounts = new Map<string, number>();
  for (const group of componentGroups) {
    const key = normalizedLabelKey(group.label);
    labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
  }

  const options: StorefrontProjectionOption[] = [
    ...projectOptions(parentVariants, COMPOSITE_PARENT_KIND_KEY, "Set", null, pricingRule),
  ];

  componentGroups.forEach((group, index) => {
    const label = normalizeLabel(group.label);
    const ambiguousLabel = label.length === 0 || (labelCounts.get(normalizedLabelKey(group.label)) ?? 0) > 1;
    options.push(
      ...projectOptions(
        group.variants,
        `component-${index + 1}`,
        label,
        ambiguousLabel ? "AMBIGUOUS_OPTION" : null,
        pricingRule,
      ),
    );
  });

  return { mode: "composite", options };
}

/**
 * The options that speak for the product itself.
 *
 * For a standalone product that is every option. For a composite it is the parent set only:
 * a component's stock and price describe a part, and letting one speak for the whole is the
 * confusion the composite projection exists to prevent.
 */
export function selectStorefrontProductLevelOptions(
  projection: StorefrontProductProjection,
): StorefrontProjectionOption[] {
  return projection.mode === "standalone"
    ? [...projection.options]
    : projection.options.filter((option) => option.kindKey === COMPOSITE_PARENT_KIND_KEY);
}

function uniqueValues(
  options: readonly StorefrontProjectionOption[],
  key: "color" | "size",
): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const option of options) {
    const value = option[key];
    if (value && !seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
  }
  return key === "size" ? sortClothingSizes(values) : values;
}

function supportsProjectedSelection(
  option: StorefrontProjectionOption,
  selection: StorefrontProjectionSelection,
): boolean {
  if (!option.purchasable) return false;
  if (selection.kindKey !== null && option.kindKey !== selection.kindKey) return false;
  if (selection.size !== null && option.size !== selection.size) return false;
  if (selection.color !== null && option.color !== selection.color) return false;
  return true;
}

export function deriveStorefrontProjectionSelection(
  options: readonly StorefrontProjectionOption[],
  selection: StorefrontProjectionSelection,
) {
  const hasKindOptions = options.some((option) => option.kindKey !== null);
  if (!hasKindOptions) {
    const standalone = deriveStorefrontSelection(options, {
      color: selection.color,
      size: selection.size,
    });
    return {
      hasKindOptions: false,
      kinds: [] as StorefrontKindChoice[],
      ...standalone,
    };
  }

  const kindsByKey = new Map<string, string>();
  for (const option of options) {
    if (option.kindKey && option.kindLabel !== null && !kindsByKey.has(option.kindKey)) {
      kindsByKey.set(option.kindKey, option.kindLabel);
    }
  }
  const kinds: StorefrontKindChoice[] = [...kindsByKey].map(([key, label]) => ({
    key,
    label,
    disabled: !options.some((option) =>
      supportsProjectedSelection(option, { kindKey: key, color: null, size: null }),
    ),
  }));

  const kindOptions =
    selection.kindKey === null
      ? []
      : options.filter((option) => option.kindKey === selection.kindKey);

  const sizes: StorefrontValueChoice[] = uniqueValues(
    selection.kindKey === null ? options : kindOptions,
    "size",
  ).map((value) => ({
    value,
    disabled:
      selection.kindKey === null ||
      !kindOptions.some((option) =>
        supportsProjectedSelection(option, {
          kindKey: selection.kindKey,
          color: null,
          size: value,
        }),
      ),
  }));

  const hasColorOptions =
    selection.kindKey !== null && kindOptions.some((option) => option.color !== null);
  const colors: StorefrontValueChoice[] = hasColorOptions
    ? uniqueValues(kindOptions, "color").map((value) => ({
        value,
        disabled:
          selection.size === null ||
          !kindOptions.some((option) =>
            supportsProjectedSelection(option, {
              kindKey: selection.kindKey,
              color: value,
              size: selection.size,
            }),
          ),
      }))
    : [];

  const selected =
    selection.kindKey !== null &&
    selection.size !== null &&
    (!hasColorOptions || selection.color !== null)
      ? kindOptions.find(
          (option) =>
            option.size === selection.size &&
            (hasColorOptions ? option.color === selection.color : option.color === null),
        ) ?? null
      : null;

  return {
    hasKindOptions: true,
    kinds,
    hasColorOptions,
    colors,
    sizes,
    selectedVariantId: selected?.id ?? null,
    selectedPrice: selected?.price ?? null,
    selectedBasePriceVnd: selected?.basePriceVnd ?? null,
    selectedIsDiscounted: selected?.isDiscounted ?? false,
    selectedUnavailableReason: selected === null ? null : selected.unavailableReason,
    canAdd: selected !== null && selected.purchasable,
  };
}
