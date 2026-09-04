const SITE_NAME = "LA Clothing";
const SCHEMA_CONTEXT = "https://schema.org" as const;
const IN_STOCK = "https://schema.org/InStock" as const;
const OUT_OF_STOCK = "https://schema.org/OutOfStock" as const;
const SCHEMA_COLOR = "https://schema.org/color" as const;
const SCHEMA_SIZE = "https://schema.org/size" as const;

/**
 * The same bound the variant query applies to an external identifier at the request boundary.
 * Mirrored catalog text is untrusted, and an unbounded identifier should not be published either.
 */
const MAX_EXTERNAL_IDENTIFIER_LENGTH = 128;

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

export type StructuredDataProductGroup = Readonly<{
  /** The reviewed external product-level identity. Never a local CUID or a presentation key. */
  productGroupID: string;
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

/** Bounded, non-blank mirrored catalog text is the only thing that may become a public identifier. */
function readExternalIdentifier(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_EXTERNAL_IDENTIFIER_LENGTH) return null;
  return trimmed;
}

/**
 * The dimensions the published variants genuinely differ on, as the full schema.org URIs Google
 * reads. A dimension the catalog does not actually vary is not listed, because `variesBy` is a
 * claim about this family and not a description of the columns the schema happens to have.
 */
function resolveVariesBy(variants: readonly StructuredDataVariant[]): string[] {
  const distinct = (key: "color" | "size") =>
    new Set(
      variants
        .map((variant) => variant[key])
        .filter((value): value is string => value !== null),
    ).size;

  const variesBy: string[] = [];
  if (distinct("color") > 1) variesBy.push(SCHEMA_COLOR);
  if (distinct("size") > 1) variesBy.push(SCHEMA_SIZE);
  return variesBy;
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

  const productGroupID =
    productGroup === null ? null : readExternalIdentifier(productGroup.productGroupID);
  const variants = productGroup?.variants ?? [];
  const variesBy = resolveVariesBy(variants);
  // A family is publishable only if it has a public identity and something it demonstrably varies
  // by; missing either, the page keeps its ordinary product-level `Product`. A single variant can
  // never satisfy the second condition — nothing differs from itself — so a group of one is
  // excluded by the same rule rather than by a separate count, and a group of one is exactly what
  // the product-level shape already says better.
  const publishedGroupID = variesBy.length > 0 ? productGroupID : null;

  const productNode: ProductNode | ProductGroupNode = publishedGroupID !== null
    ? {
        "@type": "ProductGroup",
        "@id": `${productUrl}#product`,
        name: product.name,
        url: productUrl,
        brand: {
          "@id": organizationId,
        },
        productGroupID: publishedGroupID,
        variesBy,
        // No group-level `offers`. The exact per-variant offers below are the whole point, and an
        // aggregate beside them would be a second, contradictory price authority on one page.
        hasVariant: variants.map((variant) => buildVariantNode(product.name, variant)),
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
