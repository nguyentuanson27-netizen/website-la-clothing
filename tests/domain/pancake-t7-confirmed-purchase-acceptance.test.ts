import assert from "node:assert/strict";
import test from "node:test";

import {
  assertApprovedShopId,
  assertTrustedAcceptanceEnvironment,
  attemptOrderCancellation,
  buildControlledT7OrderInput,
  CI_REFUSAL_MESSAGE,
  EXPECTED_CATALOG_BASE_PRICE,
  EXPECTED_PRODUCT_CODE,
  EXPECTED_SHOP_ID,
  EXPECTED_VARIATION_ID,
  extractCreatedOrderId,
  runControlledT7Acceptance,
  validateVariationPreflight,
} from "../../scripts/pancake-t7-confirmed-purchase-acceptance.ts";

test("preflight assertion refuses CI environments", () => {
  assert.throws(
    () => assertTrustedAcceptanceEnvironment({ CI: "true" }),
    (err: Error) => err.message === CI_REFUSAL_MESSAGE,
  );
  assert.throws(
    () => assertTrustedAcceptanceEnvironment({ GITHUB_ACTIONS: "true" }),
    (err: Error) => err.message === CI_REFUSAL_MESSAGE,
  );
});

test("preflight assertion requires explicit operator approval", () => {
  assert.throws(
    () => assertTrustedAcceptanceEnvironment({}),
    /requires explicit operator approval/,
  );
  assert.throws(
    () => assertTrustedAcceptanceEnvironment({ T7_ACCEPTANCE_APPROVED: "wrong-code" }),
    /requires explicit operator approval/,
  );

  // Succeeds when approved
  assert.doesNotThrow(() =>
    assertTrustedAcceptanceEnvironment({ T7_ACCEPTANCE_APPROVED: EXPECTED_PRODUCT_CODE }),
  );
});

test("preflight assertion refuses unexpected shop ID", () => {
  assert.throws(() => assertApprovedShopId(999999), /acceptance refused/);
  assert.doesNotThrow(() => assertApprovedShopId(EXPECTED_SHOP_ID));
});

test("variation preflight validates correct catalog facts and sellable stock", () => {
  const validPayload = {
    data: [
      {
        id: EXPECTED_VARIATION_ID,
        display_id: "A132-M",
        retail_price: EXPECTED_CATALOG_BASE_PRICE,
        remain_quantity: 10,
        product_name: "Áo nam A132",
      },
    ],
  };

  const matched = validateVariationPreflight(validPayload);
  assert.equal(matched.id, EXPECTED_VARIATION_ID);
  assert.equal(matched.retail_price, EXPECTED_CATALOG_BASE_PRICE);
  assert.equal(matched.remain_quantity, 10);

  // Missing variation
  assert.throws(
    () => validateVariationPreflight({ data: [] }),
    /not found in catalog/,
  );

  // Price mismatch
  assert.throws(
    () =>
      validateVariationPreflight({
        data: [{ id: EXPECTED_VARIATION_ID, retail_price: 999_000, remain_quantity: 10 }],
      }),
    /Catalog base price mismatch/,
  );

  // Zero stock
  assert.throws(
    () =>
      validateVariationPreflight({
        data: [{ id: EXPECTED_VARIATION_ID, retail_price: EXPECTED_CATALOG_BASE_PRICE, remain_quantity: 0 }],
      }),
    /Insufficient sellable stock/,
  );
});

test("buildControlledT7OrderInput constructs valid order input with test customer facts", () => {
  const input = buildControlledT7OrderInput(
    EXPECTED_SHOP_ID,
    EXPECTED_VARIATION_ID,
    EXPECTED_CATALOG_BASE_PRICE,
  );
  assert.equal(input.shopId, EXPECTED_SHOP_ID);
  assert.equal(input.lines[0].pancakeVariationId, EXPECTED_VARIATION_ID);
  assert.equal(input.lines[0].unitPriceVnd, EXPECTED_CATALOG_BASE_PRICE);
  assert.equal(input.lines[0].quantity, 1);
});

test("extractCreatedOrderId parses order ID from both direct and nested responses", () => {
  assert.equal(extractCreatedOrderId({ id: 12345 }), "12345");
  assert.equal(extractCreatedOrderId({ data: { id: 67890 } }), "67890");
  assert.throws(() => extractCreatedOrderId({}), /Unable to parse/);
});

