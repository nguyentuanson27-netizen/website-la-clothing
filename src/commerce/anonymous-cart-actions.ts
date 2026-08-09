"use server";

import { cookies } from "next/headers";

import { prisma } from "../db/prisma.ts";
import type { AnonymousCartCookieWrite } from "./anonymous-cart-cookie.ts";
import { createAnonymousCartMutationService } from "./anonymous-cart-mutation.ts";
import { createAnonymousCartPublicActions } from "./anonymous-cart-public-actions.ts";

async function mutationService() {
  const cookieStore = await cookies();
  return createAnonymousCartMutationService(prisma, {
    get(name) {
      return cookieStore.get(name);
    },
    set(cookie: AnonymousCartCookieWrite) {
      cookieStore.set(cookie);
    },
  });
}

const publicActions = createAnonymousCartPublicActions({ mutationService });

export async function setAnonymousCartItemQuantity(input: unknown) {
  return publicActions.setItemQuantity(input);
}

export async function removeAnonymousCartItem(input: unknown) {
  return publicActions.removeItem(input);
}
