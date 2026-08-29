import { createHash } from "node:crypto";

import type { MetaConversionsConfig } from "./pixel-config.ts";

/**
 * Server-side Conversions API events.
 *
 * Every event sent here has a browser twin fired by the pixel. Meta collapses the pair when both
 * carry the same `event_name` and `event_id`, so the order's public code is used as the event id
 * on both sides: the server event is the reliable one (it survives ad blockers and abandoned
 * tabs), the browser event carries the browsing context, and the buyer is counted once.
 */

const VIETNAM_COUNTRY_CODE = "84";

export type MetaUserIdentity = Readonly<{
  phone: string | null;
  fullName: string | null;
  clientIpAddress: string | null;
  clientUserAgent: string | null;
  /** Meta's own browser cookies. They are the strongest match signal available for a guest. */
  fbp: string | null;
  fbc: string | null;
}>;

export type MetaPurchaseContent = Readonly<{
  id: string;
  quantity: number;
  itemPrice: number;
}>;

export type MetaPurchaseEventInput = Readonly<{
  eventId: string;
  eventTimeSeconds: number;
  eventSourceUrl: string | null;
  valueVnd: number;
  contents: readonly MetaPurchaseContent[];
  identity: MetaUserIdentity;
}>;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Meta requires identifiers lowercased and stripped of formatting before hashing; a value
 * normalized differently hashes differently and simply fails to match.
 */
export function hashMetaIdentifier(value: string): string {
  return sha256Hex(value.trim().toLowerCase().replace(/\s+/g, " "));
}

/**
 * Meta wants digits only, including country code. Vietnamese numbers are usually written with a
 * national trunk "0" that has to become 84, and the +84 / 0084 / 84 forms have to collapse to the
 * same digits or the same subscriber hashes several different ways and matches none of them.
 *
 * The trunk zero is dropped after the country code as well: "+84 0912 345 678" is a common way to
 * write the number people also give as "0912345678", and both have to reach the same digits.
 */
export function normalizeVietnamesePhone(rawPhone: string): string | null {
  const digits = rawPhone.replace(/[^0-9]/g, "");
  if (digits.length === 0) return null;

  const withoutInternationalPrefix = digits.startsWith("00" + VIETNAM_COUNTRY_CODE)
    ? digits.slice(2)
    : digits;

  if (withoutInternationalPrefix.startsWith(VIETNAM_COUNTRY_CODE)) {
    const subscriber = withoutInternationalPrefix.slice(VIETNAM_COUNTRY_CODE.length);
    return VIETNAM_COUNTRY_CODE + (subscriber.startsWith("0") ? subscriber.slice(1) : subscriber);
  }
  if (withoutInternationalPrefix.startsWith("0")) {
    return VIETNAM_COUNTRY_CODE + withoutInternationalPrefix.slice(1);
  }
  return withoutInternationalPrefix;
}

/**
 * Vietnamese names run family name first and given name last, which is the opposite of the
 * fn/ln split Meta expects: the given name is `fn`, the family name is `ln`.
 */
export function splitVietnameseName(fullName: string): { fn: string; ln: string } | null {
  const parts = fullName.trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  if (parts.length === 1) return { fn: parts[0]!, ln: parts[0]! };
  return { fn: parts[parts.length - 1]!, ln: parts[0]! };
}

function buildUserData(identity: MetaUserIdentity): Record<string, unknown> {
  const userData: Record<string, unknown> = {};

  if (identity.phone !== null) {
    const phone = normalizeVietnamesePhone(identity.phone);
    if (phone !== null) userData.ph = [sha256Hex(phone)];
  }
  if (identity.fullName !== null) {
    const name = splitVietnameseName(identity.fullName);
    if (name !== null) {
      userData.fn = [hashMetaIdentifier(name.fn)];
      userData.ln = [hashMetaIdentifier(name.ln)];
    }
  }
  // Never hashed: Meta documents these as plain-text context, not identifiers.
  if (identity.clientIpAddress !== null) userData.client_ip_address = identity.clientIpAddress;
  if (identity.clientUserAgent !== null) userData.client_user_agent = identity.clientUserAgent;
  if (identity.fbp !== null) userData.fbp = identity.fbp;
  if (identity.fbc !== null) userData.fbc = identity.fbc;

  return userData;
}

export function buildMetaPurchaseEvent(input: MetaPurchaseEventInput): Record<string, unknown> {
  const event: Record<string, unknown> = {
    event_name: "Purchase",
    event_time: input.eventTimeSeconds,
    event_id: input.eventId,
    action_source: "website",
    user_data: buildUserData(input.identity),
    custom_data: {
      currency: "VND",
      value: input.valueVnd,
      contents: input.contents.map((content) => ({
        id: content.id,
        quantity: content.quantity,
        item_price: content.itemPrice,
      })),
      content_type: "product",
    },
  };
  if (input.eventSourceUrl !== null) event.event_source_url = input.eventSourceUrl;
  return event;
}

export function buildMetaConversionsRequest(
  config: MetaConversionsConfig,
  events: readonly Record<string, unknown>[],
): { url: string; body: string } {
  const payload: Record<string, unknown> = { data: events };
  if (config.testEventCode !== null) payload.test_event_code = config.testEventCode;

  return {
    url: `https://graph.facebook.com/${config.graphApiVersion}/${config.pixelId}/events`,
    // The token travels in the body, never the query string, so it cannot leak through request logs.
    body: JSON.stringify({ ...payload, access_token: config.accessToken }),
  };
}

export type MetaConversionsSendResult =
  | { ok: true }
  | { ok: false; reason: "HTTP_ERROR"; status: number }
  | { ok: false; reason: "NETWORK_ERROR" };

/**
 * Reporting a sale must never be able to fail a sale, so transport problems are returned rather
 * than thrown and the caller is expected to carry on regardless.
 */
export async function sendMetaConversionEvents(
  config: MetaConversionsConfig,
  events: readonly Record<string, unknown>[],
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 3_000,
): Promise<MetaConversionsSendResult> {
  const { url, body } = buildMetaConversionsRequest(config, events);
  const abort = AbortSignal.timeout(timeoutMs);

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: abort,
    });
    if (!response.ok) return { ok: false, reason: "HTTP_ERROR", status: response.status };
    return { ok: true };
  } catch {
    return { ok: false, reason: "NETWORK_ERROR" };
  }
}
