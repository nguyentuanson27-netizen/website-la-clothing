import assert from "node:assert/strict";
import test from "node:test";

import {
  loadCheckoutCommunes,
  loadCheckoutDistricts,
  loadCheckoutProvinces,
} from "../../src/commerce/checkout-geo.ts";

type Query = Readonly<Record<string, string | number | boolean>>;

class FakeReadableClient {
  readonly calls: Array<{ endpoint: string; query: Query }> = [];
  private readonly payloads: unknown[];

  constructor(...payloads: unknown[]) {
    this.payloads = payloads;
  }

  async getJson(endpoint: string, query: Query = {}): Promise<unknown> {
    this.calls.push({ endpoint, query });
    return this.payloads.shift();
  }
}

test("checkout province policy explicitly requests both legacy and current Vietnam records", async () => {
  const client = new FakeReadableClient({
    data: [
      { id: "101", name: "Hà Nội" },
      { id: "201", name: "Hà Nội cũ", new_id: "101" },
    ],
  });

  assert.deepEqual(await loadCheckoutProvinces(client), [
    { id: "101", name: "Hà Nội" },
    { id: "201", name: "Hà Nội cũ" },
  ]);
  assert.deepEqual(client.calls, [
    {
      endpoint: "/geo/provinces",
      query: { country_code: "84", all: true },
    },
  ]);
});

test("checkout district and commune reads preserve the exact selected Pancake parent ids", async () => {
  const client = new FakeReadableClient(
    {
      data: [{ id: "10113", name: "Quận Cầu Giấy", province_id: "101" }],
    },
    {
      data: [
        {
          id: "1011309",
          name: "Phường Dịch Vọng",
          province_id: "101",
          district_id: "10113",
        },
      ],
    },
  );

  assert.deepEqual(await loadCheckoutDistricts(client, "101"), [
    { id: "10113", name: "Quận Cầu Giấy", provinceId: "101" },
  ]);
  assert.deepEqual(await loadCheckoutCommunes(client, "101", "10113"), [
    {
      id: "1011309",
      name: "Phường Dịch Vọng",
      provinceId: "101",
      districtId: "10113",
    },
  ]);
  assert.deepEqual(client.calls, [
    {
      endpoint: "/geo/districts",
      query: { province_id: "101" },
    },
    {
      endpoint: "/geo/communes",
      query: { district_id: "10113", province_id: "101" },
    },
  ]);
});

test("checkout geo rejects non-string parent ids before any Pancake read", async () => {
  const client = new FakeReadableClient({ data: [] });

  await assert.rejects(() => loadCheckoutDistricts(client, 101));
  await assert.rejects(() => loadCheckoutCommunes(client, "101", null));
  assert.equal(client.calls.length, 0);
});
