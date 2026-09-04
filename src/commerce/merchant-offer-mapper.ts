/**
 * U25 / #153 M3 — the deterministic standalone Merchant offer mapper.
 *
 * One pure function turns canonical storefront facts into Merchant items. It owns no pricing, no
 * stock semantics, no media trust boundary, no addressing contract and no apparel policy: every one
 * of those already has an authority in this repository, and the mapper's job is to consume them in
 * the right order and refuse to emit anything it cannot substantiate.
 *
 *   canonical catalog/storefront facts
 *           |
 *   effective Merchant facts   (this module)
 *           |
 *   Merchant item  |  excluded candidate + bounded reasons
 *
 * The authorities it consumes, and why each is not re-derived here:
 *
 *   - price comes from the projection option, which the caller built with the shared promotional
 *     pricing rule the storefront charges from. A feed that recomputed a discount would be the
 *     second money formula #151 exists to prevent;
 *   - availability is `classifyMerchantAvailability`, the M1 Merchant stock semantics, so feed
 *     counts reconcile with the audited M1 numbers rather than describing a different catalog;
 *   - the landing URL is built and then *proved* by U12's own resolver: the mapper asks
 *     `resolveDeepLinkedVariantSelection` whether this exact identity resolves to this exact option
 *     on this product, so an offer link can never point at a page that would not preselect it;
 *   - media is whatever the trusted storefront resolver already returned. Raw Pancake URLs never
 *     reach this module;
 *   - identity, MPN and text safety are the M1 classifiers, under ADR 0008 for the MPN source;
 *   - apparel facts are ADR 0007's resolver, which cannot see catalog text at all.
 *
 * Three things it will not do, and one it cannot:
 *
 *   - it will not fall back from a missing `pancakeDisplayId` to the website-owned
 *     `VariantMirror.sku`. That field is not an input;
 *   - it will not emit `gtin`. A Pancake barcode is a field name, not a proof of identifier type,
 *     format and check digit, so no barcode is an input either;
 *   - it will not invent a description, a price or a stock state to make a row publishable;
 *   - and it cannot query anything. It is handed a bounded, already-loaded candidate set, so a feed
 *     of 5,000 offers costs the same number of round trips as a feed of five.
 *
 * Composite offers stay `COMPOSITE_DEFERRED` for Merchant v1, exactly as M1 audited them.
 */

import {
  classifyExternalIdentifier,
  classifyMerchantAvailability,
  classifyMerchantText,
  MERCHANT_ID_MAX_LENGTH,
  MERCHANT_MPN_MAX_LENGTH,
} from "./merchant-identity-audit.ts";
import {
  APPAREL_FACT_UNRESOLVED,
  resolveEffectiveApparelFacts,
  type MerchantAgeGroup,
  type MerchantApparelOverrides,
  type MerchantCondition,
  type MerchantGender,
} from "./merchant-apparel-facts.ts";
import type { StorefrontProductMedia } from "./product-media.ts";
import type {
  StorefrontProductProjection,
  StorefrontProjectionOption,
} from "./storefront-projection.ts";
import {
  buildStandaloneVariantDeepLinkPath,
  resolveDeepLinkedVariantSelection,
} from "./storefront-variant-deep-link.ts";

/** LA Clothing is the brand owner; there is no per-product brand fact to resolve. */
export const MERCHANT_BRAND = "LA Clothing";

/** Google Merchant accepts at most ten `additional_image_link` values per offer. */
export const MAX_MERCHANT_ADDITIONAL_IMAGES = 10;

export const MERCHANT_MARKET_UNRESOLVED = "MERCHANT_MARKET_UNRESOLVED";

export type MerchantAvailability = "in_stock" | "out_of_stock";

