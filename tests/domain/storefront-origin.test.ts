import assert from "node:assert/strict";
import test from "node:test";

import { readStorefrontOrigin } from "../../src/commerce/storefront-origin.ts";

test("storefront origin derives HTTPS only from the server-owned public domain", () => {
  assert.equal(readStorefrontOrigin({ APP_DOMAIN: "la.lanadesign.vn" }), "https://la.lanadesign.vn");
  assert.equal(readStorefrontOrigin({ APP_DOMAIN: "SHOP.EXAMPLE.COM" }), "https://shop.example.com");
});

test("storefront origin permits explicit loopback ports for local HTTP verification", () => {
  assert.equal(readStorefrontOrigin({ APP_DOMAIN: "localhost:3000" }), "http://localhost:3000");
  assert.equal(readStorefrontOrigin({ APP_DOMAIN: "127.0.0.1:3213" }), "http://127.0.0.1:3213");
});

test("storefront origin fails closed for missing or malformed authority configuration", () => {
  for (const value of [
    undefined,
    "",
    " ",
    "https://shop.example.com",
    "shop.example.com/path",
    "shop.example.com?next=evil",
    "user@shop.example.com",
    "shop.example.com:8443",
    "192.168.1.10",
    "bad_domain.example",
  ]) {
    assert.throws(() => readStorefrontOrigin({ APP_DOMAIN: value }), /APP_DOMAIN/);
  }
});

test("storefront origin validation never echoes hostile configuration", () => {
  const hostile = "attacker.example/path?token=should-not-leak";
  try {
    readStorefrontOrigin({ APP_DOMAIN: hostile });
    assert.fail("expected hostile APP_DOMAIN to fail");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.equal(message.includes(hostile), false);
    assert.equal(message.includes("should-not-leak"), false);
  }
});
