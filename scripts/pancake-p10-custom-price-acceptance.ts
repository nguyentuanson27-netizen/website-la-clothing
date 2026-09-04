import { pathToFileURL } from "node:url";

import { PancakeClient } from "../src/integrations/pancake/client.ts";
import { readPancakeConfig } from "../src/integrations/pancake/config.ts";
import {
  buildPancakeCreateOrderRequest,
  type PancakeCreateOrderInput,
  type PancakeCreateOrderRequest,
} from "../src/integrations/pancake/order-create.ts";

export const CI_REFUSAL_MESSAGE =
  "Trusted Pancake custom price acceptance refuses CI execution";
export const EXPECTED_SHOP_ID = 1635185058;
export const EXPECTED_PRODUCT_CODE = "a132";
export const EXPECTED_VARIATION_ID = "9ea76227-51f0-45a2-b5cc-f6b42e5ec3da";
export const EXPECTED_VARIATION_DISPLAY_ID = "A132-M";
export const EXPECTED_CATALOG_BASE_PRICE = 429_000;
export const DISCOUNT_DELTA_VND = 30_000;
export const EXPECTED_CUSTOM_PRICE = EXPECTED_CATALOG_BASE_PRICE - DISCOUNT_DELTA_VND; // 399_000
export const TEST_SHIPPING_FEE_VND = 30_000;

export const TEST_CUSTOMER_NAME = "TEST KHONG GIAO - Kiem tra gia khuyen mai website";
export const TEST_CUSTOMER_PHONE = "0900000000";
export const TEST_ORDER_NOTE =
  "TEST AUTOMATION U23 P10 - Controlled custom price acceptance - DO NOT SHIP - HUY DON";
export const TEST_PROVINCE_ID = "805"; // An Giang
export const TEST_DISTRICT_ID = "80505"; // Huyen An Phu
export const TEST_COMMUNE_ID = "8050501"; // Thi tran An Phu
export const TEST_ADDRESS_DETAIL = "Dia chi test tu dong - Xin huy don";

export type SanitizedAcceptanceReport = Readonly<{
  timestamp: string;
  shopId: number;
  productCode: string;
  variationId: string;
  variationDisplayId: string;
  catalogBasePriceVnd: number;
  requestedCustomPriceVnd: number;
  createdPancakeOrderId: string;
  persistedLineRetailPriceVnd: number;
  customPriceAcceptedAndPreserved: boolean;
  orderTotalPriceVnd: number;
  orderShippingFeeVnd: number;
  cleanupResult: string;
}>;

export function environmentFlagIsEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0" || value.toLowerCase() === "false") {
    return false;
  }
  return true;
}

export function assertTrustedAcceptanceEnvironment(env: NodeJS.ProcessEnv = process.env): void {
  if (environmentFlagIsEnabled(env.CI) || environmentFlagIsEnabled(env.GITHUB_ACTIONS)) {
    throw new Error(CI_REFUSAL_MESSAGE);
  }

  if (env.P10_ACCEPTANCE_APPROVED !== EXPECTED_PRODUCT_CODE) {
    throw new Error(
      `P10 custom-price acceptance requires explicit operator approval: P10_ACCEPTANCE_APPROVED=${EXPECTED_PRODUCT_CODE}`,
    );
  }
}

export function assertApprovedShopId(shopId: number): void {
  if (shopId !== EXPECTED_SHOP_ID) {
    throw new Error(
      `P10 acceptance refused: configured shop ID ${shopId} does not match expected shop ID ${EXPECTED_SHOP_ID}`,
    );
  }
}

export function validateVariationPreflight(
  variationsPayload: unknown,
  expectedVariationId: string = EXPECTED_VARIATION_ID,
  expectedBasePrice: number = EXPECTED_CATALOG_BASE_PRICE,
): { id: string; display_id: string; retail_price: number; remain_quantity: number } {
  if (!variationsPayload || typeof variationsPayload !== "object") {
    throw new Error("Invalid Pancake variations payload: expected object");
  }

  const payload = variationsPayload as { data?: unknown };
  if (!Array.isArray(payload.data)) {
    throw new Error("Invalid Pancake variations payload: missing data array");
  }

  const matched = payload.data.find(
    (item: unknown) =>
      item !== null &&
      typeof item === "object" &&
      (item as { id?: unknown }).id === expectedVariationId,
  ) as { id: string; display_id: string; retail_price: number; remain_quantity: number } | undefined;

  if (!matched) {
    throw new Error(`Target variation ${expectedVariationId} not found in catalog`);
  }

  if (matched.retail_price !== expectedBasePrice) {
    throw new Error(
      `Catalog base price mismatch for ${expectedVariationId}: expected ${expectedBasePrice}, got ${matched.retail_price}`,
    );
  }

  if (typeof matched.remain_quantity !== "number" || matched.remain_quantity < 1) {
    throw new Error(
      `Insufficient sellable stock for variation ${expectedVariationId}: ${matched.remain_quantity}`,
    );
  }

  return matched;
}

