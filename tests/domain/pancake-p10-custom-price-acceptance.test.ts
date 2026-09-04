import assert from "node:assert/strict";
import test from "node:test";

import {
  assertApprovedShopId,
  assertTrustedAcceptanceEnvironment,
  attemptOrderCancellation,
  buildControlledAcceptanceOrderInput,
  buildSanitizedAcceptanceReport,
  CI_REFUSAL_MESSAGE,
  DISCOUNT_DELTA_VND,
  environmentFlagIsEnabled,
  EXPECTED_CATALOG_BASE_PRICE,
  EXPECTED_CUSTOM_PRICE,
  EXPECTED_PRODUCT_CODE,
  EXPECTED_SHOP_ID,
  EXPECTED_VARIATION_DISPLAY_ID,
  EXPECTED_VARIATION_ID,
  extractCreatedOrderId,
  runControlledAcceptance,
  sanitizeCleanupErrorMessage,
  TEST_ADDRESS_DETAIL,
  TEST_COMMUNE_ID,
  TEST_CUSTOMER_NAME,
  TEST_CUSTOMER_PHONE,
  TEST_DISTRICT_ID,
  TEST_ORDER_NOTE,
  TEST_PROVINCE_ID,
  TEST_SHIPPING_FEE_VND,
  type ControlledAcceptanceClient,
  validateVariationPreflight,
  verifyReadBackOrderPricing,
} from "../../scripts/pancake-p10-custom-price-acceptance.ts";

test("0. environmentFlagIsEnabled correctly identifies flags", () => {
  assert.equal(environmentFlagIsEnabled("true"), true);
  assert.equal(environmentFlagIsEnabled("1"), true);
  assert.equal(environmentFlagIsEnabled("false"), false);
  assert.equal(environmentFlagIsEnabled("0"), false);
  assert.equal(environmentFlagIsEnabled(""), false);
  assert.equal(environmentFlagIsEnabled(undefined), false);
});

test("1. refuses CI execution", () => {
  assert.throws(
    () =>
      assertTrustedAcceptanceEnvironment({
        CI: "true",
        P10_ACCEPTANCE_APPROVED: EXPECTED_PRODUCT_CODE,
      } as unknown as NodeJS.ProcessEnv),
    new RegExp(CI_REFUSAL_MESSAGE),
  );
  assert.throws(
    () =>
      assertTrustedAcceptanceEnvironment({
        GITHUB_ACTIONS: "true",
        P10_ACCEPTANCE_APPROVED: EXPECTED_PRODUCT_CODE,
      } as unknown as NodeJS.ProcessEnv),
    new RegExp(CI_REFUSAL_MESSAGE),
  );
});

test("2. refuses without P10_ACCEPTANCE_APPROVED=a132", () => {
  assert.throws(
    () => assertTrustedAcceptanceEnvironment({} as unknown as NodeJS.ProcessEnv),
    /P10 custom-price acceptance requires explicit operator approval: P10_ACCEPTANCE_APPROVED=a132/,
  );
  assert.throws(
    () =>
      assertTrustedAcceptanceEnvironment({
        P10_ACCEPTANCE_APPROVED: "wrong_code",
      } as unknown as NodeJS.ProcessEnv),
    /P10 custom-price acceptance requires explicit operator approval: P10_ACCEPTANCE_APPROVED=a132/,
  );
});

test("3. passes in trusted environment with correct approval", () => {
  assert.doesNotThrow(() =>
    assertTrustedAcceptanceEnvironment({
      P10_ACCEPTANCE_APPROVED: EXPECTED_PRODUCT_CODE,
    } as unknown as NodeJS.ProcessEnv),
  );
});

test("4. asserts approved shop ID", () => {
  assert.doesNotThrow(() => assertApprovedShopId(EXPECTED_SHOP_ID));
  assert.throws(
    () => assertApprovedShopId(999999),
    /P10 acceptance refused: configured shop ID 999999 does not match expected shop ID 1635185058/,
  );
});

