import { parseGuestCheckoutInput } from "./guest-checkout-input.ts";
import type {
  PancakeCommune,
  PancakeDistrict,
  PancakeProvince,
} from "../integrations/pancake/geo.ts";

type CheckoutGeoValidationDependencies = Readonly<{
  loadProvinces(): Promise<PancakeProvince[]>;
  loadDistricts(provinceId: unknown): Promise<PancakeDistrict[]>;
  loadCommunes(provinceId: unknown, districtId: unknown): Promise<PancakeCommune[]>;
}>;

const INVALID_INPUT = Object.freeze({
  ok: false as const,
  reason: "INVALID_INPUT" as const,
});

export async function validateCheckoutGeoSelection(
  dependencies: CheckoutGeoValidationDependencies,
  input: unknown,
) {
  const parsed = parseGuestCheckoutInput(input);
  if (!parsed.ok) {
    return INVALID_INPUT;
  }

  const { provinceRef, districtRef, communeRef } = parsed.value;

  const provinces = await dependencies.loadProvinces();
  if (!provinces.some((province) => province.id === provinceRef)) {
    return INVALID_INPUT;
  }

  const districts = await dependencies.loadDistricts(provinceRef);
  if (!districts.some((district) => district.id === districtRef)) {
    return INVALID_INPUT;
  }

  const communes = await dependencies.loadCommunes(provinceRef, districtRef);
  if (!communes.some((commune) => commune.id === communeRef)) {
    return INVALID_INPUT;
  }

  return {
    ok: true as const,
    checkoutInput: parsed.value,
  };
}
