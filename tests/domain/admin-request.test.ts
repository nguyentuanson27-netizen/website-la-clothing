import assert from "node:assert/strict";
import test from "node:test";

import { AuthorizationError } from "../../src/auth/authorization.ts";
import { createAdminRequestGuard } from "../../src/auth/admin-request.ts";

const requestHeaders = new Headers({ cookie: "session=opaque" });
const adminSession = {
  user: { id: "admin-1", role: "ADMIN" },
  session: { id: "session-admin" },
} as const;
const customerSession = {
  user: { id: "customer-1", role: "CUSTOMER" },
  session: { id: "session-customer" },
} as const;

test("admin request guard validates the current server session with request headers", async () => {
  const observedHeaders: Headers[] = [];
  const guard = createAdminRequestGuard({
    getRequestHeaders: async () => requestHeaders,
    getSession: async ({ headers }) => {
      observedHeaders.push(headers);
      return adminSession;
    },
  });

  assert.equal(await guard.requireAdmin(), adminSession);
  assert.deepEqual(observedHeaders, [requestHeaders]);
});

test("admin request guard fails closed for missing or non-admin sessions", async () => {
  for (const session of [null, customerSession] as const) {
    const guard = createAdminRequestGuard({
      getRequestHeaders: async () => requestHeaders,
      getSession: async () => session,
    });

    await assert.rejects(
      () => guard.requireAdmin(),
      (error: unknown) => {
        assert.ok(error instanceof AuthorizationError);
        assert.equal(error.code, session ? "FORBIDDEN" : "UNAUTHENTICATED");
        return true;
      },
    );
  }
});
