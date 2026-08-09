import assert from "node:assert/strict";
import test from "node:test";

import { AuthConfigError, readAuthServerConfig } from "../../src/auth/config.ts";

const VALID_SECRET = "0123456789abcdef0123456789abcdef";

test("reads and normalizes explicit Better Auth server configuration", () => {
  const config = readAuthServerConfig({
    BETTER_AUTH_SECRET: VALID_SECRET,
    BETTER_AUTH_URL: "https://shop.example.com/",
    BETTER_AUTH_IP_HEADER: "X-Proxy-Client-IP",
  });

  assert.deepEqual(config, {
    secret: VALID_SECRET,
    baseURL: "https://shop.example.com",
    ipAddressHeader: "x-proxy-client-ip",
  });
});

test("allows plain HTTP only for local development hosts", () => {
  assert.deepEqual(
    readAuthServerConfig({
      BETTER_AUTH_SECRET: VALID_SECRET,
      BETTER_AUTH_URL: "http://localhost:3000",
    }),
    {
      secret: VALID_SECRET,
      baseURL: "http://localhost:3000",
      ipAddressHeader: undefined,
    },
  );

  assert.throws(
    () =>
      readAuthServerConfig({
        BETTER_AUTH_SECRET: VALID_SECRET,
        BETTER_AUTH_URL: "http://shop.example.com",
        BETTER_AUTH_IP_HEADER: "x-proxy-client-ip",
      }),
    AuthConfigError,
  );
});

test("fails closed when production client-IP trust is not explicit", async (t) => {
  const cases: Array<{ name: string; env: Record<string, string | undefined> }> = [
    {
      name: "missing trusted client IP header",
      env: {
        BETTER_AUTH_SECRET: VALID_SECRET,
        BETTER_AUTH_URL: "https://shop.example.com",
      },
    },
    {
      name: "generic x-forwarded-for header",
      env: {
        BETTER_AUTH_SECRET: VALID_SECRET,
        BETTER_AUTH_URL: "https://shop.example.com",
        BETTER_AUTH_IP_HEADER: "x-forwarded-for",
      },
    },
    {
      name: "invalid header syntax",
      env: {
        BETTER_AUTH_SECRET: VALID_SECRET,
        BETTER_AUTH_URL: "https://shop.example.com",
        BETTER_AUTH_IP_HEADER: "client ip",
      },
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      assert.throws(() => readAuthServerConfig(scenario.env), AuthConfigError);
    });
  }
});

test("fails closed for missing, weak, or ambiguous auth configuration", async (t) => {
  const cases: Array<{ name: string; env: Record<string, string | undefined> }> = [
    {
      name: "missing secret",
      env: { BETTER_AUTH_URL: "https://shop.example.com", BETTER_AUTH_IP_HEADER: "x-proxy-client-ip" },
    },
    {
      name: "short secret",
      env: {
        BETTER_AUTH_SECRET: "too-short",
        BETTER_AUTH_URL: "https://shop.example.com",
        BETTER_AUTH_IP_HEADER: "x-proxy-client-ip",
      },
    },
    {
      name: "missing base URL",
      env: { BETTER_AUTH_SECRET: VALID_SECRET, BETTER_AUTH_IP_HEADER: "x-proxy-client-ip" },
    },
    {
      name: "non-http URL",
      env: {
        BETTER_AUTH_SECRET: VALID_SECRET,
        BETTER_AUTH_URL: "file:///tmp/auth",
        BETTER_AUTH_IP_HEADER: "x-proxy-client-ip",
      },
    },
    {
      name: "credentialed URL",
      env: {
        BETTER_AUTH_SECRET: VALID_SECRET,
        BETTER_AUTH_URL: "https://user:pass@shop.example.com",
        BETTER_AUTH_IP_HEADER: "x-proxy-client-ip",
      },
    },
    {
      name: "URL path",
      env: {
        BETTER_AUTH_SECRET: VALID_SECRET,
        BETTER_AUTH_URL: "https://shop.example.com/auth",
        BETTER_AUTH_IP_HEADER: "x-proxy-client-ip",
      },
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
        BETTER_AUTH_IP_HEADER: "x-proxy-client-ip",
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
});