export type MerchantExclusionReason =
  | "COMPOSITE_DEFERRED"
  | "OFFER_ID_UNRESOLVED"
  | "ITEM_GROUP_ID_UNRESOLVED"
  | "MPN_UNRESOLVED"
  | typeof APPAREL_FACT_UNRESOLVED
  | "OPTION_NOT_ADDRESSABLE"
  | "LANDING_URL_UNRESOLVED"
  | "PRICE_UNRESOLVED"
  | "AVAILABILITY_UNRESOLVED"
  | "MEDIA_UNRESOLVED"
  | "TITLE_UNRESOLVED"
  | "DESCRIPTION_UNRESOLVED"
  | "OFFER_ID_DUPLICATE"
  | "MPN_DUPLICATE";

/**
 * The canonical reason order.
 *
 * Diagnostics are part of the contract, not debug output: a fixed order means the same catalog
 * produces the same excluded list on every run, which is what lets an operator diff two audits and
 * see a real change rather than a reshuffle.
 */
const REASON_ORDER: readonly MerchantExclusionReason[] = [
  "COMPOSITE_DEFERRED",
  "OFFER_ID_UNRESOLVED",
  "ITEM_GROUP_ID_UNRESOLVED",
  "MPN_UNRESOLVED",
  APPAREL_FACT_UNRESOLVED,
  "OPTION_NOT_ADDRESSABLE",
  "LANDING_URL_UNRESOLVED",
  "PRICE_UNRESOLVED",
  "AVAILABILITY_UNRESOLVED",
  "MEDIA_UNRESOLVED",
  "TITLE_UNRESOLVED",
  "DESCRIPTION_UNRESOLVED",
  "OFFER_ID_DUPLICATE",
  "MPN_DUPLICATE",
];

export type MerchantCandidateVariation = Readonly<{
  /** Internal `VariantMirror.id`. Aligns per-variant media and nothing else; never emitted. */
  variantId: string;
  /** External Merchant offer identity. */
  pancakeVariationId: string | null;
  /** ADR 0008 manufacturer MPN candidate, mirrored from the Pancake variation `display_id`. */
  pancakeDisplayId: string | null;
  /** Parent of, or component in, a composite set. Either side is deferred in Merchant v1. */
  isComposite: boolean;
  /** Summed warehouse stock under M1 availability semantics; `NaN` when any source is unsafe. */
  stockQuantity: number;
}>;

export type MerchantCandidateProduct = Readonly<{
  /** External Merchant `item_group_id`. */
  pancakeProductId: string | null;
  slug: string;
  name: string;
  /** Only what the storefront publishes. A Draft description is not a Merchant fact. */
  publishedDescription: string | null;
  /** Output of the trusted storefront media resolver, not raw mirrored URLs. */
  media: StorefrontProductMedia;
  /** Canonical variant-to-gallery mapping, keyed by internal `VariantMirror.id`. */
  galleryIndexByVariantId: ReadonlyMap<string, number>;
  /** The projection the product page builds, priced by the shared promotional rule. */
  projection: StorefrontProductProjection;
  /** ADR 0007 website-owned overrides; `null` on a field means inherit the shop default. */
  apparelOverrides: MerchantApparelOverrides;
  variations: readonly MerchantCandidateVariation[];
}>;

export type MerchantOffer = Readonly<{
  id: string;
  itemGroupId: string;
  brand: typeof MERCHANT_BRAND;
  mpn: string;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  additionalImageLinks: readonly string[];
  availability: MerchantAvailability;
  /**
   * The effective storefront price in Vietnamese dong, which is the denomination the mirrored
   * catalog holds. Turning it into a Merchant `price` string with an ISO currency belongs to the
   * market declaration below, and therefore waits on owner gate O2.
   */
  priceVnd: number;
  gender: MerchantGender;
  ageGroup: MerchantAgeGroup;
  condition: MerchantCondition;
  color: string | null;
  size: string | null;
}>;

/** Bounded, non-PII diagnostics: external identity and reasons, never catalog content. */
export type MerchantExcludedCandidate = Readonly<{
  pancakeVariationId: string | null;
  itemGroupId: string | null;
  reasons: readonly MerchantExclusionReason[];
}>;

