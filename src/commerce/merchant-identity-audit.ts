/**
 * M1 — read-only Merchant identity and durability audit.
 *
 * Answers what the mirrored catalog can prove today about the identifiers a Merchant feed would
 * emit, and is deliberately unable to answer what it cannot. It asserts no vendor format: which
 * shape a Pancake identifier takes is an observation to record, not a rule to enforce, and encoding
 * a guess here would turn an audit into an assumption.
 *
 * Three things it will not do:
 *
 *   - infer a GTIN. `pancakeBarcode` is a field name, not proof of a GTIN, and the audit does not
 *     read it at all rather than tempt a later reader;
 *   - invent `gender`, `age_group` or `condition`. Those are owner-approved apparel facts (O3), so
 *     they are reported as an explicit blocked state rather than derived from a name or a category;
 *   - declare identifier durability. Current DB uniqueness and upsert behaviour are explicitly
 *     insufficient evidence, so the verdict stays blocked until upstream lifetime evidence exists.
 *
 * Composites are excluded from the emittable set with `COMPOSITE_DEFERRED`: a component sold through
 * a parent set has no proven durable Merchant family identity, and that is a separate design.
 */

import { parseTrustedProductImageUrl } from "./product-media.ts";
import { resolveStorefrontPrice } from "./storefront-product.ts";

/** Matches the existing Pancake catalog audit bound so one contract governs identifier length. */
export const MAX_EXTERNAL_IDENTIFIER_LENGTH = 512;

export type ExternalIdentifierClass =
  | "PRESENT"
  | "MISSING"
  | "BLANK"
  | "UNTRIMMED"
  | "TOO_LONG";

const CLASSES: readonly ExternalIdentifierClass[] = [
  "PRESENT",
  "MISSING",
  "BLANK",
  "UNTRIMMED",
  "TOO_LONG",
];

export type MerchantIdentityRow = Readonly<{
  pancakeVariationId: string | null;
  pancakeProductId: string | null;
  /** Candidate MPN. Nullable and not database-unique, which is why it needs auditing. */
  sku: string | null;
  isComposite: boolean;
  isStorefrontVisible: boolean;
  /** Mirrored money, audited through the live storefront price rule rather than re-derived here. */
  retailPrice: number | null;
  retailPriceAfterDiscount: number | null;
  /** Summed across warehouses. Availability is a fact to report, not a reason to exclude a record. */
  stockQuantity: number;
  primaryImageUrl: string | null;
  title: string | null;
  /** Only what the storefront would actually publish; a Draft description is not a Merchant fact. */
  publishedDescription: string | null;
}>;

/**
 * Whether a record has a price the website would publish *today*.
 *
 * Deliberately the live `resolveStorefrontPrice` rule and not a second one: an audit that used a
 * different definition of a usable price would report a readiness the storefront does not share.
 * That rule is currently equality-gated on the mirrored Pancake fields pending W3 evidence, so this
 * count moves when that gate does — which is the point of measuring it.
 */
export type PriceReadiness = "READY" | "PRICE_UNRESOLVED";

export type AvailabilityClass = "IN_STOCK" | "OUT_OF_STOCK";

/** Media trust is the storefront's own parser; an untrusted host is not a Merchant image. */
export type MediaReadiness = "READY" | "MISSING" | "UNTRUSTED";

/**
 * `MALFORMED` is not a style judgement. It means text that cannot be serialized as XML 1.0 text;
 * XML-illegal code points and lone surrogates cannot be repaired by escaping.
 */
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
  /** True only when every emittable variation has a present, unique SKU. */
  mpnReady: boolean;
  price: Readonly<Record<PriceReadiness, number>>;
  availability: Readonly<Record<AvailabilityClass, number>>;
  media: Readonly<Record<MediaReadiness, number>>;
  title: Readonly<Record<TextReadiness, number>>;
  description: Readonly<Record<TextReadiness, number>>;
  /**
   * Emittable variations with a publishable price, a trusted image and serializable title and
   * description. Availability is excluded on purpose: an out-of-stock offer is still a valid
   * Merchant record, it simply carries `out_of_stock`.
   */
  merchantFactsReady: number;
  /**
   * Owner-gated apparel attributes (O3). Constants, never derived: guessing `gender` from a product
   * name is exactly the kind of invention that puts wrong data in front of shoppers.
   */
  apparelFacts: Readonly<{
    gender: "OWNER_BLOCKED";
    ageGroup: "OWNER_BLOCKED";
    condition: "OWNER_BLOCKED";
    verdict: "BLOCKED";
  }>;
  durability: Readonly<{
    /** Proven here: the mirror reconciles rows by external id, not by slug, position or local id. */
    mirrorReconcilesByExternalId: boolean;
    /** Needs upstream contract or repeated-resync evidence from an approved context. */
    upstreamLifetimeProven: boolean;
    verdict: "BLOCKED" | "PROVEN";
  }>;
}>;

