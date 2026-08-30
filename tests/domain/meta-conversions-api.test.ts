import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildMetaConversionsRequest,
  buildMetaPurchaseEvent,
  hashMetaIdentifier,
  normalizeVietnamesePhone,
  sendMetaConversionEvents,
  splitVietnameseName,
} from "../../src/integrations/meta/conversions-api.ts";
import type { MetaConversionsConfig } from "../../src/integrations/meta/pixel-config.ts";

const config: MetaConversionsConfig = Object.freeze({
  pixelId: "123456789012345",
  accessToken: "secret-token",
  graphApiVersion: "v21.0",
  testEventCode: null,
});

const identity = {
  phone: "0912 345 678",
  fullName: "Nguyễn Văn An",
  clientIpAddress: "203.0.113.9",
  clientUserAgent: "Mozilla/5.0",
  fbp: "fb.1.1700000000000.1234567890",
  fbc: "fb.1.1700000000000.AbCd",
} as const;

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

test("every spelling of a Vietnamese number normalizes to the same digits", () => {
  const expected = "84912345678";
  for (const written of [
    "0912345678",
    "0912 345 678",
    "+84912345678",
    "84912345678",
    "0084912345678",
    // A country code followed by the national trunk zero is a common way people write it.
    "+84 0912 345 678",
    "0084 0912345678",
    // Written without the trunk zero at all.
    "912345678",
  ]) {
    assert.equal(normalizeVietnamesePhone(written), expected, written);
  }
  assert.equal(normalizeVietnamesePhone("không có số"), null);
});

test("a Vietnamese name maps given name to fn and family name to ln", () => {
  // Vietnamese order is family first, given last — the reverse of what Meta's fields mean.
  assert.deepEqual(splitVietnameseName("Nguyễn Văn An"), { fn: "An", ln: "Nguyễn" });
  assert.deepEqual(splitVietnameseName("  Trần   Bình  "), { fn: "Bình", ln: "Trần" });
  assert.deepEqual(splitVietnameseName("An"), { fn: "An", ln: "An" });
  assert.equal(splitVietnameseName("   "), null);
});

test("identifiers are lowercased and whitespace-collapsed before hashing", () => {
  assert.equal(hashMetaIdentifier("  An  "), sha256("an"));
  assert.equal(hashMetaIdentifier("Nguyễn  Văn"), hashMetaIdentifier("nguyễn văn"));
});

test("a purchase event hashes identifiers and leaves context in the clear", () => {
  const event = buildMetaPurchaseEvent({
    eventId: "ORDER-123",
    eventTimeSeconds: 1_700_000_000,
    eventSourceUrl: "https://example.test/checkout",
    valueVnd: 1_290_000,
    contents: [{ id: "ao-a054", quantity: 2, itemPrice: 429_000 }],
    identity,
  });

  assert.equal(event.event_name, "Purchase");
  // The event id is what pairs this with the browser pixel's Purchase.
  assert.equal(event.event_id, "ORDER-123");
  assert.equal(event.action_source, "website");

  const userData = event.user_data as Record<string, unknown>;
  assert.deepEqual(userData.ph, [sha256("84912345678")]);
  assert.deepEqual(userData.fn, [sha256("an")]);
  assert.deepEqual(userData.ln, [sha256("nguyễn")]);
  // Meta documents these as plain context, so hashing them would break matching outright.
  assert.equal(userData.client_ip_address, "203.0.113.9");
  assert.equal(userData.fbp, identity.fbp);

  // No raw identifier may survive anywhere in the payload.
  const serialized = JSON.stringify(event);
  assert.equal(serialized.includes("912345678"), false);
  assert.equal(serialized.includes("Nguyễn"), false);

  assert.deepEqual(event.custom_data, {
    currency: "VND",
    value: 1_290_000,
    contents: [{ id: "ao-a054", quantity: 2, item_price: 429_000 }],
    content_type: "product",
  });
});

test("an absent identifier is omitted rather than hashed empty", () => {
  const event = buildMetaPurchaseEvent({
    eventId: "ORDER-124",
    eventTimeSeconds: 1_700_000_000,
    eventSourceUrl: null,
    valueVnd: 100_000,
    contents: [],
    identity: { ...identity, phone: null, fullName: null },
  });

  const userData = event.user_data as Record<string, unknown>;
  assert.equal("ph" in userData, false);
  assert.equal("fn" in userData, false);
  assert.equal("event_source_url" in event, false);
});

test("the access token travels in the body, never the URL", () => {
  const { url, body } = buildMetaConversionsRequest(config, [{ event_name: "Purchase" }]);

  assert.equal(url, "https://graph.facebook.com/v21.0/123456789012345/events");
  assert.equal(url.includes("secret-token"), false);
  assert.equal(JSON.parse(body).access_token, "secret-token");

  const withTestCode = buildMetaConversionsRequest({ ...config, testEventCode: "TEST99" }, []);
  assert.equal(JSON.parse(withTestCode.body).test_event_code, "TEST99");
});

test("transport failures are reported, never thrown at the caller", async () => {
  assert.deepEqual(
    await sendMetaConversionEvents(config, [], async () => new Response("{}", { status: 200 })),
    { ok: true },
  );
  assert.deepEqual(
    await sendMetaConversionEvents(config, [], async () => new Response("nope", { status: 400 })),
    { ok: false, reason: "HTTP_ERROR", status: 400 },
  );
  // A sale must not fail because Meta is unreachable.
  assert.deepEqual(
    await sendMetaConversionEvents(config, [], async () => {
      throw new Error("network down");
    }),
    { ok: false, reason: "NETWORK_ERROR" },
  );
});
