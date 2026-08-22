import assert from "node:assert/strict";
import test from "node:test";

import { describeGuestShippingPromotion } from "../../src/commerce/guest-shipping-policy.ts";
import { buildPublicBrandFacts } from "../../src/content/public-brand-facts.ts";
import { buildRobotsDocument } from "../../src/seo/robots-policy.ts";
import {
  buildProductStructuredData,
  buildSiteStructuredData,
} from "../../src/seo/structured-data.ts";

const publicOrigin = "https://shop.example.com";

const product = {
  slug: "ao-oxford-relaxed",
  name: "Áo Oxford Relaxed",
  editorialDescription: "Nội dung biên tập đã được LA Clothing xuất bản.",
  media: { gallery: [] },
};

const variantOptions = [
  {
    price: 590_000,
    purchasable: true,
    unavailableReason: null,
  },
] as const;

test("P16 public brand facts expose only approved identity and commerce facts", () => {
  const policy = {
    feeVnd: 25_000,
    freeShippingSubtotalVnd: 750_000,
    freeShippingMinQuantity: 4,
  } as const;

  const facts = buildPublicBrandFacts(policy);

  assert.deepEqual(facts, {
    brandName: "LA Clothing",
    brandSummary: "Minimal, modern menswear by LA Clothing.",
    paymentMethod: "Thanh toán khi nhận hàng (COD).",
    checkoutAccount: "Không cần tài khoản để thanh toán.",
    shipping: describeGuestShippingPromotion(policy),
    serverVerification:
      "Giá, tồn kho và phí vận chuyển được máy chủ kiểm tra lại khi bạn đặt hàng.",
  });

  for (const unsupportedClaim of ["material", "fit", "origin", "returnPolicy"]) {
    assert.equal(unsupportedClaim in facts, false, unsupportedClaim);
  }
});

test("P16 Product brand resolves to the same Organization entity published by the WebSite graph", () => {
  const site = buildSiteStructuredData({ origin: publicOrigin });
  const productStructuredData = buildProductStructuredData({
    origin: publicOrigin,
    product,
    variantOptions,
  });

  const organization = site["@graph"][0];
  const website = site["@graph"][1];
  const productNode = productStructuredData["@graph"][0];

  assert.deepEqual(website.publisher, { "@id": organization["@id"] });
  assert.deepEqual(productNode.brand, { "@id": organization["@id"] });
});

test("P16 robots policy explicitly keeps OAI-SearchBot on the same safe public crawl boundary", () => {
  const expectedRules = [
    {
      userAgent: "*",
      allow: "/",
      disallow: ["/api"],
    },
    {
      userAgent: "OAI-SearchBot",
      allow: "/",
      disallow: ["/api"],
    },
  ];

  assert.deepEqual(
    buildRobotsDocument({ origin: publicOrigin, indexingEnabled: false }),
    { rules: expectedRules },
  );
  assert.deepEqual(
    buildRobotsDocument({ origin: publicOrigin, indexingEnabled: true }),
    {
      rules: expectedRules,
      sitemap: "https://shop.example.com/sitemap.xml",
    },
  );
});
