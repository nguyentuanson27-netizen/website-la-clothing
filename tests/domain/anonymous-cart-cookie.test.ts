import assert from "node:assert/strict";
import test from "node:test";

import {
  ANONYMOUS_CART_COOKIE_NAME,
  createAnonymousCartCookieSession,
} from "../../src/commerce/anonymous-cart-cookie.ts";

type CookieWrite = {
  name: string;
  value: string;
  httpOnly?: boolean;
  sameSite?: "lax" | "strict" | "none";
  secure?: boolean;
  path?: string;
  expires?: Date;
  maxAge?: number;
};

function createFakeCookieStore(initialValue?: string) {
  const writes: CookieWrite[] = [];

  return {
    store: {
      get(name: string) {
        if (name !== ANONYMOUS_CART_COOKIE_NAME || initialValue === undefined) {
          return undefined;
        }
        return { value: initialValue };
      },
      set(cookie: CookieWrite) {
        writes.push(cookie);
      },
    },
    writes,
  };
}

test("reads only a canonical opaque cart UUID from the request cookie", () => {
  const validCartId = "5bba8944-1621-4c46-9f3e-5e9741247df5";
  const valid = createFakeCookieStore(validCartId);
  const malformed = createFakeCookieStore("../../account-cart");
  const padded = createFakeCookieStore(` ${validCartId} `);

  assert.equal(createAnonymousCartCookieSession(valid.store).read(), validCartId);
  assert.equal(createAnonymousCartCookieSession(malformed.store).read(), null);
  assert.equal(createAnonymousCartCookieSession(padded.store).read(), null);
});

test("writes an HttpOnly same-site production cookie that expires with the server cart", () => {
  const cartId = "5bba8944-1621-4c46-9f3e-5e9741247df5";
  const expiresAt = new Date("2026-08-16T12:00:00.000Z");
  const fake = createFakeCookieStore();

  createAnonymousCartCookieSession(fake.store, { production: true }).write({
    cartId,
    expiresAt,
  });

  assert.deepEqual(fake.writes, [
    {
      name: ANONYMOUS_CART_COOKIE_NAME,
      value: cartId,
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      expires: expiresAt,
    },
  ]);
  assert.equal("domain" in fake.writes[0]!, false);
});

test("keeps the cookie usable on local HTTP development without weakening production", () => {
  const fake = createFakeCookieStore();

  createAnonymousCartCookieSession(fake.store, { production: false }).write({
    cartId: "5bba8944-1621-4c46-9f3e-5e9741247df5",
    expiresAt: new Date("2026-08-16T12:00:00.000Z"),
  });

  assert.equal(fake.writes[0]?.secure, false);
});

test("rejects invalid internal cart identity or expiry before writing a cookie", () => {
  const fake = createFakeCookieStore();
  const session = createAnonymousCartCookieSession(fake.store, { production: true });

  assert.throws(
    () => session.write({ cartId: "not-a-uuid", expiresAt: new Date("2026-08-16T12:00:00.000Z") }),
    /cart/i,
  );
  assert.throws(
    () =>
      session.write({
        cartId: "5bba8944-1621-4c46-9f3e-5e9741247df5",
        expiresAt: new Date(Number.NaN),
      }),
    /expiry/i,
  );
  assert.deepEqual(fake.writes, []);
});

test("clears the same cookie scope without exposing the cart id", () => {
  const fake = createFakeCookieStore("5bba8944-1621-4c46-9f3e-5e9741247df5");

  createAnonymousCartCookieSession(fake.store, { production: true }).clear();

  assert.deepEqual(fake.writes, [
    {
      name: ANONYMOUS_CART_COOKIE_NAME,
      value: "",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 0,
    },
  ]);
});
