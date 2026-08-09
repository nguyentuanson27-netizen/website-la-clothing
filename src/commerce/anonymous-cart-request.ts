import { cookies } from "next/headers";

import type { PrismaClient } from "../generated/prisma/client.ts";
import { prisma } from "../db/prisma.ts";
import { createAnonymousCartCookieSession } from "./anonymous-cart-cookie.ts";
import { createAnonymousCartService } from "./anonymous-cart.ts";

type RequestCookieStore = {
  get(name: string): { value: string } | undefined;
  set(...args: never[]): void;
};

export async function resolveAnonymousCartRequest({
  client,
  store,
  now,
}: {
  client: PrismaClient;
  store: RequestCookieStore;
  now: Date;
}) {
  const cartId = createAnonymousCartCookieSession(store).read();
  if (!cartId) {
    return null;
  }

  return createAnonymousCartService(client).get({ cartId, now });
}

export async function getCurrentAnonymousCart(now = new Date()) {
  const store = await cookies();
  return resolveAnonymousCartRequest({ client: prisma, store, now });
}