test("attemptOrderCancellation sends status 7 cleanup to Pancake", async () => {
  const puts: Array<{ endpoint: string; body: unknown }> = [];
  const client = {
    getJson: async () => ({}),
    postJson: async () => ({}),
    putJson: async (endpoint: string, body: unknown) => {
      puts.push({ endpoint, body });
      return { success: true, status: 7 };
    },
  };

  const result = await attemptOrderCancellation(client, EXPECTED_SHOP_ID, "98765");
  assert.equal(result, "CANCELED_STATUS_7");
  assert.equal(puts.length, 1);
  assert.equal(puts[0].endpoint, `/shops/${EXPECTED_SHOP_ID}/orders/98765`);
  assert.deepEqual(puts[0].body, { status: 7 });
});

test("runControlledT7Acceptance executes complete verified flow with cleanup", async () => {
  const env = {
    T7_ACCEPTANCE_APPROVED: EXPECTED_PRODUCT_CODE,
    PANCAKE_API_KEY: "dummy-key-for-test",
    PANCAKE_SHOP_ID: String(EXPECTED_SHOP_ID),
  };

  const apiCalls: Array<{ method: string; endpoint: string; body?: unknown }> = [];
  const mockClient = {
    getJson: async (endpoint: string) => {
      apiCalls.push({ method: "GET", endpoint });
      if (endpoint.includes("/products/variations")) {
        return {
          data: [
            {
              id: EXPECTED_VARIATION_ID,
              display_id: "A132-M",
              retail_price: EXPECTED_CATALOG_BASE_PRICE,
              remain_quantity: 5,
              product_name: "Áo Polo Nam A132",
            },
          ],
        };
      }
      return {};
    },
    postJson: async (endpoint: string, body: unknown) => {
      apiCalls.push({ method: "POST", endpoint, body });
      return { success: true, data: { id: 777888 } };
    },
    putJson: async (endpoint: string, body: unknown) => {
      apiCalls.push({ method: "PUT", endpoint, body });
      return { success: true, status: 7 };
    },
  };

  const report = await runControlledT7Acceptance(env, { client: mockClient });

  assert.equal(report.productCode, EXPECTED_PRODUCT_CODE);
  assert.equal(report.variationId, EXPECTED_VARIATION_ID);
  assert.equal(report.createdPancakeOrderId, "777888");
  assert.equal(report.verifiedOrderState, "CONFIRMED");
  assert.equal(report.snapshotFactQuantity, 1);
  assert.equal(report.snapshotFactUnitPriceVnd, EXPECTED_CATALOG_BASE_PRICE);
  assert.equal(report.identityInvariantVerified, true);
  assert.equal(report.itemFactsInvariantVerified, true);
  assert.equal(report.canonicalTransactionId, report.publicCode);
  assert.equal(report.canonicalEventId, report.publicCode);
  assert.equal(report.canonicalItemId, EXPECTED_VARIATION_ID);
  assert.equal(report.canonicalItemPrice, EXPECTED_CATALOG_BASE_PRICE);
  assert.equal(report.canonicalItemQuantity, 1);
  assert.equal(report.cleanupResult, "CANCELED_STATUS_7");

  // Verify that cleanup PUT was called
  const cleanupCall = apiCalls.find(
    (c) => c.method === "PUT" && c.endpoint === `/shops/${EXPECTED_SHOP_ID}/orders/777888`,
  );
  assert.notEqual(cleanupCall, undefined);
  assert.deepEqual(cleanupCall?.body, { status: 7 });
});

test("attemptOrderCancellation verifies status 7 via PUT response or GET read-back", async () => {
  // Direct PUT data.status = 7
  const directClient = {
    getJson: async () => ({}),
    postJson: async () => ({}),
    putJson: async () => ({ success: true, data: { status: 7 } }),
  };
  assert.equal(
    await attemptOrderCancellation(directClient, EXPECTED_SHOP_ID, "111"),
    "CANCELED_STATUS_7",
  );

  // PUT without explicit status 7, but GET read-back confirms status 7
  const readbackCalls: string[] = [];
  const readbackClient = {
    getJson: async (endpoint: string) => {
      readbackCalls.push(endpoint);
      return { data: { status: 7 } };
    },
    postJson: async () => ({}),
    putJson: async () => ({ success: true }), // generic success only
  };
  assert.equal(
    await attemptOrderCancellation(readbackClient, EXPECTED_SHOP_ID, "222"),
    "CANCELED_STATUS_7",
  );
  assert.equal(readbackCalls.length, 1);
  assert.equal(readbackCalls[0], `/shops/${EXPECTED_SHOP_ID}/orders/222`);

  // PUT success: true, but GET read-back returns status 0 (unverified status)
  const unverifiedClient = {
    getJson: async () => ({ data: { status: 0 } }),
    postJson: async () => ({}),
    putJson: async () => ({ success: true }),
  };
  const unverifiedResult = await attemptOrderCancellation(unverifiedClient, EXPECTED_SHOP_ID, "333");
  assert.notEqual(unverifiedResult, "CANCELED_STATUS_7");
  assert.match(unverifiedResult, /CLEANUP_STATUS_UNVERIFIED/);
});

