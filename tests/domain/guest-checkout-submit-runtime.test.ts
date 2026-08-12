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

test("guest checkout runtime recovers current cart first, reads Pancake config once, and keeps authority server-owned", async () => {
  let configReads = 0;
  let recoveryInput: unknown;
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
  assert.deepEqual(calls, ["recover", "config", "snapshot", "submit"]);
  assert.deepEqual(recoveryInput, { cartId, now });
  assert.equal(configReads, 1);
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
