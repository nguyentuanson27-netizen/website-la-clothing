import { resolveStorefrontProductMedia } from "./product-media.ts";
import { isLegacyOpaqueProductSlug, normalizeProductSlug } from "./product-slug.ts";
import { buildStorefrontVariantOptions } from "./storefront-product.ts";

type CatalogAcceptanceContent = Readonly<{
  status: "DRAFT" | "REVIEWED" | "PUBLISHED";
  editorialDescription: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  collectionSlugs: readonly string[];
}>;

type CatalogAcceptanceVariant = Readonly<{
  id: string;
  color: string | null;
  size: string | null;
  sellableStock: number;
  retailPrice: number | null;
  retailPriceAfterDiscount: number | null;
  imageUrls: readonly (string | null | undefined)[];
}>;

export type CatalogAcceptanceProduct = Readonly<{
  slug: string;
  name: string;
  sourceDescription: string | null;
  primaryImageUrl: string | null;
  content: CatalogAcceptanceContent | null;
  variants: readonly CatalogAcceptanceVariant[];
}>;

export type CatalogAcceptanceSourceModel = Readonly<{
  compositeParentVariations: number;
  compositeProjectionReady: boolean;
}>;

type AcceptanceIssueKey =
  | "mappingRequired"
  | "ambiguousOption"
  | "priceUnresolved"
  | "trustedMediaOrFallbackApprovalRequired"
  | "unreadableSlug"
  | "missingPublishedCollection"
  | "missingPublishedEditorial"
  | "missingPublishedSeo";

type AcceptanceObservationKey =
  | "missingSourceDescription"
  | "noActiveVariants"
  | "noPurchasableVariant";

const MEDIA_FALLBACK_APPROVAL_LIMIT = 100;
const COMPOSITE_PARENT_VARIATION_LIMIT = 50_000;
const EMPTY_MEDIA_FALLBACK_APPROVALS: ReadonlySet<string> = new Set();

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function sorted(values: string[]): string[] {
  return values.sort((left, right) => left.localeCompare(right, "en"));
}

function assertReviewedMediaFallbackApprovals(approvedSlugs: ReadonlySet<string>): void {
  if (approvedSlugs.size > MEDIA_FALLBACK_APPROVAL_LIMIT) {
    throw new TypeError("P17 media fallback approval limit exceeded");
  }

  for (const slug of approvedSlugs) {
    if (normalizeProductSlug(slug) !== slug || isLegacyOpaqueProductSlug(slug)) {
      throw new TypeError("P17 media fallback approval slug is invalid");
    }
  }
}

function assertCatalogAcceptanceSourceModel(sourceModel: CatalogAcceptanceSourceModel): void {
  if (
    !Number.isSafeInteger(sourceModel.compositeParentVariations) ||
    sourceModel.compositeParentVariations < 0 ||
    sourceModel.compositeParentVariations > COMPOSITE_PARENT_VARIATION_LIMIT ||
    typeof sourceModel.compositeProjectionReady !== "boolean"
  ) {
    throw new TypeError("P17 source model is invalid");
  }
}

