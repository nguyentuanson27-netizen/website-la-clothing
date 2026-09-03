/**
 * Fail-closed constructors for the upper-funnel events.
 *
 * The canonical builders throw on anything that would put an untruthful fact in front of a vendor —
 * an empty identity, a fabricated price, an inverted range. That is right at the contract level and
 * wrong at a page level: a product whose mirror row lost its name must not take down the page that
 * lists it. These wrappers convert that refusal into `null`, which every caller renders as "no
 * event".
 *
 * `view_item` accepts both identity levels on purpose, and which one is used is a statement about
 * what the shopper has actually chosen:
 *
 *   - an ordinary product page has no selection yet, so it reports the product;
 *   - a page whose URL named one valid current standalone variation arrives with that variation
 *     already selected and server-resolved, so it reports the variant.
 *
 * The second case is not a guess and not a widening of the reviewed contract: it is the "unless the
 * route itself authoritatively preselects a valid variant" clause, now that the deep-link unit
 * resolves that query against the product's own authorized public option list. A shopper who then
 * changes the selection by hand does not produce another `view_item`; one page view is one view.
 */

import {
  buildCommerceItemsEvent,
  buildProductImpression,
  buildVariantItem,
  type CommerceProductImpression,
  type CommerceVariantItemFacts,
  type TrackingEvent,
} from "./commerce-events.ts";

export type ProductListContext = Readonly<{ listId: string; listName: string }>;

/** One `view_item_list` for one rendered card grid, or `null` when no card can be described. */
export function buildProductListViewEvent({
  impressions,
  list,
}: Readonly<{
  impressions: readonly CommerceProductImpression[];
  list?: ProductListContext;
}>): TrackingEvent | null {
  try {
    const items = impressions.map((impression) => buildProductImpression(impression));
    if (items.length === 0) return null;
    return buildCommerceItemsEvent("view_item_list", {
      items,
      ...(list === undefined ? {} : { itemListId: list.listId, itemListName: list.listName }),
    });
  } catch {
    return null;
  }
}

/** `select_item` for the product card a shopper clicked. */
export function buildProductSelectEvent({
  impression,
  list,
}: Readonly<{
  impression: CommerceProductImpression;
  list?: ProductListContext;
}>): TrackingEvent | null {
  try {
    return buildCommerceItemsEvent("select_item", {
      items: [buildProductImpression(impression)],
      ...(list === undefined ? {} : { itemListId: list.listId, itemListName: list.listName }),
    });
  } catch {
    return null;
  }
}

/** Product-level `view_item`, for a product page with no variant selected. */
export function buildProductViewEvent(
  impression: CommerceProductImpression,
): TrackingEvent | null {
  try {
    return buildCommerceItemsEvent("view_item", {
      items: [buildProductImpression(impression)],
    });
  } catch {
    return null;
  }
}

/** Selected-variant `view_item`, for a product page the route preselected a valid variation on. */
export function buildVariantViewEvent(
  facts: CommerceVariantItemFacts,
): TrackingEvent | null {
  try {
    return buildCommerceItemsEvent("view_item", { items: [buildVariantItem(facts)] });
  } catch {
    return null;
  }
}
