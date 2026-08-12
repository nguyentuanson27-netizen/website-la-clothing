"use server";

import { cookies } from "next/headers";

import { prisma } from "../db/prisma.ts";
import { createAnonymousCartCookieSession } from "./anonymous-cart-cookie.ts";
import { submitGuestCheckoutPublicAction } from "./guest-checkout-public-actions.ts";
import { createGuestCheckoutRateLimiter } from "./guest-checkout-rate-limit.ts";
import type { GuestCheckoutSubmitResult } from "./guest-checkout-submit.ts";
import { submitGuestCheckoutByCart } from "./guest-checkout-submit-runtime.ts";

async function createGuestCheckoutActionDependencies() {
  const cookieStore = await cookies();
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
    consumeAttempt(cartId: string) {
      return rateLimiter.consume({ cartId });
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