/**
 * Owner gate O2 — target market, content language and feed currency.
 *
 * Vietnam / Vietnamese / VND is the *proposed* value in the source plan, not an approved one, so no
 * value is hard-coded here. Until an owner approval lands, `resolveMerchantMarket` reports the
 * market unresolved and `activationBlockedReasons` carries that state to every consumer.
 */
export type MerchantMarketPolicy = Readonly<{
  /** ISO 3166-1 alpha-2, uppercase. */
  targetCountry: string;
  /** ISO 639-1, lowercase. */
  contentLanguage: string;
  /** ISO 4217, uppercase. */
  currency: string;
}>;

export type MerchantMarketResolution =
  | Readonly<{ status: "APPROVED"; policy: MerchantMarketPolicy }>
  | Readonly<{ status: "UNRESOLVED"; reason: typeof MERCHANT_MARKET_UNRESOLVED }>;

/** No owner approval exists for O2 yet. Changing this is an owner decision, not a code change. */
export const APPROVED_MERCHANT_MARKET: MerchantMarketPolicy | null = null;

export function resolveMerchantMarket(
  candidate: MerchantMarketPolicy | null | undefined,
): MerchantMarketResolution {
  const unresolved = Object.freeze({
    status: "UNRESOLVED" as const,
    reason: MERCHANT_MARKET_UNRESOLVED,
  });

  if (candidate === null || candidate === undefined || typeof candidate !== "object") {
    return unresolved;
  }

  const { targetCountry, contentLanguage, currency } = candidate;
  if (
    typeof targetCountry !== "string"
    || !/^[A-Z]{2}$/.test(targetCountry)
    || typeof contentLanguage !== "string"
    || !/^[a-z]{2}$/.test(contentLanguage)
    || typeof currency !== "string"
    || !/^[A-Z]{3}$/.test(currency)
  ) {
    return unresolved;
  }

  return Object.freeze({
    status: "APPROVED" as const,
    policy: Object.freeze({ targetCountry, contentLanguage, currency }),
  });
}

export type MerchantMappingResult = Readonly<{
  offers: readonly MerchantOffer[];
  excluded: readonly MerchantExcludedCandidate[];
  market: MerchantMarketResolution;
  /** Non-empty means Merchant must not be activated from this projection. */
  activationBlockedReasons: readonly string[];
}>;

type Draft = {
  readonly pancakeVariationId: string | null;
  readonly itemGroupId: string | null;
  readonly reasons: Set<MerchantExclusionReason>;
  readonly offer: MerchantOffer | null;
};

function requireAbsoluteOrigin(origin: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new TypeError("Merchant offer origin must be an absolute http(s) origin");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new TypeError("Merchant offer origin must be an absolute http(s) origin");
  }
  return parsed;
}

function isMerchantIdentifier(value: string | null, maxLength: number, allowWhitespace: boolean) {
  return (
    classifyExternalIdentifier(value, { maxLength, allowWhitespace }) === "PRESENT"
  );
}

/**
 * The trusted image for this exact variant, then the product's canonical primary as the fallback.
 *
 * Both come out of the same resolver, so the fallback is not a relaxation of the trust boundary —
 * it is the same product-level photography the storefront shows when a variant has none of its own.
 */
function resolveOfferImages(
  product: MerchantCandidateProduct,
  variantId: string,
): { imageLink: string | null; additionalImageLinks: readonly string[] } {
  const gallery = product.media.gallery;
  const index = product.galleryIndexByVariantId.get(variantId);
  const variantImage =
    index !== undefined && Number.isInteger(index) ? (gallery[index]?.url ?? null) : null;
  const imageLink = variantImage ?? product.media.primary?.url ?? null;

  if (imageLink === null) return { imageLink: null, additionalImageLinks: [] };

  const additionalImageLinks = gallery
    .map((image) => image.url)
    .filter((url) => url !== imageLink)
    .slice(0, MAX_MERCHANT_ADDITIONAL_IMAGES);

  return { imageLink, additionalImageLinks };
}

