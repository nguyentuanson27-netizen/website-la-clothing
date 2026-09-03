import { buildCanonicalCartAnalyticsProjection } from "@/commerce/cart-analytics-projection";
import type { StorefrontCartLine } from "@/commerce/storefront-cart";
import {
  buildBeginCheckoutEvent,
  buildVariantItem,
  buildViewCartEvent,
  type TrackingEvent,
} from "@/tracking/commerce-events";

import { isCommerceTrackingEnabled } from "./commerce-event-reporter";

function buildCartEvent(
  lines: readonly StorefrontCartLine[],
  build: (items: ReturnType<typeof buildVariantItem>[]) => TrackingEvent,
): TrackingEvent | null {
  if (!isCommerceTrackingEnabled()) return null;

  const projection = buildCanonicalCartAnalyticsProjection(lines);
  if (projection === null) return null;

  try {
    return build(projection.items.map((facts) => buildVariantItem(facts)));
  } catch {
    return null;
  }
}

/**
 * `view_cart` from the cart page's current resolved truth.
 *
 * The same lines the page renders, at the same prices, through the one all-or-nothing projection.
 * A cart holding anything the projection cannot describe safely emits nothing at all — the shopper
 * still sees their cart, and the funnel simply has no observation for this visit rather than a
 * misleading one.
 */
export function buildCartViewEvent(
  lines: readonly StorefrontCartLine[],
): TrackingEvent | null {
  return buildCartEvent(lines, (items) => buildViewCartEvent({ items }));
}

/**
 * `begin_checkout`, for a checkout that has already passed its commerce-validity gates.
 *
 * The caller emits this only on the branch where every line resolved, priced and had sufficient
 * stock — the same condition that lets the page render a checkout form at all. Analytics never
 * decides that: a projection that cannot be built suppresses the event and leaves checkout exactly
 * as it was, because measurement is not an authorization step.
 */
export function buildCheckoutBeginEvent(
  lines: readonly StorefrontCartLine[],
): TrackingEvent | null {
  return buildCartEvent(lines, (items) => buildBeginCheckoutEvent({ items }));
}
