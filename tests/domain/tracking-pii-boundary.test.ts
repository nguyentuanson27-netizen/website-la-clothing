import assert from "node:assert/strict";
import test from "node:test";

import { buildCommerceItemsEvent } from "../../src/tracking/commerce-events.ts";
import { publishTrackingEvent } from "../../src/tracking/data-layer.ts";

type TestWindow = { dataLayer?: unknown };

const forgedVariant = {
  item_id: "pancake-variation-1",
  item_name: "Áo Oxford Relaxed",
  item_group_id: "pancake-product-1",
  price: 890_000,
  quantity: 1,
  guestPhone: "0900000000",
  email: "buyer@example.com",
  addressDetail: "12 Le Loi",
  note: "giao gio hanh chinh",
} as const;

test("T1 commerce builders whitelist item fields instead of preserving caller extras", () => {
  const event = buildCommerceItemsEvent("add_to_cart", {
    items: [forgedVariant],
  });

  assert.deepEqual((event.ecommerce as { items: readonly unknown[] }).items, [
    {
      item_id: "pancake-variation-1",
      item_name: "Áo Oxford Relaxed",
      item_group_id: "pancake-product-1",
      price: 890_000,
      quantity: 1,
    },
  ]);

  const serialized = JSON.stringify(event).toLowerCase();
  for (const forbidden of ["guestphone", "0900000000", "email", "buyer@example.com", "addressdetail", "note"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must be removed at the event boundary`);
  }
});

test("T1 the publisher canonicalizes a direct page_view instead of forwarding extra fields", () => {
  const win: TestWindow = {};
  const forged = {
    event: "page_view",
    page_path: "/shop/ao-oxford",
    guestPhone: "0900000000",
    email: "buyer@example.com",
  };

  assert.equal(publishTrackingEvent(win, forged), true);
  assert.deepEqual(win.dataLayer, [
    { ecommerce: null },
    { event: "page_view", page_path: "/shop/ao-oxford" },
  ]);
});

test("T1 the publisher canonicalizes nested commerce items even when callers bypass builders", () => {
  const win: TestWindow = {};
  const forged = {
    event: "add_to_cart",
    ecommerce: {
      items: [forgedVariant],
      guestName: "Nguyen Van A",
    },
    note: "call before delivery",
  };

  assert.equal(publishTrackingEvent(win, forged), true);
  const serialized = JSON.stringify(win.dataLayer).toLowerCase();
  for (const forbidden of [
    "guestphone",
    "0900000000",
    "email",
    "buyer@example.com",
    "addressdetail",
    "guestname",
    "note",
    "call before delivery",
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} must never reach dataLayer`);
  }
});