export function buildCatalogAcceptanceReport({
  products,
  publishedCollectionSlugs,
  sourceModel,
  approvedMediaFallbackSlugs = EMPTY_MEDIA_FALLBACK_APPROVALS,
}: Readonly<{
  products: readonly CatalogAcceptanceProduct[];
  publishedCollectionSlugs: ReadonlySet<string>;
  sourceModel: CatalogAcceptanceSourceModel;
  approvedMediaFallbackSlugs?: ReadonlySet<string>;
}>) {
  assertReviewedMediaFallbackApprovals(approvedMediaFallbackSlugs);
  assertCatalogAcceptanceSourceModel(sourceModel);

  const issues: Record<AcceptanceIssueKey, string[]> = {
    mappingRequired: [],
    ambiguousOption: [],
    priceUnresolved: [],
    trustedMediaOrFallbackApprovalRequired: [],
    unreadableSlug: [],
    missingPublishedCollection: [],
    missingPublishedEditorial: [],
    missingPublishedSeo: [],
  };
  const observations: Record<AcceptanceObservationKey, string[]> = {
    missingSourceDescription: [],
    noActiveVariants: [],
    noPurchasableVariant: [],
  };
  const blockers = {
    compositeProjectionRequired:
      sourceModel.compositeParentVariations > 0 && !sourceModel.compositeProjectionReady,
  };
  const summary = {
    products: products.length,
    withSourceDescription: 0,
    trustedMediaReady: 0,
    approvedMediaFallbackReady: 0,
    readableSlugReady: 0,
    publishedCollectionReady: 0,
    publishedEditorialReady: 0,
    publishedSeoReady: 0,
    variantMappingReady: 0,
    purchasableNow: 0,
  };

  for (const product of products) {
    const slug = product.slug;
    const options = buildStorefrontVariantOptions(product.variants);
    const mappingRequired = options.some(
      (option) => option.unavailableReason === "MAPPING_REQUIRED",
    );
    const ambiguousOption = options.some(
      (option) => option.unavailableReason === "AMBIGUOUS_OPTION",
    );
    const priceUnresolved = options.some(
      (option) => option.unavailableReason === "PRICE_UNRESOLVED",
    );
    const purchasableNow = options.some((option) => option.purchasable);

    if (mappingRequired) issues.mappingRequired.push(slug);
    if (ambiguousOption) issues.ambiguousOption.push(slug);
    if (priceUnresolved) issues.priceUnresolved.push(slug);
    if (!mappingRequired && !ambiguousOption) summary.variantMappingReady += 1;
    if (purchasableNow) {
      summary.purchasableNow += 1;
    } else {
      observations.noPurchasableVariant.push(slug);
    }
    if (product.variants.length === 0) observations.noActiveVariants.push(slug);

    const media = resolveStorefrontProductMedia({
      productName: product.name,
      primaryImageUrl: product.primaryImageUrl,
      variantImageUrls: product.variants.map((variant) => variant.imageUrls),
    });
    if (media.primary) {
      summary.trustedMediaReady += 1;
    } else if (approvedMediaFallbackSlugs.has(slug)) {
      summary.approvedMediaFallbackReady += 1;
    } else {
      issues.trustedMediaOrFallbackApprovalRequired.push(slug);
    }

    const readableSlug =
      normalizeProductSlug(slug) === slug && !isLegacyOpaqueProductSlug(slug);
    if (readableSlug) {
      summary.readableSlugReady += 1;
    } else {
      issues.unreadableSlug.push(slug);
    }

    const hasPublishedCollection =
      product.content?.collectionSlugs.some((collectionSlug) =>
        publishedCollectionSlugs.has(collectionSlug),
      ) ?? false;
    if (hasPublishedCollection) {
      summary.publishedCollectionReady += 1;
    } else {
      issues.missingPublishedCollection.push(slug);
    }

    const publishedContent = product.content?.status === "PUBLISHED" ? product.content : null;
    if (hasText(publishedContent?.editorialDescription)) {
      summary.publishedEditorialReady += 1;
    } else {
      issues.missingPublishedEditorial.push(slug);
    }
    if (hasText(publishedContent?.seoTitle) && hasText(publishedContent?.seoDescription)) {
      summary.publishedSeoReady += 1;
    } else {
      issues.missingPublishedSeo.push(slug);
    }

    if (hasText(product.sourceDescription)) {
      summary.withSourceDescription += 1;
    } else {
      observations.missingSourceDescription.push(slug);
    }
  }

  for (const values of Object.values(issues)) sorted(values);
  for (const values of Object.values(observations)) sorted(values);

  return {
    ready:
      !blockers.compositeProjectionRequired &&
      Object.values(issues).every((values) => values.length === 0),
    sourceModel: { ...sourceModel },
    blockers,
    summary,
    issues,
    observations,
  };
}
