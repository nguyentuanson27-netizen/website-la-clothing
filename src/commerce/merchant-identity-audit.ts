/**
 * M1 — read-only Merchant identity and durability audit.
 *
 * Answers what the mirrored catalog can prove today about the identifiers a Merchant feed would
 * emit, and is deliberately unable to answer what it cannot.
 *
 * It enforces Google Merchant Center format and character constraints for offer IDs, combined with
 * LA Clothing's stricter fail-closed policy: invalid control/format/private-use/unassigned Unicode,
 * malformed UTF-16, supplementary-plane code points represented by surrogate pairs, and whitespace
 * in `id` / `item_group_id` are rejected. Length bounds are 50 Unicode code points for ID and 70
 * Unicode code points for MPN. The same conservative Unicode safety boundary is applied to MPN.
 *
 * Three things it will not do:
 *
 *   - infer a GTIN. `pancakeBarcode` is a field name, not proof of a GTIN, and the audit does not
 *     read it at all rather than tempt a later reader;
 *   - invent `gender`, `age_group` or `condition`. Those are owner-approved apparel facts (O3), so
 *     they are reported as an explicit blocked state rather than derived from a name or category;
 *   - declare identifier durability. Current DB uniqueness and upsert behaviour are explicitly
 *     insufficient evidence, so the verdict stays blocked until upstream lifetime evidence exists.
 *
 * Composites are excluded from the emittable set with `COMPOSITE_DEFERRED`.
 */

import { resolveStorefrontProductMedia } from "./product-media.ts";
import { resolveStorefrontPrice } from "./storefront-product.ts";

/** Matches the existing Pancake catalog audit bound for generic external identifiers. */
export const MAX_EXTERNAL_IDENTIFIER_LENGTH = 512;

/** Google Merchant Center specification: offer id and item_group_id are limited to 50 characters. */
export const MERCHANT_ID_MAX_LENGTH = 50;

/** Google Merchant Center specification: manufacturer part number (mpn) is limited to 70 characters. */
export const MERCHANT_MPN_MAX_LENGTH = 70;

export type ExternalIdentifierClass =
  | "PRESENT"
  | "MISSING"
  | "BLANK"
  | "UNTRIMMED"
  | "TOO_LONG"
  | "INVALID_FORMAT";

const CLASSES: readonly ExternalIdentifierClass[] = [
  "PRESENT",
  "MISSING",
  "BLANK",
  "UNTRIMMED",
  "TOO_LONG",
  "INVALID_FORMAT",
];

export type MerchantIdentityRow = Readonly<{
  pancakeVariationId: string | null;
  pancakeProductId: string | null;
  /**
   * Candidate manufacturer MPN. The M1 repository sources this from mirrored Pancake
   * `pancakeDisplayId`; it is intentionally not the website-owned `VariantMirror.sku` field.
   * The summary keeps the historical `sku` key for report compatibility.
   */
  sku: string | null;
  isComposite: boolean;
  isStorefrontVisible: boolean;
  /** Mirrored money, audited through the live storefront price rule rather than re-derived here. */
  retailPrice: number | null;
  retailPriceAfterDiscount: number | null;
  /** Valid summed stock, or NaN when any source warehouse quantity is unsafe/unresolved. */
  stockQuantity: number;
  primaryImageUrl: string | null;
  /** Product-level storefront media candidates from all active/present variants, in resolver order. */
  variantImageUrls?: readonly unknown[] | null;
  title: string | null;
  /** Only what the storefront would actually publish; a Draft description is not a Merchant fact. */
  publishedDescription: string | null;
}>;

export type PriceReadiness = "READY" | "PRICE_UNRESOLVED";
export type AvailabilityClass = "IN_STOCK" | "OUT_OF_STOCK" | "AVAILABILITY_UNRESOLVED";
export type MediaReadiness = "READY" | "MISSING" | "UNTRUSTED";
export type TextReadiness = "READY" | "MISSING" | "MALFORMED";
export type DuplicateIdentifier = Readonly<{ value: string; occurrences: number }>;

