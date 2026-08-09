import type { PrismaClient } from "../generated/prisma/client.ts";
import {
  createAnonymousCartCookieSession,
  type AnonymousCartCookieWrite,
} from "./anonymous-cart-cookie.ts";
import { createAnonymousCartService } from "./anonymous-cart.ts";

type WritableCartCookieStore = {
  get(name: string): { value: string } | undefined;
  set(cookie: AnonymousCartCookieWrite): void;
};

type MutationOptions = {
  production?: boolean;
};

type SetMutationResult =
  | {
      ok: true;
      cartId: string;
      expiresAt?: Date;
      item: { variantId: string; quantity: number };
    }
  | {
      ok: false;
      reason: "INVALID_QUANTITY" | "VARIANT_UNAVAILABLE" | "CART_LINE_LIMIT";
    };

type RemoveMutationResult = { ok: true } | { ok: false; reason: "CART_UNAVAILABLE" };

export function createAnonymousCartMutationService(
  client: PrismaClient,
  store: WritableCartCookieStore,
  options: MutationOptions = {},
) {
  const carts = createAnonymousCartService(client);
  const cookie = createAnonymousCartCookieSession(store, options);

  async function setItemQuantity({
    variantId,
    quantity,
    now,
  }: {
    variantId: string;
    quantity: number;
    now: Date;
  }): Promise<SetMutationResult> {
    const currentCartId = cookie.read();
    if (currentCartId) {
      const existingResult = await carts.setItemQuantity({
        cartId: currentCartId,
        variantId,
        quantity,
        now,
      });

      if (existingResult.ok) {
        return { ok: true, cartId: currentCartId, item: existingResult.item };
      }
      if (existingResult.reason !== "CART_UNAVAILABLE") {
        return existingResult;
      }
    }

    const createdResult = await carts.createWithItem({ variantId, quantity, now });
    if (!createdResult.ok) {
      return createdResult;
    }

    cookie.write({
      cartId: createdResult.cart.id,
      expiresAt: createdResult.cart.expiresAt,
    });

    return {
      ok: true,
      cartId: createdResult.cart.id,
      expiresAt: createdResult.cart.expiresAt,
      item: createdResult.item,
    };
  }

  async function removeItem({
    variantId,
    now,
  }: {
    variantId: string;
    now: Date;
  }): Promise<RemoveMutationResult> {
    const cartId = cookie.read();
    if (!cartId) {
      return { ok: false, reason: "CART_UNAVAILABLE" };
    }

    const result = await carts.removeItem({ cartId, variantId, now });
    if (!result.ok) {
      cookie.clear();
    }
    return result;
  }

  return { setItemQuantity, removeItem };
}
