/**
 * U12 / M2 — `/shop/<slug>?variant=<pancakeVariationId>`.
 *
 * The safety property under test is structural rather than procedural: resolution never looks the
 * query value up in the database. It matches only inside the projection the page already built for
 * this product, which is the authorized public option set. A forged id, an id belonging to another
 * product, an inactive or private variation and a composite component are therefore all the same
 * case — absent from that list — and all fail closed to base-PDP behaviour without a lookup.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_VARIANT_QUERY_LENGTH,
  VARIANT_QUERY_PARAM,
  readVariantQueryValue,
  resolveDeepLinkedVariantSelection,
} from "../../src/commerce/storefront-variant-deep-link.ts";
import type {
  StorefrontProductProjection,
  StorefrontProjectionOption,
} from "../../src/commerce/storefront-projection.ts";

function option(overrides: Partial<StorefrontProjectionOption> = {}): StorefrontProjectionOption {
  return {
    id: "variant-mirror-cuid",
    pancakeVariationId: "pv-1",
    color: "Đen",
    size: "M",
    price: 890_000,
    purchasable: true,
    unavailableReason: null,
    kindKey: null,
    kindLabel: null,
    ...overrides,
  };
}

const standalone: StorefrontProductProjection = {
  mode: "standalone",
  options: [
    option({ id: "cuid-a", pancakeVariationId: "pv-a", color: "Đen", size: "M" }),
    option({ id: "cuid-b", pancakeVariationId: "pv-b", color: "Đen", size: "L", price: 910_000 }),
    option({ id: "cuid-c", pancakeVariationId: "pv-c", color: "Kem", size: "M" }),
  ],
};

test("U12 the query parameter is the reviewed one", () => {
  assert.equal(VARIANT_QUERY_PARAM, "variant");
});

test("U12 a valid standalone variation preselects exactly that option", () => {
  const selection = resolveDeepLinkedVariantSelection({
    projection: standalone,
    variantQuery: "pv-b",
  });

  assert.deepEqual(selection, { kindKey: null, color: "Đen", size: "L", variantId: "cuid-b" });
});

test("U12 a different valid variation preselects its own option, not the first", () => {
  const selection = resolveDeepLinkedVariantSelection({
    projection: standalone,
    variantQuery: "pv-c",
  });

  assert.deepEqual(selection, { kindKey: null, color: "Kem", size: "M", variantId: "cuid-c" });
});

test("U12 a forged variation id selects nothing", () => {
  for (const forged of ["pv-does-not-exist", "../../etc/passwd", "%00", "pv-a "]) {
    assert.equal(
      resolveDeepLinkedVariantSelection({ projection: standalone, variantQuery: forged }),
      null,
      `${forged} must not preselect`,
    );
  }
});

test("U12 the internal VariantMirror id is never accepted as the external query identity", () => {
  // Passing the local CUID must behave exactly like a forged value. If this ever resolved, the
  // internal mutation identity would have become a guessable public addressing key.
  assert.equal(
    resolveDeepLinkedVariantSelection({ projection: standalone, variantQuery: "cuid-a" }),
    null,
  );
});

test("U12 a stale or inactive variation absent from the projection selects nothing", () => {
  // A variation that was deleted, deactivated or made private upstream is simply not in the
  // authorized option list the page built, so it cannot be addressed.
  const withoutB: StorefrontProductProjection = {
    mode: "standalone",
    options: standalone.options.filter((entry) => entry.pancakeVariationId !== "pv-b"),
  };

  assert.equal(
    resolveDeepLinkedVariantSelection({ projection: withoutB, variantQuery: "pv-b" }),
    null,
  );
});

test("U12 a variation belonging to another product selects nothing", () => {
  // Resolution is scoped to this product's own projection, so another product's real, currently
  // valid variation id is indistinguishable from a forged one here.
  assert.equal(
    resolveDeepLinkedVariantSelection({ projection: standalone, variantQuery: "pv-other-product" }),
    null,
  );
});

test("U12 a valid current variation that is merely sold out stays addressable", () => {
  // Whether an external identity is valid, current and addressable is a different question from
  // whether it can be bought right now. A present, active, sold-out variation is still the one the
  // link names, and refusing it would send the shopper to a vague "from" price instead of that
  // variant's exact sold-out state. Add-to-bag is blocked by the selection model, not here.
  const projection: StorefrontProductProjection = {
    mode: "standalone",
    options: [
      option({
        id: "cuid-oos",
        pancakeVariationId: "pv-oos",
        purchasable: false,
        unavailableReason: "OUT_OF_STOCK",
      }),
    ],
  };

  assert.deepEqual(
    resolveDeepLinkedVariantSelection({ projection, variantQuery: "pv-oos" }),
    { kindKey: null, color: "Đen", size: "M", variantId: "cuid-oos" },
  );
});

test("U12 an option the catalog cannot resolve to one concrete choice is refused", () => {
  // These two are identity problems rather than stock problems: the catalog cannot say which
  // concrete option the id names, so there is nothing safe to preselect.
  for (const unresolvable of ["MAPPING_REQUIRED", "AMBIGUOUS_OPTION"] as const) {
    const projection: StorefrontProductProjection = {
      mode: "standalone",
      options: [
        option({
          pancakeVariationId: "pv-unresolvable",
          purchasable: false,
          unavailableReason: unresolvable,
        }),
      ],
    };

    assert.equal(
      resolveDeepLinkedVariantSelection({ projection, variantQuery: "pv-unresolvable" }),
      null,
      `${unresolvable} must not preselect`,
    );
  }
});

test("U12 a variation whose price cannot be resolved is still addressable", () => {
  // PRICE_UNRESOLVED is a pricing fact, not an identity one, so the variation remains the one the
  // link names and the page shows its real unavailable state.
  const projection: StorefrontProductProjection = {
    mode: "standalone",
    options: [
      option({
        id: "cuid-unpriced",
        pancakeVariationId: "pv-unpriced",
        price: null,
        purchasable: false,
        unavailableReason: "PRICE_UNRESOLVED",
      }),
    ],
  };

  assert.equal(
    resolveDeepLinkedVariantSelection({ projection, variantQuery: "pv-unpriced" })?.variantId,
    "cuid-unpriced",
  );
});

test("U12 a composite product rejects the deep link entirely", () => {
  // M2 is standalone-only. A composite component variation must never become addressable through
  // the parent's URL, even when the id is real and currently purchasable.
  const composite: StorefrontProductProjection = {
    mode: "composite",
    options: [
      option({ pancakeVariationId: "pv-component", kindKey: "ao-thun", kindLabel: "Áo thun" }),
    ],
  };

  assert.equal(
    resolveDeepLinkedVariantSelection({ projection: composite, variantQuery: "pv-component" }),
    null,
  );
});

test("U12 an ambiguous projection never guesses which option was meant", () => {
  const duplicated: StorefrontProductProjection = {
    mode: "standalone",
    options: [
      option({ id: "cuid-x", pancakeVariationId: "pv-dup", size: "M" }),
      option({ id: "cuid-y", pancakeVariationId: "pv-dup", size: "L" }),
    ],
  };

  assert.equal(
    resolveDeepLinkedVariantSelection({ projection: duplicated, variantQuery: "pv-dup" }),
    null,
  );
});

test("U12 the query value is bounded before it is matched", () => {
  const atBound = "x".repeat(MAX_VARIANT_QUERY_LENGTH);
  const overBound = "x".repeat(MAX_VARIANT_QUERY_LENGTH + 1);

  assert.equal(readVariantQueryValue(atBound), atBound);
  assert.equal(readVariantQueryValue(overBound), null);
});

test("U12 absent, empty and repeated query values resolve to no preselection", () => {
  assert.equal(readVariantQueryValue(undefined), null);
  assert.equal(readVariantQueryValue(""), null);
  // A repeated `?variant=a&variant=b` is ambiguous about which was intended; choosing one would be
  // a guess, so neither is used.
  assert.equal(readVariantQueryValue(["pv-a", "pv-b"]), null);
  assert.equal(readVariantQueryValue(["pv-a"]), null);
});

test("U12 a null query resolves to no preselection without touching the projection", () => {
  assert.equal(
    resolveDeepLinkedVariantSelection({ projection: standalone, variantQuery: null }),
    null,
  );
});
