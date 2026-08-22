import {
  resolveStorefrontProductMedia,
  type StorefrontProductMedia,
} from "./product-media.ts";
import {
  buildStorefrontVariantOptions,
  type StorefrontVariantUnavailableReason,
} from "./storefront-product.ts";

export type StorefrontCartItem = {
  variantId: string;
  quantity: number;
};

export type StorefrontCartVariant = {
  id: string;
  isPresent: boolean;
  isActive: boolean;
  isCompositeComponentAvailable?: boolean;
  color: string | null;
  size: string | null;
  sellableStock: number;
  retailPrice: number | null;
  retailPriceAfterDiscount: number | null;
  imageUrls?: readonly string[];
};

export type StorefrontCartProduct = {
  slug: string;
  name: string;
  isPresent: boolean;
  isActive: boolean;
  primaryImageUrl?: string | null;
  variants: readonly StorefrontCartVariant[];
};

export type StorefrontCartUnavailableReason =
  | StorefrontVariantUnavailableReason
  | "INSUFFICIENT_STOCK"
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
  media: StorefrontProductMedia;
};

function normalizedOptionValue(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isPublicOwner(product: StorefrontCartProduct): boolean {
  return product.isPresent && product.isActive;
}

function isCommerceEligibleVariant(
  product: StorefrontCartProduct,
  variant: StorefrontCartVariant,
): boolean {
  return (
    variant.isPresent &&
    variant.isActive &&
    (isPublicOwner(product) || variant.isCompositeComponentAvailable === true)
  );
}

const emptyMedia: StorefrontProductMedia = { primary: null, gallery: [] };

export function buildStorefrontCartLines({
  items,
  products,
}: {
  items: readonly StorefrontCartItem[];
  products: readonly StorefrontCartProduct[];
}): StorefrontCartLine[] {
  const variantOwner = new Map<string, StorefrontCartProduct>();
  const productMediaMap = new Map<string, StorefrontProductMedia>();
  const resolvedOptions = new Map<string, ReturnType<typeof buildStorefrontVariantOptions>[number]>();

  for (const product of products) {
    const media = resolveStorefrontProductMedia({
      productName: product.name,
      primaryImageUrl: product.primaryImageUrl,
      variantImageUrls: product.variants.map((variant) => variant.imageUrls ?? []),
    });
    productMediaMap.set(product.slug, media);

    for (const variant of product.variants) {
      variantOwner.set(variant.id, product);
    }

    const currentVariants = product.variants.filter((variant) =>
      isCommerceEligibleVariant(product, variant),
    );
    for (const option of buildStorefrontVariantOptions(currentVariants)) {
      resolvedOptions.set(option.id, option);
    }
  }

  return items.map((item) => {
    const product = variantOwner.get(item.variantId);
    const media = (product ? productMediaMap.get(product.slug) : null) ?? emptyMedia;

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
        media,
      };
    }

    const variant = product.variants.find(({ id }) => id === item.variantId);
    if (!variant) {
      return {
        variantId: item.variantId,
        productSlug: isPublicOwner(product) ? product.slug : null,
        productName: product.name,
        color: null,
        size: null,
        quantity: item.quantity,
        price: null,
        available: false,
        unavailableReason: "VARIANT_UNAVAILABLE",
        media,
      };
    }

    const base = {
      variantId: item.variantId,
      productSlug: isPublicOwner(product) ? product.slug : null,
      productName: product.name,
      color: normalizedOptionValue(variant.color),
      size: normalizedOptionValue(variant.size),
      quantity: item.quantity,
      media,
    };

    if (!isPublicOwner(product) && variant.isCompositeComponentAvailable !== true) {
      return {
        ...base,
        price: null,
        available: false,
        unavailableReason: "PRODUCT_UNAVAILABLE" as const,
      };
    }

    if (!variant.isPresent || !variant.isActive) {
      return {
        ...base,
        price: null,
        available: false,
        unavailableReason: "VARIANT_UNAVAILABLE" as const,
      };
    }

    const option = resolvedOptions.get(item.variantId);
    if (!option) {
      return {
        ...base,
        price: null,
        available: false,
        unavailableReason: "VARIANT_UNAVAILABLE" as const,
      };
    }

    if (option.purchasable && option.sellableStock < item.quantity) {
      return {
        ...base,
        price: option.price,
        available: false,
        unavailableReason: "INSUFFICIENT_STOCK" as const,
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
