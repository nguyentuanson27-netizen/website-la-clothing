/**
 * Server Action input parsing and boundary validation for promotion admin mutations.
 *
 * Boundary principles:
 * - Trimming preserves string boundaries without truncating identifiers.
 * - Oversized identifiers are preserved so domain validator can reject with IDENTIFIER_TOO_LONG.
 * - Money inputs must be strict positive decimal representations, never sanitized into altered amounts.
 */

import {
  MAX_TARGETS_PER_CAMPAIGN,
  type CampaignTargetInput,
} from "./promotion-activation.ts";

export type ParsedDiscountResult =
  | Readonly<{
      ok: true;
      discountType: "PERCENTAGE" | "FIXED_PRICE";
      percentageValue: number | null;
      fixedPriceVnd: bigint | null;
    }>
  | Readonly<{
      ok: false;
      reason: "MALFORMED_FIXED_PRICE" | "INVALID_PERCENTAGE";
    }>;

export function parseTargets(formData: FormData): CampaignTargetInput[] {
  const targetProductIds = formData
    .getAll("targetProductId")
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());

  const targetVariantIds = formData
    .getAll("targetVariantId")
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());

  const targets: CampaignTargetInput[] = [
    ...targetProductIds.map((id) => ({ productId: id, variantId: null })),
    ...targetVariantIds.map((id) => ({ productId: null, variantId: id })),
  ];

  // Bounded row count protection: take up to MAX_TARGETS_PER_CAMPAIGN + 1 so domain validator can catch TOO_MANY_TARGETS
  return targets.slice(0, MAX_TARGETS_PER_CAMPAIGN + 1);
}

export function parseDiscountInputs(formData: FormData): ParsedDiscountResult {
  const discountType = formData.get("discountType") === "FIXED_PRICE" ? "FIXED_PRICE" : "PERCENTAGE";

  if (discountType === "PERCENTAGE") {
    const raw = formData.get("percentageValue");
    if (typeof raw !== "string" || raw.trim().length === 0) {
      return { ok: true, discountType, percentageValue: null, fixedPriceVnd: null };
    }
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) {
      return { ok: false, reason: "INVALID_PERCENTAGE" };
    }
    const num = Number(trimmed);
    if (!Number.isSafeInteger(num) || num < 1 || num > 99) {
      return { ok: false, reason: "INVALID_PERCENTAGE" };
    }
    return { ok: true, discountType, percentageValue: num, fixedPriceVnd: null };
  }

  // FIXED_PRICE
  const raw = formData.get("fixedPriceVnd");
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: true, discountType, percentageValue: null, fixedPriceVnd: null };
  }

  const trimmed = raw.trim();
  // Strict positive decimal integer representation: digits only, non-zero, no leading zeros
  if (!/^[1-9]\d*$/.test(trimmed)) {
    return { ok: false, reason: "MALFORMED_FIXED_PRICE" };
  }

  try {
    const fixedPriceVnd = BigInt(trimmed);
    return { ok: true, discountType, percentageValue: null, fixedPriceVnd };
  } catch {
    return { ok: false, reason: "MALFORMED_FIXED_PRICE" };
  }
}

export function parseVietnamDateTime(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}:00+07:00`.slice(0, 25));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
