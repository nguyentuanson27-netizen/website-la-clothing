import assert from "node:assert/strict";
import test from "node:test";

import { createPancakeOrderGateway } from "../../src/integrations/pancake/order-gateway.ts";

function responsePayload() {
  return {
    id: 1418,
    system_id: 862,
    shop_id: 4,
    inserted_at: "2026-08-12T08:10:11Z",
    updated_at: "2026-08-12T09:12:13Z",
    status: 2,
    bill_full_name: "PII must remain outside the status model",
  };
}

test("order gateway reads one fixed shop-scoped order path and returns the strict status model", async () => {
  const calls: Array<{ endpoint: string; query: unknown }> = [];
  const client = {
    async getJson(endpoint: string, query?: unknown) {
      calls.push({ endpoint, query });
      return responsePayload();
    },
    async postJson() {
      throw new Error("not used");
    },
  };

  const gateway = createPancakeOrderGateway(client, async () => []);
  const result = await gateway.fetchOrderStatus(4, "1418");

  assert.deepEqual(calls, [{ endpoint: "/shops/4/orders/1418", query: undefined }]);
  assert.deepEqual(result, {
    orderId: "1418",
    systemId: 862,
    shopId: 4,
    status: 2,
    insertedAt: "2026-08-12T08:10:11Z",
    updatedAt: "2026-08-12T09:12:13Z",
  });
});

test("order gateway rejects unsafe order identifiers before any network request", async () => {
  let calls = 0;
  const client = {
    async getJson() {
      calls += 1;
      return responsePayload();
    },
    async postJson() {
      throw new Error("not used");
    },
  };
  const gateway = createPancakeOrderGateway(client, async () => []);

  for (const [shopId, orderId] of [
    [0, "1418"],
    [4, ""],
    [4, "01418"],
    [4, "1418/../../shops/5"],
    [4, "9007199254740992"],
  ] as const) {
    await assert.rejects(() => gateway.fetchOrderStatus(shopId, orderId), TypeError);
  }

  assert.equal(calls, 0);
});

test("order gateway fails closed when Pancake returns another shop or order identity", async () => {
  for (const payload of [{ ...responsePayload(), shop_id: 5 }, { ...responsePayload(), id: 1419 }]) {
    const client = {
      async getJson() {
        return payload;
      },
      async postJson() {
        throw new Error("not used");
      },
    };
    const gateway = createPancakeOrderGateway(client, async () => []);

    await assert.rejects(() => gateway.fetchOrderStatus(4, "1418"));
  }
});
