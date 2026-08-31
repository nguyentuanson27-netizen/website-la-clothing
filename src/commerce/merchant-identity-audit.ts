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
 *   - invent `gender`, `age_group` or `condition`. Those are owner-approved apparel facts (O3);
 *   - declare identifier durability. Current DB uniqueness and upsert behaviour are explicitly
 *     insufficient evidence, so the verdict stays blocked until upstream lifetime evidence exists.
 *
 * Composites are excluded from the emittable set with `COMPOSITE_DEFERRED`: a component sold through
 * a parent set has no proven durable Merchant family identity, and that is a separate design.
 */

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
}>;

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
