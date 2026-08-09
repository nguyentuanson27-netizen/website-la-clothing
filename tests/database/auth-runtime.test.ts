import assert from "node:assert/strict";
import test from "node:test";

import { auth } from "../../src/auth/server.ts";
import { prisma } from "../../src/db/prisma.ts";

const email = "auth-runtime-smoke@example.invalid";
const password = "runtime-smoke-password-123";

function cookieHeaderFrom(headers: Headers): string {
  return headers
    .getSetCookie()
    .map((cookie) => cookie.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

test.beforeEach(async () => {
  await prisma.user.deleteMany({ where: { email } });
});

test.afterEach(async () => {
  await prisma.user.deleteMany({ where: { email } });
});

test.after(async () => {
  await prisma.$disconnect();
});

test("Better Auth is wired to the explicitly trusted client IP header", () => {
  assert.deepEqual(auth.options.advanced?.ipAddress?.ipAddressHeaders, ["x-ci-client-ip"]);
});

test("Better Auth signs up a CUSTOMER and its returned cookie resolves to a server session", async () => {
  const { headers } = await auth.api.signUpEmail({
    returnHeaders: true,
    body: {
      name: "Auth Runtime Smoke",
      email,
      password,
    },
  });

  const cookie = cookieHeaderFrom(headers);
  assert.notEqual(cookie, "");

  const session = await auth.api.getSession({
    headers: new Headers({ cookie }),
  });

  assert.ok(session);
  assert.equal(session.user.email, email);
  assert.equal(session.user.role, "CUSTOMER");

  const persisted = await prisma.user.findUnique({ where: { email } });
  assert.ok(persisted);
  assert.equal(persisted.role, "CUSTOMER");
});
