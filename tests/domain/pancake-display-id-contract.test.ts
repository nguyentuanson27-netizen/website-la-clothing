import assert from "node:assert/strict";
import test from "node:test";

import {
  PancakeCatalogContractError,
  parsePancakeCatalogVariations,
} from "../../src/integrations/pancake/catalog-contract.ts";

function payload() {
  return {
    success: true,
    page_number: 1,
    page_size: 100,
    total_entries: 1,
    total_pages: 1,
    data: [
      {
        id: "variation-1",
        product_id: "product-1",
        display_id: "A132-M" as unknown,
        barcode: "145-1",
        fields: [
          { id: "field-color", keyValue: "color", name: "Color", value: "Black" },
          { id: "field-size", keyValue: "size", name: "Size", value: "M" },
        ],
        images: [],
        is_hidden: false,
        is_locked: false,
        retail_price: 500_000,
        retail_price_after_discount: 500_000,
        product: {
          id: "product-1",
          name: "Áo A132",
          note_product: null,
          image: null,
        },
        variations_warehouses: [],
      },
    ],
  };
}

function assertIdentityFailure(value: unknown) {
  const malformed = payload();
  malformed.data[0]!.display_id = value;

  assert.throws(
    () => parsePancakeCatalogVariations(malformed),
    (error: unknown) => {
      assert.ok(error instanceof PancakeCatalogContractError);
      assert.equal(error.reason, "variation-identity");
      return true;
    },
  );
}

test("Pancake catalog contract preserves a valid display_id as the upstream manufacturer-SKU candidate", () => {
  const parsed = parsePancakeCatalogVariations(payload());
  assert.equal(parsed.variations[0]?.displayId, "A132-M");
});

test("Pancake catalog contract normalizes missing or null display_id to null without inventing an identifier", () => {
  const missing = payload();
  delete (missing.data[0] as Record<string, unknown>).display_id;
  assert.equal(parsePancakeCatalogVariations(missing).variations[0]?.displayId, null);

  const explicitNull = payload();
  explicitNull.data[0]!.display_id = null;
  assert.equal(parsePancakeCatalogVariations(explicitNull).variations[0]?.displayId, null);
});

test("Pancake catalog contract fails closed when display_id is present with a non-string type", () => {
  assertIdentityFailure(123);
  assertIdentityFailure({ value: "A132-M" });
  assertIdentityFailure(["A132-M"]);
});