test("5. validateVariationPreflight validates payload correctly", () => {
  const validPayload = {
    data: [
      {
        id: EXPECTED_VARIATION_ID,
        display_id: EXPECTED_VARIATION_DISPLAY_ID,
        retail_price: EXPECTED_CATALOG_BASE_PRICE,
        remain_quantity: 10,
      },
    ],
  };

  const result = validateVariationPreflight(validPayload);
  assert.equal(result.id, EXPECTED_VARIATION_ID);
  assert.equal(result.display_id, EXPECTED_VARIATION_DISPLAY_ID);
  assert.equal(result.retail_price, EXPECTED_CATALOG_BASE_PRICE);
  assert.equal(result.remain_quantity, 10);

  // Missing variation
  assert.throws(
    () => validateVariationPreflight({ data: [] }),
    /Target variation 9ea76227-51f0-45a2-b5cc-f6b42e5ec3da not found in catalog/,
  );

  // Price mismatch
  assert.throws(
    () =>
      validateVariationPreflight({
        data: [
          {
            id: EXPECTED_VARIATION_ID,
            display_id: EXPECTED_VARIATION_DISPLAY_ID,
            retail_price: 500_000,
            remain_quantity: 10,
          },
        ],
      }),
    /Catalog base price mismatch/,
  );

  // Out of stock
  assert.throws(
    () =>
      validateVariationPreflight({
        data: [
          {
            id: EXPECTED_VARIATION_ID,
            display_id: EXPECTED_VARIATION_DISPLAY_ID,
            retail_price: EXPECTED_CATALOG_BASE_PRICE,
            remain_quantity: 0,
          },
        ],
      }),
    /Insufficient sellable stock/,
  );
});

test("6. buildControlledAcceptanceOrderInput creates valid non-PII test order", () => {
  const input = buildControlledAcceptanceOrderInput();

  assert.equal(input.shopId, EXPECTED_SHOP_ID);
  assert.equal(input.guestName, TEST_CUSTOMER_NAME);
  assert.equal(input.guestPhone, TEST_CUSTOMER_PHONE);
  assert.equal(input.provinceRef, TEST_PROVINCE_ID);
  assert.equal(input.districtRef, TEST_DISTRICT_ID);
  assert.equal(input.communeRef, TEST_COMMUNE_ID);
  assert.equal(input.addressDetail, TEST_ADDRESS_DETAIL);
  assert.equal(input.note, TEST_ORDER_NOTE);
  assert.equal(input.shippingFeeVnd, TEST_SHIPPING_FEE_VND);
  assert.equal(input.lines.length, 1);
  assert.equal(input.lines[0].pancakeVariationId, EXPECTED_VARIATION_ID);
  assert.equal(input.lines[0].quantity, 1);
  assert.equal(input.lines[0].unitPriceVnd, EXPECTED_CUSTOM_PRICE);
  assert.equal(input.lines[0].unitPriceVnd, EXPECTED_CATALOG_BASE_PRICE - DISCOUNT_DELTA_VND);
  assert.notEqual(input.lines[0].unitPriceVnd, EXPECTED_CATALOG_BASE_PRICE);
});

test("7. verifyReadBackOrderPricing distinguishes preserved custom price from overwritten base", () => {
  const orderWithPreservedCustomPrice = {
    data: {
      total_price: 399_000,
      shipping_fee: 30_000,
      items: [
        {
          variation_id: EXPECTED_VARIATION_ID,
          variation_info: { retail_price: EXPECTED_CUSTOM_PRICE },
        },
      ],
    },
  };

  const preserved = verifyReadBackOrderPricing(orderWithPreservedCustomPrice);
  assert.equal(preserved.persistedRetailPrice, EXPECTED_CUSTOM_PRICE);
  assert.equal(preserved.isCustomPricePreserved, true);
  assert.equal(preserved.orderTotalPrice, 399_000);
  assert.equal(preserved.orderShippingFee, 30_000);

  // Overwritten with base price
  const orderWithOverwrittenPrice = {
    data: {
      total_price: 429_000,
      shipping_fee: 30_000,
      items: [
        {
          variation_id: EXPECTED_VARIATION_ID,
          variation_info: { retail_price: EXPECTED_CATALOG_BASE_PRICE },
        },
      ],
    },
  };

  const overwritten = verifyReadBackOrderPricing(orderWithOverwrittenPrice);
  assert.equal(overwritten.persistedRetailPrice, EXPECTED_CATALOG_BASE_PRICE);
  assert.equal(overwritten.isCustomPricePreserved, false);
});

