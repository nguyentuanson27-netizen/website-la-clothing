import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductStructuredData,
  buildSiteStructuredData,
  serializeJsonLd,
} from "../../src/seo/structured-data.ts";

const product = {
  slug: "ao-oxford-relaxed",
  name: "Áo Oxford Relaxed",
  editorialDescription: "Áo Oxford Relaxed với nội dung biên tập đã được xuất bản.",
  media: {
    gallery: [
      {
        url: "https://content.pancake.vn/1/2/3/4/ao-oxford.jpg",
        alt: "Áo Oxford Relaxed",
      },
      {
        url: "https://content.pancake.vn/1/2/3/4/ao-oxford-back.jpg",
        alt: "Áo Oxford Relaxed - Ảnh 2",
      },
    ],
  },
};

const onePriceOptions = [
  {
    price: 590_000,
    purchasable: true,
    unavailableReason: null,
  },
  {
    price: 590_000,
    purchasable: false,
    unavailableReason: "OUT_OF_STOCK" as const,
  },
];

const oneVariant = {
  url: "https://shop.example.com/shop/ao-oxford-relaxed?variant=pv-a",
  color: null,
  size: "M",
  price: 590_000,
  availability: "IN_STOCK" as const,
  imageUrl: null,
};

const twoIdentifiedVariants = [
  { ...oneVariant, mpn: "A132-M" },
  {
    ...oneVariant,
    url: "https://shop.example.com/shop/ao-oxford-relaxed?variant=pv-b",
    mpn: "A132-L",
    size: "L",
  },
];

test("P14 builds factual Product, Offer, and BreadcrumbList from visible server-authoritative facts", () => {
  const structured = buildProductStructuredData({
    origin: "https://shop.example.com",
    product,
    variantOptions: onePriceOptions,
  });

  assert.deepEqual(structured, {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        "@id": "https://shop.example.com/shop/ao-oxford-relaxed#product",
        name: "Áo Oxford Relaxed",
        url: "https://shop.example.com/shop/ao-oxford-relaxed",
        description: product.editorialDescription,
        image: product.media.gallery.map((item) => item.url),
        brand: {
          "@id": "https://shop.example.com/#organization",
        },
        offers: {
          "@type": "Offer",
          url: "https://shop.example.com/shop/ao-oxford-relaxed",
          priceCurrency: "VND",
          price: 590_000,
          availability: "https://schema.org/InStock",
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: "Trang chủ",
            item: "https://shop.example.com/",
          },
          {
            "@type": "ListItem",
            position: 2,
            name: "Shop",
            item: "https://shop.example.com/shop",
          },
          {
            "@type": "ListItem",
            position: 3,
            name: "Áo Oxford Relaxed",
          },
        ],
      },
    ],
  });
});

test("P14 emits a truthful OutOfStock Offer only when price is fully resolved and stock is the only blocker", () => {
  const structured = buildProductStructuredData({
    origin: "https://shop.example.com",
    product,
    variantOptions: [
      { price: 590_000, purchasable: false, unavailableReason: "OUT_OF_STOCK" },
      { price: 590_000, purchasable: false, unavailableReason: "OUT_OF_STOCK" },
    ],
  });

  const productNode = structured["@graph"][0];
  assert.equal(productNode["@type"], "Product");
  assert.deepEqual(productNode.offers, {
    "@type": "Offer",
    url: "https://shop.example.com/shop/ao-oxford-relaxed",
    priceCurrency: "VND",
    price: 590_000,
    availability: "https://schema.org/OutOfStock",
  });
});

test("P14 omits Offer instead of misrepresenting variant price ranges or unresolved commerce state", () => {
  const priceRange = buildProductStructuredData({
    origin: "https://shop.example.com",
    product,
    variantOptions: [
      { price: 590_000, purchasable: true, unavailableReason: null },
      { price: 690_000, purchasable: true, unavailableReason: null },
    ],
  });
  const unresolved = buildProductStructuredData({
    origin: "https://shop.example.com",
    product,
    variantOptions: [
      { price: 590_000, purchasable: false, unavailableReason: "AMBIGUOUS_OPTION" },
      { price: 590_000, purchasable: false, unavailableReason: "AMBIGUOUS_OPTION" },
    ],
  });

  assert.equal("offers" in priceRange["@graph"][0], false);
  assert.equal("offers" in unresolved["@graph"][0], false);
});

