"use server";

import {
  createCheckoutGeoPublicActions,
  type CheckoutGeoPublicResult,
} from "./checkout-geo-public-actions.ts";
import {
  loadCheckoutCommunes,
  loadCheckoutDistricts,
  loadCheckoutProvinces,
} from "./checkout-geo.ts";
import { PancakeClient } from "../integrations/pancake/client.ts";
import { readPancakeConfig } from "../integrations/pancake/config.ts";
import type {
  PancakeCommune,
  PancakeDistrict,
  PancakeProvince,
} from "../integrations/pancake/geo.ts";

function createServerClient(): PancakeClient {
  const { apiKey } = readPancakeConfig();
  return new PancakeClient({ apiKey });
}

const publicActions = createCheckoutGeoPublicActions({
  loadProvinces: () => loadCheckoutProvinces(createServerClient()),
  loadDistricts: (provinceId) =>
    loadCheckoutDistricts(createServerClient(), provinceId),
  loadCommunes: (provinceId, districtId) =>
    loadCheckoutCommunes(createServerClient(), provinceId, districtId),
});

export async function loadCheckoutProvincesAction(): Promise<
  CheckoutGeoPublicResult<PancakeProvince>
> {
  return publicActions.provinces();
}

export async function loadCheckoutDistrictsAction(
  provinceId: unknown,
): Promise<CheckoutGeoPublicResult<PancakeDistrict>> {
  return publicActions.districts(provinceId);
}

export async function loadCheckoutCommunesAction(
  provinceId: unknown,
  districtId: unknown,
): Promise<CheckoutGeoPublicResult<PancakeCommune>> {
  return publicActions.communes(provinceId, districtId);
}
