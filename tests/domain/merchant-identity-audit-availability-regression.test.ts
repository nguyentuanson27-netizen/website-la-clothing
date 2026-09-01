import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyMerchantAvailability,
  summarizeMerchantIdentity,
  type MerchantIdentityRow,
} from "../../src/commerce/merchant-identity-audit.ts";

function row(overrides: Partial<MerchantIdentityRow> = {}): MerchantIdentityRow {
  return {
    pancakeVariationId: "variation-1",
    pancakeProductId: "product-1",
    sku: "LA-SHIRT-M",
    isComposite: false,
    isStorefrontVisible: true,
    retailPrice: 500_000,
    retailPriceAfterDiscount: 500_000,
    stockQuantity: 4,
    primaryImageUrl: "https://content.pancake.vn/catalog/1/2/3/shirt.jpg",
    title: "Ao so mi LA",
    publishedDescription: "Ao so mi vai cotton.",
    ...overrides,
  };
}

test("M1 distinguishes unresolved availability from a valid zero-stock fact", () => {
  assert.equal(classifyMerchantAvailability(0), "OUT_OF_STOCK");
  assert.equal(classifyMerchantAvailability(-3), "AVAILABILITY_UNRESOLVED");
  assert.equal(classifyMerchantAvailability(Number.NaN), "AVAILABILITY_UNRESOLVED");

  const summary = summarizeMerchantIdentity([
    row({ pancakeVariationId: "v-zero", sku: "LA-ZERO", stockQuantity: 0 }),
    row({ pancakeVariationId: "v-invalid", sku: "LA-INVALID", stockQuantity: Number.NaN }),
  ]);

  assert.deepEqual(summary.availability, {
    IN_STOCK: 0,
    OUT_OF_STOCK: 1,
    AVAILABILITY_UNRESOLVED: 1,
  });
  assert.equal(
    summary.merchantFactsReady,
    1,
    "valid zero-stock remains Merchant-ready, but unresolved availability must fail readiness closed",
  );
});