test("8. buildSanitizedAcceptanceReport formats clean report without PII", () => {
  const report = buildSanitizedAcceptanceReport({
    timestamp: "2026-09-04T09:14:00.000Z",
    shopId: EXPECTED_SHOP_ID,
    productCode: EXPECTED_PRODUCT_CODE,
    variationId: EXPECTED_VARIATION_ID,
    variationDisplayId: EXPECTED_VARIATION_DISPLAY_ID,
    catalogBasePriceVnd: EXPECTED_CATALOG_BASE_PRICE,
    requestedCustomPriceVnd: EXPECTED_CUSTOM_PRICE,
    createdPancakeOrderId: "23254",
    persistedLineRetailPriceVnd: EXPECTED_CUSTOM_PRICE,
    customPriceAcceptedAndPreserved: true,
    orderTotalPriceVnd: 399_000,
    orderShippingFeeVnd: 30_000,
    cleanupResult: "CANCELED_STATUS_7",
  });

  assert.equal(report.shopId, 1635185058);
  assert.equal(report.productCode, "a132");
  assert.equal(report.customPriceAcceptedAndPreserved, true);
  assert.equal(report.createdPancakeOrderId, "23254");
  assert.equal(report.cleanupResult, "CANCELED_STATUS_7");
  assert.equal(Object.isFrozen(report), true);
});

test("9. extractCreatedOrderId parses top-level id and data.id correctly", () => {
  assert.equal(extractCreatedOrderId({ id: 12345 }), "12345");
  assert.equal(extractCreatedOrderId({ success: true, data: { id: 67890 } }), "67890");

  assert.throws(() => extractCreatedOrderId(null), /Unable to parse created order ID/);
  assert.throws(() => extractCreatedOrderId({}), /Unable to parse created order ID/);
  assert.throws(() => extractCreatedOrderId({ data: {} }), /Unable to parse created order ID/);
  assert.throws(() => extractCreatedOrderId({ id: -1 }), /Unable to parse created order ID/);
  assert.throws(() => extractCreatedOrderId({ data: { id: 0 } }), /Unable to parse created order ID/);
});

test("10. create succeeds -> createdOrderId exists -> read-back throws -> cleanup PUT status=7 is called exactly once, original read-back error propagates", async () => {
  let postCalls = 0;
  let putCalls = 0;
  let cleanupEndpoint = "";
  let cleanupBody: unknown = null;

  const mockClient: ControlledAcceptanceClient = {
    async getJson(endpoint: string) {
      if (endpoint.includes("/products/variations")) {
        return {
          data: [
            {
              id: EXPECTED_VARIATION_ID,
              display_id: EXPECTED_VARIATION_DISPLAY_ID,
              retail_price: EXPECTED_CATALOG_BASE_PRICE,
              remain_quantity: 10,
            },
          ],
        };
      }
      if (endpoint.includes("/orders/999")) {
        throw new Error("Simulated network timeout reading back order 999");
      }
      throw new Error(`Unexpected getJson endpoint: ${endpoint}`);
    },
    async postJson(endpoint: string) {
      postCalls += 1;
      assert.equal(endpoint, `/shops/${EXPECTED_SHOP_ID}/orders`);
      return { success: true, data: { id: 999 } };
    },
    async putJson(endpoint: string, body: unknown) {
      putCalls += 1;
      cleanupEndpoint = endpoint;
      cleanupBody = body;
      return { success: true, data: { status: 7 } };
    },
  };

  const testEnv = {
    P10_ACCEPTANCE_APPROVED: EXPECTED_PRODUCT_CODE,
    PANCAKE_API_KEY: "dummy-key-for-test",
    PANCAKE_SHOP_ID: String(EXPECTED_SHOP_ID),
  } as unknown as NodeJS.ProcessEnv;

  await assert.rejects(
    () => runControlledAcceptance(testEnv, { client: mockClient }),
    /Simulated network timeout reading back order 999/,
  );

  assert.equal(postCalls, 1, "postJson must be called exactly once (no retry)");
  assert.equal(putCalls, 1, "putJson cleanup must be called exactly once despite read-back throw");
  assert.equal(cleanupEndpoint, `/shops/${EXPECTED_SHOP_ID}/orders/999`, "cleanup must target exact createdOrderId");
  assert.deepEqual(cleanupBody, { status: 7 }, "cleanup payload must set status=7 (CANCELED)");
});

