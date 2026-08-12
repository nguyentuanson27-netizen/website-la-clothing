import type {
  PancakeCommune,
  PancakeDistrict,
  PancakeProvince,
} from "../integrations/pancake/geo.ts";

type CheckoutGeoPublicFailure = Readonly<{
  ok: false;
  reason: "GEO_UNAVAILABLE";
}>;

type CheckoutGeoPublicSuccess<T> = Readonly<{
  ok: true;
  options: T[];
}>;

export type CheckoutGeoPublicResult<T> =
  | CheckoutGeoPublicSuccess<T>
  | CheckoutGeoPublicFailure;

type CheckoutGeoPublicDependencies = Readonly<{
  loadProvinces(): Promise<PancakeProvince[]>;
  loadDistricts(provinceId: unknown): Promise<PancakeDistrict[]>;
  loadCommunes(provinceId: unknown, districtId: unknown): Promise<PancakeCommune[]>;
}>;

const GEO_UNAVAILABLE: CheckoutGeoPublicFailure = Object.freeze({
  ok: false,
  reason: "GEO_UNAVAILABLE",
});

async function safeRead<T>(read: () => Promise<T[]>): Promise<CheckoutGeoPublicResult<T>> {
  try {
    return {
      ok: true,
      options: await read(),
    };
  } catch {
    return GEO_UNAVAILABLE;
  }
}

export function createCheckoutGeoPublicActions(
  dependencies: CheckoutGeoPublicDependencies,
) {
  return {
    provinces(): Promise<CheckoutGeoPublicResult<PancakeProvince>> {
      return safeRead(() => dependencies.loadProvinces());
    },
    districts(
      provinceId: unknown,
    ): Promise<CheckoutGeoPublicResult<PancakeDistrict>> {
      return safeRead(() => dependencies.loadDistricts(provinceId));
    },
    communes(
      provinceId: unknown,
      districtId: unknown,
    ): Promise<CheckoutGeoPublicResult<PancakeCommune>> {
      return safeRead(() => dependencies.loadCommunes(provinceId, districtId));
    },
  };
}
