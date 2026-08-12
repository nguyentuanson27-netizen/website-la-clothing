import assert from "node:assert/strict";
import test from "node:test";

import { createCheckoutGeoPublicActions } from "../../src/commerce/checkout-geo-public-actions.ts";

const provinces = [
  { id: "101", name: "Hà Nội" },
  { id: "201", name: "Hà Nội cũ" },
];
const districts = [{ id: "10113", name: "Quận Cầu Giấy", provinceId: "101" }];
const communes = [
  {
    id: "1011309",
    name: "Phường Dịch Vọng",
    provinceId: "101",
    districtId: "10113",
  },
];

test("checkout geo public actions authorize each read, return allowlisted options, and preserve parent ids", async () => {
  const calls: unknown[] = [];
  const dependencies = {
    allowRead: async () => {
      calls.push(["allow"]);
      return true;
    },
    loadProvinces: async () => provinces,
    loadDistricts: async (provinceId: unknown) => {
      calls.push(["districts", provinceId]);
      return districts;
    },
    loadCommunes: async (provinceId: unknown, districtId: unknown) => {
      calls.push(["communes", provinceId, districtId]);
      return communes;
    },
  };
  const actions = createCheckoutGeoPublicActions(dependencies);

  assert.deepEqual(await actions.provinces(), { ok: true, options: provinces });
  assert.deepEqual(await actions.districts("101"), { ok: true, options: districts });
  assert.deepEqual(await actions.communes("101", "10113"), { ok: true, options: communes });
  assert.deepEqual(calls, [
    ["allow"],
    ["allow"],
    ["districts", "101"],
    ["allow"],
    ["communes", "101", "10113"],
  ]);
});

test("checkout geo public actions fail closed with one fixed browser reason", async () => {
  const secret = "pancake-secret-must-not-escape";
  const dependencies = {
    allowRead: async () => true,
    loadProvinces: async () => {
      throw new Error(`network failed with ${secret}`);
    },
    loadDistricts: async () => {
      throw new Error(`bad parent ${secret}`);
    },
    loadCommunes: async () => {
      throw new Error(`malformed response ${secret}`);
    },
  };
  const actions = createCheckoutGeoPublicActions(dependencies);

  for (const result of [
    await actions.provinces(),
    await actions.districts("101"),
    await actions.communes("101", "10113"),
  ]) {
    assert.deepEqual(result, { ok: false, reason: "GEO_UNAVAILABLE" });
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test("checkout geo public actions deny rate-limited reads before Pancake loaders", async () => {
  let upstreamCalls = 0;
  const dependencies = {
    allowRead: async () => false,
    loadProvinces: async () => {
      upstreamCalls += 1;
      return provinces;
    },
    loadDistricts: async () => {
      upstreamCalls += 1;
      return districts;
    },
    loadCommunes: async () => {
      upstreamCalls += 1;
      return communes;
    },
  };
  const actions = createCheckoutGeoPublicActions(dependencies);

  assert.deepEqual(await actions.provinces(), { ok: false, reason: "GEO_UNAVAILABLE" });
  assert.deepEqual(await actions.districts("101"), { ok: false, reason: "GEO_UNAVAILABLE" });
  assert.deepEqual(await actions.communes("101", "10113"), {
    ok: false,
    reason: "GEO_UNAVAILABLE",
  });
  assert.equal(upstreamCalls, 0);
});
