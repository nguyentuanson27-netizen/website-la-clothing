const SITE_NAME = "LA Clothing";
const SCHEMA_CONTEXT = "https://schema.org" as const;
const IN_STOCK = "https://schema.org/InStock" as const;
const OUT_OF_STOCK = "https://schema.org/OutOfStock" as const;

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
  "@graph": [ProductNode, BreadcrumbListNode];
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

export function buildProductStructuredData({
  origin,
  product,
  variantOptions,
}: Readonly<{
  origin: string;
  product: StructuredDataProduct;
  variantOptions: readonly StructuredDataVariantOption[];
}>): ProductStructuredDataDocument {
  const { rootUrl, organizationId } = buildSiteEntityIds(origin);
  const productUrl = new URL(`/shop/${product.slug}`, origin).href;
  const shopUrl = new URL("/shop", origin).href;
  const offer = buildOffer(productUrl, variantOptions);
  const images = product.media.gallery.map((item) => item.url);

  const productNode: ProductNode = {
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
  if (offer) {
    productNode.offers = offer;
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
