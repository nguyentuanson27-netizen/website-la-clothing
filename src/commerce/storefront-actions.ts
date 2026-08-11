"use server";

import { setAnonymousCartItemQuantity } from "./anonymous-cart-actions.ts";
import { createStorefrontCatalogRepository } from "./storefront-catalog.ts";
import { createStorefrontPurchasePublicActions } from "./storefront-purchase-public-actions.ts";
import { createStorefrontPurchaseService } from "./storefront-purchase.ts";
import { prisma } from "../db/prisma.ts";
import { readPancakeShopId } from "../integrations/pancake/config.ts";

const publicActions = createStorefrontPurchasePublicActions({
  async purchase({ slug, variantId }) {
    const shopId = readPancakeShopId();
    const catalog = createStorefrontCatalogRepository(prisma);
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
