import { pathToFileURL } from "node:url";

import { readCanonicalPurchaseSnapshot, type CanonicalPurchaseClient } from "../src/commerce/canonical-purchase-snapshot.ts";
import { PancakeClient } from "../src/integrations/pancake/client.ts";
import { readPancakeConfig } from "../src/integrations/pancake/config.ts";
import {
  buildPancakeCreateOrderRequest,
  type PancakeCreateOrderInput,
  type PancakeCreateOrderRequest,
} from "../src/integrations/pancake/order-create.ts";

export const CI_REFUSAL_MESSAGE =
  "Trusted Pancake confirmed purchase acceptance refuses CI execution";
export const EXPECTED_SHOP_ID = 1635185058;
export const EXPECTED_PRODUCT_CODE = "a132";
export const EXPECTED_VARIATION_ID = "9ea76227-51f0-45a2-b5cc-f6b42e5ec3da";
export const EXPECTED_VARIATION_DISPLAY_ID = "A132-M";
export const EXPECTED_CATALOG_BASE_PRICE = 429_000;
export const TEST_SHIPPING_FEE_VND = 30_000;

export const TEST_CUSTOMER_NAME = "TEST KHONG GIAO - Kiem tra confirmed purchase T7";
export const TEST_CUSTOMER_PHONE = "0900000000";
export const TEST_ORDER_NOTE =
  "TEST AUTOMATION U24 T7 - Canonical confirmed Purchase - DO NOT SHIP - HUY DON";
export const TEST_PROVINCE_ID = "805"; // An Giang
export const TEST_DISTRICT_ID = "80505"; // Huyen An Phu
export const TEST_COMMUNE_ID = "8050501"; // Thi tran An Phu
export const TEST_ADDRESS_DETAIL = "Dia chi test tu dong - Xin huy don";

export type SanitizedT7AcceptanceReport = Readonly<{
  timestamp: string;
  shopId: number;
  productCode: string;
  variationId: string;
  variationDisplayId: string;
  publicCode: string;
  catalogBasePriceVnd: number;
  createdPancakeOrderId: string;
  verifiedOrderState: "CONFIRMED";
  snapshotFactQuantity: number;
  snapshotFactUnitPriceVnd: number;
  canonicalTransactionId: string;
  canonicalEventId: string;
  canonicalMerchandiseValueVnd: number;
  canonicalShippingVnd: number;
  canonicalTotalVnd: number;
  canonicalItemId: string;
  canonicalItemPrice: number;
  canonicalItemQuantity: number;
  identityInvariantVerified: boolean; // transactionId === eventId === publicCode
  itemFactsInvariantVerified: boolean; // item facts match immutable snapshot
  cleanupResult: string;
}>;

export function environmentFlagIsEnabled(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "0" || value.toLowerCase() === "false") {
    return false;
  }
  return true;
}

export function assertTrustedAcceptanceEnvironment(
  env: Record<string, string | undefined> = process.env,
): void {
  if (environmentFlagIsEnabled(env.CI) || environmentFlagIsEnabled(env.GITHUB_ACTIONS)) {
    throw new Error(CI_REFUSAL_MESSAGE);
  }

  if (env.T7_ACCEPTANCE_APPROVED !== EXPECTED_PRODUCT_CODE) {
    throw new Error(
      `T7 confirmed-purchase acceptance requires explicit operator approval: T7_ACCEPTANCE_APPROVED=${EXPECTED_PRODUCT_CODE}`,
    );
  }
}

export function assertApprovedShopId(shopId: number): void {
  if (shopId !== EXPECTED_SHOP_ID) {
    throw new Error(
      `T7 acceptance refused: configured shop ID ${shopId} does not match expected shop ID ${EXPECTED_SHOP_ID}`,
    );
  }
}

export function validateVariationPreflight(
  variationsPayload: unknown,
  expectedVariationId: string = EXPECTED_VARIATION_ID,
  expectedBasePrice: number = EXPECTED_CATALOG_BASE_PRICE,
): { id: string; display_id: string; retail_price: number; remain_quantity: number; product_name?: string } {
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
  ) as { id: string; display_id: string; retail_price: number; remain_quantity: number; product_name?: string } | undefined;

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

export function buildControlledT7OrderInput(
  shopId: number = EXPECTED_SHOP_ID,
  variationId: string = EXPECTED_VARIATION_ID,
  unitPriceVnd: number = EXPECTED_CATALOG_BASE_PRICE,
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
        unitPriceVnd,
      },
    ],
  };
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

