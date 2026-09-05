/**
 * The standalone variant deep link: `/shop/<slug>?variant=<pancakeVariationId>`.
 *
 * One addressing contract, owned here. The query names a variation by its **external** Pancake
 * identity, which is the same identity the Merchant feed and analytics use, so a link built from a
 * feed row and a link copied from the address bar mean the same thing. The internal
 * `VariantMirror.id` deliberately does not resolve: it is the authorization/mutation key, and
 * making it addressable from the URL would turn an internal handle into a guessable public one.
 *
 * Resolution is a match inside the projection the page already built, never a database lookup. That
 * is what makes the whole class of hostile inputs one case instead of several: a forged id, another
 * product's id, a deleted or deactivated variation, a private one and a composite component are all
 * simply absent from this product's authorized public option list, so none of them can preselect
 * anything and none of them costs a query. Failing closed here means falling back to the ordinary
 * product page, which is a complete and correct page in its own right.
 *
 * This module owns no pricing, no canonical/indexing policy and no selection semantics. It returns
 * the same `{ kindKey, color, size }` shape the panel already uses, so a deep link produces exactly
 * the state a shopper's own click would have produced.
 */

import type {
  StorefrontProductProjection,
  StorefrontProjectionOption,
} from "./storefront-projection.ts";

/** The reviewed query parameter name. #153 M2 owns it; nothing else may define a variant query. */
export const VARIANT_QUERY_PARAM = "variant";

/**
 * Bounds the browser-supplied value before it is matched, consistent with the identifier bound the
 * rest of the server boundary applies. Matching happens against a small in-memory array, so this is
 * hygiene rather than a hot-path guard — but an unbounded string should not cross the boundary at
 * all.
 */
export const MAX_VARIANT_QUERY_LENGTH = 128;

export type DeepLinkedVariantSelection = Readonly<{
  kindKey: string | null;
  color: string | null;
  size: string | null;
  /** Internal id of the matched option, so a caller can align other per-variant facts (media). */
  variantId: string;
}>;

/**
 * Normalizes the raw search-param value into a bounded single string.
 *
 * A repeated `?variant=a&variant=b` arrives as an array and is refused rather than resolved to one
 * of the two: there is no rule saying which was intended, and picking one would be a guess.
 */
export function readVariantQueryValue(
  raw: string | readonly string[] | undefined | null,
): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > MAX_VARIANT_QUERY_LENGTH) return null;
  return raw;
}

/**
 * The reviewed product-slug shape, as `normalizeProductSlug` produces it.
 *
 * Building a link is the one direction where an unexpected slug becomes a URL rather than a lookup
 * that simply misses, so the shape is re-checked here instead of trusted. A slug that does not match
 * yields no link at all: an offer without a landing page is a fact a consumer can fail closed on,
 * whereas a mis-encoded one is a broken destination shipped to a vendor.
 */
const PRODUCT_SLUG_PATH_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_PRODUCT_SLUG_PATH_LENGTH = 160;

/**
 * Builds the exact standalone variant deep link this module already resolves.
 *
 * It is here, beside the resolver, so the addressing contract has one owner: a feed, a card or a
 * structured-data document that assembled `/shop/...?variant=...` itself would be a second contract
 * free to drift from the one the page actually honours. Callers get a path rather than an absolute
 * URL, because the origin is `readStorefrontOrigin`'s to decide.
 *
 * The variation identity is percent-encoded, so the value the page reads back is byte-for-byte the
 * value the caller named. Whether that identity is *addressable* is a separate question, and stays
 * with `resolveDeepLinkedVariantSelection` against the product's authorized option list.
 */
export function buildStandaloneVariantDeepLinkPath({
  slug,
  pancakeVariationId,
}: Readonly<{ slug: string; pancakeVariationId: string }>): string | null {
  if (
    typeof slug !== "string"
    || slug.length === 0
    || slug.length > MAX_PRODUCT_SLUG_PATH_LENGTH
    || !PRODUCT_SLUG_PATH_PATTERN.test(slug)
  ) {
    return null;
  }

  if (readVariantQueryValue(pancakeVariationId) === null) return null;

  return `/shop/${slug}?${VARIANT_QUERY_PARAM}=${encodeURIComponent(pancakeVariationId)}`;
}

function matchesVariation(
  option: StorefrontProjectionOption,
  pancakeVariationId: string,
): boolean {
  return option.pancakeVariationId === pancakeVariationId;
}

export function resolveDeepLinkedVariantSelection({
  projection,
  variantQuery,
}: Readonly<{
  projection: StorefrontProductProjection;
  variantQuery: string | null;
}>): DeepLinkedVariantSelection | null {
  // Standalone only. A composite parent presents component groups, and letting one component's
  // variation be addressed through the parent URL would make a presentation grouping look like an
  // addressable product — exactly the identity confusion T4 exists to prevent.
  if (projection.mode !== "standalone") return null;

  const pancakeVariationId = readVariantQueryValue(variantQuery);
  if (pancakeVariationId === null) return null;

  const matches = projection.options.filter((option) =>
    matchesVariation(option, pancakeVariationId),
  );
  // Exactly one, or none. A duplicated external id means the catalog cannot say which option was
  // meant, and the ambiguity is reported by not selecting rather than by picking the first.
  if (matches.length !== 1) return null;

  const matched = matches[0]!;
  // Purchasability is deliberately *not* a condition. Whether an external variation identity is
  // valid, current and addressable is a different question from whether it can be bought right
  // now: a variation that is present, active and simply sold out is still the one the link names,
  // and refusing it would send a shopper to a vague "from" price instead of that variant's exact
  // sold-out state. Add-to-bag stays disabled through the selection model's own `canAdd`.
  //
  // Options carrying MAPPING_REQUIRED or AMBIGUOUS_OPTION are excluded, because those mean the
  // catalog cannot say which concrete option this is — an identity problem, not a stock one.
  if (matched.unavailableReason === "MAPPING_REQUIRED"
    || matched.unavailableReason === "AMBIGUOUS_OPTION") {
    return null;
  }

  return Object.freeze({
    kindKey: matched.kindKey,
    color: matched.color,
    size: matched.size,
    variantId: matched.id,
  });
}