export type MerchantIdentitySummary = Readonly<{
  totalVariations: number;
  compositeDeferred: number;
  emittableStandaloneVariations: number;
  variationIdentifiers: Readonly<Record<ExternalIdentifierClass, number>>;
  productIdentifiers: Readonly<Record<ExternalIdentifierClass, number>>;
  sku: Readonly<Record<ExternalIdentifierClass, number>>;
  duplicateVariationIds: readonly DuplicateIdentifier[];
  duplicateSkus: readonly DuplicateIdentifier[];
  /** True only when every emittable variation has a present, unique manufacturer SKU/MPN. */
  mpnReady: boolean;
  price: Readonly<Record<PriceReadiness, number>>;
  availability: Readonly<Record<AvailabilityClass, number>>;
  media: Readonly<Record<MediaReadiness, number>>;
  title: Readonly<Record<TextReadiness, number>>;
  description: Readonly<Record<TextReadiness, number>>;
  merchantFactsReady: number;
  apparelFacts: Readonly<{
    policy: "RESOLVED";
    productOverrides: "NOT_IMPLEMENTED";
    verdict: "BLOCKED";
  }>;
  durability: Readonly<{
    mirrorReconcilesByExternalId: boolean;
    upstreamLifetimeProven: boolean;
    verdict: "BLOCKED" | "PROVEN";
  }>;
}>;

export type ClassifyIdentifierOptions = {
  maxLength?: number;
  allowWhitespace?: boolean;
};

/**
 * Google Merchant invalid-Unicode examples for `id` include controls, format characters,
 * private-use/unassigned code points and surrogate pairs. The shared M1 validator applies that
 * conservative boundary to every Merchant identifier candidate, including MPN.
 */
const INVALID_MERCHANT_UNICODE_REGEX = /\p{Cc}|\p{Cf}|\p{Co}|\p{Cn}/u;
const SUPPLEMENTARY_CODE_POINT_REGEX = /[\u{10000}-\u{10FFFF}]/u;

export function hasInvalidMerchantUnicode(value: string): boolean {
  if (typeof value.isWellFormed === "function" && !value.isWellFormed()) {
    return true;
  }
  if (SUPPLEMENTARY_CODE_POINT_REGEX.test(value)) {
    return true;
  }
  return INVALID_MERCHANT_UNICODE_REGEX.test(value);
}

function unicodeCodePointLength(value: string): number {
  return Array.from(value).length;
}

export function classifyExternalIdentifier(
  value: string | null,
  options?: number | ClassifyIdentifierOptions,
): ExternalIdentifierClass {
  const maxLength =
    typeof options === "number" ? options : (options?.maxLength ?? MAX_EXTERNAL_IDENTIFIER_LENGTH);
  const allowWhitespace =
    typeof options === "number" ? true : (options?.allowWhitespace ?? true);

  if (value === null || value.length === 0) return "MISSING";
  if (value.trim().length === 0) return "BLANK";
  if (value !== value.trim()) return "UNTRIMMED";
  if (unicodeCodePointLength(value) > maxLength) return "TOO_LONG";

  // Google says to avoid whitespace and may normalize it. LA Clothing deliberately refuses to rely
  // on that normalization for offer ID and item_group_id: any whitespace is rejected fail-closed.
  if (!allowWhitespace && /\s/.test(value)) return "INVALID_FORMAT";

  if (hasInvalidMerchantUnicode(value)) return "INVALID_FORMAT";

  return "PRESENT";
}

