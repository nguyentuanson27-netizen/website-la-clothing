/**
 * The browser publisher.
 *
 * Two rules make this safe to call from anywhere in the commerce path:
 *
 *   - it never throws. A blocked, hostile or absent dataLayer is a no-op, because a tracking
 *     failure must never change whether an order was placed;
 *   - it never replaces an initialized `window.dataLayer`. Whatever already queued into it —
 *     including entries pushed before this module ran — stays in order.
 *
 * Every commerce push is preceded by an `ecommerce: null` reset so keys from the previous event
 * cannot bleed into the next one, which is how a stale item list or price ends up attached to an
 * unrelated conversion.
 */

import type { TrackingEvent } from "./commerce-events.ts";
import { canonicalizeTrackingEvent } from "./event-boundary.ts";

export const DATA_LAYER_NAME = "dataLayer";

type DataLayerHost = { [DATA_LAYER_NAME]?: unknown } | undefined;

/**
 * Returns the shared dataLayer array, creating it only when nothing occupies the slot. An existing
 * non-array value fails closed rather than being overwritten: something else owns that global, and
 * clobbering it would break whatever put it there.
 */
export function ensureDataLayer(host: DataLayerHost): unknown[] | null {
  if (host === undefined || host === null) return null;

  try {
    const existing = host[DATA_LAYER_NAME];
    if (Array.isArray(existing)) return existing;
    if (existing !== undefined) return null;

    const created: unknown[] = [];
    host[DATA_LAYER_NAME] = created;
    return created;
  } catch {
    return null;
  }
}

/**
 * Publishes one canonical event. The runtime boundary rebuilds even structurally compatible input
 * before it reaches the sink, so caller-added checkout/customer fields cannot hitch a ride through
 * TypeScript's open object compatibility. Malformed input fails before the dataLayer is initialized.
 *
 * Returns whether the canonical event reached the dataLayer, so a caller that needs to know can
 * react — but no caller is required to, and no path may treat `false` as an error.
 */
export function publishTrackingEvent(host: DataLayerHost, event: TrackingEvent): boolean {
  let canonicalEvent: TrackingEvent;
  try {
    canonicalEvent = canonicalizeTrackingEvent(event);
  } catch {
    return false;
  }

  const dataLayer = ensureDataLayer(host);
  if (dataLayer === null) return false;

  try {
    dataLayer.push({ ecommerce: null });
    dataLayer.push(canonicalEvent);
    return true;
  } catch {
    return false;
  }
}

/** Publishes against the live browser global; a server or non-browser context is a no-op. */
export function publishBrowserTrackingEvent(event: TrackingEvent): boolean {
  if (typeof window === "undefined") return false;
  return publishTrackingEvent(window as unknown as DataLayerHost, event);
}
