import { createHmac } from "node:crypto";
import { isIP } from "node:net";

import type { AuthServerConfig } from "../auth/config.ts";

const MAX_IP_TEXT_LENGTH = 64;
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const HMAC_CONTEXT = "la-clothing:guest-checkout-client:v1";

type HeaderReader = Readonly<{
  get(name: string): string | null;
}>;

function unavailable(): never {
  throw new TypeError("Checkout client identity is unavailable");
}

function readTrustedClientIp(headers: HeaderReader, headerName: string): string {
  const value = headers.get(headerName);
  if (
    !value ||
    value.length > MAX_IP_TEXT_LENGTH ||
    value.trim() !== value ||
    value.includes(",") ||
    isIP(value) === 0
  ) {
    return unavailable();
  }
  return value.toLowerCase();
}

function isLocalBaseUrl(baseURL: string): boolean {
  try {
    const url = new URL(baseURL);
    return (url.protocol === "http:" || url.protocol === "https:") && LOCAL_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * The buyer's IP for callers that can do without one, such as analytics reporting.
 *
 * Same trusted-header rule as the checkout client key: only the proxy-owned single-value header
 * counts, never x-forwarded-for, which anything upstream can append to. An absent or malformed
 * value yields null rather than throwing, because a missing match signal is not worth failing
 * anything over.
 */
export function readOptionalTrustedClientIp(
  headers: HeaderReader,
  config: Pick<AuthServerConfig, "ipAddressHeader">,
): string | null {
  if (!config.ipAddressHeader) return null;
  try {
    return readTrustedClientIp(headers, config.ipAddressHeader);
  } catch {
    return null;
  }
}

export function deriveGuestCheckoutClientKey(
  headers: HeaderReader,
  config: Pick<AuthServerConfig, "secret" | "baseURL" | "ipAddressHeader">,
): string {
  if (typeof config.secret !== "string" || config.secret.length < 32) {
    return unavailable();
  }

  let identity: string;
  if (config.ipAddressHeader) {
    identity = `ip:${readTrustedClientIp(headers, config.ipAddressHeader)}`;
  } else if (isLocalBaseUrl(config.baseURL)) {
    identity = "local-development";
  } else {
    return unavailable();
  }

  const digest = createHmac("sha256", config.secret)
    .update(HMAC_CONTEXT)
    .update("\0")
    .update(identity)
    .digest("hex");
  return `v1:${digest}`;
}