/** XML 1.0 Fifth Edition `Char`: #x9 | #xA | #xD | #x20-#xD7FF | #xE000-#xFFFD | #x10000-#x10FFFF. */
function isXml10Text(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) return false;

    const allowed =
      codePoint === 0x09
      || codePoint === 0x0a
      || codePoint === 0x0d
      || (codePoint >= 0x20 && codePoint <= 0xd7ff)
      || (codePoint >= 0xe000 && codePoint <= 0xfffd)
      || (codePoint >= 0x10000 && codePoint <= 0x10ffff);

    if (!allowed) return false;
  }

  return true;
}

export function classifyMerchantText(value: string | null): TextReadiness {
  if (value === null || value.trim().length === 0) return "MISSING";
  if (!isXml10Text(value)) return "MALFORMED";
  return "READY";
}

export function classifyMerchantPrice(row: MerchantIdentityRow): PriceReadiness {
  const price = resolveStorefrontPrice({
    retailPrice: row.retailPrice,
    retailPriceAfterDiscount: row.retailPriceAfterDiscount,
  });
  return price === null ? "PRICE_UNRESOLVED" : "READY";
}

export function classifyMerchantAvailability(stockQuantity: number): AvailabilityClass {
  if (!Number.isFinite(stockQuantity) || stockQuantity < 0) return "AVAILABILITY_UNRESOLVED";
  return stockQuantity > 0 ? "IN_STOCK" : "OUT_OF_STOCK";
}

function normalizeVariantImageUrls(
  variantImageUrls: readonly unknown[] | null | undefined,
): readonly string[] {
  if (!Array.isArray(variantImageUrls)) return [];
  return variantImageUrls.filter((candidate): candidate is string => typeof candidate === "string");
}

/**
 * Merchant media readiness delegates trusted-image selection to the exact storefront product
 * resolver. `variantImageUrls` is the ordered product-level candidate set assembled from all
 * active/present variants of the product, not merely the current variation's own image list.
 */
export function classifyMerchantMedia(
  primaryImageUrl: string | null,
  variantImageUrls?: readonly unknown[] | null,
): MediaReadiness {
  const productVariantImageUrls = normalizeVariantImageUrls(variantImageUrls);
  const resolved = resolveStorefrontProductMedia({
    productName: "Merchant audit",
    primaryImageUrl,
    variantImageUrls: [productVariantImageUrls],
  });

  if (resolved.primary !== null) return "READY";

  const hasPrimaryCandidate =
    typeof primaryImageUrl === "string" && primaryImageUrl.trim().length > 0;
  const hasVariantCandidate = productVariantImageUrls.some((candidate) => candidate.trim().length > 0);

  return hasPrimaryCandidate || hasVariantCandidate ? "UNTRUSTED" : "MISSING";
}

function countsFor<TClass extends string>(names: readonly TClass[]): Record<TClass, number> {
  return Object.fromEntries(names.map((name) => [name, 0])) as Record<TClass, number>;
}

function emptyCounts(): Record<ExternalIdentifierClass, number> {
  return Object.fromEntries(CLASSES.map((name) => [name, 0])) as Record<
    ExternalIdentifierClass,
    number
  >;
}

function duplicatesOf(values: readonly string[]): DuplicateIdentifier[] {
  const occurrences = new Map<string, number>();
  for (const value of values) occurrences.set(value, (occurrences.get(value) ?? 0) + 1);

  return [...occurrences.entries()]
    .filter(([, count]) => count > 1)
    .map(([value, count]) => Object.freeze({ value, occurrences: count }))
    .sort((left, right) => left.value.localeCompare(right.value));
}

