/**
 * Canonical commerce event contract.
 *
 * Business code owns event truth. Everything downstream — GTM, GA4, Ads, TikTok — routes and maps
 * these facts; none of them recomputes a price or an identity. The two identity levels are kept
 * apart on purpose: the storefront has legitimate states where no variant has been selected, and
 * guessing a first or cheapest variant to obtain a variation id would report a purchase intent that
 * never happened.
 *
 *   - product-level upper funnel  → `pancakeProductId`
 *   - selected/committed variant  → `pancakeVariationId`
 *   - Purchase transaction/event  → `OrderMirror.publicCode`
 *
 * A slug, a local CUID or a `VariantMirror.id` is never a vendor-facing commerce identity: they are
 * presentation or internal-authorization keys and would silently diverge from the catalog and feed.
 *
 * Every builder constructs its payload from named fields only, so no caller can widen an event with
 * checkout PII by spreading a larger object into it.
 */

export const COMMERCE_EVENT_NAMES = [
  "page_view",
  "view_item_list",
  "select_item",
  "view_item",
  "add_to_cart",
  "remove_from_cart",
  "view_cart",
  "begin_checkout",
  "purchase",
] as const;

export type CommerceEventName = (typeof COMMERCE_EVENT_NAMES)[number];

/** Events whose items must be concrete selected/committed variants. */
const COMMITTED_VARIANT_EVENTS = new Set<CommerceEventName>([
  "add_to_cart",
  "remove_from_cart",
  "view_cart",
  "begin_checkout",
  "purchase",
]);

/** Browser-supplied and mirrored identifiers alike stay bounded before they reach a vendor. */
export const MAX_COMMERCE_IDENTIFIER_LENGTH = 128;

export type CommerceProductImpression = Readonly<{
  productExternalId: string;
  itemName: string;
  exactPriceVnd?: number;
  minimumPriceVnd?: number;
  maximumPriceVnd?: number;
  listId?: string;
  listName?: string;
  index?: number;
}>;

export type CommerceVariantItemFacts = Readonly<{
  variantExternalId: string;
  productExternalId?: string;
  itemName: string;
  unitPriceVnd: number;
  quantity: number;
  color?: string;
  size?: string;
  projectionContext?: string;
}>;

export type ProductImpressionItem = {
  item_id: string;
  item_name: string;
  price?: number;
  la_minimum_price_vnd?: number;
  la_maximum_price_vnd?: number;
  item_list_id?: string;
  item_list_name?: string;
  index?: number;
};

export type VariantItem = {
  item_id: string;
  item_name: string;
  item_group_id?: string;
  price: number;
  quantity: number;
  item_variant?: string;
  la_projection_context?: string;
};

export type CommerceItem = ProductImpressionItem | VariantItem;

export type TrackingEvent = Readonly<{
  event: string;
  [key: string]: unknown;
}>;

function requireIdentity(value: string, label: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0 || trimmed.length > MAX_COMMERCE_IDENTIFIER_LENGTH) {
    throw new RangeError(`${label} must be a bounded non-empty external identity`);
  }
  return trimmed;
}

function requireText(value: string, label: string): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length === 0) throw new RangeError(`${label} must not be empty`);
  return trimmed;
}

