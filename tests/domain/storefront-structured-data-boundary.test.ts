import assert from "node:assert/strict";
import test from "node:test";

import { buildStorefrontProductStructuredData } from "../../src/seo/storefront-product-structured-data.ts";

const baseProduct = {
  slug: "set-a",
  name: "Set A",
  editorialDescription: null,
  media: { gallery: [] },
  variants: [
    {
      id: "parent-m",
      pancakeVariationId: "pancake-parent-m",
      color: null,
      size: "M",
      sellableStock: 0,
      retailPrice: 790_000,
      retailPriceAfterDiscount: 790_000,
    },
  ],
};

test("composite child availability cannot make a sold-out parent Product schema InStock", () => {
  const product = {
    ...baseProduct,
    projection: {
      mode: "composite" as const,
      options: [
        {
          id: "parent-m",
          kindKey: "parent",
          kindLabel: "Set",
          color: null,
          size: "M",
          price: 790_000,
          purchasable: false,
          unavailableReason: "OUT_OF_STOCK" as const,
        },
        {
          id: "component-m",
          kindKey: "component:shirt",
          kindLabel: "Ao A",
          color: null,
          size: "M",
          price: 790_000,
          purchasable: true,
          unavailableReason: null,
        },
      ],
    },
  };

  const structured = buildStorefrontProductStructuredData({
    origin: "https://shop.example.com",
    product,
  });

  const productNode = structured["@graph"][0];
  assert.deepEqual(productNode.offers, {
    "@type": "Offer",
    url: "https://shop.example.com/shop/set-a",
    priceCurrency: "VND",
    price: 790_000,
    availability: "https://schema.org/OutOfStock",
  });
});
