"use server";

import { headers } from "next/headers";

import { readAuthServerConfig } from "../auth/config.ts";
import { prisma } from "../db/prisma.ts";
import { PancakeClient } from "../integrations/pancake/client.ts";
import { readPancakeConfig } from "../integrations/pancake/config.ts";
import type {
  PancakeCommune,
  PancakeDistrict,
  PancakeProvince,
} from "../integrations/pancake/geo.ts";
import { deriveGuestCheckoutClientKey } from "./guest-checkout-client-identity.ts";
import { createGuestCheckoutRateLimiter } from "./guest-checkout-rate-limit.ts";
import {
  createCheckoutGeoPublicActions,
  type CheckoutGeoPublicResult,
} from "./checkout-geo-public-actions.ts";
import {
  loadCheckoutCommunes,
  loadCheckoutDistricts,
  loadCheckoutProvinces,
} from "./checkout-geo.ts";

const geoRateLimiter = createGuestCheckoutRateLimiter(prisma);

function createServerClient(): PancakeClient {
  const { apiKey } = readPancakeConfig();
  return new PancakeClient({ apiKey });
}

async function allowGeoRead(): Promise<boolean> {
  const requestHeaders = await headers();
  const authConfig = readAuthServerConfig();
  const clientKey = deriveGuestCheckoutClientKey(requestHeaders, authConfig);
  return geoRateLimiter.consumeGeoClient({ clientKey });
}

const publicActions = createCheckoutGeoPublicActions({
  allowRead: allowGeoRead,
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