export function classifyExternalIdentifier(value: string | null): ExternalIdentifierClass {
  if (value === null || value.length === 0) return "MISSING";
  if (value.trim().length === 0) return "BLANK";
  if (value.length > MAX_EXTERNAL_IDENTIFIER_LENGTH) return "TOO_LONG";
  if (value !== value.trim()) return "UNTRIMMED";
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
  // Fail-safe: a non-finite or negative mirrored quantity is not evidence of stock.
  return Number.isFinite(stockQuantity) && stockQuantity > 0 ? "IN_STOCK" : "OUT_OF_STOCK";
}

export function classifyMerchantMedia(primaryImageUrl: string | null): MediaReadiness {
  if (primaryImageUrl === null || primaryImageUrl.trim().length === 0) return "MISSING";
  return parseTrustedProductImageUrl(primaryImageUrl) === null ? "UNTRUSTED" : "READY";
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
  const availability = countsFor<AvailabilityClass>(["IN_STOCK", "OUT_OF_STOCK"]);
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
    // Only what would actually be emitted is audited. A hidden variation's missing SKU is not a
    // Merchant problem, and counting it would produce a verdict nobody can act on.
    if (!row.isStorefrontVisible) continue;

    emittableStandaloneVariations += 1;

    const variationClass = classifyExternalIdentifier(row.pancakeVariationId);
    variationIdentifiers[variationClass] += 1;
    if (variationClass === "PRESENT") emittableVariationIds.push(row.pancakeVariationId as string);

    // One product family is counted once however many of its variations are emitted.
    const productId = row.pancakeProductId;
    if (productId === null || !seenProductIds.has(productId)) {
      productIdentifiers[classifyExternalIdentifier(productId)] += 1;
      if (productId !== null) seenProductIds.add(productId);
    }

    const skuClass = classifyExternalIdentifier(row.sku);
    sku[skuClass] += 1;
    if (skuClass === "PRESENT") emittableSkus.push(row.sku as string);

    const priceClass = classifyMerchantPrice(row);
    const mediaClass = classifyMerchantMedia(row.primaryImageUrl);
    const titleClass = classifyMerchantText(row.title);
    const descriptionClass = classifyMerchantText(row.publishedDescription);
    price[priceClass] += 1;
    availability[classifyMerchantAvailability(row.stockQuantity)] += 1;
    media[mediaClass] += 1;
    title[titleClass] += 1;
    description[descriptionClass] += 1;
    if (
      priceClass === "READY"
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
    mpnReady: sku.PRESENT === emittableStandaloneVariations && duplicateSkus.length === 0,
    price: Object.freeze(price),
    availability: Object.freeze(availability),
    media: Object.freeze(media),
    title: Object.freeze(title),
    description: Object.freeze(description),
    merchantFactsReady,
    apparelFacts: Object.freeze({
      // O3 is an owner decision. Deriving these from a product name or category is precisely the
      // invention the spec forbids, so they are constants that stay blocked until a human supplies
      // the approved source of truth.
      gender: "OWNER_BLOCKED" as const,
      ageGroup: "OWNER_BLOCKED" as const,
      condition: "OWNER_BLOCKED" as const,
      verdict: "BLOCKED" as const,
    }),
    durability: Object.freeze({
      mirrorReconcilesByExternalId: true,
      // Nothing this audit can read establishes that an upstream object keeps its id for its
      // lifetime. That needs a provider contract or repeated full-catalog resync evidence from an
      // approved context, so the verdict is a constant here rather than a computed hope.
      upstreamLifetimeProven: false,
      verdict: "BLOCKED" as const,
    }),
  });
}
