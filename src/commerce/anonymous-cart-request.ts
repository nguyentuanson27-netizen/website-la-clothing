import type { PrismaClient } from "../generated/prisma/client.ts";
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
