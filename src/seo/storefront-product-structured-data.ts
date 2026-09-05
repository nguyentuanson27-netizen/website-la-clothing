/**
 * U27 — the boundary from the PDP's storefront projection to published product JSON-LD.
 *
 * It answers one question: which of this product's variants may appear as their own `Product` and
 * exact `Offer` under a `ProductGroup`, and with which facts. Everything it publishes already has
 * an owner, and it reuses that owner rather than re-deriving the answer:
 *
 * - addressability and the variant URL — the U12 deep-link contract;
 * - price and availability — the PDP projection, priced by the same rule the page renders with;
 * - images — the trusted media the catalog already resolved for this product's gallery;
 * - product-level identity — the external `pancakeProductId` the storefront already treats as this
 *   product's public identity.
 *
 * Nothing here reads the database. The projection the page has already built is the whole input,
 * so publishing structured data costs no additional catalog or pricing work.
 */

import { toOptionIdentityKey } from "../commerce/storefront-product.ts";
import {
  selectStorefrontProductLevelOptions,
  type StorefrontProductProjection,
  type StorefrontProjectionOption,
} from "../commerce/storefront-projection.ts";
import {
  buildVariantDeepLinkUrl,
  resolveDeepLinkedVariantSelection,
} from "../commerce/storefront-variant-deep-link.ts";
import {
  buildProductStructuredData,
  isPublishableIdentifier,
  type ProductStructuredDataDocument,
  type StructuredDataAvailability,
  type StructuredDataProductGroup,
  type StructuredDataVariant,
  type StructuredDataVariantDimension,
} from "./structured-data.ts";

type StorefrontStructuredDataProduct = Readonly<{
  /** Product-level external identity; the same one the page already reports to analytics. */
  pancakeProductId: string;
  slug: string;
  name: string;
  editorialDescription: string | null;
  media: Readonly<{
    gallery: readonly Readonly<{
      url: string;
      alt: string;
    }>[];
  }>;
  /** Server-resolved variant → gallery position, keyed by internal id and never published. */
  galleryIndexByVariantId: Readonly<Record<string, number>>;
  projection: StorefrontProductProjection;
}>;

/**
 * This option's commerce state, when it can be stated exactly.
 *
 * Fail-closed, and price and availability are decided together on purpose: an offer is published
 * only when the price is fully resolved *and* the option is either buyable or out of stock for
 * stock reasons alone. A variant whose price never resolved is not published as sold out — that
 * would answer a pricing question with a stock claim.
 */
function resolvePublishableOffer(
  option: StorefrontProjectionOption,
): Readonly<{ price: number; availability: StructuredDataAvailability }> | null {
  const { price } = option;
  if (price === null || !Number.isFinite(price) || price < 0) return null;
  if (option.purchasable) return { price, availability: "IN_STOCK" };
  if (option.unavailableReason === "OUT_OF_STOCK") return { price, availability: "OUT_OF_STOCK" };
  return null;
}

function resolveVariantImageUrl(
  product: StorefrontStructuredDataProduct,
  option: StorefrontProjectionOption,
): string | null {
  const index = product.galleryIndexByVariantId[option.id];
  // An index that addresses no resolved image — missing, out of range, or not a position at all —
  // simply does not select one, so there is nothing further to guard.
  return typeof index === "number" ? product.media.gallery[index]?.url ?? null : null;
}

/**
 * The dimensions these variants genuinely differ on.
 *
 * Compared through the option model's own identity rule rather than by raw string, because that is
 * the rule that decided these rows were distinct siblings in the first place. Mirrored catalog text
 * is inconsistently cased, and a family whose rows read `Đen` and `đen` varies by size alone — the
 * markup must not tell Google it offers two colours.
 */
function resolveVariesBy(
  variants: readonly StructuredDataVariant[],
): StructuredDataVariantDimension[] {
  const distinct = (key: "color" | "size") =>
    new Set(
      variants
        .map((variant) => variant[key])
        .filter((value): value is string => value !== null)
        .map(toOptionIdentityKey),
    ).size;

  const variesBy: StructuredDataVariantDimension[] = [];
  if (distinct("color") > 1) variesBy.push("COLOR");
  if (distinct("size") > 1) variesBy.push("SIZE");
  return variesBy;
}

