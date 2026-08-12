import assert from "node:assert/strict";
import test from "node:test";

import { createGuestCheckoutSubmitRuntime } from "../../src/commerce/guest-checkout-submit-runtime.ts";

const now = new Date("2026-08-12T06:00:00.000Z");
const cartId = "44444444-4444-4444-8444-444444444444";
const checkoutInput = {
  name: "Nguyễn Văn A",
  phone: "0901234567",
  provinceRef: "province-01",
  districtRef: "district-001",
  communeRef: "commune-0001",
  detail: "12 Đường A",
  note: null,
};

test("guest checkout runtime recovers current cart, validates geo, and keeps authority server-owned", async () => {
  let configReads = 0;
  let recoveryInput: unknown;
  let geoInput: unknown;
  let snapshotInput: unknown;
  let submissionInput: unknown;
  let orderFactoryConfig: unknown;
  const calls: string[] = [];

  const runtime = createGuestCheckoutSubmitRuntime({
    recoverStranded: async (input) => {
      calls.push("recover");
      recoveryInput = input;
    },
    readConfig: () => {
      calls.push("config");
      configReads += 1;
      return { apiKey: "server-secret", shopId: 920_007 };
    },
    validateGeo: async (_config: unknown, input: unknown) => {
      calls.push("geo");
      geoInput = input;
      return { ok: true as const, checkoutInput };
    },
    createSnapshot: () => ({
      async create(input) {
        calls.push("snapshot");
        snapshotInput = input;
        return {
          ok: true as const,
          order: {
            publicCode: "LA-server-owned",
            state: "DRAFT" as const,
            merchandiseSubtotalVnd: BigInt(500_000),
            shippingFeeVnd: BigInt(30_000),
            totalVnd: BigInt(530_000),
          },
        };
      },
    }),
    createOrderSubmission: (config) => {
      orderFactoryConfig = config;
      return {
        async submit(input) {
          calls.push("submit");
          submissionInput = input;
          return {
            ok: true as const,
            state: "CONFIRMED" as const,
            pancakeOrderId: "700001",
          };
        },
      };
    },
    generatePublicCode: () => "LA-server-owned",
    clock: () => now,
  });

  assert.deepEqual(await runtime.submit({ cartId, checkoutInput }), {
    ok: true,
    status: "CONFIRMED",
    orderCode: "LA-server-owned",
  });
  assert.deepEqual(calls, ["recover", "config", "geo", "snapshot", "submit"]);
  assert.deepEqual(recoveryInput, { cartId, now });
  assert.equal(configReads, 1);
  assert.deepEqual(geoInput, checkoutInput);
  assert.deepEqual(orderFactoryConfig, { apiKey: "server-secret", shopId: 920_007 });
  assert.deepEqual(snapshotInput, {
    cartId,
    shopId: 920_007,
    publicCode: "LA-server-owned",
    checkoutInput,
    now,
  });
  assert.deepEqual(submissionInput, {
    publicCode: "LA-server-owned",
    shopId: 920_007,
  });
});

test("guest checkout runtime rejects an invalid geo hierarchy before snapshot or order submission", async () => {
  const calls: string[] = [];
  const runtime = createGuestCheckoutSubmitRuntime({
    recoverStranded: async () => {
      calls.push("recover");
    },
    readConfig: () => {
      calls.push("config");
      return { apiKey: "server-secret", shopId: 920_007 };
    },
    validateGeo: async () => {
      calls.push("geo");
      return { ok: false as const, reason: "INVALID_INPUT" as const };
    },
    createSnapshot: () => {
      calls.push("snapshot-factory");
      throw new Error("snapshot must not be created");
    },
    createOrderSubmission: () => {
      calls.push("order-factory");
      throw new Error("order submission must not be created");
    },
    clock: () => now,
  });

  assert.deepEqual(await runtime.submit({ cartId, checkoutInput }), {
    ok: false,
    status: "RETRYABLE",
    reason: "INVALID_INPUT",
  });
  assert.deepEqual(calls, ["recover", "config", "geo"]);
});
