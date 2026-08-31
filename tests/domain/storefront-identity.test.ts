import assert from "node:assert/strict";
import test from "node:test";

import { buildStorefrontProductProjection } from "../../src/commerce/storefront-projection.ts";
import {
  buildStorefrontVariantOptions,
  toStorefrontSelectableOptions,
  type StorefrontVariantFacts,
} from "../../src/commerce/storefront-product.ts";

function variant(
  id: string,
  pancakeVariationId: string,
  size: string,
  overrides: Partial<StorefrontVariantFacts> = {},
): StorefrontVariantFacts {
  return {
    id,
    pancakeVariationId,
    color: null,
    size,
    sellableStock: 2,
    retailPrice: 590_000,
    retailPriceAfterDiscount: 590_000,
    ...overrides,
  };
}

test("T4 a concrete option carries variation identity alongside the internal mutation id", () => {
  const [option] = toStorefrontSelectableOptions(
    buildStorefrontVariantOptions([variant("clx0000internal1", "pancake-variation-1", "M")]),
  );

  assert.equal(option?.id, "clx0000internal1", "the mutation identity is unchanged");
  assert.equal(option?.pancakeVariationId, "pancake-variation-1");
  assert.notEqual(option?.pancakeVariationId, option?.id);
});

test("T4 every projected standalone option carries its own variation identity", () => {
  const projection = buildStorefrontProductProjection({
    parentVariants: [
      variant("clx0000internal1", "pancake-variation-1", "M"),
      variant("clx0000internal2", "pancake-variation-2", "L"),
    ],
    componentGroups: [],
    hasCompositeGraph: false,
  });

  assert.equal(projection.mode, "standalone");
  assert.deepEqual(
    projection.options.map((option) => option.pancakeVariationId),
    ["pancake-variation-1", "pancake-variation-2"],
  );
});

test("T4 a presentation kindKey never stands in for external identity", () => {
  const projection = buildStorefrontProductProjection({
    parentVariants: [variant("clx0000set1", "pancake-variation-set", "M")],
    componentGroups: [
      { label: "Áo A", variants: [variant("clx0000shirt1", "pancake-variation-shirt", "M")] },
      { label: "Quần A", variants: [variant("clx0000pants1", "pancake-variation-pants", "M")] },
    ],
    hasCompositeGraph: true,
  });

  assert.equal(projection.mode, "composite");
  for (const option of projection.options) {
    assert.ok(option.pancakeVariationId, "every composite option keeps a real variation identity");
    assert.notEqual(
      option.pancakeVariationId,
      option.kindKey,
      "a grouping key is presentation, never identity",
    );
    assert.notEqual(option.pancakeVariationId, option.id);
  }

  // Component options are distinct variations, not one identity shared across a kind group.
  const identities = projection.options.map((option) => option.pancakeVariationId);
  assert.equal(new Set(identities).size, identities.length, "identities are per variation");
});
