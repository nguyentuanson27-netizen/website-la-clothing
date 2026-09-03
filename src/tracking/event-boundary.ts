import {
  buildBeginCheckoutEvent,
  buildCommerceItemsEvent,
  buildPageViewEvent,
  buildPurchaseEvent,
  buildViewCartEvent,
  type CommerceItem,
  type TrackingEvent,
} from "./commerce-events.ts";

type UnknownRecord = Record<string, unknown>;

function requireRecord(value: unknown, label: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RangeError(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RangeError(`${label} must be a non-empty string`);
  }
  return value;
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number") throw new RangeError(`${label} must be a number`);
  return value;
}

function readItems(ecommerce: UnknownRecord): readonly CommerceItem[] {
  if (!Array.isArray(ecommerce.items)) {
    throw new RangeError("commerce event requires an items array");
  }
  return ecommerce.items as CommerceItem[];
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, label);
}

/**
 * Final runtime boundary before an event reaches the browser dataLayer.
 *
 * Callers are allowed to hand the publisher a structurally compatible literal, so TypeScript alone
 * cannot guarantee that no checkout/customer property was attached after a canonical builder ran.
 * Rebuilding through the canonical builders gives the sink a closed field set and re-applies the
 * identity, money and committed-variant invariants. Unknown fields are discarded; malformed known
 * fields fail closed.
 */
export function canonicalizeTrackingEvent(event: unknown): TrackingEvent {
  const input = requireRecord(event, "tracking event");
  const name = requireString(input.event, "tracking event name");

  if (name === "page_view") {
    return buildPageViewEvent({
      pathname: requireString(input.page_path, "page path"),
    });
  }

  const ecommerce = requireRecord(input.ecommerce, `${name} ecommerce payload`);
  const items = readItems(ecommerce);

  switch (name) {
    case "view_item_list":
    case "select_item":
    case "view_item":
    case "add_to_cart":
    case "remove_from_cart":
      return buildCommerceItemsEvent(name, {
        items,
        itemListId: optionalString(ecommerce.item_list_id, "list identity"),
        itemListName: optionalString(ecommerce.item_list_name, "list name"),
      });

    case "view_cart":
      return buildViewCartEvent({ items });

    case "begin_checkout":
      return buildBeginCheckoutEvent({ items });

    case "purchase": {
      const transactionId = requireString(ecommerce.transaction_id, "purchase transaction identity");
      const eventId = requireString(ecommerce.event_id, "purchase event identity");
      if (transactionId !== eventId) {
        throw new RangeError("purchase transaction and event identities must match");
      }
      if (ecommerce.currency !== "VND") {
        throw new RangeError("purchase currency must be VND");
      }

      return buildPurchaseEvent({
        publicCode: transactionId,
        merchandiseValueVnd: requireNumber(ecommerce.value, "purchase merchandise value"),
        shippingVnd: requireNumber(ecommerce.shipping, "purchase shipping value"),
        totalVnd: requireNumber(ecommerce.la_total_vnd, "purchase order total"),
        items,
      });
    }

    default:
      throw new RangeError("tracking event name is not part of the canonical commerce vocabulary");
  }
}
