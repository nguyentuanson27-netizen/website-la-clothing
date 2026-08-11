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
    },
  ]);

  assert.equal("sellableStock" in lines[0]!, false);
  assert.equal("retailPrice" in lines[0]!, false);
  assert.equal("retailPriceAfterDiscount" in lines[0]!, false);
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
  });
});
