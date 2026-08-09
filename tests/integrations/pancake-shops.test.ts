import assert from "node:assert/strict";
import test from "node:test";

import { listPancakeShops, PancakePayloadError } from "../../src/integrations/pancake/shops.ts";

const documentedShopResponse = {
  shops: [
    {
      id: 6036602,
      name: "Shop thời trang",
      avatar_url: "https://example.invalid/avatar.jpg",
      pages: [],
    },
  ],
  success: true,
};

test("maps the documented Pancake shop response into the internal shop contract", async () => {
  let requestedEndpoint = "";
  const client = {
    async getJson(endpoint: string): Promise<unknown> {
      requestedEndpoint = endpoint;
      return documentedShopResponse;
    },
  };

  const shops = await listPancakeShops(client);

  assert.equal(requestedEndpoint, "/shops");
  assert.deepEqual(shops, [{ id: 6036602, name: "Shop thời trang" }]);
});

test("rejects unsuccessful or malformed Pancake shop payloads", async (t) => {
  const cases: Array<{ name: string; payload: unknown }> = [
    { name: "success false", payload: { success: false, shops: [] } },
    { name: "missing shops", payload: { success: true } },
    { name: "non-array shops", payload: { success: true, shops: {} } },
    { name: "invalid shop id", payload: { success: true, shops: [{ id: "6036602", name: "Shop" }] } },
    { name: "invalid shop name", payload: { success: true, shops: [{ id: 6036602, name: "" }] } },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const client = {
        async getJson(): Promise<unknown> {
          return scenario.payload;
        },
      };

      await assert.rejects(() => listPancakeShops(client), PancakePayloadError);
    });
  }
});
