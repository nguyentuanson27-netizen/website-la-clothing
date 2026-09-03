/**
 * The one canonical cart analytics projection, consumed by `view_cart` and `begin_checkout`.
 *
 * Both events describe the same basket at the same moment, so they are built from one projection.
 * A cart mapper and a slightly different checkout mapper would be two answers to one question, and
 * the funnel would eventually show a basket changing between the cart page and the checkout page
 * when nothing had changed at all.
 *
 * **All or nothing.** A cart event is a statement about a whole basket and a total that reconciles
 * with it. If any non-empty line cannot supply a safe external identity, an authoritative price, a
 * positive integer quantity and a name, the projection is unavailable and both events are
 * suppressed. It is deliberately not a filter:
 *
 *   - dropping the unsafe line would report a basket the shopper does not have;
 *   - keeping it with a placeholder identity — a local CUID, the slug — would put a value in
 *     `item_id` that matches nothing in the catalog or the feed;
 *   - emitting the safe lines with a total over only those lines would publish a checkout value
 *     smaller than the cart, with nothing to show why.
 *
 * A composite component line carries the external identity of the component variation that is
 * actually being bought. The parent it happens to be sold through is presentation.
 *
 * None of this can affect shopping. The projection is a pure read of already-resolved lines; being
 * unavailable means an event is not published, never that a cart or checkout behaves differently.
 */

import {
  buildCartAnalyticsItemFacts,
  toCartAnalyticsLineFacts,
} from "./cart-analytics-facts.ts";
import type { StorefrontCartLine } from "./storefront-cart.ts";
import type { CommerceVariantItemFacts } from "../tracking/commerce-events.ts";

const MAX_SAFE_VND = BigInt(Number.MAX_SAFE_INTEGER);

export type CanonicalCartProjection = Readonly<{
  items: readonly CommerceVariantItemFacts[];
  currency: "VND";
  /** Exactly `sum(unitPriceVnd × quantity)` over the complete emitted item set. */
  merchandiseValueVnd: number;
}>;

/**
 * Builds the complete projection, or `null`.
 *
 * The empty cart is `null` too: there is no basket to describe, and an event with no items is not
 * something the canonical contract accepts.
 *
 * The total is accumulated in `BigInt`. Each price and quantity is individually a safe integer, but
 * their product and the running sum need not be, and a checkout value that quietly lost precision
 * is worse than one that failed.
 */
export function buildCanonicalCartAnalyticsProjection(
  lines: readonly StorefrontCartLine[],
): CanonicalCartProjection | null {
  if (lines.length === 0) return null;

  const items: CommerceVariantItemFacts[] = [];
  let merchandiseValueVnd = BigInt(0);

  for (const line of lines) {
    const facts = buildCartAnalyticsItemFacts({
      line: toCartAnalyticsLineFacts(line),
      quantity: line.quantity,
    });
    if (facts === null) return null;

    items.push(facts);
    merchandiseValueVnd += BigInt(facts.unitPriceVnd) * BigInt(facts.quantity);
    if (merchandiseValueVnd > MAX_SAFE_VND) return null;
  }

  return Object.freeze({
    items: Object.freeze(items),
    currency: "VND" as const,
    merchandiseValueVnd: Number(merchandiseValueVnd),
  });
}
