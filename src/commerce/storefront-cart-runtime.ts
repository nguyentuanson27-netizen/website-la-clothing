import { prisma } from "../db/prisma.ts";
import { readPancakeShopId } from "../integrations/pancake/config.ts";
import { getCurrentAnonymousCart } from "./anonymous-cart-next.ts";
import { createStorefrontCartRepository } from "./storefront-cart-repository.ts";

export async function getCurrentStorefrontCartLines(now: Date = new Date()) {
  return (await getCurrentStorefrontCheckoutContext(now))?.lines ?? [];
}

/**
 * The cart lines plus the server-read cart identity behind them.
 *
 * Checkout needs both and must read them together: the rendered-quote proof is bound to the cart
 * whose lines produced the quote, so resolving the identity in a second request would open a window
 * where the two disagree. The raw id is server-only — it goes into the proof's MAC context and
 * never into anything the browser receives.
 */
export async function getCurrentStorefrontCheckoutContext(now: Date = new Date()) {
  const cart = await getCurrentAnonymousCart(now);
  if (!cart || cart.items.length === 0) return null;

  const lines = await createStorefrontCartRepository(prisma).getLines({
    shopId: readPancakeShopId(),
    items: cart.items,
  });
  return { cartId: cart.id, lines };
}
