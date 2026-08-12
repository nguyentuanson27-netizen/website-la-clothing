import assert from "node:assert/strict";
import test from "node:test";

import {
  listPancakeCommunes,
  listPancakeDistricts,
  listPancakeProvinces,
} from "../../src/integrations/pancake/geo.ts";

type Query = Readonly<Record<string, string | number | boolean>>;

type GeoErrorCode = "INVALID_GEO_QUERY" | "MALFORMED_GEO_RESPONSE";

const MAX_GEO_ENTRIES = 1_000;

function hasGeoCode(error: unknown, code: GeoErrorCode): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: unknown }).code === code
  );
}

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

test("geo gateway uses the observed Pancake query contract and exposes only checkout hierarchy fields", async () => {
  const client = new FakeReadableClient(
    {
      data: [
        { id: "101", name: " Hà Nội ", name_en: "ha noi", new_id: "84_VN101" },
        { id: "701", name: "Hồ Chí Minh", unexpected: "ignored" },
      ],
    },
    {
      data: [
        { id: "10113", name: "Quận Cầu Giấy", name_en: "cau giay", province_id: "101" },
      ],
    },
    {
      data: [
        {
          id: "1011309",
          name: "Phường Dịch Vọng",
          district_id: "10113",
          province_id: "101",
          new_id: null,
          postcode: null,
        },
      ],
    },
  );

  assert.deepEqual(
    await listPancakeProvinces(client, { countryCode: "84", isNew: false, all: true }),
    [
      { id: "101", name: "Hà Nội" },
      { id: "701", name: "Hồ Chí Minh" },
    ],
  );
  assert.deepEqual(await listPancakeDistricts(client, { provinceId: "101" }), [
    { id: "10113", name: "Quận Cầu Giấy", provinceId: "101" },
  ]);
  assert.deepEqual(
    await listPancakeCommunes(client, { provinceId: "101", districtId: "10113" }),
    [
      {
        id: "1011309",
        name: "Phường Dịch Vọng",
        provinceId: "101",
        districtId: "10113",
      },
    ],
  );

  assert.deepEqual(client.calls, [
    {
      endpoint: "/geo/provinces",
      query: { country_code: "84", is_new: false, all: true },
    },
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

test("optional province mode flags are omitted rather than invented when the caller does not choose them", async () => {
  const client = new FakeReadableClient({ data: [] });

  assert.deepEqual(await listPancakeProvinces(client, { countryCode: "84" }), []);
  assert.deepEqual(client.calls, [
    {
      endpoint: "/geo/provinces",
      query: { country_code: "84" },
    },
  ]);
});

test("geo gateway rejects malformed, duplicate and wrong-parent records", async () => {
  const malformed = new FakeReadableClient({ data: [{ id: "101", name: "   " }] });
  await assert.rejects(
    () => listPancakeProvinces(malformed, { countryCode: "84" }),
    (error: unknown) => hasGeoCode(error, "MALFORMED_GEO_RESPONSE"),
  );

  const duplicate = new FakeReadableClient({
    data: [
      { id: "101", name: "One" },
      { id: "101", name: "Two" },
    ],
  });
  await assert.rejects(
    () => listPancakeProvinces(duplicate, { countryCode: "84" }),
    (error: unknown) => hasGeoCode(error, "MALFORMED_GEO_RESPONSE"),
  );

  const wrongDistrictParent = new FakeReadableClient({
    data: [{ id: "10113", name: "Quận Cầu Giấy", province_id: "701" }],
  });
  await assert.rejects(
    () => listPancakeDistricts(wrongDistrictParent, { provinceId: "101" }),
    (error: unknown) => hasGeoCode(error, "MALFORMED_GEO_RESPONSE"),
  );

  const wrongCommuneParent = new FakeReadableClient({
    data: [
      {
        id: "1011309",
        name: "Phường Dịch Vọng",
        district_id: "10113",
        province_id: "701",
      },
    ],
  });
  await assert.rejects(
    () => listPancakeCommunes(wrongCommuneParent, { provinceId: "101", districtId: "10113" }),
    (error: unknown) => hasGeoCode(error, "MALFORMED_GEO_RESPONSE"),
  );
});

test("geo gateway validates bounded lookup identifiers before any Pancake read", async () => {
  const client = new FakeReadableClient({ data: [] });

  for (const run of [
    () => listPancakeProvinces(client, { countryCode: " " }),
    () => listPancakeDistricts(client, { provinceId: "101 " }),
    () => listPancakeCommunes(client, { provinceId: "101", districtId: "x".repeat(65) }),
  ]) {
    await assert.rejects(
      run,
      (error: unknown) => hasGeoCode(error, "INVALID_GEO_QUERY"),
    );
  }

  assert.equal(client.calls.length, 0);
});

test("geo gateway rejects oversized result sets before returning third-party data", async () => {
  const client = new FakeReadableClient({
    data: Array.from({ length: MAX_GEO_ENTRIES + 1 }, (_, index) => ({
      id: String(index + 1),
      name: `Province ${index + 1}`,
    })),
  });

  await assert.rejects(
    () => listPancakeProvinces(client, { countryCode: "84" }),
    (error: unknown) => hasGeoCode(error, "MALFORMED_GEO_RESPONSE"),
  );
});
