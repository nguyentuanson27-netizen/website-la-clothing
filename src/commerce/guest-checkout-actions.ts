"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { readAuthServerConfig } from "../auth/config.ts";
import { readStorefrontOrigin } from "./storefront-origin.ts";
import { prisma } from "../db/prisma.ts";
import { createAnonymousCartCookieSession } from "./anonymous-cart-cookie.ts";
import {
  deriveGuestCheckoutClientKey,
  readOptionalTrustedClientIp,
} from "./guest-checkout-client-identity.ts";
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

  return {
    // Only the proxy-owned header the rest of checkout trusts. x-forwarded-for is client-spoofable
    // and this codebase rejects it as an IP source everywhere else; a wrong address is worse than
    // none, since it attributes the sale to whoever the buyer claimed to be.
    clientIpAddress: readOptionalTrustedClientIp(requestHeaders, readAuthServerConfig()),
    clientUserAgent: requestHeaders.get("user-agent"),
    fbp: cookieStore.get("_fbp")?.value ?? null,
    fbc: cookieStore.get("_fbc")?.value ?? null,
    // The configured canonical origin, not the request's Host header: Host is attacker-controlled
    // and would otherwise be reported to Meta as where the sale happened.
    eventSourceUrl: `${readStorefrontOrigin()}/checkout`,
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
    // The request context has to be read inside the request, but the reporting itself must not sit
    // between the buyer and their confirmation page. `after` keeps the work alive past the
    // response without holding it up, which a bare floating promise would not survive on a
    // serverless runtime that freezes the invocation the moment it responds.
    const metaContext = await readMetaRequestContext();
    after(() => reportMetaPurchaseSafely(prisma, result.orderCode, metaContext));
    redirect(`/checkout/success?order=${encodeURIComponent(result.orderCode)}`);
  }
  return result;
}
