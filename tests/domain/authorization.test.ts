import assert from "node:assert/strict";
import test from "node:test";

import {
  AuthorizationError,
  requireAdminSession,
  requireAuthenticatedSession,
} from "../../src/auth/authorization.ts";

const customerSession = {
  user: { id: "customer-1", role: "CUSTOMER" },
  session: { id: "session-1" },
} as const;

const adminSession = {
  user: { id: "admin-1", role: "ADMIN" },
  session: { id: "session-2" },
} as const;

test("requires an authenticated session before protected work continues", () => {
  assert.equal(requireAuthenticatedSession(customerSession), customerSession);

  assert.throws(
    () => requireAuthenticatedSession(null),
    (error: unknown) => {
      assert.ok(error instanceof AuthorizationError);
      assert.equal(error.code, "UNAUTHENTICATED");
      return true;
    },
  );
});

test("requires the server-owned ADMIN role for admin work", () => {
  assert.equal(requireAdminSession(adminSession), adminSession);

  assert.throws(
    () => requireAdminSession(customerSession),
    (error: unknown) => {
      assert.ok(error instanceof AuthorizationError);
      assert.equal(error.code, "FORBIDDEN");
      return true;
    },
  );
});

test("unknown or missing roles fail closed instead of gaining admin access", () => {
  for (const role of [undefined, null, "OWNER", "admin", ""] as const) {
    assert.throws(
      () =>
        requireAdminSession({
          user: { id: "user-1", role },
          session: { id: "session-1" },
        }),
      (error: unknown) => {
        assert.ok(error instanceof AuthorizationError);
        assert.equal(error.code, "FORBIDDEN");
        return true;
      },
    );
  }
});
