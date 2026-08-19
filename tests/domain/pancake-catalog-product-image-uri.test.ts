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

function assertRejectedProductImage(image: string) {
  assert.throws(
    () => parsePancakeCatalogVariations(payloadWithProductImage(image)),
    (error: unknown) => {
      assert.ok(error instanceof PancakeCatalogContractError);
      assert.equal(error.reason, "variation-product-image");
      return true;
    },
  );
}

test("P1 rejects a syntactically invalid documented product image URI", () => {
  assertRejectedProductImage("not a uri");
});

test("P1 rejects malformed raw URI syntax that WHATWG URL parsing can normalize or preserve", () => {
  assertRejectedProductImage("https://example.test/%ZZ");
  assertRejectedProductImage("https://example.test/a b.jpg");
  assertRejectedProductImage("https://example.test/a\tb.jpg");
  assertRejectedProductImage("https://example.test/á.jpg");
  assertRejectedProductImage("https://example.test/a\\b.jpg");
  assertRejectedProductImage("https://example.test/<image>.jpg");
  assertRejectedProductImage("https://example.test/`image`.jpg");
  assertRejectedProductImage("https://example.test/{image}.jpg");
  assertRejectedProductImage("https://example.test/a[b].jpg");
  assertRejectedProductImage("https://example.test/a?label=[b]");
});

test("P1 accepts URI syntax without applying P3 HTTPS/origin trust policy", () => {
  const httpUri = "http://example.test/product.jpg";
  const httpResult = parsePancakeCatalogVariations(payloadWithProductImage(httpUri));
  assert.equal(httpResult.variations[0]?.product.primaryImageUrl, httpUri);

  const ipv6LiteralUri = "http://[::1]/product.jpg";
  const ipv6Result = parsePancakeCatalogVariations(payloadWithProductImage(ipv6LiteralUri));
  assert.equal(ipv6Result.variations[0]?.product.primaryImageUrl, ipv6LiteralUri);
});
