import assert from "node:assert/strict";
import test from "node:test";

import { deriveGuestCheckoutClientKey } from "../../src/commerce/guest-checkout-client-identity.ts";

function headerStore(values: Record<string, string | undefined>) {
  return {
    get(name: string) {
      return values[name.toLowerCase()] ?? null;
    },
  };
}

const productionConfig = {
  secret: "0123456789abcdef0123456789abcdef",
  baseURL: "https://shop.example.com",
  ipAddressHeader: "x-real-client-ip",
};

test("checkout client identity uses only the configured trusted single-value IP header and never exposes raw IP", () => {
  const first = deriveGuestCheckoutClientKey(
    headerStore({
      "x-real-client-ip": "203.0.113.10",
      "x-forwarded-for": "198.51.100.200, 198.51.100.201",
    }),
    productionConfig,
  );
  const same = deriveGuestCheckoutClientKey(
    headerStore({ "x-real-client-ip": "203.0.113.10" }),
    productionConfig,
  );
  const other = deriveGuestCheckoutClientKey(
    headerStore({ "x-real-client-ip": "203.0.113.11" }),
    productionConfig,
  );

  assert.equal(first, same);
  assert.notEqual(first, other);
  assert.match(first, /^v1:[0-9a-f]{64}$/);
  assert.equal(first.includes("203.0.113.10"), false);
});

test("checkout client identity fails closed for missing, malformed, or multi-value trusted IP", () => {
  for (const value of [undefined, "", "not-an-ip", "203.0.113.10, 203.0.113.11", " 203.0.113.10 "]) {
    assert.throws(
      () => deriveGuestCheckoutClientKey(headerStore({ "x-real-client-ip": value }), productionConfig),
      /Checkout client identity is unavailable/,
    );
  }
});

test("local development without a proxy header gets one stable non-IP fallback identity", () => {
  const localConfig = {
    secret: productionConfig.secret,
    baseURL: "http://localhost:3000",
    ipAddressHeader: undefined,
  };
  const key = deriveGuestCheckoutClientKey(headerStore({}), localConfig);
  assert.equal(key, deriveGuestCheckoutClientKey(headerStore({}), localConfig));
  assert.match(key, /^v1:[0-9a-f]{64}$/);

  assert.throws(
    () =>
      deriveGuestCheckoutClientKey(headerStore({}), {
        ...localConfig,
        baseURL: "https://shop.example.com",
      }),
    /Checkout client identity is unavailable/,
  );
});
