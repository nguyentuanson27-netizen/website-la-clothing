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
    now?: Date;
  }): Promise<
    | {
        variants: StorefrontVariantFacts[];
        projection?: StorefrontProductProjection;
      }
    | null
  >;
};

type AddUnitInput = {
  variantId: string;
};

type StorefrontPurchaseFailure =
  | { ok: false; reason: "INVALID_SELECTION" }
  | { ok: false; reason: "VARIANT_UNAVAILABLE" };

function isBoundedTrimmed(value: string, maxLength: number): boolean {
  return value.length > 0 && value.length <= maxLength && value === value.trim();
}

/**
 * The PDP purchase path.
 *
 * `addUnit` takes no quantity by design. "Thêm vào giỏ hàng" means one more unit, and a quantity
 * parameter here is what let this path be wired to an absolute set-quantity mutation, where a line
 * already holding several units would be silently reset to the value passed in.
 *
 * The option lookup below authorizes the request against the current public projection, but it is
 * not the authority: it runs before the cart row is locked. The mutation re-resolves the same facts
 * inside its transaction, so this exists to reject obviously invalid input cheaply and to map the
 * browser's option id onto the authorized internal id.
 */
export function createStorefrontPurchaseService<TResult>({
  catalog,
  addUnit,
}: {
  catalog: StorefrontPurchaseCatalog;
  addUnit(input: AddUnitInput): Promise<TResult>;
}) {
  async function add({
    shopId,
    slug,
    variantId,
    now,
  }: {
    shopId: number;
    slug: string;
    variantId: string;
    /** Fixed by the caller so this pre-check and the mutation resolve one campaign instant. */
    now?: Date;
  }): Promise<TResult | StorefrontPurchaseFailure> {
    if (
      typeof slug !== "string" ||
      typeof variantId !== "string" ||
      !isBoundedTrimmed(slug, MAX_STOREFRONT_SLUG_LENGTH) ||
      !isBoundedTrimmed(variantId, MAX_STOREFRONT_VARIANT_ID_LENGTH)
    ) {
      return { ok: false, reason: "INVALID_SELECTION" };
    }

    const product = await catalog.getProductBySlug({ shopId, slug, now });
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

    return addUnit({ variantId: selected.id });
  }

  return { add };
}
