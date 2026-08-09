import { cookies } from "next/headers";

import { prisma } from "../db/prisma.ts";
import { resolveAnonymousCartRequest } from "./anonymous-cart-request.ts";

export async function getCurrentAnonymousCart(now = new Date()) {
  const store = await cookies();
  return resolveAnonymousCartRequest({ client: prisma, store, now });
}
