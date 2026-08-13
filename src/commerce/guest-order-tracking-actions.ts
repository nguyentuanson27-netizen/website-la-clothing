"use server";

import { headers } from "next/headers";

import { readAuthServerConfig } from "../auth/config.ts";
import { prisma } from "../db/prisma.ts";
import { deriveGuestCheckoutClientKey } from "./guest-checkout-client-identity.ts";
import { lookupGuestOrderPublicAction } from "./guest-order-tracking-public-actions.ts";
import {
  createGuestOrderTrackingRateLimiter,
  deriveGuestOrderTrackingCodeKey,
} from "./guest-order-tracking-rate-limit.ts";
import {
  createGuestOrderTrackingService,
  type GuestOrderTrackingResult,
} from "./guest-order-tracking.ts";
import type { GuestOrderTrackingPublicResult } from "./guest-order-tracking-public-actions.ts";

async function createGuestOrderTrackingActionDependencies() {
  const requestHeaders = await headers();
  const authConfig = readAuthServerConfig();
  const clientKey = deriveGuestCheckoutClientKey(requestHeaders, authConfig);
  const rateLimiter = createGuestOrderTrackingRateLimiter(prisma);
  const tracking = createGuestOrderTrackingService(prisma);

  return {
    async consumeClient() {
      return rateLimiter.consumeClient({ clientKey });
    },
    async consumeOrderCode(orderCode: string) {
      const codeKey = deriveGuestOrderTrackingCodeKey(orderCode, authConfig.secret);
      return rateLimiter.consumeOrderCode({ codeKey });
    },
    async lookup(input: { orderCode: string; phone: string }): Promise<GuestOrderTrackingResult> {
      return tracking.lookup(input);
    },
  };
}

export async function lookupGuestOrderAction(
  _previousState: GuestOrderTrackingPublicResult | null,
  formData: FormData,
): Promise<GuestOrderTrackingPublicResult> {
  try {
    return await lookupGuestOrderPublicAction(
      await createGuestOrderTrackingActionDependencies(),
      formData,
    );
  } catch {
    return { ok: false, reason: "UNAVAILABLE" };
  }
}
