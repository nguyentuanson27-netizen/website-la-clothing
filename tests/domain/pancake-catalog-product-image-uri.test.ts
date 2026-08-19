import assert from "node:assert/strict";
import test from "node:test";

import {
  PancakeCatalogContractError,
  parsePancakeCatalogVariations,
} from "../../src/integrations/pancake/catalog-contract.ts";

function payloadWithProductImage(image: unknown) {
  return {
    success: true,
    page_number: 1,
    page_size: 1,
    total_entries: 1,
    total_pages: 1,
    data: [
      {
        id: "variation-1",
        product_id: "product-1",
        display_id: "DISPLAY-1",
        barcode: "BAR-1",
        fields: [],
        images: [],
        is_hidden: false,
        is_locked: false,
        retail_price: 500_000,
        retail_price_after_discount: 500_000,
        product: {
          id: "product-1",
          name: "Test Shirt",
          note_product: null,
          image,
        },
        variations_warehouses: [],
      },
    ],
  };
}

test("P1 rejects a syntactically invalid documented product image URI", () => {
  assert.throws(
    () => parsePancakeCatalogVariations(payloadWithProductImage("not a uri")),
    (error: unknown) => {
      assert.ok(error instanceof PancakeCatalogContractError);
      assert.equal(error.reason, "variation-product-image");
      return true;
    },
  );
});

test("P1 accepts URI syntax without applying P3 HTTPS/origin trust policy", () => {
  const result = parsePancakeCatalogVariations(payloadWithProductImage("http://example.test/product.jpg"));
  assert.equal(result.variations[0]?.product.primaryImageUrl, "http://example.test/product.jpg");
});
