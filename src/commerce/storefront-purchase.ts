import type { StorefrontProductProjection } from "./storefront-projection.ts";
import {
  buildStorefrontVariantOptions,
  type StorefrontVariantFacts,
} from "./storefront-product.ts";

const MAX_STOREFRONT_SLUG_LENGTH = 160;
const MAX_STOREFRONT_VARIANT_ID_LENGTH = 200;

type StorefrontPurchaseCatalog = {
  getProductBySlug(input: {
    shopId: number;
    slug: string;
  }): Promise<
    | {
        variants: StorefrontVariantFacts[];
        projection?: StorefrontProductProjection;
      }
    | null
  >;
};

type AddToCartInput = {
  variantId: string;
  quantity: number;
};

type StorefrontPurchaseFailure =
  | { ok: false; reason: "INVALID_SELECTION" }
  | { ok: false; reason: "VARIANT_UNAVAILABLE" };

function isBoundedTrimmed(value: string, maxLength: number): boolean {
  return value.length > 0 && value.length <= maxLength && value === value.trim();
}

export function createStorefrontPurchaseService<TResult>({
  catalog,
  addToCart,
}: {
  catalog: StorefrontPurchaseCatalog;
  addToCart(input: AddToCartInput): Promise<TResult>;
}) {
  async function add({
    shopId,
    slug,
    variantId,
  }: {
    shopId: number;
    slug: string;
    variantId: string;
  }): Promise<TResult | StorefrontPurchaseFailure> {
    if (
      typeof slug !== "string" ||
      typeof variantId !== "string" ||
      !isBoundedTrimmed(slug, MAX_STOREFRONT_SLUG_LENGTH) ||
      !isBoundedTrimmed(variantId, MAX_STOREFRONT_VARIANT_ID_LENGTH)
    ) {
      return { ok: false, reason: "INVALID_SELECTION" };
    }

    const product = await catalog.getProductBySlug({ shopId, slug });
    if (!product) {
      return { ok: false, reason: "VARIANT_UNAVAILABLE" };
    }

    const selected = product.projection
      ? product.projection.options.find((option) => option.id === variantId)
      : buildStorefrontVariantOptions(product.variants).find(
          (variant) => variant.id === variantId,
        );
    if (!selected?.purchasable) {
      return { ok: false, reason: "VARIANT_UNAVAILABLE" };
    }

    return addToCart({ variantId: selected.id, quantity: 1 });
  }

  return { add };
}