function requireIntegerVnd(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer VND amount`);
  }
  return value;
}

function requireQuantity(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError("commerce item quantity must be a positive safe integer");
  }
  return value;
}

function describeOptions(color?: string, size?: string): string | undefined {
  const parts = [color, size].map((part) => part?.trim()).filter((part) => (part ?? "").length > 0);
  return parts.length === 0 ? undefined : parts.join(" / ");
}

/**
 * A product impression may carry an exact price, a min/max range, or no money at all.
 *
 * The range case deliberately omits `price`: reporting the minimum as a vendor price would let a
 * downstream destination treat it as the price of a variant the shopper never selected. An
 * unresolved product omits monetary fields entirely rather than fabricating a value.
 */
export function buildProductImpression(
  impression: CommerceProductImpression,
): ProductImpressionItem {
  const item: ProductImpressionItem = {
    item_id: requireIdentity(impression.productExternalId, "product identity"),
    item_name: requireText(impression.itemName, "commerce item name"),
  };

  const { exactPriceVnd, minimumPriceVnd, maximumPriceVnd } = impression;
  if (exactPriceVnd !== undefined) {
    item.price = requireIntegerVnd(exactPriceVnd, "product price");
  } else if (minimumPriceVnd !== undefined || maximumPriceVnd !== undefined) {
    if (minimumPriceVnd === undefined || maximumPriceVnd === undefined) {
      throw new RangeError("a product price range requires both a minimum and a maximum");
    }
    const minimum = requireIntegerVnd(minimumPriceVnd, "product price");
    const maximum = requireIntegerVnd(maximumPriceVnd, "product price");
    if (minimum > maximum) throw new RangeError("a product price range must not be inverted");
    if (minimum === maximum) item.price = minimum;
    else {
      item.la_minimum_price_vnd = minimum;
      item.la_maximum_price_vnd = maximum;
    }
  }

  if (impression.listId !== undefined) {
    item.item_list_id = requireIdentity(impression.listId, "list identity");
  }
  if (impression.listName !== undefined) {
    item.item_list_name = requireText(impression.listName, "list name");
  }
  if (impression.index !== undefined) {
    if (!Number.isSafeInteger(impression.index) || impression.index < 0) {
      throw new RangeError("list index must be a non-negative safe integer");
    }
    item.index = impression.index;
  }

  return item;
}

export function buildVariantItem(facts: CommerceVariantItemFacts): VariantItem {
  const item: VariantItem = {
    item_id: requireIdentity(facts.variantExternalId, "variant identity"),
    item_name: requireText(facts.itemName, "commerce item name"),
    price: requireIntegerVnd(facts.unitPriceVnd, "variant unit price"),
    quantity: requireQuantity(facts.quantity),
  };

  if (facts.productExternalId !== undefined) {
    item.item_group_id = requireIdentity(facts.productExternalId, "product identity");
  }
  const options = describeOptions(facts.color, facts.size);
  if (options !== undefined) item.item_variant = options;
  if (facts.projectionContext !== undefined) {
    item.la_projection_context = requireIdentity(facts.projectionContext, "projection context");
  }

  return item;
}

function isVariantItem(item: CommerceItem): item is VariantItem {
  return typeof (item as VariantItem).price === "number"
    && typeof (item as VariantItem).quantity === "number";
}

/**
 * Re-validates an item at the event boundary.
 *
 * The builders above cannot be the only gate: the event builders accept a `CommerceItem`, so a
 * caller mapping straight from a repository row — or writing a literal — reaches them without ever
 * passing through `buildVariantItem`. A negative price or a fractional quantity that slips through
 * becomes a negative conversion value at a destination, which is worse than no event at all.
 */
function assertCommerceItem(name: CommerceEventName, item: CommerceItem): void {
  if (typeof item !== "object" || item === null) {
    throw new RangeError(`${name} items must be commerce item objects`);
  }
  requireIdentity((item as CommerceItem).item_id, `${name} item identity`);
  requireText((item as CommerceItem).item_name, `${name} item name`);

  const price = (item as VariantItem).price;
  if (price !== undefined) requireIntegerVnd(price, `${name} item price`);

  const quantity = (item as VariantItem).quantity;
  if (quantity !== undefined) requireQuantity(quantity);
}

function requireItems(name: CommerceEventName, items: readonly CommerceItem[]): readonly CommerceItem[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new RangeError(`${name} requires at least one item`);
  }

  for (const item of items) {
    assertCommerceItem(name, item);
    if (COMMITTED_VARIANT_EVENTS.has(name) && !isVariantItem(item)) {
      throw new RangeError(`${name} requires concrete variant identity, not a product impression`);
    }
  }

  // Copied and frozen, so neither the caller's later mutation of its own array nor a mutation of the
  // published event can add a field the validation above never saw. The no-PII property has to hold
  // at publish time, not only at construction time.
  return Object.freeze(items.map((item) => Object.freeze({ ...item })));
}

export type CommerceItemsEventInput = Readonly<{
  items: readonly CommerceItem[];
  itemListId?: string;
  itemListName?: string;
}>;

/**
 * Builds one canonical ecommerce event. Only the named fields are read, so a caller that hands in a
 * larger object — a checkout form model, say — cannot leak customer facts into the dataLayer.
 */
export function buildCommerceItemsEvent(
  name: Exclude<CommerceEventName, "page_view" | "begin_checkout" | "purchase">,
  input: CommerceItemsEventInput,
): TrackingEvent {
  const items = requireItems(name, input.items);
  const ecommerce: Record<string, unknown> = {};

  if (input.itemListId !== undefined) {
    ecommerce.item_list_id = requireIdentity(input.itemListId, "list identity");
  }
  if (input.itemListName !== undefined) {
    ecommerce.item_list_name = requireText(input.itemListName, "list name");
  }
  ecommerce.items = items;

  return Object.freeze({ event: name, ecommerce: Object.freeze(ecommerce) });
}

const MAX_SAFE_VND = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Exact integer accumulation.
 *
 * Every operand is individually a safe integer, but that says nothing about their product or their
 * running sum: two safe prices can multiply past 2^53 and silently lose precision while still
 * looking like a valid number. A checkout value that is quietly wrong is worse than one that fails,
 * so the arithmetic is done in `BigInt` and the result fails closed if it leaves the safe domain.
 */
function sumMerchandiseVnd(items: readonly CommerceItem[]): number {
  let total = BigInt(0);
  for (const item of items) {
    const variant = item as VariantItem;
    total += BigInt(variant.price) * BigInt(variant.quantity);
  }

  if (total > MAX_SAFE_VND) {
    throw new RangeError("merchandise value must stay inside the safe integer VND domain");
  }
  return Number(total);
}

/** GA4 checkout value is the merchandise item sum; shipping is reported separately at Purchase. */
export function buildBeginCheckoutEvent(
  input: Readonly<{ items: readonly CommerceItem[] }>,
): TrackingEvent {
  const items = requireItems("begin_checkout", input.items);

  return Object.freeze({
    event: "begin_checkout",
    ecommerce: Object.freeze({
      currency: "VND",
      value: sumMerchandiseVnd(items),
      items,
    }),
  });
}

export type CommercePurchaseFacts = Readonly<{
  publicCode: string;
  merchandiseValueVnd: number;
  shippingVnd: number;
  totalVnd: number;
  items: readonly CommerceItem[];
}>;

export type PurchaseEvent = Readonly<{
  event: "purchase";
  ecommerce: Readonly<{
    transaction_id: string;
    event_id: string;
    currency: "VND";
    value: number;
    shipping: number;
    la_total_vnd: number;
    items: readonly CommerceItem[];
  }>;
}>;

/**
 * `publicCode` is both the GA4/Ads transaction id and the TikTok event id, so a later Events API
 * implementation shares one identity with the browser event and Meta's existing deduplication.
 *
 * `value` stays the merchandise sum with shipping reported separately; the order total is carried
 * as a first-party fact for the destinations whose owner-approved semantics use it.
 */
export function buildPurchaseEvent(facts: CommercePurchaseFacts): PurchaseEvent {
  const publicCode = requireIdentity(facts.publicCode, "transaction identity");
  const items = requireItems("purchase", facts.items);

  return Object.freeze({
    event: "purchase" as const,
    ecommerce: Object.freeze({
      transaction_id: publicCode,
      event_id: publicCode,
      currency: "VND" as const,
      value: requireIntegerVnd(facts.merchandiseValueVnd, "merchandise value"),
      shipping: requireIntegerVnd(facts.shippingVnd, "shipping value"),
      la_total_vnd: requireIntegerVnd(facts.totalVnd, "order total"),
      items,
    }),
  });
}

/**
 * The canonical page view.
 *
 * Query state is deliberately excluded: it is the surface most likely to carry a tracking token or
 * a customer-supplied value, and no reviewed destination needs it. One navigation still produces
 * exactly one event.
 */
export function buildPageViewEvent(
  location: Readonly<{ pathname: string; search?: string }>,
): TrackingEvent {
  const pathname = typeof location.pathname === "string" ? location.pathname : "";
  if (!pathname.startsWith("/")) {
    throw new RangeError("page path must be an absolute application path");
  }

  return Object.freeze({ event: "page_view", page_path: pathname });
}
