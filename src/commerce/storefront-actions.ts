"use server";

import { setAnonymousCartItemQuantity } from "./anonymous-cart-actions.ts";
import { createStorefrontProductDetailRepository } from "./storefront-product-detail.ts";
import { createStorefrontPurchasePublicActions } from "./storefront-purchase-public-actions.ts";
import { createStorefrontPurchaseService } from "./storefront-purchase.ts";
import { prisma } from "../db/prisma.ts";
import { readPancakeShopId } from "../integrations/pancake/config.ts";

const publicActions = createStorefrontPurchasePublicActions({
  async purchase({ slug, variantId }) {
    const shopId = readPancakeShopId();
    const catalog = createStorefrontProductDetailRepository(prisma);
    const purchase = createStorefrontPurchaseService({
      catalog,
      async addToCart({ variantId: authorizedVariantId, quantity }) {
        return setAnonymousCartItemQuantity({
          variantId: authorizedVariantId,
          quantity,
        });
      },
    });

    return purchase.add({ shopId, slug, variantId });
  },
});

export async function addStorefrontItemToBag(input: unknown) {
  return publicActions.add(input);
}
