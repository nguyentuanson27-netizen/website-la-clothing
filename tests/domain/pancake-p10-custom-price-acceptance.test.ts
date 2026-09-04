import assert from "node:assert/strict";
import test from "node:test";

import {
  assertApprovedShopId,
  assertTrustedAcceptanceEnvironment,
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
  TEST_ADDRESS_DETAIL,
  TEST_COMMUNE_ID,
  TEST_CUSTOMER_NAME,
  TEST_CUSTOMER_PHONE,
  TEST_DISTRICT_ID,
  TEST_ORDER_NOTE,
  TEST_PROVINCE_ID,
  TEST_SHIPPING_FEE_VND,
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

