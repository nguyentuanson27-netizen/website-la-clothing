import assert from "node:assert/strict";
import test from "node:test";

import { validateCheckoutGeoSelection } from "../../src/commerce/checkout-geo-validation.ts";

const rawInput = {
  name: " Nguyễn Văn A ",
  phone: " 0901234567 ",
  provinceRef: "101",
  districtRef: "10113",
  communeRef: "1011309",
  detail: " 12 Đường A ",
  note: " giao giờ hành chính ",
};

function createDependencies(overrides: Partial<{
  provinces: unknown[];
  districts: unknown[];
  communes: unknown[];
}> = {}) {
  const calls: string[] = [];
  return {
    calls,
    dependencies: {
      async loadProvinces() {
        calls.push("provinces");
        return (overrides.provinces ?? [{ id: "101", name: "Hà Nội" }]) as never;
      },
      async loadDistricts(provinceId: unknown) {
        calls.push(`districts:${String(provinceId)}`);
        return (overrides.districts ?? [
          { id: "10113", name: "Quận Cầu Giấy", provinceId: "101" },
        ]) as never;
      },
      async loadCommunes(provinceId: unknown, districtId: unknown) {
        calls.push(`communes:${String(provinceId)}:${String(districtId)}`);
        return (overrides.communes ?? [
          {
            id: "1011309",
            name: "Phường Dịch Vọng",
            provinceId: "101",
            districtId: "10113",
          },
        ]) as never;
      },
    },
  };
}

test("checkout geo validation accepts only an exact hierarchy and returns normalized checkout input", async () => {
  const { calls, dependencies } = createDependencies();

  assert.deepEqual(await validateCheckoutGeoSelection(dependencies, rawInput), {
    ok: true,
    checkoutInput: {
      name: "Nguyễn Văn A",
      phone: "0901234567",
      provinceRef: "101",
      districtRef: "10113",
      communeRef: "1011309",
      detail: "12 Đường A",
      note: "giao giờ hành chính",
    },
  });
  assert.deepEqual(calls, ["provinces", "districts:101", "communes:101:10113"]);
});

test("checkout geo validation stops at the first unknown hierarchy level", async () => {
  const unknownProvince = createDependencies({ provinces: [] });
  assert.deepEqual(
    await validateCheckoutGeoSelection(unknownProvince.dependencies, rawInput),
    { ok: false, reason: "INVALID_INPUT" },
  );
  assert.deepEqual(unknownProvince.calls, ["provinces"]);

  const unknownDistrict = createDependencies({ districts: [] });
  assert.deepEqual(
    await validateCheckoutGeoSelection(unknownDistrict.dependencies, rawInput),
    { ok: false, reason: "INVALID_INPUT" },
  );
  assert.deepEqual(unknownDistrict.calls, ["provinces", "districts:101"]);

  const unknownCommune = createDependencies({ communes: [] });
  assert.deepEqual(
    await validateCheckoutGeoSelection(unknownCommune.dependencies, rawInput),
    { ok: false, reason: "INVALID_INPUT" },
  );
  assert.deepEqual(unknownCommune.calls, ["provinces", "districts:101", "communes:101:10113"]);
});

test("malformed checkout input is rejected before any geo read", async () => {
  const { calls, dependencies } = createDependencies();

  assert.deepEqual(
    await validateCheckoutGeoSelection(dependencies, { ...rawInput, provinceRef: " " }),
    { ok: false, reason: "INVALID_INPUT" },
  );
  assert.deepEqual(calls, []);
});

test("geo dependency failures propagate instead of being misclassified as invalid user input", async () => {
  const outage = new Error("Pancake unavailable");
  const dependencies = {
    async loadProvinces(): Promise<never> {
      throw outage;
    },
    async loadDistricts(): Promise<never> {
      throw new Error("unreachable");
    },
    async loadCommunes(): Promise<never> {
      throw new Error("unreachable");
    },
  };

  await assert.rejects(
    () => validateCheckoutGeoSelection(dependencies, rawInput),
    (error: unknown) => error === outage,
  );
});
