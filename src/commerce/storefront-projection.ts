import {
  buildStorefrontVariantOptions,
  toStorefrontSelectableOptions,
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
): StorefrontProjectionOption[] {
  return toStorefrontSelectableOptions(buildStorefrontVariantOptions(variants)).map((option) =>
    forcedUnavailableReason === null
      ? { ...option, kindKey, kindLabel }
      : {
          ...option,
          kindKey,
          kindLabel,
          purchasable: false,
          unavailableReason: forcedUnavailableReason,
        },
  );
}

export function buildStorefrontProductProjection({
  parentVariants,
  componentGroups,
  hasCompositeGraph,
}: Readonly<{
  parentVariants: readonly StorefrontVariantFacts[];
  componentGroups: readonly StorefrontCompositeComponentGroup[];
  hasCompositeGraph: boolean;
}>): StorefrontProductProjection {
  if (!hasCompositeGraph) {
    return {
      mode: "standalone",
      options: projectOptions(parentVariants, null, null),
    };
  }

  const labelCounts = new Map<string, number>();
  for (const group of componentGroups) {
    const key = normalizedLabelKey(group.label);
    labelCounts.set(key, (labelCounts.get(key) ?? 0) + 1);
  }

  const options: StorefrontProjectionOption[] = [
    ...projectOptions(parentVariants, "parent", "Set"),
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
      ),
    );
  });

  return { mode: "composite", options };
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
  return values;
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
            option.purchasable &&
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
    canAdd: selected !== null,
  };
}
