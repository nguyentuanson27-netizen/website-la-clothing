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
  allowRead(): Promise<boolean>;
  loadProvinces(): Promise<PancakeProvince[]>;
  loadDistricts(provinceId: unknown): Promise<PancakeDistrict[]>;
  loadCommunes(provinceId: unknown, districtId: unknown): Promise<PancakeCommune[]>;
}>;

const GEO_UNAVAILABLE: CheckoutGeoPublicFailure = Object.freeze({
  ok: false,
  reason: "GEO_UNAVAILABLE",
});

async function safeRead<T>(
  dependencies: CheckoutGeoPublicDependencies,
  read: () => Promise<T[]>,
): Promise<CheckoutGeoPublicResult<T>> {
  try {
    if (!(await dependencies.allowRead())) {
      return GEO_UNAVAILABLE;
    }
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
      return safeRead(dependencies, () => dependencies.loadProvinces());
    },
    districts(
      provinceId: unknown,
    ): Promise<CheckoutGeoPublicResult<PancakeDistrict>> {
      return safeRead(dependencies, () => dependencies.loadDistricts(provinceId));
    },
    communes(
      provinceId: unknown,
      districtId: unknown,
    ): Promise<CheckoutGeoPublicResult<PancakeCommune>> {
      return safeRead(dependencies, () =>
        dependencies.loadCommunes(provinceId, districtId),
      );
    },
  };
}