/**
 * Proves the emitted link with the storefront's own resolver.
 *
 * Building the path is not enough: a path is only a landing page if the product page would resolve
 * that identity to that exact option. Asking U12 closes the whole hostile class at once — stale,
 * forged, another product's, deactivated, private, ambiguous and composite identities are all
 * simply absent from the authorized option list, and none of them can produce an offer URL.
 */
function resolveAddressableOption(
  product: MerchantCandidateProduct,
  variation: MerchantCandidateVariation,
): StorefrontProjectionOption | null {
  if (variation.pancakeVariationId === null) return null;

  const selection = resolveDeepLinkedVariantSelection({
    projection: product.projection,
    variantQuery: variation.pancakeVariationId,
  });
  if (selection === null || selection.variantId !== variation.variantId) return null;

  return (
    product.projection.options.find(
      (candidate) =>
        candidate.id === variation.variantId
        && candidate.pancakeVariationId === variation.pancakeVariationId,
    ) ?? null
  );
}

function draftCandidate(
  product: MerchantCandidateProduct,
  variation: MerchantCandidateVariation,
  origin: URL,
): Draft {
  const pancakeVariationId = variation.pancakeVariationId;

  // Composite is a whole-projection verdict as well as a per-variation one: a set's parent option
  // and its components are equally deferred, and reporting one reason keeps the excluded counts
  // reconcilable with the M1 audit rather than mixing a deferral with incidental readiness gaps.
  if (variation.isComposite || product.projection.mode !== "standalone") {
    return {
      pancakeVariationId,
      itemGroupId: product.pancakeProductId,
      reasons: new Set<MerchantExclusionReason>(["COMPOSITE_DEFERRED"]),
      offer: null,
    };
  }

  const reasons = new Set<MerchantExclusionReason>();

  const hasOfferId = isMerchantIdentifier(pancakeVariationId, MERCHANT_ID_MAX_LENGTH, false);
  if (!hasOfferId) reasons.add("OFFER_ID_UNRESOLVED");

  const hasItemGroupId = isMerchantIdentifier(
    product.pancakeProductId,
    MERCHANT_ID_MAX_LENGTH,
    false,
  );
  if (!hasItemGroupId) reasons.add("ITEM_GROUP_ID_UNRESOLVED");

  const hasMpn = isMerchantIdentifier(variation.pancakeDisplayId, MERCHANT_MPN_MAX_LENGTH, true);
  if (!hasMpn) reasons.add("MPN_UNRESOLVED");

  const apparel = resolveEffectiveApparelFacts(product.apparelOverrides);
  if (!apparel.ok) reasons.add(APPAREL_FACT_UNRESOLVED);

  const addressableOption = resolveAddressableOption(product, variation);
  if (addressableOption === null) reasons.add("OPTION_NOT_ADDRESSABLE");

  // Two reasons are reported only when they are the candidate's own fault rather than a consequence
  // of one already recorded: a landing URL cannot be blamed on a slug when the offer identity itself
  // is unusable, and a price cannot be called unresolved when no option was ever resolved to price.
  // Cascaded reasons would make every excluded row look like several independent defects.
  const path =
    hasOfferId && pancakeVariationId !== null
      ? buildStandaloneVariantDeepLinkPath({ slug: product.slug, pancakeVariationId })
      : null;
  if (hasOfferId && path === null) reasons.add("LANDING_URL_UNRESOLVED");

  const priceVnd = addressableOption?.price ?? null;
  if (addressableOption !== null && priceVnd === null) reasons.add("PRICE_UNRESOLVED");

  const availabilityClass = classifyMerchantAvailability(variation.stockQuantity);
  if (availabilityClass === "AVAILABILITY_UNRESOLVED") reasons.add("AVAILABILITY_UNRESOLVED");

  const { imageLink, additionalImageLinks } = resolveOfferImages(product, variation.variantId);
  if (imageLink === null) reasons.add("MEDIA_UNRESOLVED");

  if (classifyMerchantText(product.name) !== "READY") reasons.add("TITLE_UNRESOLVED");
  if (classifyMerchantText(product.publishedDescription) !== "READY") {
    reasons.add("DESCRIPTION_UNRESOLVED");
  }

  if (
    reasons.size > 0
    || !apparel.ok
    || addressableOption === null
    || path === null
    || priceVnd === null
    || imageLink === null
    || pancakeVariationId === null
    || product.pancakeProductId === null
  ) {
    return { pancakeVariationId, itemGroupId: product.pancakeProductId, reasons, offer: null };
  }

  return {
    pancakeVariationId,
    itemGroupId: product.pancakeProductId,
    reasons,
    offer: Object.freeze({
      id: pancakeVariationId,
      itemGroupId: product.pancakeProductId,
      brand: MERCHANT_BRAND,
      mpn: variation.pancakeDisplayId as string,
      title: product.name,
      description: product.publishedDescription as string,
      link: new URL(path, origin).href,
      imageLink,
      additionalImageLinks: Object.freeze(additionalImageLinks),
      availability: availabilityClass === "IN_STOCK" ? "in_stock" : "out_of_stock",
      priceVnd,
      gender: apparel.facts.gender,
      ageGroup: apparel.facts.ageGroup,
      condition: apparel.facts.condition,
      color: addressableOption.color,
      size: addressableOption.size,
    }),
  };
}

