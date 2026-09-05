const SITE_NAME = "LA Clothing";
const SCHEMA_CONTEXT = "https://schema.org" as const;
const IN_STOCK = "https://schema.org/InStock" as const;
const OUT_OF_STOCK = "https://schema.org/OutOfStock" as const;
import { MAX_VARIANT_QUERY_LENGTH } from "../commerce/storefront-variant-deep-link.ts";

/** The full schema.org URIs Google reads for the dimensions a variant family varies by. */
const SCHEMA_URI_BY_DIMENSION = {
  COLOR: "https://schema.org/color",
  SIZE: "https://schema.org/size",
} as const;

type StorefrontUnavailableReason =
  | "MAPPING_REQUIRED"
  | "AMBIGUOUS_OPTION"
  | "OUT_OF_STOCK"
  | "PRICE_UNRESOLVED"
  | null;

type StructuredDataVariantOption = Readonly<{
  price: number | null;
  purchasable: boolean;
  unavailableReason: StorefrontUnavailableReason;
}>;

export type StructuredDataAvailability = "IN_STOCK" | "OUT_OF_STOCK";

/**
 * One publishable variant, as the caller has already resolved it.
 *
 * Every field is a fact with an existing owner. In particular `url` is the exact deep link written
 * by the addressing contract that reads it back — this module never constructs a variant URL, so
 * there is no second URL implementation to drift from U12. Eligibility (is this variation
 * addressable, is its price resolved, is its availability knowable) is likewise settled before a
 * variant reaches here: this module publishes, it does not decide.
 */
export type StructuredDataVariant = Readonly<{
  url: string;
  color: string | null;
  size: string | null;
  price: number;
  availability: StructuredDataAvailability;
  imageUrl: string | null;
}>;

export type StructuredDataVariantDimension = keyof typeof SCHEMA_URI_BY_DIMENSION;

export type StructuredDataProductGroup = Readonly<{
  /** The reviewed external product-level identity. Never a local CUID or a presentation key. */
  productGroupID: string;
  /**
   * The dimensions the caller established these variants actually differ on — a domain answer,
   * because "do these two rows name the same colour?" is the option model's question, not this
   * module's. Naming them here rather than re-deriving them is what keeps `variesBy` from becoming
   * a stricter rule than the one that decided the variants were siblings in the first place.
   */
  variesBy: readonly StructuredDataVariantDimension[];
  variants: readonly StructuredDataVariant[];
}>;

type StructuredDataProduct = Readonly<{
  slug: string;
  name: string;
  editorialDescription: string | null;
  media: Readonly<{
    gallery: readonly Readonly<{
      url: string;
      alt: string;
    }>[];
  }>;
}>;

type OfferNode = {
  "@type": "Offer";
  url: string;
  priceCurrency: "VND";
  price: number;
  availability: typeof IN_STOCK | typeof OUT_OF_STOCK;
};

type ProductVariantNode = {
  "@type": "Product";
  "@id": string;
  name: string;
  url: string;
  color?: string;
  size?: string;
  image?: string[];
  offers: OfferNode;
};

type ProductGroupNode = {
  "@type": "ProductGroup";
  "@id": string;
  name: string;
  url: string;
  brand: {
    "@id": string;
  };
  description?: string;
  image?: string[];
  productGroupID: string;
  variesBy: string[];
  hasVariant: ProductVariantNode[];
};

type ProductNode = {
  "@type": "Product";
  "@id": string;
  name: string;
  url: string;
  brand: {
    "@id": string;
  };
  description?: string;
  image?: string[];
  offers?: OfferNode;
};

type BreadcrumbListNode = {
  "@type": "BreadcrumbList";
  itemListElement: [
    {
      "@type": "ListItem";
      position: 1;
      name: "Trang chủ";
      item: string;
    },
    {
      "@type": "ListItem";
      position: 2;
      name: "Shop";
      item: string;
    },
    {
      "@type": "ListItem";
      position: 3;
      name: string;
    },
  ];
};

type OrganizationNode = {
  "@type": "Organization";
  "@id": string;
  name: typeof SITE_NAME;
  url: string;
};

type WebSiteNode = {
  "@type": "WebSite";
  "@id": string;
  name: typeof SITE_NAME;
  url: string;
  publisher: {
    "@id": string;
  };
};

export type ProductStructuredDataDocument = {
  "@context": typeof SCHEMA_CONTEXT;
  /**
   * Exactly one product-schema authority per page. A `ProductGroup` replaces the product-level
   * `Product` rather than joining it, so a variant family's exact per-variant offers can never sit
   * beside a contradictory product-level offer.
   */
  "@graph": [ProductNode | ProductGroupNode, BreadcrumbListNode];
};

export type SiteStructuredDataDocument = {
  "@context": typeof SCHEMA_CONTEXT;
  "@graph": [OrganizationNode, WebSiteNode];
};

function buildSiteEntityIds(origin: string) {
  const rootUrl = new URL("/", origin).href;
  return {
    rootUrl,
    organizationId: `${rootUrl}#organization`,
    websiteId: `${rootUrl}#website`,
  };
}