test("P14/U27 refuses ProductGroup when structural or variant-identifier gates are not proven", () => {
  for (const productGroup of [
    undefined,
    null,
    { productGroupID: "pancake-product-1", variesBy: [], variants: twoIdentifiedVariants },
    { productGroupID: "pancake-product-1", variesBy: ["SIZE" as const], variants: [] },
    { productGroupID: "", variesBy: ["SIZE" as const], variants: twoIdentifiedVariants },
    { productGroupID: " pancake-product-1 ", variesBy: ["SIZE" as const], variants: twoIdentifiedVariants },
    { productGroupID: "p".repeat(129), variesBy: ["SIZE" as const], variants: twoIdentifiedVariants },
    // Looks structurally valid, but no reviewed variant identifier exists.
    {
      productGroupID: "pancake-product-1",
      variesBy: ["SIZE" as const],
      variants: [
        oneVariant,
        { ...oneVariant, url: "https://shop.example.com/shop/ao-oxford-relaxed?variant=pv-b", size: "L" },
      ],
    },
    // A manufacturer MPN must distinguish variants rather than being duplicated across the family.
    {
      productGroupID: "pancake-product-1",
      variesBy: ["SIZE" as const],
      variants: twoIdentifiedVariants.map((variant) => ({ ...variant, mpn: "DUP" })),
    },
  ]) {
    const serialized = JSON.stringify(
      buildProductStructuredData({
        origin: "https://shop.example.com",
        product,
        variantOptions: onePriceOptions,
        productGroup,
      }),
    );

    for (const forbidden of ["ProductGroup", "hasVariant", "productGroupID", "variesBy"]) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  }
});

test("U27 serializer publishes ProductGroup only with unique reviewed MPNs", () => {
  const structured = buildProductStructuredData({
    origin: "https://shop.example.com",
    product,
    variantOptions: onePriceOptions,
    productGroup: {
      productGroupID: "pancake-product-1",
      variesBy: ["SIZE"],
      variants: twoIdentifiedVariants,
    },
  });

  const group = structured["@graph"][0];
  assert.equal(group["@type"], "ProductGroup");
  assert.deepEqual(group.hasVariant.map((variant) => variant.mpn), ["A132-M", "A132-L"]);
  assert.equal("offers" in group, false);
});

test("P14 omits invented product and merchant-policy facts", () => {
  const structured = buildProductStructuredData({
    origin: "https://shop.example.com",
    product: {
      ...product,
      editorialDescription: null,
      media: { gallery: [] },
    },
    variantOptions: onePriceOptions,
  });
  const productNode = structured["@graph"][0];

  assert.equal("description" in productNode, false);
  assert.equal("image" in productNode, false);
  for (const forbidden of [
    "aggregateRating",
    "review",
    "gtin",
    "gtin13",
    "gtin14",
    "material",
    "shippingDetails",
    "hasMerchantReturnPolicy",
  ]) {
    assert.equal(forbidden in productNode, false, forbidden);
  }
});

test("P14 builds minimal factual Organization and WebSite entities from the validated storefront origin", () => {
  assert.deepEqual(buildSiteStructuredData({ origin: "https://shop.example.com" }), {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": "https://shop.example.com/#organization",
        name: "LA Clothing",
        url: "https://shop.example.com/",
      },
      {
        "@type": "WebSite",
        "@id": "https://shop.example.com/#website",
        name: "LA Clothing",
        url: "https://shop.example.com/",
        publisher: {
          "@id": "https://shop.example.com/#organization",
        },
      },
    ],
  });
});

test("P14 JSON-LD serialization neutralizes closing-script injection", () => {
  const serialized = serializeJsonLd({
    "@context": "https://schema.org",
    "@type": "Product",
    name: "</script><script>alert('p14')</script>",
  });

  assert.equal(serialized.includes("<"), false);
  assert.equal(serialized.includes("</script>"), false);
  assert.match(serialized, /\\u003c\/script>/);
});


/**
 * U32a / W5. `sku` is the website-owned `VariantMirror.sku` - Schema.org's merchant-specific
 * identifier. It is deliberately a different fact from `mpn`, which ADR 0008 fixes as the
 * owner-confirmed manufacturer identifier mirrored from Pancake `display_id`. Publishing one must
 * never publish the other, and neither may stand in for the other.
 */