export function summarizeMerchantIdentity(
  rows: readonly MerchantIdentityRow[],
): MerchantIdentitySummary {
  const variationIdentifiers = emptyCounts();
  const productIdentifiers = emptyCounts();
  const sku = emptyCounts();

  const price = countsFor<PriceReadiness>(["READY", "PRICE_UNRESOLVED"]);
  const availability = countsFor<AvailabilityClass>([
    "IN_STOCK",
    "OUT_OF_STOCK",
    "AVAILABILITY_UNRESOLVED",
  ]);
  const media = countsFor<MediaReadiness>(["READY", "MISSING", "UNTRUSTED"]);
  const title = countsFor<TextReadiness>(["READY", "MISSING", "MALFORMED"]);
  const description = countsFor<TextReadiness>(["READY", "MISSING", "MALFORMED"]);
  let merchantFactsReady = 0;

  let compositeDeferred = 0;
  const emittableVariationIds: string[] = [];
  const emittableSkus: string[] = [];
  const seenProductIds = new Set<string>();
  let emittableStandaloneVariations = 0;

  for (const row of rows) {
    if (row.isComposite) {
      compositeDeferred += 1;
      continue;
    }
    if (!row.isStorefrontVisible) continue;

    emittableStandaloneVariations += 1;

    const variationClass = classifyExternalIdentifier(row.pancakeVariationId, {
      maxLength: MERCHANT_ID_MAX_LENGTH,
      allowWhitespace: false,
    });
    variationIdentifiers[variationClass] += 1;
    if (variationClass === "PRESENT") emittableVariationIds.push(row.pancakeVariationId as string);

    const productId = row.pancakeProductId;
    if (productId === null || !seenProductIds.has(productId)) {
      productIdentifiers[
        classifyExternalIdentifier(productId, {
          maxLength: MERCHANT_ID_MAX_LENGTH,
          allowWhitespace: false,
        })
      ] += 1;
      if (productId !== null) seenProductIds.add(productId);
    }

    const skuClass = classifyExternalIdentifier(row.sku, {
      maxLength: MERCHANT_MPN_MAX_LENGTH,
      allowWhitespace: true,
    });
    sku[skuClass] += 1;
    if (skuClass === "PRESENT") emittableSkus.push(row.sku as string);

    const priceClass = classifyMerchantPrice(row);
    const availabilityClass = classifyMerchantAvailability(row.stockQuantity);
    const mediaClass = classifyMerchantMedia(row.primaryImageUrl, row.variantImageUrls);
    const titleClass = classifyMerchantText(row.title);
    const descriptionClass = classifyMerchantText(row.publishedDescription);
    price[priceClass] += 1;
    availability[availabilityClass] += 1;
    media[mediaClass] += 1;
    title[titleClass] += 1;
    description[descriptionClass] += 1;

    if (
      priceClass === "READY"
      && availabilityClass !== "AVAILABILITY_UNRESOLVED"
      && mediaClass === "READY"
      && titleClass === "READY"
      && descriptionClass === "READY"
    ) {
      merchantFactsReady += 1;
    }
  }

  const duplicateVariationIds = duplicatesOf(emittableVariationIds);
  const duplicateSkus = duplicatesOf(emittableSkus);

  return Object.freeze({
    totalVariations: rows.length,
    compositeDeferred,
    emittableStandaloneVariations,
    variationIdentifiers: Object.freeze(variationIdentifiers),
    productIdentifiers: Object.freeze(productIdentifiers),
    sku: Object.freeze(sku),
    duplicateVariationIds: Object.freeze(duplicateVariationIds),
    duplicateSkus: Object.freeze(duplicateSkus),
    mpnReady:
      emittableStandaloneVariations > 0
      && sku.PRESENT === emittableStandaloneVariations
      && duplicateSkus.length === 0,
    price: Object.freeze(price),
    availability: Object.freeze(availability),
    media: Object.freeze(media),
    title: Object.freeze(title),
    description: Object.freeze(description),
    merchantFactsReady,
    apparelFacts: Object.freeze({
      policy: "RESOLVED" as const,
      productOverrides: "NOT_IMPLEMENTED" as const,
      verdict: "BLOCKED" as const,
    }),
    durability: Object.freeze({
      mirrorReconcilesByExternalId: true,
      upstreamLifetimeProven: false,
      verdict: "BLOCKED" as const,
    }),
  });
}