test("11. create succeeds -> createdOrderId exists -> verification throws (malformed items) -> cleanup PUT status=7 is called exactly once, original error propagates", async () => {
  let postCalls = 0;
  let putCalls = 0;
  let cleanupEndpoint = "";
  let cleanupBody: unknown = null;

  const mockClient: ControlledAcceptanceClient = {
    async getJson(endpoint: string) {
      if (endpoint.includes("/products/variations")) {
        return {
          data: [
            {
              id: EXPECTED_VARIATION_ID,
              display_id: EXPECTED_VARIATION_DISPLAY_ID,
              retail_price: EXPECTED_CATALOG_BASE_PRICE,
              remain_quantity: 10,
            },
          ],
        };
      }
      if (endpoint.includes("/orders/888")) {
        // Return malformed order lacking items array
        return { data: { id: 888, status: 0 } };
      }
      throw new Error(`Unexpected getJson endpoint: ${endpoint}`);
    },
    async postJson() {
      postCalls += 1;
      return { id: 888 };
    },
    async putJson(endpoint: string, body: unknown) {
      putCalls += 1;
      cleanupEndpoint = endpoint;
      cleanupBody = body;
      return { success: true, status: 7 };
    },
  };

  const testEnv = {
    P10_ACCEPTANCE_APPROVED: EXPECTED_PRODUCT_CODE,
    PANCAKE_API_KEY: "dummy-key-for-test",
    PANCAKE_SHOP_ID: String(EXPECTED_SHOP_ID),
  } as unknown as NodeJS.ProcessEnv;

  await assert.rejects(
    () => runControlledAcceptance(testEnv, { client: mockClient }),
    /Order payload missing items array/,
  );

  assert.equal(postCalls, 1);
  assert.equal(putCalls, 1);
  assert.equal(cleanupEndpoint, `/shops/${EXPECTED_SHOP_ID}/orders/888`);
  assert.deepEqual(cleanupBody, { status: 7 });
});

test("12. create succeeds -> createdOrderId exists -> custom price mismatch -> cleanup PUT status=7 is called exactly once, price error propagates", async () => {
  let postCalls = 0;
  let putCalls = 0;
  let cleanupEndpoint = "";

  const mockClient: ControlledAcceptanceClient = {
    async getJson(endpoint: string) {
      if (endpoint.includes("/products/variations")) {
        return {
          data: [
            {
              id: EXPECTED_VARIATION_ID,
              display_id: EXPECTED_VARIATION_DISPLAY_ID,
              retail_price: EXPECTED_CATALOG_BASE_PRICE,
              remain_quantity: 10,
            },
          ],
        };
      }
      if (endpoint.includes("/orders/777")) {
        // Return order where retail_price was reset to catalog base 429_000 instead of 399_000
        return {
          data: {
            id: 777,
            status: 0,
            items: [
              {
                variation_id: EXPECTED_VARIATION_ID,
                variation_info: { retail_price: EXPECTED_CATALOG_BASE_PRICE },
              },
            ],
          },
        };
      }
      throw new Error(`Unexpected getJson endpoint: ${endpoint}`);
    },
    async postJson() {
      postCalls += 1;
      return { id: 777 };
    },
    async putJson(endpoint: string) {
      putCalls += 1;
      cleanupEndpoint = endpoint;
      return { success: true, data: { status: 7 } };
    },
  };

  const testEnv = {
    P10_ACCEPTANCE_APPROVED: EXPECTED_PRODUCT_CODE,
    PANCAKE_API_KEY: "dummy-key-for-test",
    PANCAKE_SHOP_ID: String(EXPECTED_SHOP_ID),
  } as unknown as NodeJS.ProcessEnv;

  await assert.rejects(
    () => runControlledAcceptance(testEnv, { client: mockClient }),
    /Pancake failed to preserve custom price/,
  );

  assert.equal(postCalls, 1);
  assert.equal(putCalls, 1);
  assert.equal(cleanupEndpoint, `/shops/${EXPECTED_SHOP_ID}/orders/777`);
});

