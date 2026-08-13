import assert from "node:assert/strict";
import test from "node:test";

import { validateReleaseEnvironment } from "../../src/operations/release-readiness.ts";

const validEnvironment = {
  DATABASE_URL: "postgresql://release_user:super-secret-password@db.internal:5432/la_clothing",
  BETTER_AUTH_SECRET: "release-only-secret-0123456789abcdef",
  BETTER_AUTH_URL: "https://shop.example.com",
  BETTER_AUTH_IP_HEADER: "cf-connecting-ip",
  PANCAKE_API_KEY: "super-secret-pancake-key",
  PANCAKE_SHOP_ID: "920007",
  LA_SHIPPING_FEE_VND: "30000",
  LA_FREE_SHIPPING_SUBTOTAL_VND: "1000000",
  LA_FREE_SHIPPING_MIN_QUANTITY: "3",
} as const;

test("release preflight validates required server configuration without returning secrets", () => {
  const result = validateReleaseEnvironment(validEnvironment);

  assert.deepEqual(result, {
    databaseConfigured: true,
    authConfigured: true,
    trustedIpHeaderConfigured: true,
    pancakeConfigured: true,
    pancakeShopId: 920_007,
    shippingPolicy: {
      feeVnd: 30_000,
      freeShippingSubtotalVnd: 1_000_000,
      freeShippingMinQuantity: 3,
    },
  });

  const serialized = JSON.stringify(result);
  for (const sensitiveValue of [
    "release_user",
    "super-secret-password",
    validEnvironment.BETTER_AUTH_SECRET,
    validEnvironment.PANCAKE_API_KEY,
  ]) {
    assert.equal(serialized.includes(sensitiveValue), false);
  }
});

test("release preflight rejects missing or non-PostgreSQL database URLs without echoing credentials", () => {
  assert.throws(
    () => validateReleaseEnvironment({ ...validEnvironment, DATABASE_URL: undefined }),
    /DATABASE_URL must be configured/,
  );

  const secretUrl = "mysql://release_user:should-never-leak@db.internal/la_clothing";
  try {
    validateReleaseEnvironment({ ...validEnvironment, DATABASE_URL: secretUrl });
    assert.fail("expected invalid database URL to fail");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.match(message, /DATABASE_URL must use PostgreSQL/);
    assert.equal(message.includes("should-never-leak"), false);
  }
});

test("release preflight delegates auth, Pancake and shipping validation fail closed", () => {
  assert.throws(
    () => validateReleaseEnvironment({ ...validEnvironment, BETTER_AUTH_URL: "http://shop.example.com" }),
    /BETTER_AUTH_URL must use HTTPS/,
  );
  assert.throws(
    () => validateReleaseEnvironment({ ...validEnvironment, PANCAKE_SHOP_ID: "0" }),
    /PANCAKE_SHOP_ID must be a positive integer/,
  );
  assert.throws(
    () => validateReleaseEnvironment({ ...validEnvironment, LA_SHIPPING_FEE_VND: "30000.5" }),
    /LA_SHIPPING_FEE_VND/,
  );
});
