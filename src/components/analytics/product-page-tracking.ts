import { buildStorefrontProductImpressionFromOptions } from "@/commerce/storefront-impressions";
import type { StorefrontProjectionOption } from "@/commerce/storefront-projection";
import type { DeepLinkedVariantSelection } from "@/commerce/storefront-variant-deep-link";
import type { TrackingEvent } from "@/tracking/commerce-events";
import { buildProductViewEvent, buildVariantViewEvent } from "@/tracking/upper-funnel-events";

import { isCommerceTrackingEnabled } from "./commerce-event-reporter";

/**
 * The product page's single `view_item`, at the identity level the page actually arrived at.
 *
 * An ordinary product page opens with nothing chosen: no kind, no colour, no size. Its `view_item`
 * is therefore product-level. Picking a variant to name here — the first, the cheapest — would
 * report a selection the shopper has not made.
 *
 * A page reached through `/shop/<slug>?variant=<pancakeVariationId>` is different. The deep-link
 * unit resolved that query server-side against this product's own authorized public option list, so
 * the page renders with one concrete current variation already selected and priced. That is the
 * reviewed contract's "unless the route itself authoritatively preselects a valid variant" case, and
 * reporting it at product level would understate what the page is showing. The variant event uses
 * the projection's own resolved price, so it agrees with the price on screen.
 *
 * The variant path falls back to the product-level event rather than inventing money when the
 * preselected option has no resolvable price — a sold-out or unpriceable variation is still a valid
 * deep-link target, and a product-level impression remains a truthful description of the page.
 *
 * Selecting an option by hand afterwards does not produce a second `view_item`: one page view is
 * one view, and re-reporting on every radio click would inflate the funnel with interactions the
 * canonical vocabulary already has no event for.
 */
export function buildProductPageViewEvent({
  pancakeProductId,
  name,
  options,
  deepLinkedSelection,
}: Readonly<{
  pancakeProductId: string;
  name: string;
  options: readonly StorefrontProjectionOption[];
  deepLinkedSelection: DeepLinkedVariantSelection | null;
}>): TrackingEvent | null {
  if (!isCommerceTrackingEnabled()) return null;

  if (deepLinkedSelection !== null) {
    const selected = options.find((option) => option.id === deepLinkedSelection.variantId);
    if (selected !== undefined && selected.price !== null) {
      const variantEvent = buildVariantViewEvent({
        variantExternalId: selected.pancakeVariationId,
        productExternalId: pancakeProductId,
        itemName: name,
        unitPriceVnd: selected.price,
        quantity: 1,
        ...(selected.color === null ? {} : { color: selected.color }),
        ...(selected.size === null ? {} : { size: selected.size }),
      });
      if (variantEvent !== null) return variantEvent;
    }
  }

  const impression = buildStorefrontProductImpressionFromOptions({
    pancakeProductId,
    name,
    options,
  });
  return impression === null ? null : buildProductViewEvent(impression);
}
