import { prisma } from "../db/prisma.ts";
import { readPancakeShopId } from "../integrations/pancake/config.ts";
import { getCurrentAnonymousCart } from "./anonymous-cart-next.ts";
import { createStorefrontCartRepository } from "./storefront-cart-repository.ts";

export async function getCurrentStorefrontCartLines(now: Date = new Date()) {
  const cart = await getCurrentAnonymousCart(now);
  if (!cart || cart.items.length === 0) return [];

  return createStorefrontCartRepository(prisma).getLines({
    shopId: readPancakeShopId(),
    items: cart.items,
  });
}
