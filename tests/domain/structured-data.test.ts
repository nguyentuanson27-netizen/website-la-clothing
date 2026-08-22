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

test("P14 does not claim ProductGroup variant markup without crawlable preselected variant URLs", () => {
  const structured = buildProductStructuredData({
    origin: "https://shop.example.com",
    product,
    variantOptions: onePriceOptions,
  });
  const serialized = JSON.stringify(structured);

  assert.equal(serialized.includes("ProductGroup"), false);
  assert.equal(serialized.includes("hasVariant"), false);
  assert.equal(serialized.includes("productGroupID"), false);
  assert.equal(serialized.includes("variesBy"), false);
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
