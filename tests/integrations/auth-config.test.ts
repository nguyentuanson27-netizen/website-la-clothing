import assert from "node:assert/strict";
import test from "node:test";

import { AuthConfigError, readAuthServerConfig } from "../../src/auth/config.ts";

const VALID_SECRET = "0123456789abcdef0123456789abcdef";

test("reads and normalizes explicit Better Auth server configuration", () => {
  const config = readAuthServerConfig({
    BETTER_AUTH_SECRET: VALID_SECRET,
    BETTER_AUTH_URL: "https://shop.example.com/",
  });

  assert.deepEqual(config, {
    secret: VALID_SECRET,
    baseURL: "https://shop.example.com",
  });
});

test("allows plain HTTP only for local development hosts", () => {
  assert.equal(
    readAuthServerConfig({
      BETTER_AUTH_SECRET: VALID_SECRET,
      BETTER_AUTH_URL: "http://localhost:3000",
    }).baseURL,
    "http://localhost:3000",
  );

  assert.throws(
    () =>
      readAuthServerConfig({
        BETTER_AUTH_SECRET: VALID_SECRET,
        BETTER_AUTH_URL: "http://shop.example.com",
      }),
    AuthConfigError,
  );
});

test("fails closed for missing, weak, or ambiguous auth configuration", async (t) => {
  const cases: Array<{ name: string; env: Record<string, string | undefined> }> = [
    {
      name: "missing secret",
      env: { BETTER_AUTH_URL: "https://shop.example.com" },
    },
    {
      name: "short secret",
      env: { BETTER_AUTH_SECRET: "too-short", BETTER_AUTH_URL: "https://shop.example.com" },
    },
    {
      name: "missing base URL",
      env: { BETTER_AUTH_SECRET: VALID_SECRET },
    },
    {
      name: "non-http URL",
      env: { BETTER_AUTH_SECRET: VALID_SECRET, BETTER_AUTH_URL: "file:///tmp/auth" },
    },
    {
      name: "credentialed URL",
      env: { BETTER_AUTH_SECRET: VALID_SECRET, BETTER_AUTH_URL: "https://user:pass@shop.example.com" },
    },
    {
      name: "URL path",
      env: { BETTER_AUTH_SECRET: VALID_SECRET, BETTER_AUTH_URL: "https://shop.example.com/auth" },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      assert.throws(() => readAuthServerConfig(scenario.env), AuthConfigError);
    });
  }
});

test("configuration errors never echo the Better Auth secret", () => {
  const secret = "super-sensitive-secret-value-1234567890";

  assert.throws(
    () =>
      readAuthServerConfig({
        BETTER_AUTH_SECRET: secret,
        BETTER_AUTH_URL: "invalid-url",
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});
