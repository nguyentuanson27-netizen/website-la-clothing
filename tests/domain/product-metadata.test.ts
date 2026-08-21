import assert from "node:assert/strict";
import test from "node:test";

import { buildStorefrontProductMetadata } from "../../src/seo/product-metadata.ts";

const trustedPrimary = {
  url: "https://content.pancake.vn/1/2/3/4/ao-oxford.jpg",
  alt: "Áo Oxford Relaxed",
};

const baseProduct = {
  slug: "ao-oxford-relaxed",
  name: "Áo Oxford Relaxed",
  seoTitle: "Áo Oxford Relaxed nam",
  seoDescription: "Áo Oxford Relaxed của LA Clothing với phom hiện đại và thông tin sản phẩm đã được biên tập.",
  media: {
    primary: trustedPrimary,
  },
};

test("P13 builds canonical PDP metadata from published website-owned SEO fields and trusted product media", () => {
  const metadata = buildStorefrontProductMetadata({
    origin: "https://shop.example.com",
    indexingEnabled: true,
    product: baseProduct,
  });

  assert.equal(metadata.title, baseProduct.seoTitle);
  assert.equal(metadata.description, baseProduct.seoDescription);
  assert.deepEqual(metadata.alternates, {
    canonical: "https://shop.example.com/shop/ao-oxford-relaxed",
  });
  assert.deepEqual(metadata.openGraph, {
    type: "website",
    locale: "vi_VN",
    siteName: "LA Clothing",
    title: baseProduct.seoTitle,
    description: baseProduct.seoDescription,
    url: "https://shop.example.com/shop/ao-oxford-relaxed",
    images: [
      {
        url: trustedPrimary.url,
        alt: trustedPrimary.alt,
      },
    ],
  });
  assert.deepEqual(metadata.twitter, {
    card: "summary_large_image",
    title: baseProduct.seoTitle,
    description: baseProduct.seoDescription,
    images: [
      {
        url: trustedPrimary.url,
        alt: trustedPrimary.alt,
      },
    ],
  });
});

test("P13 falls back to factual product identity and a semantic website-owned social card", () => {
  const metadata = buildStorefrontProductMetadata({
    origin: "https://shop.example.com",
    indexingEnabled: true,
    product: {
      ...baseProduct,
      seoTitle: null,
      seoDescription: null,
      media: { primary: null },
    },
  });

  assert.equal(metadata.title, "Áo Oxford Relaxed");
  assert.equal(metadata.description, "Khám phá Áo Oxford Relaxed từ LA Clothing.");
  assert.deepEqual(metadata.openGraph?.images, [
    {
      url: "https://shop.example.com/la-clothing-modern-menswear-social-card.png",
      alt: "LA Clothing — Modern Menswear",
    },
  ]);
  assert.deepEqual(metadata.twitter?.images, [
    {
      url: "https://shop.example.com/la-clothing-modern-menswear-social-card.png",
      alt: "LA Clothing — Modern Menswear",
    },
  ]);
});

test("P13 never rewrites trusted remote Pancake media through a website proxy or storage path", () => {
  const metadata = buildStorefrontProductMetadata({
    origin: "https://shop.example.com",
    indexingEnabled: true,
    product: baseProduct,
  });

  const openGraphImages = metadata.openGraph?.images;
  const twitterImages = metadata.twitter?.images;
  assert.ok(Array.isArray(openGraphImages));
  assert.ok(Array.isArray(twitterImages));
  assert.equal(openGraphImages[0]?.url, trustedPrimary.url);
  assert.equal(twitterImages[0]?.url, trustedPrimary.url);
});

test("P13 withholds the canonical tag while search indexing is disabled", () => {
  const metadata = buildStorefrontProductMetadata({
    origin: "https://la.lanadesign.vn",
    indexingEnabled: false,
    product: baseProduct,
  });

  assert.equal(metadata.alternates, undefined);
  assert.equal(metadata.openGraph?.url, "https://la.lanadesign.vn/shop/ao-oxford-relaxed");
});
