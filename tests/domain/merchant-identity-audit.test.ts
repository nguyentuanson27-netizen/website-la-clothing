import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyExternalIdentifier,
  MAX_EXTERNAL_IDENTIFIER_LENGTH,
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
    ...overrides,
  };
}

test("M1 an external identifier is classified without assuming a vendor format", () => {
  assert.equal(classifyExternalIdentifier("variation-1"), "PRESENT");
  assert.equal(classifyExternalIdentifier("9007199254740993"), "PRESENT");
  assert.equal(classifyExternalIdentifier("a".repeat(MAX_EXTERNAL_IDENTIFIER_LENGTH)), "PRESENT");

  assert.equal(classifyExternalIdentifier(null), "MISSING");
  assert.equal(classifyExternalIdentifier(""), "MISSING");
  assert.equal(classifyExternalIdentifier("   "), "BLANK");
  assert.equal(classifyExternalIdentifier(" padded "), "UNTRIMMED");
  assert.equal(
    classifyExternalIdentifier("a".repeat(MAX_EXTERNAL_IDENTIFIER_LENGTH + 1)),
    "TOO_LONG",
  );
});

test("M1 the audit counts identifier health for variations and standalone products", () => {
  const summary = summarizeMerchantIdentity([
    row({ pancakeVariationId: "v-1", pancakeProductId: "p-1" }),
    row({ pancakeVariationId: "v-2", pancakeProductId: "p-1" }),
    row({ pancakeVariationId: " v-3 ", pancakeProductId: "p-2" }),
  ]);

  assert.equal(summary.variationIdentifiers.PRESENT, 2);
  assert.equal(summary.variationIdentifiers.UNTRIMMED, 1);
  // Two variations share one product family; the product identifier is counted once per family.
  assert.equal(summary.productIdentifiers.PRESENT, 2);
});

test("M1 duplicate external identifiers are reported rather than assumed impossible", () => {
  const summary = summarizeMerchantIdentity([
    row({ pancakeVariationId: "v-dup" }),
    row({ pancakeVariationId: "v-dup" }),
    row({ pancakeVariationId: "v-unique" }),
  ]);

  assert.equal(summary.duplicateVariationIds.length, 1);
  assert.deepEqual(summary.duplicateVariationIds[0], { value: "v-dup", occurrences: 2 });
});

test("M1 SKU is audited as candidate MPN for presence and uniqueness, never invented", () => {
  const summary = summarizeMerchantIdentity([
    row({ pancakeVariationId: "v-1", sku: "LA-A" }),
    row({ pancakeVariationId: "v-2", sku: "LA-A" }),
    row({ pancakeVariationId: "v-3", sku: null }),
    row({ pancakeVariationId: "v-4", sku: "   " }),
    row({ pancakeVariationId: "v-5", sku: "LA-B" }),
  ]);

  assert.equal(summary.sku.PRESENT, 3, "two LA-A plus LA-B");
  assert.equal(summary.sku.MISSING, 1);
  assert.equal(summary.sku.BLANK, 1);
  assert.deepEqual(summary.duplicateSkus, [{ value: "LA-A", occurrences: 2 }]);
  assert.equal(
    summary.mpnReady,
    false,
    "a duplicate or missing SKU means MPN is not provably unique yet",
  );
});

test("M1 MPN is only ready when every emitted variation has a present, unique SKU", () => {
  const summary = summarizeMerchantIdentity([
    row({ pancakeVariationId: "v-1", sku: "LA-A" }),
    row({ pancakeVariationId: "v-2", sku: "LA-B" }),
  ]);

  assert.equal(summary.sku.PRESENT, 2);
  assert.deepEqual(summary.duplicateSkus, []);
  assert.equal(summary.mpnReady, true);
});

test("M1 composites are classified COMPOSITE_DEFERRED and excluded from the emittable set", () => {
  const summary = summarizeMerchantIdentity([
    row({ pancakeVariationId: "v-standalone", isComposite: false }),
    row({ pancakeVariationId: "v-composite", isComposite: true, sku: null }),
  ]);

  assert.equal(summary.compositeDeferred, 1);
  assert.equal(summary.emittableStandaloneVariations, 1);
  // A composite's missing SKU must not drag down the standalone MPN verdict.
  assert.equal(summary.mpnReady, true);
  assert.equal(summary.sku.MISSING, 0, "composite rows are outside the emittable audit");
});

test("M1 only storefront-visible standalone variations are counted as emittable", () => {
  const summary = summarizeMerchantIdentity([
    row({ pancakeVariationId: "v-visible", isStorefrontVisible: true }),
    row({ pancakeVariationId: "v-hidden", isStorefrontVisible: false, sku: null }),
  ]);

  assert.equal(summary.emittableStandaloneVariations, 1);
  assert.equal(summary.mpnReady, true, "a hidden variation is not emitted, so it cannot block MPN");
});

test("M1 the audit never asserts a GTIN and never invents apparel facts", () => {
  const summary = summarizeMerchantIdentity([row()]);
  const serialized = JSON.stringify(summary);

  for (const forbidden of ["gtin", "barcode", "gender", "age_group", "ageGroup", "condition"]) {
    assert.equal(
      serialized.toLowerCase().includes(forbidden.toLowerCase()),
      false,
      `${forbidden} must not appear: it is either unproven or owner-approved input`,
    );
  }
});

test("M1 the durability verdict is never satisfied by this audit alone", () => {
  const summary = summarizeMerchantIdentity([row()]);

  assert.equal(summary.durability.mirrorReconcilesByExternalId, true);
  assert.equal(summary.durability.upstreamLifetimeProven, false);
  assert.equal(summary.durability.verdict, "BLOCKED");
});