export function buildControlledAcceptanceOrderInput(
  shopId: number = EXPECTED_SHOP_ID,
  variationId: string = EXPECTED_VARIATION_ID,
  customPriceVnd: number = EXPECTED_CUSTOM_PRICE,
): PancakeCreateOrderInput {
  return {
    shopId,
    guestName: TEST_CUSTOMER_NAME,
    guestPhone: TEST_CUSTOMER_PHONE,
    provinceRef: TEST_PROVINCE_ID,
    districtRef: TEST_DISTRICT_ID,
    communeRef: TEST_COMMUNE_ID,
    addressDetail: TEST_ADDRESS_DETAIL,
    note: TEST_ORDER_NOTE,
    shippingFeeVnd: TEST_SHIPPING_FEE_VND,
    lines: [
      {
        pancakeVariationId: variationId,
        quantity: 1,
        unitPriceVnd: customPriceVnd,
      },
    ],
  };
}

export function verifyReadBackOrderPricing(
  orderPayload: unknown,
  expectedVariationId: string = EXPECTED_VARIATION_ID,
  expectedCustomPriceVnd: number = EXPECTED_CUSTOM_PRICE,
): {
  persistedRetailPrice: number;
  isCustomPricePreserved: boolean;
  orderTotalPrice: number;
  orderShippingFee: number;
} {
  if (!orderPayload || typeof orderPayload !== "object") {
    throw new Error("Invalid order read-back payload");
  }

  const order = (orderPayload as { data?: Record<string, unknown> }).data ?? (orderPayload as Record<string, unknown>);
  const items = order.items;
  if (!Array.isArray(items)) {
    throw new Error("Order payload missing items array");
  }

  const matchedItem = items.find(
    (item) => item && typeof item === "object" && item.variation_id === expectedVariationId,
  );
  if (!matchedItem) {
    throw new Error(`Variation ${expectedVariationId} not found in order items`);
  }

  const varInfo = matchedItem.variation_info as { retail_price?: unknown } | undefined;
  const persistedRetailPrice = varInfo?.retail_price;
  if (typeof persistedRetailPrice !== "number" || !Number.isSafeInteger(persistedRetailPrice)) {
    throw new Error(`Invalid or missing variation_info.retail_price in order item: ${String(persistedRetailPrice)}`);
  }

  const orderTotalPrice = typeof order.total_price === "number" ? order.total_price : 0;
  const orderShippingFee = typeof order.shipping_fee === "number" ? order.shipping_fee : 0;

  return {
    persistedRetailPrice,
    isCustomPricePreserved: persistedRetailPrice === expectedCustomPriceVnd,
    orderTotalPrice,
    orderShippingFee,
  };
}

export function buildSanitizedAcceptanceReport(input: {
  timestamp: string;
  shopId: number;
  productCode: string;
  variationId: string;
  variationDisplayId: string;
  catalogBasePriceVnd: number;
  requestedCustomPriceVnd: number;
  createdPancakeOrderId: string;
  persistedLineRetailPriceVnd: number;
  customPriceAcceptedAndPreserved: boolean;
  orderTotalPriceVnd: number;
  orderShippingFeeVnd: number;
  cleanupResult: string;
}): SanitizedAcceptanceReport {
  return Object.freeze({
    timestamp: input.timestamp,
    shopId: input.shopId,
    productCode: input.productCode,
    variationId: input.variationId,
    variationDisplayId: input.variationDisplayId,
    catalogBasePriceVnd: input.catalogBasePriceVnd,
    requestedCustomPriceVnd: input.requestedCustomPriceVnd,
    createdPancakeOrderId: input.createdPancakeOrderId,
    persistedLineRetailPriceVnd: input.persistedLineRetailPriceVnd,
    customPriceAcceptedAndPreserved: input.customPriceAcceptedAndPreserved,
    orderTotalPriceVnd: input.orderTotalPriceVnd,
    orderShippingFeeVnd: input.orderShippingFeeVnd,
    cleanupResult: input.cleanupResult,
  });
}

