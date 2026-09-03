/**
 * The one place a resolved cart line becomes a canonical commerce event fact.
 *
 * Mutation snapshots, `view_cart` and `begin_checkout` all come through here, so there is a single
 * definition of what makes a line analytics-safe. A second mapper — one for the cart page and a
 * slightly different one for checkout — is how two funnel events end up disagreeing about the same
 * basket.
 *
 * Three properties matter and are enforced rather than assumed:
 *
 *   - **External identity only.** `variantId` is `VariantMirror.id`, a local CUID that exists for
 *     authorization and mutation. It is never read here, so no code path can substitute it for a
 *     vendor `item_id` — a fabricated identity would silently fail to match the catalog and the
 *     Merchant feed while looking perfectly valid.
 *   - **Server money.** `unitPriceVnd` comes from the resolved line, which prices through the
 *     central promotion authority. Nothing rendered, cached or client-supplied reaches this.
 *   - **Fail closed.** An unsafe line returns `null`. Callers must then suppress the event, never
 *     substitute a fallback, and never drop the line and emit the rest.
 *
 * Named fields only: a line carries media and availability facts that have no business in a vendor
 * payload, and spreading would carry them along.
 */

import { buildVariantItem, type CommerceVariantItemFacts } from "../tracking/commerce-events.ts";
import type { StorefrontCartLine } from "./storefront-cart.ts";

/** The subset of a resolved cart line a canonical event fact is allowed to read. */
export type CartAnalyticsLineFacts = Readonly<{
  pancakeVariationId: string | null;
  pancakeProductId: string | null;
  productName: string | null;
  color: string | null;
  size: string | null;
  price: number | null;
}>;

function optionalText(value: string | null): string | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Builds one canonical variant item fact, or `null` when the line cannot supply one safely.
 *
 * `quantity` is the event's own quantity, which is not always the line's committed quantity: an
 * `add_to_cart` reports the positive delta that was committed, not the total the line now holds.
 * The caller therefore states it explicitly and the value is validated as a positive integer here.
 *
 * Validation is delegated to the canonical builder rather than duplicated. That builder is the
 * contract every event must satisfy, so a fact set that survives it is one an event can carry, and
 * a fact set that does not is rejected at the source instead of throwing later inside a shopper's
 * click handler.
 */
export function buildCartAnalyticsItemFacts({
  line,
  quantity,
}: Readonly<{
  line: CartAnalyticsLineFacts;
  quantity: number;
}>): CommerceVariantItemFacts | null {
  if (line.pancakeVariationId === null || line.price === null || line.productName === null) {
    return null;
  }

  const facts: CommerceVariantItemFacts = {
    variantExternalId: line.pancakeVariationId,
    itemName: line.productName,
    unitPriceVnd: line.price,
    quantity,
    ...(line.pancakeProductId === null ? {} : { productExternalId: line.pancakeProductId }),
    ...(optionalText(line.color) === undefined ? {} : { color: optionalText(line.color) }),
    ...(optionalText(line.size) === undefined ? {} : { size: optionalText(line.size) }),
  };

  try {
    // Round-trips the facts through the canonical item builder purely as validation: identity
    // bounds, integer money and positive quantity all fail closed here rather than at the sink.
    buildVariantItem(facts);
  } catch {
    return null;
  }

  return Object.freeze(facts);
}

/** Narrows a full resolved cart line to the fields a canonical event fact may read. */
export function toCartAnalyticsLineFacts(line: StorefrontCartLine): CartAnalyticsLineFacts {
  return {
    pancakeVariationId: line.pancakeVariationId,
    pancakeProductId: line.pancakeProductId,
    productName: line.productName,
    color: line.color,
    size: line.size,
    price: line.price,
  };
}

/**
 * Rebuilds a canonical item from an untyped value, for a public action's outward boundary.
 *
 * Two things happen here that a type annotation cannot do at runtime. Fields are copied by name, so
 * a widened upstream shape cannot carry cart identity, a local `VariantMirror.id` or customer facts
 * across the boundary. And the result is validated through the canonical builder, so an empty
 * identity, fractional money or a non-positive quantity fails closed as "no snapshot" rather than
 * reaching a browser that would then publish it.
 *
 * `quantity` is stated by the caller because an event's quantity is how much moved, which is not
 * the quantity the committed line holds.
 */
export function toPublicCartAnalyticsItemFacts(
  value: unknown,
  quantity: number,
): CommerceVariantItemFacts | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;

  const variantExternalId = record.variantExternalId;
  const itemName = record.itemName;
  const unitPriceVnd = record.unitPriceVnd;
  if (
    typeof variantExternalId !== "string"
    || typeof itemName !== "string"
    || typeof unitPriceVnd !== "number"
  ) {
    return null;
  }

  return buildCartAnalyticsItemFacts({
    line: {
      pancakeVariationId: variantExternalId,
      pancakeProductId: typeof record.productExternalId === "string"
        ? record.productExternalId
        : null,
      productName: itemName,
      color: typeof record.color === "string" ? record.color : null,
      size: typeof record.size === "string" ? record.size : null,
      price: unitPriceVnd,
    },
    quantity,
  });
}