/** Values claimed by more than one otherwise-emittable draft. */
function duplicatesAmong(values: readonly string[]): ReadonlySet<string> {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicated.add(value);
    else seen.add(value);
  }
  return duplicated;
}

export function mapMerchantOffers({
  products,
  origin,
  market = APPROVED_MERCHANT_MARKET,
}: Readonly<{
  products: readonly MerchantCandidateProduct[];
  /** Absolute storefront origin, from `readStorefrontOrigin`. */
  origin: string;
  /** Owner-approved O2 market, when one exists. */
  market?: MerchantMarketPolicy | null;
}>): MerchantMappingResult {
  const parsedOrigin = requireAbsoluteOrigin(origin);

  const drafts: Draft[] = [];
  for (const product of products) {
    for (const variation of product.variations) {
      drafts.push(draftCandidate(product, variation, parsedOrigin));
    }
  }

  // Uniqueness is a property of the emittable set, so it is decided after every candidate has been
  // judged on its own facts. A duplicate is never resolved by preferring one claimant: both are
  // excluded, because the catalog cannot say which offer the identity or the part number names.
  const emittable = drafts.filter((draft) => draft.offer !== null);
  const duplicateIds = duplicatesAmong(emittable.map((draft) => draft.offer!.id));
  const duplicateMpns = duplicatesAmong(emittable.map((draft) => draft.offer!.mpn));

  const offers: MerchantOffer[] = [];
  const excluded: MerchantExcludedCandidate[] = [];

  for (const draft of drafts) {
    const reasons = draft.reasons;
    if (draft.offer !== null) {
      if (duplicateIds.has(draft.offer.id)) reasons.add("OFFER_ID_DUPLICATE");
      if (duplicateMpns.has(draft.offer.mpn)) reasons.add("MPN_DUPLICATE");
    }

    if (reasons.size === 0 && draft.offer !== null) {
      offers.push(draft.offer);
      continue;
    }

    excluded.push(
      Object.freeze({
        pancakeVariationId: draft.pancakeVariationId,
        itemGroupId: draft.itemGroupId,
        reasons: Object.freeze(REASON_ORDER.filter((reason) => reasons.has(reason))),
      }),
    );
  }

  const resolvedMarket = resolveMerchantMarket(market);

  return Object.freeze({
    offers: Object.freeze(offers),
    excluded: Object.freeze(excluded),
    market: resolvedMarket,
    activationBlockedReasons: Object.freeze(
      resolvedMarket.status === "APPROVED" ? [] : [MERCHANT_MARKET_UNRESOLVED],
    ),
  });
}
