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

test("fresh guest checkout validates geo before creating a snapshot", async () => {
  let configReads = 0;
  let recoveryInput: unknown;
  let geoInput: unknown;
  let snapshotFactoryInput: unknown;
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
    requiresFreshSnapshot: async (input) => {
      calls.push("fresh-check");
      assert.equal(input, cartId);
      return true;
    },
    validateGeo: async (_config: unknown, input: unknown) => {
      calls.push("geo");
      geoInput = input;
      return { ok: true as const, checkoutInput };
    },
    createSnapshot: (input) => {
      snapshotFactoryInput = input;
      return {
        async create(snapshot) {
          calls.push("snapshot");
          snapshotInput = snapshot;
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
      };
    },
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
  assert.deepEqual(calls, ["recover", "config", "fresh-check", "geo", "snapshot", "submit"]);
  assert.deepEqual(recoveryInput, { cartId, now });
  assert.equal(configReads, 1);
  assert.deepEqual(geoInput, checkoutInput);
  assert.deepEqual(snapshotFactoryInput, { checkoutInputValidated: true });
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

test("reusable active checkout skips geo reads while snapshot transaction retains race authority", async () => {
  const calls: string[] = [];
  let snapshotFactoryInput: unknown;
  const runtime = createGuestCheckoutSubmitRuntime({
    recoverStranded: async () => {
      calls.push("recover");
    },
    readConfig: () => {
      calls.push("config");
      return { apiKey: "server-secret", shopId: 920_007 };
    },
    requiresFreshSnapshot: async () => {
      calls.push("fresh-check");
      return false;
    },
    validateGeo: async () => {
      calls.push("geo");
      throw new Error("reusable checkout must not re-read Pancake geo");
    },
    createSnapshot: (input) => {
      snapshotFactoryInput = input;
      return {
        async create() {
          calls.push("snapshot");
          return {
            ok: true as const,
            order: {
              publicCode: "LA-confirmed",
              state: "CONFIRMED" as const,
              merchandiseSubtotalVnd: BigInt(500_000),
              shippingFeeVnd: BigInt(30_000),
              totalVnd: BigInt(530_000),
            },
          };
        },
      };
    },
    createOrderSubmission: () => ({
      async submit() {
        calls.push("submit");
        return {
          ok: true as const,
          state: "CONFIRMED" as const,
          pancakeOrderId: "700001",
        };
      },
    }),
    clock: () => now,
  });

  assert.deepEqual(await runtime.submit({ cartId, checkoutInput }), {
    ok: true,
    status: "CONFIRMED",
    orderCode: "LA-confirmed",
  });
  assert.deepEqual(calls, ["recover", "config", "fresh-check", "snapshot", "submit"]);
  assert.deepEqual(snapshotFactoryInput, { checkoutInputValidated: false });
});

test("fresh guest checkout rejects an invalid geo hierarchy before snapshot or order submission", async () => {
  const calls: string[] = [];
  const runtime = createGuestCheckoutSubmitRuntime({
    recoverStranded: async () => {
      calls.push("recover");
    },
    readConfig: () => {
      calls.push("config");
      return { apiKey: "server-secret", shopId: 920_007 };
    },
    requiresFreshSnapshot: async () => {
      calls.push("fresh-check");
      return true;
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
  assert.deepEqual(calls, ["recover", "config", "fresh-check", "geo"]);
});
