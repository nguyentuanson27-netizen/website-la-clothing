import {
  listPancakeCommunes,
  listPancakeDistricts,
  listPancakeProvinces,
  PancakeGeoContractError,
  type PancakeCommune,
  type PancakeDistrict,
  type PancakeProvince,
} from "../integrations/pancake/geo.ts";

type QueryValue = string | number | boolean;

type CheckoutGeoReadableClient = {
  getJson(
    endpoint: string,
    query?: Readonly<Record<string, QueryValue>>,
  ): Promise<unknown>;
};

function requireParentId(value: unknown): string {
  if (typeof value !== "string") {
    throw new PancakeGeoContractError("INVALID_GEO_QUERY");
  }
  return value;
}

export async function loadCheckoutProvinces(
  client: CheckoutGeoReadableClient,
): Promise<PancakeProvince[]> {
  return listPancakeProvinces(client, {
    countryCode: "84",
    all: true,
  });
}

export async function loadCheckoutDistricts(
  client: CheckoutGeoReadableClient,
  provinceId: unknown,
): Promise<PancakeDistrict[]> {
  return listPancakeDistricts(client, {
    provinceId: requireParentId(provinceId),
  });
}

export async function loadCheckoutCommunes(
  client: CheckoutGeoReadableClient,
  provinceId: unknown,
  districtId: unknown,
): Promise<PancakeCommune[]> {
  return listPancakeCommunes(client, {
    provinceId: requireParentId(provinceId),
    districtId: requireParentId(districtId),
  });
}
