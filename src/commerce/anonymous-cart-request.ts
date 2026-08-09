import type { PrismaClient } from "../generated/prisma/client.ts";
import { readAnonymousCartCookie } from "./anonymous-cart-cookie.ts";
import { createAnonymousCartService } from "./anonymous-cart.ts";

type RequestCookieReader = {
  get(name: string): { value: string } | undefined;
};

export async function resolveAnonymousCartRequest({
  client,
  store,
  now,
}: {
  client: PrismaClient;
  store: RequestCookieReader;
  now: Date;
}) {
  const cartId = readAnonymousCartCookie(store);
  if (!cartId) {
    return null;
  }

  return createAnonymousCartService(client).get({ cartId, now });
}