/**
 * The external product identity, when it is publishable as one.
 *
 * Mirrored catalog text is untrusted, so a blank or unbounded value publishes no group at all, and
 * an untrimmed one is refused rather than repaired: trimming would publish an identity the catalog
 * does not hold, and a `productGroupID` that disagrees with the id every other consumer uses is
 * worse than none. The rule itself belongs to the module that writes the document, so this asks it
 * rather than restating it — a second copy here would be free to drift from what is serialized.
 */
function readPublishableProductGroupID(pancakeProductId: string): string | null {
  return isPublishableIdentifier(pancakeProductId) ? pancakeProductId : null;
}

/**
 * The variants this page may publish, each proved addressable before it is published.
 *
 * Eligibility is not re-implemented here. Every candidate's external identity is fed back through
 * the U12 resolver against this same projection, and only an identity that reselects *this* option
 * survives. That single check is what makes composites, duplicated external ids, unmappable and
 * ambiguous options, blank and oversized identifiers all fail closed for the same reason they fail
 * closed for a shopper following the link: the URL would not open the variant it names, so the URL
 * must not be published.
 *
 * The resolver scans the option list, so this is quadratic in the number of options of one product
 * — a small in-memory array the page already holds, with no query behind it.
 */
function resolvePublishableVariants({
  origin,
  product,
}: Readonly<{
  origin: string;
  product: StorefrontStructuredDataProduct;
}>): StructuredDataVariant[] {
  const variants: StructuredDataVariant[] = [];

  for (const option of product.projection.options) {
    const reselected = resolveDeepLinkedVariantSelection({
      projection: product.projection,
      variantQuery: option.pancakeVariationId,
    });
    // The second half is redundant against today's resolver, which matches one exact external id or
    // none. It stays because it, not the resolver's current internals, is the property this file
    // depends on: the URL about to be published must open *this* variant. A resolver that ever
    // learned to fall back to a near match would otherwise start publishing wrong links silently.
    if (reselected === null || reselected.variantId !== option.id) continue;

    const offer = resolvePublishableOffer(option);
    if (offer === null) continue;

    variants.push({
      url: buildVariantDeepLinkUrl({
        origin,
        slug: product.slug,
        pancakeVariationId: option.pancakeVariationId,
      }),
      color: option.color,
      size: option.size,
      price: offer.price,
      availability: offer.availability,
      imageUrl: resolveVariantImageUrl(product, option),
    });
  }

  return variants;
}

/**
 * The publishable variant family, or `null` when this product does not have one.
 *
 * Null covers every case the page must fall back from: a composite, a product whose options are
 * not addressable, one with a single option, and one whose external identity is unusable.
 */
function resolveProductGroup({
  origin,
  product,
}: Readonly<{
  origin: string;
  product: StorefrontStructuredDataProduct;
}>): StructuredDataProductGroup | null {
  const productGroupID = readPublishableProductGroupID(product.pancakeProductId);
  if (productGroupID === null) return null;

  const variants = resolvePublishableVariants({ origin, product });
  const variesBy = resolveVariesBy(variants);
  if (variesBy.length === 0) return null;

  return { productGroupID, variesBy, variants };
}

export function buildStorefrontProductStructuredData({
  origin,
  product,
}: Readonly<{
  origin: string;
  product: StorefrontStructuredDataProduct;
}>): ProductStructuredDataDocument {
  return buildProductStructuredData({
    origin,
    product,
    // The product-level fallback, for a product with no publishable variant family: a composite's
    // parent set, or a standalone product with a single option. Unchanged behaviour, now resolved
    // from the same projection the page renders so structured data cannot quote a price the page
    // does not show.
    variantOptions: selectStorefrontProductLevelOptions(product.projection),
    productGroup: resolveProductGroup({ origin, product }),
  });
}
