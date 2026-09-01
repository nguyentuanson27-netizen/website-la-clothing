import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStorefrontCartLines,
  type StorefrontCartProduct,
} from "../../src/commerce/storefront-cart.ts";

/** A normal public product with two purchasable variants. */
const standaloneProduct: StorefrontCartProduct = {
  slug: "relaxed-shirt",
  pancakeProductId: "pancake-product-1",
  name: "Relaxed Shirt",
  isPresent: true,
  isActive: true,
  variants: [
    {
      id: "clx0000internalvariant1",
      pancakeVariationId: "pancake-variation-1",
      isPresent: true,
      isActive: true,
      color: "Black",
      size: "M",
      sellableStock: 3,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
    {
      id: "clx0000internalvariant2",
      pancakeVariationId: "pancake-variation-2",
      isPresent: true,
      isActive: true,
      color: "Black",
      size: "L",
      sellableStock: 0,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
  ],
};

/**
 * A composite component: its owning product is not public, but the component is purchasable through
 * the parent set, and the line the buyer committed to is still a real variation.
 */
const compositeComponentProduct: StorefrontCartProduct = {
  slug: "component-tee",
  pancakeProductId: "pancake-product-component",
  name: "Component Tee",
  isPresent: true,
  isActive: false,
  variants: [
    {
      id: "clx0000internalcomponent1",
      pancakeVariationId: "pancake-variation-component",
      isPresent: true,
      isActive: true,
      isCompositeComponentAvailable: true,
      color: "White",
      size: "M",
      sellableStock: 5,
      retailPrice: 250_000,
      retailPriceAfterDiscount: 250_000,
    },
  ],
};

test("T4 a resolved standalone cart line carries the purchased variation external identity", () => {
  const [line] = buildStorefrontCartLines({
    items: [{ variantId: "clx0000internalvariant1", quantity: 1 }],
    products: [standaloneProduct],
  });

  assert.equal(line?.pancakeVariationId, "pancake-variation-1");
  assert.equal(line?.pancakeProductId, "pancake-product-1");
  assert.equal(line?.available, true);
});

test("T4 the internal variant id stays the mutation identity and is never the external one", () => {
  const [line] = buildStorefrontCartLines({
    items: [{ variantId: "clx0000internalvariant1", quantity: 1 }],
    products: [standaloneProduct],
  });

  assert.equal(line?.variantId, "clx0000internalvariant1", "mutation identity is preserved");
  assert.notEqual(
    line?.pancakeVariationId,
    line?.variantId,
    "the local id must never be substituted as vendor identity",
  );
  assert.notEqual(line?.pancakeProductId, line?.productSlug, "a slug is not product identity");
});

test("T4 a composite component line preserves its variation identity despite a private owner", () => {
  const [line] = buildStorefrontCartLines({
    items: [{ variantId: "clx0000internalcomponent1", quantity: 1 }],
    products: [compositeComponentProduct],
  });

  assert.equal(line?.available, true);
  assert.equal(
    line?.pancakeVariationId,
    "pancake-variation-component",
    "the purchased variation identity survives a non-public owner",
  );
  // Public product identity follows the same rule as the public slug: withheld for a private owner.
  assert.equal(line?.productSlug, null);
  assert.equal(line?.pancakeProductId, null);
});

test("T4 an unresolvable line never fabricates an external identity", () => {
  const [line] = buildStorefrontCartLines({
    items: [{ variantId: "clx0000nolongerinthecatalog", quantity: 1 }],
    products: [standaloneProduct],
  });

  assert.equal(line?.available, false);
  assert.equal(line?.unavailableReason, "VARIANT_UNAVAILABLE");
  assert.equal(line?.pancakeVariationId, null);
  assert.equal(line?.pancakeProductId, null);
  assert.equal(line?.variantId, "clx0000nolongerinthecatalog", "the requested id is still reported");
});

test("T4 a line whose variant vanished from a known product still fabricates nothing", () => {
  const [line] = buildStorefrontCartLines({
    items: [{ variantId: "clx0000removedvariant", quantity: 1 }],
    products: [
      { ...standaloneProduct, variants: [...standaloneProduct.variants] },
      // The owning product is known, but this variant id is not one of its variants.
    ],
  });

  assert.equal(line?.pancakeVariationId, null);
  assert.equal(line?.available, false);
});

test("T4 an unavailable but resolvable line still reports the real variation identity", () => {
  const soldOut = buildStorefrontCartLines({
    items: [{ variantId: "clx0000internalvariant2", quantity: 5 }],
    products: [standaloneProduct],
  })[0];

  assert.equal(soldOut?.available, false);
  assert.equal(
    soldOut?.pancakeVariationId,
    "pancake-variation-2",
    "the buyer committed to a real variation; identity is not lost with availability",
  );
});

test("T4 identity is per line, so two lines never share one variation identity", () => {
  const lines = buildStorefrontCartLines({
    items: [
      { variantId: "clx0000internalvariant1", quantity: 1 },
      { variantId: "clx0000internalvariant2", quantity: 1 },
    ],
    products: [standaloneProduct],
  });

  assert.deepEqual(
    lines.map((line) => line.pancakeVariationId),
    ["pancake-variation-1", "pancake-variation-2"],
  );
});

test("T4 existing price, availability and privacy behaviour is unchanged", () => {
  const [line] = buildStorefrontCartLines({
    items: [{ variantId: "clx0000internalvariant1", quantity: 1 }],
    products: [standaloneProduct],
  });

  assert.equal(line?.price, 590_000);
  assert.equal(line?.productSlug, "relaxed-shirt");
  assert.equal(line?.productName, "Relaxed Shirt");
  assert.equal(line?.color, "Black");
  assert.equal(line?.size, "M");
  assert.equal("sellableStock" in (line ?? {}), false, "exact stock stays server-side");
});
