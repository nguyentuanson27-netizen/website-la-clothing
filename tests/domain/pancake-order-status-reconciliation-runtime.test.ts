import assert from "node:assert/strict";
import test from "node:test";

import {
  createPancakeOrderStatusReconciliationRuntime,
  reconcilePancakeOrderStatusByOrderId,
} from "../../src/commerce/pancake-order-status-reconciliation-runtime.ts";

const shopId = 920_007;

test("status reconciliation runtime wires configured shop scope into the strict gateway and service", async () => {
  const calls: string[] = [];
  const gateway = {
    async fetchOrderStatus() {
      throw new Error("gateway should be consumed only by the injected service in this wiring test");
    },
  };
  const runtime = createPancakeOrderStatusReconciliationRuntime({
    readConfig() {
      calls.push("config");
      return { apiKey: "server-only-test-key", shopId };
    },
    createGateway(config) {
      calls.push(`gateway:${config.apiKey}:${config.shopId}`);
      return gateway;
    },
    createService(receivedGateway, options) {
      assert.equal(receivedGateway, gateway);
      assert.deepEqual(options, { shopId });
      calls.push("service");
      return {
        async reconcile(input) {
          calls.push(`reconcile:${input.orderId}`);
          return { ok: true as const, outcome: "UPDATED" as const };
        },
      };
    },
  });

  assert.deepEqual(await runtime.reconcile({ orderId: "local-order-1" }), {
    ok: true,
    outcome: "UPDATED",
  });
  assert.deepEqual(calls, [
    "config",
    `gateway:server-only-test-key:${shopId}`,
    "service",
    "reconcile:local-order-1",
  ]);
});

test("status reconciliation runtime collapses configuration/bootstrap failures without leaking details", async () => {
  const secretMarker = "PANCAKE_API_KEY=must-not-leak";
  const runtime = createPancakeOrderStatusReconciliationRuntime({
    readConfig() {
      throw new Error(secretMarker);
    },
  });

  const result = await runtime.reconcile({ orderId: "local-order-1" });
  assert.deepEqual(result, { ok: false, reason: "STATUS_UNAVAILABLE" });
  assert.equal(JSON.stringify(result).includes(secretMarker), false);
});

test("default exported status reconciliation entry point is callable without exposing construction details", () => {
  assert.equal(typeof reconcilePancakeOrderStatusByOrderId, "function");
});
