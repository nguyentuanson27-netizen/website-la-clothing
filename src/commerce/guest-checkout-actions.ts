"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { readAuthServerConfig } from "../auth/config.ts";
import { prisma } from "../db/prisma.ts";
import { createAnonymousCartCookieSession } from "./anonymous-cart-cookie.ts";
import { deriveGuestCheckoutClientKey } from "./guest-checkout-client-identity.ts";
import { submitGuestCheckoutPublicAction } from "./guest-checkout-public-actions.ts";
import { createGuestCheckoutRateLimiter } from "./guest-checkout-rate-limit.ts";
import { reportMetaPurchaseSafely } from "./meta-purchase-reporting.ts";
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

/**
 * The browsing context Meta matches a server event against: the buyer's address and user agent,
 * plus the pixel's own `_fbp` / `_fbc` cookies, which are the strongest signal available for a
 * guest who never creates an account.
 */
async function readMetaRequestContext() {
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  const forwardedFor = requestHeaders.get("x-forwarded-for");
  const host = requestHeaders.get("host");

  return {
    clientIpAddress: forwardedFor?.split(",")[0]?.trim() || null,
    clientUserAgent: requestHeaders.get("user-agent"),
    fbp: cookieStore.get("_fbp")?.value ?? null,
    fbc: cookieStore.get("_fbc")?.value ?? null,
    eventSourceUrl: host === null ? null : `https://${host}/checkout`,
  };
}

export async function submitGuestCheckoutAction(
  _previousState: GuestCheckoutSubmitResult | null,
  formData: FormData,
): Promise<GuestCheckoutSubmitResult> {
  let result: GuestCheckoutSubmitResult;
  try {
    result = await submitGuestCheckoutPublicAction(
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

  if (result.ok) {
    // Reported before the redirect, while the request still has the buyer's headers and Meta
    // cookies. Awaited rather than fired and forgotten: a serverless invocation can be frozen the
    // moment it responds, which would drop the request mid-flight. It cannot throw, and it gives
    // up after its own short timeout, so the shopper waits on it only briefly and never fails
    // because of it.
    await reportMetaPurchaseSafely(prisma, result.orderCode, await readMetaRequestContext());
    redirect(`/checkout/success?order=${encodeURIComponent(result.orderCode)}`);
  }
  return result;
}