test("U32a publishes the website-owned SKU on the variant node it belongs to", () => {
  const structured = buildProductStructuredData({
    origin: "https://shop.example.com",
    product,
    variantOptions: onePriceOptions,
    productGroup: {
      productGroupID: "pancake-product-1",
      variesBy: ["SIZE"],
      variants: [
        { ...twoIdentifiedVariants[0], sku: "LA-OXF-M" },
        { ...twoIdentifiedVariants[1], sku: "LA-OXF-L" },
      ],
    },
  });

  const group = structured["@graph"][0];
  assert.equal(group["@type"], "ProductGroup");
  assert.deepEqual(
    group.hasVariant.map((variant) => variant.sku),
    ["LA-OXF-M", "LA-OXF-L"],
    "each variant node carries its own SKU, never a sibling's",
  );
  assert.deepEqual(
    group.hasVariant.map((variant) => variant.mpn),
    ["A132-M", "A132-L"],
    "ADR 0008 MPNs are untouched by the SKU that sits beside them",
  );
});

test("U32a omits SKU rather than publishing a junk value", () => {
  const unpublishable = [null, undefined, "", "   ", " LA-OXF-M", "LA-OXF-M ", "L".repeat(129)];
  for (const sku of unpublishable) {
    const structured = buildProductStructuredData({
      origin: "https://shop.example.com",
      product,
      variantOptions: onePriceOptions,
      productGroup: {
        productGroupID: "pancake-product-1",
        variesBy: ["SIZE"],
        variants: [
          { ...twoIdentifiedVariants[0], sku },
          { ...twoIdentifiedVariants[1], sku: "LA-OXF-L" },
        ],
      },
    });

    const group = structured["@graph"][0];
    assert.equal(group["@type"], "ProductGroup");
    assert.equal(
      "sku" in group.hasVariant[0],
      false,
      `an unpublishable SKU must be absent, not empty or placeholder: ${JSON.stringify(sku)}`,
    );
    assert.equal(
      group.hasVariant[1].sku,
      "LA-OXF-L",
      "one variant's unpublishable SKU must not suppress a sibling's good one",
    );
  }
});

/**
 * Fail-closed on GTIN. `VariantMirror.pancakeBarcode` is a mirrored external value whose upstream
 * type, format, check digit and lifecycle are unproven, so nothing may map it to a GTIN property.
 * This asserts the absence structurally rather than trusting that no one wired it up.
 */
test("U32a publishes no GTIN property anywhere, whatever the catalog holds", () => {
  const structured = buildProductStructuredData({
    origin: "https://shop.example.com",
    product,
    variantOptions: onePriceOptions,
    productGroup: {
      productGroupID: "pancake-product-1",
      variesBy: ["SIZE"],
      variants: [
        // A 13-digit EAN shape. Looking like a GTIN is not being one.
        { ...twoIdentifiedVariants[0], sku: "4006381333931" },
        { ...twoIdentifiedVariants[1], sku: "LA-OXF-L" },
      ],
    },
  });

  const serialized = serializeJsonLd(structured);
  for (const property of ["gtin", "gtin8", "gtin12", "gtin13", "gtin14", "isbn"]) {
    assert.equal(
      new RegExp(`"${property}"\\s*:`).test(serialized),
      false,
      `${property} must never be published from an unproven barcode or a SKU that resembles one`,
    );
  }
  const group = structured["@graph"][0];
  assert.equal(group["@type"], "ProductGroup");
  assert.equal(
    group.hasVariant[0].sku,
    "4006381333931",
    "a GTIN-shaped value still publishes as the SKU it actually is",
  );
});


/**
 * U32b guard. Organization enrichment - logo, sameAs, contactPoint, address - is blocked by B2
 * because no owner-approved first-party contact fact exists. This asserts the Organization entity
 * stays exactly as narrow as it is, so a later product-schema slice cannot quietly widen it.
 */
test("U32b publishes no unapproved Organization fact", () => {
  const site = buildSiteStructuredData({ origin: "https://shop.example.com" });
  const organization = site["@graph"][0];

  assert.equal(organization["@type"], "Organization");
  assert.deepEqual(
    Object.keys(organization).sort(),
    ["@id", "@type", "name", "url"],
    "the Organization entity must carry no fact beyond its identity and canonical URL",
  );

  const serialized = serializeJsonLd(site);
  for (const blocked of [
    "address",
    "contactPoint",
    "sameAs",
    "logo",
    "telephone",
    "email",
    "founder",
    "foundingDate",
    "vatID",
    "taxID",
  ]) {
    assert.equal(
      new RegExp(`"${blocked}"\\s*:`).test(serialized),
      false,
      `${blocked} is owner-blocked by B2 and must not be published`,
    );
  }
});
