"use server";

import { cookies, headers } from "next/headers";

import { readAuthServerConfig } from "../auth/config.ts";
import { prisma } from "../db/prisma.ts";
import { createAnonymousCartCookieSession } from "./anonymous-cart-cookie.ts";
import { deriveGuestCheckoutClientKey } from "./guest-checkout-client-identity.ts";
import { submitGuestCheckoutPublicAction } from "./guest-checkout-public-actions.ts";
import { createGuestCheckoutRateLimiter } from "./guest-checkout-rate-limit.ts";
import type { GuestCheckoutSubmitResult } from "./guest-checkout-submit.ts";
import { submitGuestCheckoutByCart } from "./guest-checkout-submit-runtime.ts";

async function createGuestCheckoutActionDependencies() {
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  const authConfig = readAuthServerConfig();
  const clientKey = deriveGuestCheckoutClientKey(requestHeaders, authConfig);
  const cartSession = createAnonymousCartCookieSession({
    get(name: string) {
      return cookieStore.get(name);
    },
    set(cookie) {
      cookieStore.set(cookie);
    },
  });
  const rateLimiter = createGuestCheckoutRateLimiter(prisma);

  return {
    cartSession,
    async consumeAttempt(cartId: string) {
      const now = new Date();
      if (!(await rateLimiter.consumeClient({ clientKey, now }))) {
        return false;
      }
      return rateLimiter.consume({ cartId, now });
    },
    submitCheckout: submitGuestCheckoutByCart,
  };
}

export async function submitGuestCheckoutAction(
  _previousState: GuestCheckoutSubmitResult | null,
  formData: FormData,
): Promise<GuestCheckoutSubmitResult> {
  try {
    return await submitGuestCheckoutPublicAction(
      await createGuestCheckoutActionDependencies(),
      formData,
    );
  } catch {
    return {
      ok: false,
      status: "RETRYABLE",
      reason: "CHECKOUT_UNAVAILABLE",
    };
  }
}