function buildOffer(
  productUrl: string,
  variantOptions: readonly StructuredDataVariantOption[],
): OfferNode | undefined {
  if (variantOptions.length === 0) return undefined;

  const prices = variantOptions.map((option) => option.price);
  if (
    prices.some(
      (price): price is null => price === null || !Number.isFinite(price) || price < 0,
    )
  ) {
    return undefined;
  }

  const resolvedPrices = prices as number[];
  const price = resolvedPrices[0]!;
  if (resolvedPrices.some((candidate) => candidate !== price)) return undefined;

  const hasPurchasableVariant = variantOptions.some((option) => option.purchasable);
  const allUnavailableStateIsStockOnly = variantOptions.every(
    (option) => option.purchasable || option.unavailableReason === "OUT_OF_STOCK",
  );
  if (!allUnavailableStateIsStockOnly) return undefined;

  const availability = hasPurchasableVariant
    ? IN_STOCK
    : variantOptions.every((option) => option.unavailableReason === "OUT_OF_STOCK")
      ? OUT_OF_STOCK
      : undefined;
  if (!availability) return undefined;

  return {
    "@type": "Offer",
    url: productUrl,
    priceCurrency: "VND",
    price,
    availability,
  };
}

/**
 * Bounded, non-blank mirrored catalog text, published exactly as the catalog holds it. Trimming
 * would publish an identity no other consumer uses, so an untrimmed value is refused instead.
 */
function isPublishableIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= MAX_VARIANT_QUERY_LENGTH && value.trim() === value;
}

function buildVariantNode(name: string, variant: StructuredDataVariant): ProductVariantNode {
  const node: ProductVariantNode = {
    "@type": "Product",
    "@id": `${variant.url}#product`,
    // The family's name, not a composed one: the option this variant is differs from its siblings
    // by `color`/`size`, which the group already names through `variesBy`. Inventing a variant
    // title would publish merchandising copy the catalog never wrote.
    name,
    url: variant.url,
    offers: {
      "@type": "Offer",
      url: variant.url,
      priceCurrency: "VND",
      price: variant.price,
      availability: variant.availability === "IN_STOCK" ? IN_STOCK : OUT_OF_STOCK,
    },
  };

  if (variant.color !== null) node.color = variant.color;
  if (variant.size !== null) node.size = variant.size;
  if (variant.imageUrl !== null) node.image = [variant.imageUrl];

  return node;
}

export function buildProductStructuredData({
  origin,
  product,
  variantOptions,
  productGroup = null,
}: Readonly<{
  origin: string;
  product: StructuredDataProduct;
  variantOptions: readonly StructuredDataVariantOption[];
  /**
   * The publishable variant family, when the caller resolved one. Absent — or too small, or without
   * a usable external identity — the page keeps the ordinary product-level `Product` + `Offer`.
   */
  productGroup?: StructuredDataProductGroup | null;
}>): ProductStructuredDataDocument {
  const { rootUrl, organizationId } = buildSiteEntityIds(origin);
  const productUrl = new URL(`/shop/${product.slug}`, origin).href;
  const shopUrl = new URL("/shop", origin).href;
  const images = product.media.gallery.map((item) => item.url);

  // The caller decides whether a family is publishable — whether these rows really are siblings,
  // and whether their identity is one this catalog holds. What is checked here is what this module
  // must not serialize whatever a caller believes: a group needs members, something it varies by,
  // and an identity that is bounded and unaltered. A family of one can never vary by anything,
  // which is exactly what the product-level shape already says better.
  //
  // The identifier rules repeat the boundary's deliberately. There is one production caller today,
  // but the bound is on untrusted mirrored text and this is the function that writes it into a
  // public document, so it holds the bound itself rather than inheriting it from whoever calls.
  const publishedGroup =
    productGroup !== null
    && isPublishableIdentifier(productGroup.productGroupID)
    && productGroup.variesBy.length > 0
    && productGroup.variants.length > 0
      ? productGroup
      : null;

  const productNode: ProductNode | ProductGroupNode = publishedGroup !== null
    ? {
        "@type": "ProductGroup",
        "@id": `${productUrl}#product`,
        name: product.name,
        url: productUrl,
        brand: {
          "@id": organizationId,
        },
        productGroupID: publishedGroup.productGroupID,
        variesBy: publishedGroup.variesBy.map(
          (dimension) => SCHEMA_URI_BY_DIMENSION[dimension],
        ),
        // No group-level `offers`. The exact per-variant offers below are the whole point, and an
        // aggregate beside them would be a second, contradictory price authority on one page.
        hasVariant: publishedGroup.variants.map(
          (variant) => buildVariantNode(product.name, variant),
        ),
      }
    : {
        "@type": "Product",
        "@id": `${productUrl}#product`,
        name: product.name,
        url: productUrl,
        brand: {
          "@id": organizationId,
        },
      };

  if (product.editorialDescription) {
    productNode.description = product.editorialDescription;
  }
  if (images.length > 0) {
    productNode.image = images;
  }
  if (productNode["@type"] === "Product") {
    const offer = buildOffer(productUrl, variantOptions);
    if (offer) {
      productNode.offers = offer;
    }
  }

  return {
    "@context": SCHEMA_CONTEXT,
    "@graph": [
      productNode,
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Trang chủ",
            item: rootUrl,
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Shop",
            item: shopUrl,
          },
          {
            "@type": "ListItem",
            position: 3,
            name: product.name,
          },
        ],
      },
    ],
  };
}

export function buildSiteStructuredData({
  origin,
}: Readonly<{ origin: string }>): SiteStructuredDataDocument {
  const { rootUrl, organizationId, websiteId } = buildSiteEntityIds(origin);

  return {
    "@context": SCHEMA_CONTEXT,
    "@graph": [
      {
        "@type": "Organization",
        "@id": organizationId,
        name: SITE_NAME,
        url: rootUrl,
      },
      {
        "@type": "WebSite",
        "@id": websiteId,
        name: SITE_NAME,
        url: rootUrl,
        publisher: {
          "@id": organizationId,
        },
      },
    ],
  };
}

export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
