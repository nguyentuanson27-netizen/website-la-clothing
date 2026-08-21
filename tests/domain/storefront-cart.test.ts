import assert from "node:assert/strict";
import test from "node:test";

import { buildStorefrontCartLines } from "../../src/commerce/storefront-cart.ts";

const availableProduct = {
  slug: "relaxed-shirt",
  name: "Relaxed Shirt",
  isPresent: true,
  isActive: true,
  variants: [
    {
      id: "available",
      isPresent: true,
      isActive: true,
      color: "Black",
      size: "M",
      sellableStock: 3,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
    {
      id: "sold-out",
      isPresent: true,
      isActive: true,
      color: "Black",
      size: "L",
      sellableStock: 0,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
    {
      id: "inactive-variant",
      isPresent: true,
      isActive: false,
      color: "Stone",
      size: "M",
      sellableStock: 2,
      retailPrice: 620_000,
      retailPriceAfterDiscount: 620_000,
    },
  ],
};

test("cart lines expose current storefront price and availability without exact stock", () => {
  const lines = buildStorefrontCartLines({
    items: [
      { variantId: "available", quantity: 2 },
      { variantId: "sold-out", quantity: 1 },
      { variantId: "inactive-variant", quantity: 1 },
    ],
    products: [availableProduct],
  });

  assert.deepEqual(lines, [
    {
      variantId: "available",
      productSlug: "relaxed-shirt",
      productName: "Relaxed Shirt",
      color: "Black",
      size: "M",
      quantity: 2,
      price: 590_000,
      available: true,
      unavailableReason: null,
      media: { primary: null, gallery: [] },
    },
    {
      variantId: "sold-out",
      productSlug: "relaxed-shirt",
      productName: "Relaxed Shirt",
      color: "Black",
      size: "L",
      quantity: 1,
      price: 590_000,
      available: false,
      unavailableReason: "OUT_OF_STOCK",
      media: { primary: null, gallery: [] },
    },
    {
      variantId: "inactive-variant",
      productSlug: "relaxed-shirt",
      productName: "Relaxed Shirt",
      color: "Stone",
      size: "M",
      quantity: 1,
      price: null,
      available: false,
      unavailableReason: "VARIANT_UNAVAILABLE",
      media: { primary: null, gallery: [] },
    },
  ]);

  assert.equal("sellableStock" in lines[0]!, false);
  assert.equal("retailPrice" in lines[0]!, false);
  assert.equal("retailPriceAfterDiscount" in lines[0]!, false);
});

test("cart line fails closed when its requested quantity exceeds current sellable stock", () => {
  const [line] = buildStorefrontCartLines({
    items: [{ variantId: "available", quantity: 4 }],
    products: [availableProduct],
  });

  assert.deepEqual(line, {
    variantId: "available",
    productSlug: "relaxed-shirt",
    productName: "Relaxed Shirt",
    color: "Black",
    size: "M",
    quantity: 4,
    price: 590_000,
    available: false,
    unavailableReason: "INSUFFICIENT_STOCK",
    media: { primary: null, gallery: [] },
  });
  assert.equal("sellableStock" in line!, false);
});

test("cart lines fail closed when the product or variant cannot be resolved for the storefront", () => {
  const lines = buildStorefrontCartLines({
    items: [
      { variantId: "inactive-product-variant", quantity: 1 },
      { variantId: "unknown-variant", quantity: 1 },
    ],
    products: [
      {
        slug: "archived-jacket",
        name: "Archived Jacket",
        isPresent: false,
        isActive: false,
        variants: [
          {
            id: "inactive-product-variant",
            isPresent: true,
            isActive: true,
            color: "Olive",
            size: "L",
            sellableStock: 4,
            retailPrice: 1_290_000,
            retailPriceAfterDiscount: 1_290_000,
          },
        ],
      },
    ],
  });

  assert.deepEqual(lines[0], {
    variantId: "inactive-product-variant",
    productSlug: "archived-jacket",
    productName: "Archived Jacket",
    color: "Olive",
    size: "L",
    quantity: 1,
    price: null,
    available: false,
    unavailableReason: "PRODUCT_UNAVAILABLE",
    media: { primary: null, gallery: [] },
  });
  assert.deepEqual(lines[1], {
    variantId: "unknown-variant",
    productSlug: null,
    productName: null,
    color: null,
    size: null,
    quantity: 1,
    price: null,
    available: false,
    unavailableReason: "VARIANT_UNAVAILABLE",
    media: { primary: null, gallery: [] },
  });
});

test("cart lines resolve and expose trusted product media when present", () => {
  const productWithMedia = {
    slug: "linen-jacket",
    name: "Linen Jacket",
    primaryImageUrl: "https://content.pancake.vn/images/1/2/3/jacket-main.jpg",
    isPresent: true,
    isActive: true,
    variants: [
      {
        id: "var-1",
        isPresent: true,
        isActive: true,
        color: "Ink",
        size: "M",
        sellableStock: 5,
        retailPrice: 990_000,
        retailPriceAfterDiscount: 990_000,
        imageUrls: ["https://content.pancake.vn/images/1/2/3/jacket-ink.jpg"],
      },
    ],
  };

  const [line] = buildStorefrontCartLines({
    items: [{ variantId: "var-1", quantity: 1 }],
    products: [productWithMedia],
  });

  assert.equal(line?.media.primary?.url, "https://content.pancake.vn/images/1/2/3/jacket-main.jpg");
  assert.equal(line?.media.primary?.alt, "Linen Jacket");
  assert.equal(line?.media.gallery.length, 2);
});
