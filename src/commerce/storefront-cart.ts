import {
  buildStorefrontVariantOptions,
  type StorefrontVariantUnavailableReason,
} from "./storefront-product.ts";

type StorefrontCartItem = {
  variantId: string;
  quantity: number;
};

type StorefrontCartVariant = {
  id: string;
  isPresent: boolean;
  isActive: boolean;
  color: string | null;
  size: string | null;
  sellableStock: number;
  retailPrice: number | null;
  retailPriceAfterDiscount: number | null;
};

type StorefrontCartProduct = {
  slug: string;
  name: string;
  isPresent: boolean;
  isActive: boolean;
  variants: readonly StorefrontCartVariant[];
};

export type StorefrontCartUnavailableReason =
  | StorefrontVariantUnavailableReason
  | "PRODUCT_UNAVAILABLE"
  | "VARIANT_UNAVAILABLE";

export type StorefrontCartLine = {
  variantId: string;
  productSlug: string | null;
  productName: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  price: number | null;
  available: boolean;
  unavailableReason: StorefrontCartUnavailableReason | null;
};

function normalizedOptionValue(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function buildStorefrontCartLines({
  items,
  products,
}: {
  items: readonly StorefrontCartItem[];
  products: readonly StorefrontCartProduct[];
}): StorefrontCartLine[] {
  const variantOwner = new Map<string, StorefrontCartProduct>();
  const resolvedOptions = new Map<string, ReturnType<typeof buildStorefrontVariantOptions>[number]>();

  for (const product of products) {
    for (const variant of product.variants) {
      variantOwner.set(variant.id, product);
    }

    if (!product.isPresent || !product.isActive) continue;

    const currentVariants = product.variants.filter(
      (variant) => variant.isPresent && variant.isActive,
    );
    for (const option of buildStorefrontVariantOptions(currentVariants)) {
      resolvedOptions.set(option.id, option);
    }
  }

  return items.map((item) => {
    const product = variantOwner.get(item.variantId);
    if (!product) {
      return {
        variantId: item.variantId,
        productSlug: null,
        productName: null,
        color: null,
        size: null,
        quantity: item.quantity,
        price: null,
        available: false,
        unavailableReason: "VARIANT_UNAVAILABLE",
      };
    }

    const variant = product.variants.find(({ id }) => id === item.variantId);
    if (!variant) {
      return {
        variantId: item.variantId,
        productSlug: product.slug,
        productName: product.name,
        color: null,
        size: null,
        quantity: item.quantity,
        price: null,
        available: false,
        unavailableReason: "VARIANT_UNAVAILABLE",
      };
    }

    const base = {
      variantId: item.variantId,
      productSlug: product.slug,
      productName: product.name,
      color: normalizedOptionValue(variant.color),
      size: normalizedOptionValue(variant.size),
      quantity: item.quantity,
    };

    if (!product.isPresent || !product.isActive) {
      return {
        ...base,
        price: null,
        available: false,
        unavailableReason: "PRODUCT_UNAVAILABLE",
      };
    }

    if (!variant.isPresent || !variant.isActive) {
      return {
        ...base,
        price: null,
        available: false,
        unavailableReason: "VARIANT_UNAVAILABLE",
      };
    }

    const option = resolvedOptions.get(item.variantId);
    if (!option) {
      return {
        ...base,
        price: null,
        available: false,
        unavailableReason: "VARIANT_UNAVAILABLE",
      };
    }

    return {
      ...base,
      price: option.price,
      available: option.purchasable,
      unavailableReason: option.unavailableReason,
    };
  });
}
