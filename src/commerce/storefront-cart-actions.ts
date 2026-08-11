"use server";

import { cookies } from "next/headers";

import { prisma } from "../db/prisma.ts";
import { readPancakeShopId } from "../integrations/pancake/config.ts";
import type { AnonymousCartCookieWrite } from "./anonymous-cart-cookie.ts";
import { createAnonymousCartMutationService } from "./anonymous-cart-mutation.ts";
import { resolveAnonymousCartRequest } from "./anonymous-cart-request.ts";
import { createStorefrontCartPublicActions } from "./storefront-cart-public-actions.ts";
import { createStorefrontCartRepository } from "./storefront-cart-repository.ts";

async function createActionRuntime() {
  const cookieStore = await cookies();
  const now = new Date();
  const shopId = readPancakeShopId();
  const repository = createStorefrontCartRepository(prisma);
  const writableCookieStore = {
    get(name: string) {
      return cookieStore.get(name);
    },
    set(cookie: AnonymousCartCookieWrite) {
      cookieStore.set(cookie);
    },
  };
  const mutations = createAnonymousCartMutationService(prisma, writableCookieStore);

  return createStorefrontCartPublicActions({
    async getLines() {
      const cart = await resolveAnonymousCartRequest({
        client: prisma,
        store: writableCookieStore,
        now,
      });
      if (!cart || cart.items.length === 0) return [];
      return repository.getLines({ shopId, items: cart.items });
    },
    async canSetQuantity({ variantId, quantity }) {
      const [line] = await repository.getLines({
        shopId,
        items: [{ variantId, quantity }],
      });
      return line?.available === true;
    },
    async setQuantity({ variantId, quantity }) {
      return mutations.updateExistingItemQuantity({ variantId, quantity, now });
    },
    async remove({ variantId }) {
      return mutations.removeItem({ variantId, now });
    },
  });
}

export async function updateStorefrontCartLine(input: unknown) {
  return (await createActionRuntime()).update(input);
}

export async function removeStorefrontCartLine(input: unknown) {
  return (await createActionRuntime()).remove(input);
}