test("13. read-back throws AND cleanup fails -> original read-back error is NOT replaced, cleanup context attached safely without leaking secrets", async () => {
  let putCalls = 0;

  const mockClient: ControlledAcceptanceClient = {
    async getJson(endpoint: string) {
      if (endpoint.includes("/products/variations")) {
        return {
          data: [
            {
              id: EXPECTED_VARIATION_ID,
              display_id: EXPECTED_VARIATION_DISPLAY_ID,
              retail_price: EXPECTED_CATALOG_BASE_PRICE,
              remain_quantity: 10,
            },
          ],
        };
      }
      throw new Error("Original read-back network partition error");
    },
    async postJson() {
      return { id: 666 };
    },
    async putJson() {
      putCalls += 1;
      throw new Error("Pancake HTTP 500 error for /orders/666?api_key=SECRET_TOKEN_VALUE");
    },
  };

  const testEnv = {
    P10_ACCEPTANCE_APPROVED: EXPECTED_PRODUCT_CODE,
    PANCAKE_API_KEY: "dummy-key-for-test",
    PANCAKE_SHOP_ID: String(EXPECTED_SHOP_ID),
  } as unknown as NodeJS.ProcessEnv;

  let capturedError: (Error & { cleanupContext?: { createdOrderId?: string; cleanupResult?: string } }) | null = null;
  try {
    await runControlledAcceptance(testEnv, { client: mockClient });
  } catch (err) {
    capturedError = err as Error;
  }

  assert.ok(capturedError !== null, "Error must be thrown");
  assert.match(capturedError.message, /Original read-back network partition error/);
  assert.equal(putCalls, 1);
  assert.equal(capturedError.cleanupContext?.createdOrderId, "666");
  assert.match(capturedError.cleanupContext?.cleanupResult ?? "", /CLEANUP_FAILED_/);
  // Ensure sensitive token was sanitized and not present in cleanupResult
  assert.equal((capturedError.cleanupContext?.cleanupResult ?? "").includes("SECRET_TOKEN_VALUE"), false);
});

test("14. attemptOrderCancellation handles success, unexpected body, and error states", async () => {
  // Success with success: true
  const successClient1: ControlledAcceptanceClient = {
    async getJson() { throw new Error(); },
    async postJson() { throw new Error(); },
    async putJson() { return { success: true, data: { status: 7 } }; },
  };
  assert.equal(await attemptOrderCancellation(successClient1, EXPECTED_SHOP_ID, "101"), "CANCELED_STATUS_7");

  // Success with direct status: 7
  const successClient2: ControlledAcceptanceClient = {
    async getJson() { throw new Error(); },
    async postJson() { throw new Error(); },
    async putJson() { return { status: 7 }; },
  };
  assert.equal(await attemptOrderCancellation(successClient2, EXPECTED_SHOP_ID, "102"), "CANCELED_STATUS_7");

  // Unexpected body
  const unexpectedClient: ControlledAcceptanceClient = {
    async getJson() { throw new Error(); },
    async postJson() { throw new Error(); },
    async putJson() { return { success: false, status: 0 }; },
  };
  assert.equal(await attemptOrderCancellation(unexpectedClient, EXPECTED_SHOP_ID, "103"), "PUT_RETURNED_UNEXPECTED_BODY");

  // Rejection/HTTP error
  const failingClient: ControlledAcceptanceClient = {
    async getJson() { throw new Error(); },
    async postJson() { throw new Error(); },
    async putJson() { throw new Error("HTTP 404 order not found"); },
  };
  assert.equal(await attemptOrderCancellation(failingClient, EXPECTED_SHOP_ID, "104"), "CLEANUP_FAILED_HTTP 404 order not found");
});

test("15. sanitizeCleanupErrorMessage strips sensitive query parameters and secrets", () => {
  assert.equal(
    sanitizeCleanupErrorMessage("Failed for /orders/123?api_key=sensitive-secret-token"),
    "Failed for /orders/123",
  );
  assert.equal(
    sanitizeCleanupErrorMessage("Failed for /orders/123?other=1&api_key=token123&test=2"),
    "Failed for /orders/123?other=1&test=2",
  );
  assert.equal(
    sanitizeCleanupErrorMessage("Failed with secret_key=mysecret"),
    "Failed with",
  );
});