export function extractCreatedOrderId(rawResponse: unknown): string {
  if (rawResponse && typeof rawResponse === "object") {
    const record = rawResponse as Record<string, unknown>;
    if (typeof record.id === "number" && Number.isSafeInteger(record.id) && record.id > 0) {
      return String(record.id);
    }
    if (record.data && typeof record.data === "object") {
      const dataRecord = record.data as Record<string, unknown>;
      if (typeof dataRecord.id === "number" && Number.isSafeInteger(dataRecord.id) && dataRecord.id > 0) {
        return String(dataRecord.id);
      }
    }
  }
  throw new Error("Unable to parse created order ID from Pancake response");
}

export async function runControlledAcceptance(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SanitizedAcceptanceReport> {
  assertTrustedAcceptanceEnvironment(env);

  const config = readPancakeConfig(env);
  assertApprovedShopId(config.shopId);

  const client = new PancakeClient({ apiKey: config.apiKey });

  // Step 1: Preflight
  const variationsPayload = await client.getJson(
    `/shops/${config.shopId}/products/variations`,
    { search: EXPECTED_PRODUCT_CODE },
  );
  const targetVar = validateVariationPreflight(
    variationsPayload,
    EXPECTED_VARIATION_ID,
    EXPECTED_CATALOG_BASE_PRICE,
  );

  // Step 2: Build Request
  const orderInput = buildControlledAcceptanceOrderInput(
    config.shopId,
    EXPECTED_VARIATION_ID,
    EXPECTED_CUSTOM_PRICE,
  );
  const request: PancakeCreateOrderRequest = buildPancakeCreateOrderRequest(orderInput);

  // Step 3: Single submission attempt
  // Note: While the raw OpenAPI document specified HTTP 200, live Pancake POS API
  // returns HTTP 201 Created upon successful order creation with payload { success: true, data: { id: ... } }.
  // client.postJson allows any response.ok (2xx) status and verifies JSON response format.
  const createResponse = await client.postJson(
    `/shops/${config.shopId}/orders`,
    request,
  );
  const createdOrderId = extractCreatedOrderId(createResponse);

  // Step 4: Read-back verification
  const orderPayload = await client.getJson(`/shops/${config.shopId}/orders/${createdOrderId}`);
  const verification = verifyReadBackOrderPricing(
    orderPayload,
    EXPECTED_VARIATION_ID,
    EXPECTED_CUSTOM_PRICE,
  );

  // Step 5: Safe Cleanup
  let cleanupResult = "NOT_ATTEMPTED";
  try {
    const cancelResponse = (await client.putJson(
      `/shops/${config.shopId}/orders/${createdOrderId}`,
      { status: 7 }, // Status 7 = CANCELED
    )) as { success?: boolean; data?: { status?: number }; status?: number };

    if (
      cancelResponse.success ||
      cancelResponse.data?.status === 7 ||
      cancelResponse.status === 7
    ) {
      cleanupResult = "CANCELED_STATUS_7";
    } else {
      cleanupResult = "PUT_RETURNED_UNEXPECTED_BODY";
    }
  } catch (cancelErr) {
    const message = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
    cleanupResult = `CLEANUP_FAILED_${message}`;
  }

  const report = buildSanitizedAcceptanceReport({
    timestamp: new Date().toISOString(),
    shopId: config.shopId,
    productCode: EXPECTED_PRODUCT_CODE,
    variationId: EXPECTED_VARIATION_ID,
    variationDisplayId: targetVar.display_id,
    catalogBasePriceVnd: EXPECTED_CATALOG_BASE_PRICE,
    requestedCustomPriceVnd: EXPECTED_CUSTOM_PRICE,
    createdPancakeOrderId: createdOrderId,
    persistedLineRetailPriceVnd: verification.persistedRetailPrice,
    customPriceAcceptedAndPreserved: verification.isCustomPricePreserved,
    orderTotalPriceVnd: verification.orderTotalPrice,
    orderShippingFeeVnd: verification.orderShippingFee,
    cleanupResult,
  });

  if (!report.customPriceAcceptedAndPreserved) {
    throw new Error(
      `Pancake failed to preserve custom price: requested ${EXPECTED_CUSTOM_PRICE}, persisted ${verification.persistedRetailPrice}`,
    );
  }

  return report;
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isDirectExecution()) {
  try {
    const report = await runControlledAcceptance();
    console.log("PANCAKE_CUSTOM_PRICE_ACCEPTANCE_BEGIN");
    console.log(JSON.stringify(report, null, 2));
    console.log("PANCAKE_CUSTOM_PRICE_ACCEPTANCE_END");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === CI_REFUSAL_MESSAGE) {
      console.error(CI_REFUSAL_MESSAGE);
    } else {
      console.error(`P10 custom price acceptance failed: ${message}`);
    }
    process.exit(1);
  }
}