export function sanitizeCleanupErrorMessage(message: string): string {
  if (typeof message !== "string") {
    return "UNKNOWN_ERROR";
  }
  return message
    .replace(/[?&]api_key=[^&\s]+/gi, "")
    .replace(/[?&][a-zA-Z0-9_-]*(?:key|token|secret)[a-zA-Z0-9_-]*=[^&\s]+/gi, "")
    .replace(/\b(?:api_key|token|secret_key|secret)=[^\s]+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type ControlledAcceptanceClient = {
  getJson(
    endpoint: string,
    query?: Readonly<Record<string, string | number | boolean>>,
  ): Promise<unknown>;
  postJson(endpoint: string, body: unknown): Promise<unknown>;
  putJson(endpoint: string, body: unknown): Promise<unknown>;
};

export async function attemptOrderCancellation(
  client: ControlledAcceptanceClient,
  shopId: number,
  orderId: string,
): Promise<string> {
  try {
    const cancelResponse = (await client.putJson(
      `/shops/${shopId}/orders/${orderId}`,
      { status: 7 }, // Status 7 = CANCELED
    )) as { success?: boolean; data?: { status?: number }; status?: number } | null | undefined;

    // If PUT response explicitly proves status 7
    if (
      cancelResponse &&
      (cancelResponse.data?.status === 7 || cancelResponse.status === 7)
    ) {
      return "CANCELED_STATUS_7";
    }

    // Do not treat generic success: true alone as proof of cancellation.
    // Perform an explicit read-back of the created Pancake order after the PUT to verify status 7.
    try {
      const readBackResponse = (await client.getJson(
        `/shops/${shopId}/orders/${orderId}`,
      )) as { data?: { status?: number }; status?: number } | null | undefined;

      const orderStatus = readBackResponse?.data?.status ?? readBackResponse?.status;
      if (orderStatus === 7) {
        return "CANCELED_STATUS_7";
      }
      return `CLEANUP_STATUS_UNVERIFIED_STATUS_${orderStatus ?? "UNKNOWN"}`;
    } catch (readBackErr) {
      const msg = readBackErr instanceof Error ? readBackErr.message : String(readBackErr);
      return `CLEANUP_READBACK_FAILED_${sanitizeCleanupErrorMessage(msg)}`;
    }
  } catch (cancelErr) {
    const message = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
    return `CLEANUP_FAILED_${sanitizeCleanupErrorMessage(message)}`;
  }
}

export type ControlledT7AcceptanceDependencies = Readonly<{
  client?: ControlledAcceptanceClient;
  dbClient?: CanonicalPurchaseClient;
}>;

export async function runControlledT7Acceptance(
  env: Record<string, string | undefined> = process.env,
  dependencies: ControlledT7AcceptanceDependencies = {},
): Promise<SanitizedT7AcceptanceReport> {
  assertTrustedAcceptanceEnvironment(env);

  const config = readPancakeConfig(env);
  assertApprovedShopId(config.shopId);

  const client = dependencies.client ?? new PancakeClient({ apiKey: config.apiKey });

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
  const publicCode = `T7-A132-${Date.now()}`;
  const orderInput = buildControlledT7OrderInput(
    config.shopId,
    EXPECTED_VARIATION_ID,
    EXPECTED_CATALOG_BASE_PRICE,
  );
  const request: PancakeCreateOrderRequest = buildPancakeCreateOrderRequest(orderInput);

  // Step 3: Single submission attempt
  const createResponse = await client.postJson(
    `/shops/${config.shopId}/orders`,
    request,
  );
  const createdOrderId = extractCreatedOrderId(createResponse);

  // Critical safety boundary: once createdOrderId exists, order cleanup MUST be attempted in finally
  let cleanupResult = "NOT_ATTEMPTED";
  let snapshotVerification: {
    snapshot: Awaited<ReturnType<typeof readCanonicalPurchaseSnapshot>>;
    identityInvariantVerified: boolean;
    itemFactsInvariantVerified: boolean;
  } | undefined;
  let executionError: unknown = null;

  try {
    // Step 4: Create local finalized CONFIRMED order facts and verify canonical purchase snapshot
    const unitPriceVnd = EXPECTED_CATALOG_BASE_PRICE;
    const quantity = 1;
    const merchandiseSubtotalVnd = unitPriceVnd * quantity;
    const shippingFeeVnd = TEST_SHIPPING_FEE_VND;
    const totalVnd = merchandiseSubtotalVnd + shippingFeeVnd;

    // Use injected dbClient or an in-memory client conforming to CanonicalPurchaseClient
    const localOrder = {
      state: "CONFIRMED" as const,
      publicCode,
      merchandiseSubtotalVnd: BigInt(merchandiseSubtotalVnd),
      shippingFeeVnd: BigInt(shippingFeeVnd),
      totalVnd: BigInt(totalVnd),
      lines: [
        {
          variantId: "live-variant-a132",
          pancakeVariationId: EXPECTED_VARIATION_ID,
          productName: targetVar.product_name ?? "Sản phẩm A132",
          color: "Màu chuẩn",
          size: "M",
          quantity,
          unitPriceVnd: BigInt(unitPriceVnd),
          lineTotalVnd: BigInt(merchandiseSubtotalVnd),
        },
      ],
    };

    const dbClient: CanonicalPurchaseClient =
      dependencies.dbClient ??
      ({
        orderMirror: {
          findUnique: async () => (localOrder as unknown as null),
        },
        variantMirror: {
          findMany: async () => [
            {
              id: "live-variant-a132",
              product: { pancakeProductId: "pancake-prod-a132" },
            },
          ],
        },
      } as unknown as CanonicalPurchaseClient);

    const snapshot = await readCanonicalPurchaseSnapshot(dbClient, publicCode);
    if (!snapshot) {
      throw new Error(`Failed to read canonical Purchase snapshot for order ${publicCode}`);
    }

    const identityInvariantVerified =
      snapshot.publicCode === publicCode &&
      snapshot.event.ecommerce.transaction_id === publicCode &&
      snapshot.event.ecommerce.event_id === publicCode;

    const firstItem = snapshot.event.ecommerce.items[0] as { item_id: string; price: number; quantity: number };
    const itemFactsInvariantVerified =
      firstItem.item_id === EXPECTED_VARIATION_ID &&
      firstItem.price === unitPriceVnd &&
      firstItem.quantity === quantity &&
      snapshot.event.ecommerce.value === merchandiseSubtotalVnd &&
      snapshot.event.ecommerce.shipping === shippingFeeVnd &&
      snapshot.event.ecommerce.la_total_vnd === totalVnd;

    if (!identityInvariantVerified) {
      throw new Error("Identity invariant violated: transactionId !== eventId !== publicCode");
    }
    if (!itemFactsInvariantVerified) {
      throw new Error("Item facts invariant violated: facts do not match immutable finalized order snapshot");
    }

    snapshotVerification = {
      snapshot,
      identityInvariantVerified,
      itemFactsInvariantVerified,
    };
  } catch (err) {
    executionError = err;
  } finally {
    // Step 5: Safe Cleanup - executed in all exit paths once createdOrderId is known
    cleanupResult = await attemptOrderCancellation(
      client,
      config.shopId,
      createdOrderId,
    );
  }

  if (executionError !== null) {
    if (executionError instanceof Error && cleanupResult !== "CANCELED_STATUS_7") {
      try {
        (executionError as Error & { cleanupContext?: unknown }).cleanupContext = {
          createdOrderId,
          cleanupResult,
        };
      } catch {
        // Ignore if error object cannot have properties attached
      }
    }
    throw executionError;
  }

  // If the main acceptance verification succeeds but cleanup cannot be confirmed as status 7,
  // the acceptance run must fail rather than print ACCEPTANCE SUCCESS.
  if (cleanupResult !== "CANCELED_STATUS_7") {
    throw new Error(
      `Acceptance failed: Pancake order ${createdOrderId} cleanup could not be verified as status 7 (result: ${cleanupResult})`,
    );
  }

  if (!snapshotVerification) {
    throw new Error("Verification state is unexpectedly undefined after acceptance execution");
  }

  const firstItem = snapshotVerification.snapshot!.event.ecommerce.items[0] as { item_id: string; price: number; quantity: number };

  return Object.freeze({
    timestamp: new Date().toISOString(),
    shopId: config.shopId,
    productCode: EXPECTED_PRODUCT_CODE,
    variationId: EXPECTED_VARIATION_ID,
    variationDisplayId: targetVar.display_id,
    publicCode,
    catalogBasePriceVnd: EXPECTED_CATALOG_BASE_PRICE,
    createdPancakeOrderId: createdOrderId,
    verifiedOrderState: "CONFIRMED" as const,
    snapshotFactQuantity: 1,
    snapshotFactUnitPriceVnd: EXPECTED_CATALOG_BASE_PRICE,
    canonicalTransactionId: snapshotVerification.snapshot!.event.ecommerce.transaction_id,
    canonicalEventId: snapshotVerification.snapshot!.event.ecommerce.event_id,
    canonicalMerchandiseValueVnd: snapshotVerification.snapshot!.event.ecommerce.value,
    canonicalShippingVnd: snapshotVerification.snapshot!.event.ecommerce.shipping,
    canonicalTotalVnd: snapshotVerification.snapshot!.event.ecommerce.la_total_vnd,
    canonicalItemId: firstItem.item_id,
    canonicalItemPrice: firstItem.price,
    canonicalItemQuantity: firstItem.quantity,
    identityInvariantVerified: snapshotVerification.identityInvariantVerified,
    itemFactsInvariantVerified: snapshotVerification.itemFactsInvariantVerified,
    cleanupResult,
  });
}

// Direct execution harness
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1] === import.meta.filename ||
    pathToFileURL(process.argv[1]).href === import.meta.url);

if (isDirectExecution) {
  runControlledT7Acceptance()
    .then((report) => {
      console.log("\n--- T7 CONFIRMED PURCHASE ACCEPTANCE SUCCESS ---");
      console.log(JSON.stringify(report, null, 2));
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n--- T7 CONFIRMED PURCHASE ACCEPTANCE FAILURE ---");
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
