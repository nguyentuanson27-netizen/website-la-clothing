import assert from "node:assert/strict";
import test from "node:test";

import { deriveStorefrontSelection } from "../../src/commerce/storefront-selection.ts";
import { buildStorefrontVariantOptions } from "../../src/commerce/storefront-product.ts";

const options = buildStorefrontVariantOptions([
  {
    id: "black-m",
    pancakeVariationId: "pancake-black-m",
    color: "Black",
    size: "M",
    sellableStock: 3,
    retailPrice: 590_000,
    retailPriceAfterDiscount: 590_000,
  },
  {
    id: "black-l-sold-out",
    pancakeVariationId: "pancake-black-l-sold-out",
    color: "Black",
    size: "L",
    sellableStock: 0,
    retailPrice: 590_000,
    retailPriceAfterDiscount: 590_000,
  },
  {
    id: "stone-m",
    pancakeVariationId: "pancake-stone-m",
    color: "Stone",
    size: "M",
    sellableStock: 2,
    retailPrice: 620_000,
    retailPriceAfterDiscount: 620_000,
  },
  {
    id: "stone-l",
    pancakeVariationId: "pancake-stone-l",
    color: "Stone",
    size: "L",
    sellableStock: 1,
    retailPrice: 620_000,
    retailPriceAfterDiscount: 620_000,
  },
  {
    id: "olive-xl-unresolved",
    pancakeVariationId: "pancake-olive-xl-unresolved",
    color: "Olive",
    size: "XL",
    sellableStock: 1,
    retailPrice: 650_000,
    retailPriceAfterDiscount: 600_000,
  },
]);

test("storefront selection exposes only options with at least one purchasable combination", () => {
  const state = deriveStorefrontSelection(options, { color: null, size: null });

  assert.equal(state.hasColorOptions, true);
  assert.deepEqual(state.colors, [
    { value: "Black", disabled: false },
    { value: "Stone", disabled: false },
    { value: "Olive", disabled: true },
  ]);
  assert.deepEqual(state.sizes, [
    { value: "M", disabled: false },
    { value: "L", disabled: false },
    { value: "XL", disabled: true },
  ]);
  assert.equal(state.selectedVariantId, null);
  assert.equal(state.selectedPrice, null);
  assert.equal(state.canAdd, false);
});

test("storefront selection disables impossible sizes for the chosen color", () => {
  const state = deriveStorefrontSelection(options, { color: "Black", size: null });

  assert.deepEqual(state.sizes, [
    { value: "M", disabled: false },
    { value: "L", disabled: true },
    { value: "XL", disabled: true },
  ]);
  assert.equal(state.selectedVariantId, null);
  assert.equal(state.canAdd, false);
});

test("storefront selection resolves one exact purchasable Color x Size pair", () => {
  const state = deriveStorefrontSelection(options, { color: "Stone", size: "L" });

  assert.equal(state.selectedVariantId, "stone-l");
  assert.equal(state.selectedPrice, 620_000);
  assert.equal(state.canAdd, true);
});

test("storefront selection resolves a size-only product without requiring color", () => {
  const sizeOnlyOptions = buildStorefrontVariantOptions([
    {
      id: "size-only-m",
      pancakeVariationId: "pancake-size-only-m",
      color: null,
      size: "M",
      sellableStock: 2,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
    {
      id: "size-only-l",
      pancakeVariationId: "pancake-size-only-l",
      color: null,
      size: "L",
      sellableStock: 1,
      retailPrice: 620_000,
      retailPriceAfterDiscount: 620_000,
    },
  ]);

  const empty = deriveStorefrontSelection(sizeOnlyOptions, { color: null, size: null });
  assert.equal(empty.hasColorOptions, false);
  assert.deepEqual(empty.colors, []);
  assert.deepEqual(empty.sizes, [
    { value: "M", disabled: false },
    { value: "L", disabled: false },
  ]);
  assert.equal(empty.canAdd, false);

  const selected = deriveStorefrontSelection(sizeOnlyOptions, { color: null, size: "L" });
  assert.equal(selected.selectedVariantId, "size-only-l");
  assert.equal(selected.selectedPrice, 620_000);
  assert.equal(selected.canAdd, true);
});

test("storefront selection names a sold-out combination but refuses to add it", () => {
  // Being selected and being addable are separate facts. The shopper picked a concrete existing
  // combination, so the panel must show that variant's own price and say it is out of stock —
  // not fall back to a vague range as if nothing were chosen. Only `canAdd` is withheld.
  const soldOut = deriveStorefrontSelection(options, { color: "Black", size: "L" });
  assert.equal(soldOut.selectedVariantId, "black-l-sold-out");
  assert.equal(soldOut.selectedPrice, 590_000);
  assert.equal(soldOut.selectedUnavailableReason, "OUT_OF_STOCK");
  assert.equal(soldOut.canAdd, false);
});

test("storefront selection fails closed for a combination that does not exist", () => {
  const unknown = deriveStorefrontSelection(options, { color: "Unknown", size: "M" });
  assert.equal(unknown.selectedVariantId, null);
  assert.equal(unknown.selectedPrice, null);
  assert.equal(unknown.selectedUnavailableReason, null);
  assert.equal(unknown.canAdd, false);
});

test("storefront selection keeps another purchasable color reachable when the current size is incompatible", () => {
  const disjointOptions = buildStorefrontVariantOptions([
    {
      id: "black-small",
      pancakeVariationId: "pancake-black-small",
      color: "Black",
      size: "S",
      sellableStock: 1,
      retailPrice: 590_000,
      retailPriceAfterDiscount: 590_000,
    },
    {
      id: "stone-large",
      pancakeVariationId: "pancake-stone-large",
      color: "Stone",
      size: "L",
      sellableStock: 1,
      retailPrice: 620_000,
      retailPriceAfterDiscount: 620_000,
    },
  ]);

  const state = deriveStorefrontSelection(disjointOptions, { color: "Black", size: "S" });
  assert.deepEqual(state.colors, [
    { value: "Black", disabled: false },
    { value: "Stone", disabled: false },
  ]);
  assert.deepEqual(state.sizes, [
    { value: "S", disabled: false },
    { value: "L", disabled: true },
  ]);
});

test("storefront selection sorts sizes according to standard clothing order (S, M, L, XL, XXL)", () => {
  const shuffledOptions = buildStorefrontVariantOptions([
    { id: "v-l", pancakeVariationId: "pancake-v-l", color: null, size: "L", sellableStock: 1, retailPrice: 500_000, retailPriceAfterDiscount: 500_000 },
    { id: "v-m", pancakeVariationId: "pancake-v-m", color: null, size: "M", sellableStock: 1, retailPrice: 500_000, retailPriceAfterDiscount: 500_000 },
    { id: "v-xl", pancakeVariationId: "pancake-v-xl", color: null, size: "XL", sellableStock: 1, retailPrice: 500_000, retailPriceAfterDiscount: 500_000 },
    { id: "v-s", pancakeVariationId: "pancake-v-s", color: null, size: "S", sellableStock: 1, retailPrice: 500_000, retailPriceAfterDiscount: 500_000 },
    { id: "v-xxl", pancakeVariationId: "pancake-v-xxl", color: null, size: "XXL", sellableStock: 1, retailPrice: 500_000, retailPriceAfterDiscount: 500_000 },
  ]);

  const state = deriveStorefrontSelection(shuffledOptions, { color: null, size: null });
  assert.deepEqual(
    state.sizes.map((s) => s.value),
    ["S", "M", "L", "XL", "XXL"],
  );
});