test("runControlledT7Acceptance fails when cleanup returns success: true without verified status 7", async () => {
  const env = {
    T7_ACCEPTANCE_APPROVED: EXPECTED_PRODUCT_CODE,
    PANCAKE_API_KEY: "dummy-key-for-test",
    PANCAKE_SHOP_ID: String(EXPECTED_SHOP_ID),
  };

  const mockClient = {
    getJson: async (endpoint: string) => {
      if (endpoint.includes("/products/variations")) {
        return {
          data: [
            {
              id: EXPECTED_VARIATION_ID,
              display_id: "A132-M",
              retail_price: EXPECTED_CATALOG_BASE_PRICE,
              remain_quantity: 5,
              product_name: "Áo Polo Nam A132",
            },
          ],
        };
      }
      // Read-back for order returns uncancelled status
      return { data: { status: 0 } };
    },
    postJson: async () => ({ success: true, data: { id: 888999 } }),
    putJson: async () => ({ success: true }), // Generic success: true without status 7
  };

  await assert.rejects(
    async () => runControlledT7Acceptance(env, { client: mockClient }),
    /cleanup could not be verified as status 7/,
  );
});

test("runControlledT7Acceptance fails when cleanup request throws", async () => {
  const env = {
    T7_ACCEPTANCE_APPROVED: EXPECTED_PRODUCT_CODE,
    PANCAKE_API_KEY: "dummy-key-for-test",
    PANCAKE_SHOP_ID: String(EXPECTED_SHOP_ID),
  };

  const mockClient = {
    getJson: async (endpoint: string) => {
      if (endpoint.includes("/products/variations")) {
        return {
          data: [
            {
              id: EXPECTED_VARIATION_ID,
              display_id: "A132-M",
              retail_price: EXPECTED_CATALOG_BASE_PRICE,
              remain_quantity: 5,
              product_name: "Áo Polo Nam A132",
            },
          ],
        };
      }
      return {};
    },
    postJson: async () => ({ success: true, data: { id: 999111 } }),
    putJson: async () => {
      throw new Error("Network timeout during cancel");
    },
  };

  await assert.rejects(
    async () => runControlledT7Acceptance(env, { client: mockClient }),
    /cleanup could not be verified as status 7/,
  );
});

test("verification throws after create → cleanup is still attempted exactly once and original verification error is preserved", async () => {
  const env = {
    T7_ACCEPTANCE_APPROVED: EXPECTED_PRODUCT_CODE,
    PANCAKE_API_KEY: "dummy-key-for-test",
    PANCAKE_SHOP_ID: String(EXPECTED_SHOP_ID),
  };

  const puts: string[] = [];
  const mockClient = {
    getJson: async (endpoint: string) => {
      if (endpoint.includes("/products/variations")) {
        return {
          data: [
            {
              id: EXPECTED_VARIATION_ID,
              display_id: "A132-M",
              retail_price: EXPECTED_CATALOG_BASE_PRICE,
              remain_quantity: 5,
              product_name: "Áo Polo Nam A132",
            },
          ],
        };
      }
      return {};
    },
    postJson: async () => ({ success: true, data: { id: 555666 } }),
    putJson: async (endpoint: string) => {
      puts.push(endpoint);
      return { success: true, status: 7 };
    },
  };

  // Inject a dbClient that throws an intentional verification error
  const failingDbClient = {
    orderMirror: {
      findUnique: async () => {
        throw new Error("Intentional order verification explosion");
      },
    },
    variantMirror: {
      findMany: async () => [],
    },
  };

  await assert.rejects(
    async () =>
      runControlledT7Acceptance(env, {
        client: mockClient,
        dbClient: failingDbClient as unknown as import("../../src/commerce/canonical-purchase-snapshot.ts").CanonicalPurchaseClient,
      }),
    (err: Error) => {
      assert.equal(err.message, "Intentional order verification explosion");
      return true;
    },
  );

  // Assert cleanup was attempted exactly once
  assert.equal(puts.length, 1);
  assert.equal(puts[0], `/shops/${EXPECTED_SHOP_ID}/orders/555666`);
});

