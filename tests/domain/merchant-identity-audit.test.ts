import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyExternalIdentifier,
  classifyMerchantAvailability,
  classifyMerchantMedia,
  classifyMerchantPrice,
  classifyMerchantText,
  MAX_EXTERNAL_IDENTIFIER_LENGTH,
  MERCHANT_ID_MAX_LENGTH,
  MERCHANT_MPN_MAX_LENGTH,
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
    // A fully Merchant-ready row by default, so a fixture only states the fact it is exercising.
    retailPrice: 500_000,
    retailPriceAfterDiscount: 500_000,
    stockQuantity: 4,
    primaryImageUrl: "https://content.pancake.vn/catalog/1/2/3/shirt.jpg",
    title: "Áo sơ mi LA",
    publishedDescription: "Áo sơ mi vải cotton, dáng suông.",
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

test("M1 Merchant format and length limits enforce 1-50 chars for offer and product ID, rejecting whitespace, controls, and invalid Unicode", () => {
  assert.equal(MERCHANT_ID_MAX_LENGTH, 50);
  assert.equal(MERCHANT_MPN_MAX_LENGTH, 70);

  // Valid normal ASCII identifier
  assert.equal(
    classifyExternalIdentifier("v-1_abc", { maxLength: MERCHANT_ID_MAX_LENGTH, allowWhitespace: false }),
    "PRESENT",
  );
  assert.equal(
    classifyExternalIdentifier("a".repeat(50), { maxLength: MERCHANT_ID_MAX_LENGTH, allowWhitespace: false }),
    "PRESENT",
  );

  // Overlong Merchant ID boundary (50 valid, 51 too long)
  assert.equal(
    classifyExternalIdentifier("a".repeat(51), { maxLength: MERCHANT_ID_MAX_LENGTH, allowWhitespace: false }),
    "TOO_LONG",
  );

  // Valid Unicode identifier that Google accepts (letters, numbers, accents)
  assert.equal(
    classifyExternalIdentifier("sp-áo-thun-đỏ-123", { maxLength: MERCHANT_ID_MAX_LENGTH, allowWhitespace: false }),
    "PRESENT",
  );

  // Current whitespace policy: LA Clothing fail-closed policy rejects all whitespace for ID
  assert.equal(
    classifyExternalIdentifier("v 1", { maxLength: MERCHANT_ID_MAX_LENGTH, allowWhitespace: false }),
    "INVALID_FORMAT",
  );
  assert.equal(
    classifyExternalIdentifier("v\t1", { maxLength: MERCHANT_ID_MAX_LENGTH, allowWhitespace: false }),
    "INVALID_FORMAT",
  );
  assert.equal(
    classifyExternalIdentifier("v\n1", { maxLength: MERCHANT_ID_MAX_LENGTH, allowWhitespace: false }),
    "INVALID_FORMAT",
  );

  // But MPN permits internal whitespace under LA Clothing policy when trimmed and valid
  assert.equal(
    classifyExternalIdentifier("SKU 123 M", { maxLength: MERCHANT_MPN_MAX_LENGTH, allowWhitespace: true }),
    "PRESENT",
  );

  // ASCII C0 controls, C1 controls, and DEL
  assert.equal(
    classifyExternalIdentifier("v\x001", { maxLength: MERCHANT_ID_MAX_LENGTH, allowWhitespace: false }),
    "INVALID_FORMAT",
  );
  assert.equal(
    classifyExternalIdentifier("v\x1f1", { maxLength: MERCHANT_ID_MAX_LENGTH, allowWhitespace: false }),
    "INVALID_FORMAT",
  );
  assert.equal(
    classifyExternalIdentifier("v\x7f1", { maxLength: MERCHANT_ID_MAX_LENGTH, allowWhitespace: false }),
    "INVALID_FORMAT",
  );
  assert.equal(
    classifyExternalIdentifier("v\u00851", { maxLength: MERCHANT_ID_MAX_LENGTH, allowWhitespace: false }),
    "INVALID_FORMAT",
  );

  // Google invalid Unicode: Zero-width joiner (U+200D) and format characters
  assert.equal(
    classifyExternalIdentifier("v\u200D1", { maxLength: MERCHANT_ID_MAX_LENGTH, allowWhitespace: false }),
    "INVALID_FORMAT",
    "U+200D ZWJ must be rejected per Google Merchant specification",
  );
  assert.equal(
    classifyExternalIdentifier("v\u200C1", { maxLength: MERCHANT_ID_MAX_LENGTH, allowWhitespace: false }),
    "INVALID_FORMAT",
    "U+200C ZWNJ must be rejected",
  );
  assert.equal(
    classifyExternalIdentifier("v\uFEFF1", { maxLength: MERCHANT_ID_MAX_LENGTH, allowWhitespace: false }),
    "INVALID_FORMAT",
    "BOM U+FEFF must be rejected",
  );

  // Google invalid Unicode: Private-use characters (BMP PUA and Supplementary PUA)
  assert.equal(
    classifyExternalIdentifier("v\uE0001", { maxLength: MERCHANT_ID_MAX_LENGTH, allowWhitespace: false }),
    "INVALID_FORMAT",
    "BMP Private Use Area (U+E000) must be rejected per Google Merchant specification",
  );
  assert.equal(
    classifyExternalIdentifier("v\uF8FF1", { maxLength: MERCHANT_ID_MAX_LENGTH, allowWhitespace: false }),
    "INVALID_FORMAT",
    "BMP Private Use Area (U+F8FF) must be rejected",
  );
  assert.equal(
    classifyExternalIdentifier("v\u{F0000}1", { maxLength: MERCHANT_ID_MAX_LENGTH, allowWhitespace: false }),
    "INVALID_FORMAT",
    "Supplementary Private Use Area-A must be rejected",
  );

  // Google invalid Unicode: Lone surrogates / malformed UTF-16
  assert.equal(
    classifyExternalIdentifier("v\uD8001", { maxLength: MERCHANT_ID_MAX_LENGTH, allowWhitespace: false }),
    "INVALID_FORMAT",
    "Lone high surrogate U+D800 must be rejected",
  );
  assert.equal(
    classifyExternalIdentifier("v\uDC001", { maxLength: MERCHANT_ID_MAX_LENGTH, allowWhitespace: false }),
    "INVALID_FORMAT",
    "Lone low surrogate U+DC00 must be rejected",
  );

  // Google invalid Unicode: Unassigned code points and noncharacters
  assert.equal(
    classifyExternalIdentifier("v\uFDD01", { maxLength: MERCHANT_ID_MAX_LENGTH, allowWhitespace: false }),
    "INVALID_FORMAT",
    "Unicode noncharacter U+FDD0 must be rejected",
  );
  assert.equal(
    classifyExternalIdentifier("v\uFFFF1", { maxLength: MERCHANT_ID_MAX_LENGTH, allowWhitespace: false }),
    "INVALID_FORMAT",
    "Unicode noncharacter U+FFFF must be rejected",
  );

  // MPN limits (1-70 chars boundary) and invalid Unicode rejection
  assert.equal(classifyExternalIdentifier("SKU-1", { maxLength: MERCHANT_MPN_MAX_LENGTH }), "PRESENT");
  assert.equal(classifyExternalIdentifier("a".repeat(70), { maxLength: MERCHANT_MPN_MAX_LENGTH }), "PRESENT");
  assert.equal(classifyExternalIdentifier("a".repeat(71), { maxLength: MERCHANT_MPN_MAX_LENGTH }), "TOO_LONG");
  assert.equal(
    classifyExternalIdentifier("SKU\u200D1", { maxLength: MERCHANT_MPN_MAX_LENGTH }),
    "INVALID_FORMAT",
    "MPN also rejects invalid Unicode like U+200D",
  );
  assert.equal(
    classifyExternalIdentifier("SKU\uE000", { maxLength: MERCHANT_MPN_MAX_LENGTH }),
    "INVALID_FORMAT",
    "MPN also rejects private-use characters",
  );
});

test("M1 summarizeMerchantIdentity enforces Merchant-specific bounds on variations, products, and SKU", () => {
  const summary = summarizeMerchantIdentity([
    // Variation ID too long (>50)
    row({ pancakeVariationId: "v".repeat(51), pancakeProductId: "p-1", sku: "SKU-1" }),
    // Variation ID invalid format (internal space)
    row({ pancakeVariationId: "v space", pancakeProductId: "p-1", sku: "SKU-2" }),
    // Product ID too long (>50)
    row({ pancakeVariationId: "v-3", pancakeProductId: "p".repeat(51), sku: "SKU-3" }),
    // SKU too long (>70)
    row({ pancakeVariationId: "v-4", pancakeProductId: "p-2", sku: "s".repeat(71) }),
    // Valid row
    row({ pancakeVariationId: "v-5", pancakeProductId: "p-2", sku: "SKU-5" }),
  ]);

  assert.equal(summary.emittableStandaloneVariations, 5);
  assert.equal(summary.variationIdentifiers.TOO_LONG, 1);
  assert.equal(summary.variationIdentifiers.INVALID_FORMAT, 1);
  assert.equal(summary.variationIdentifiers.PRESENT, 3);

  assert.equal(summary.productIdentifiers.TOO_LONG, 1);
  assert.equal(summary.productIdentifiers.PRESENT, 2); // p-1 and p-2

  assert.equal(summary.sku.TOO_LONG, 1);
  assert.equal(summary.sku.PRESENT, 4);
  assert.equal(summary.mpnReady, false, "overlong SKU fails MPN readiness");
});

test("M1 mpnReady fails closed when there are zero emittable standalone variations", () => {
  const summary = summarizeMerchantIdentity([]);
  assert.equal(summary.emittableStandaloneVariations, 0);
  assert.equal(summary.mpnReady, false, "empty catalog cannot claim MPN ready");

  const hiddenSummary = summarizeMerchantIdentity([
    row({ isStorefrontVisible: false }),
  ]);
  assert.equal(hiddenSummary.emittableStandaloneVariations, 0);
  assert.equal(hiddenSummary.mpnReady, false, "catalog with no visible variations cannot claim MPN ready");
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

test("M1 fails closed on candidate SKU with null, blank, untrimmed, overlong, invalid Unicode, and duplicates", () => {
  const summary = summarizeMerchantIdentity([
    row({ pancakeVariationId: "v-null", sku: null }),
    row({ pancakeVariationId: "v-blank", sku: "   " }),
    row({ pancakeVariationId: "v-untrimmed", sku: " A132-M " }),
    row({ pancakeVariationId: "v-overlong", sku: "A".repeat(71) }),
    row({ pancakeVariationId: "v-invalid-unicode", sku: "A132\u0000M" }),
    row({ pancakeVariationId: "v-valid-1", sku: "A132-L" }),
    row({ pancakeVariationId: "v-valid-2", sku: "A132-L" }), // duplicate
  ]);

  assert.equal(summary.emittableStandaloneVariations, 7);
  assert.equal(summary.sku.MISSING, 1);
  assert.equal(summary.sku.BLANK, 1);
  assert.equal(summary.sku.UNTRIMMED, 1);
  assert.equal(summary.sku.TOO_LONG, 1);
  assert.equal(summary.sku.INVALID_FORMAT, 1);
  assert.equal(summary.sku.PRESENT, 2);
  assert.deepEqual(summary.duplicateSkus, [{ value: "A132-L", occurrences: 2 }]);
  assert.equal(summary.mpnReady, false, "M1 must fail closed when any candidate SKU is missing, malformed or duplicate");
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

test("M1 the audit never asserts a GTIN", () => {
  const serialized = JSON.stringify(summarizeMerchantIdentity([row()])).toLowerCase();

  for (const forbidden of ["gtin", "barcode"]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `${forbidden} must not appear: a field name is not proof of an identifier type`,
    );
  }
});

/**
 * ADR 0007 settled the O3 policy and U25/M3 now implements persistence, server validation, admin
 * editing and effective-fact projection. This older mirror-only M1 summary deliberately does not
 * read `ProductMerchantFacts`, so it must report that limitation without claiming the runtime is
 * missing and without claiming it has audited the resolved apparel values.
 */
test("M1 apparel readiness reports current runtime without pretending legacy M1 audits it", () => {
  const summary = summarizeMerchantIdentity([
    row({ title: "Áo sơ mi nam người lớn", publishedDescription: "Dành cho nam giới trưởng thành." }),
  ]);

  assert.deepEqual(summary.apparelFacts, {
    policy: "RESOLVED",
    productOverrides: "IMPLEMENTED",
    verdict: "NOT_AUDITED_BY_M1",
  });
});

/**
 * The no-inference rule is untouched by ADR 0007 and is the half that must never relax: the ADR
 * forbids deriving a value from name, category, description, size or model output just as firmly.
 *
 * The audit also does not restate the approved shop defaults. They are M3's to apply, and a second
 * copy here would be a second authority for a value a feed publishes.
 */
test("M1 the audit never produces an apparel value, derived or restated", () => {
  const summary = summarizeMerchantIdentity([
    row({ title: "Áo sơ mi nam người lớn", publishedDescription: "Dành cho nam giới trưởng thành." }),
  ]);

  const serialized = JSON.stringify(summary).toLowerCase();
  for (const value of [
    "male", "female", "unisex",
    "newborn", "infant", "toddler", "kids", "adult",
    "refurbished", "used",
  ]) {
    assert.equal(
      serialized.includes(value),
      false,
      `${value} must never appear: it is either an inference or M3's to apply, not M1's to report`,
    );
  }
});

test("M1 the durability verdict is never satisfied by this audit alone", () => {
  const summary = summarizeMerchantIdentity([row()]);

  assert.equal(summary.durability.mirrorReconcilesByExternalId, true);
  assert.equal(summary.durability.upstreamLifetimeProven, false);
  assert.equal(summary.durability.verdict, "BLOCKED");
});

test("M1 local mirror audit always remains fail-closed and cannot declare upstream durability", () => {
  const summary = summarizeMerchantIdentity([row()]);

  assert.equal(summary.durability.mirrorReconcilesByExternalId, true);
  assert.equal(summary.durability.upstreamLifetimeProven, false);
  assert.equal(summary.durability.verdict, "BLOCKED");
});

/* -------------------------------------------------------------- catalog facts beyond identity */

/**
 * Price readiness defers to the live storefront rule rather than restating it. That matters twice
 * over: an audit with its own definition would report a readiness the storefront does not share,
 * and the current rule is equality-gated on the mirrored Pancake fields pending W3 evidence, so
 * this count is exactly the measurement that decides whether that gate can move.
 */
test("M1 price readiness follows the live storefront rule, including its discount equality gate", () => {
  assert.equal(classifyMerchantPrice(row()), "READY");
  assert.equal(classifyMerchantPrice(row({ retailPrice: null })), "PRICE_UNRESOLVED");
  assert.equal(
    classifyMerchantPrice(row({ retailPrice: 500_000, retailPriceAfterDiscount: 400_000 })),
    "PRICE_UNRESOLVED",
    "a mirrored discount the website does not honour leaves no publishable price",
  );
  assert.equal(
    classifyMerchantPrice(row({ retailPrice: Number.NaN, retailPriceAfterDiscount: Number.NaN })),
    "PRICE_UNRESOLVED",
  );
});

test("M1 availability distinguishes valid stock facts from unresolved source data", () => {
  assert.equal(classifyMerchantAvailability(4), "IN_STOCK");
  assert.equal(classifyMerchantAvailability(0), "OUT_OF_STOCK");
  assert.equal(classifyMerchantAvailability(-3), "AVAILABILITY_UNRESOLVED");
  assert.equal(classifyMerchantAvailability(Number.NaN), "AVAILABILITY_UNRESOLVED");
});

test("M1 media readiness uses the storefront's own trust parser and resolves product and variant media", () => {
  const TRUSTED_1 = "https://content.pancake.vn/catalog/1/2/3/shirt.jpg";
  const TRUSTED_2 = "https://content.pancake.vn/catalog/4/5/6/variant.jpg";
  const UNTRUSTED_1 = "https://cdn.attacker.example/shirt.jpg";
  const UNTRUSTED_HTTP = "http://content.pancake.vn/catalog/1/2/3/shirt.jpg";
  const UNTRUSTED_MALFORMED = "not-a-url";

  // Case A: Product primary missing + valid trusted variant image -> READY
  assert.equal(
    classifyMerchantMedia(null, [TRUSTED_1]),
    "READY",
    "Case A: trusted variant image makes media READY even when product primary is missing",
  );
  assert.equal(
    classifyMerchantMedia("   ", [TRUSTED_2]),
    "READY",
    "Case A: trusted variant image makes media READY when product primary is blank",
  );

  // Case B: Valid product primary -> READY
  assert.equal(
    classifyMerchantMedia(TRUSTED_1, null),
    "READY",
    "Case B: valid product primary makes media READY with no variant images",
  );
  assert.equal(
    classifyMerchantMedia(TRUSTED_1, []),
    "READY",
    "Case B: valid product primary makes media READY with empty variant images",
  );

  // Case C: Untrusted / malformed product and variant media -> UNTRUSTED (not READY)
  assert.equal(
    classifyMerchantMedia(UNTRUSTED_1, null),
    "UNTRUSTED",
    "Case C: untrusted product primary is UNTRUSTED",
  );
  assert.equal(
    classifyMerchantMedia(UNTRUSTED_HTTP, [UNTRUSTED_1, UNTRUSTED_MALFORMED]),
    "UNTRUSTED",
    "Case C: untrusted product primary and untrusted variant images are UNTRUSTED",
  );
  assert.equal(
    classifyMerchantMedia(null, [UNTRUSTED_1]),
    "UNTRUSTED",
    "Case C: untrusted variant image without product primary is UNTRUSTED",
  );

  // Case D: Mixture of trusted and untrusted variant candidates -> READY
  assert.equal(
    classifyMerchantMedia(null, [UNTRUSTED_1, TRUSTED_2]),
    "READY",
    "Case D: trusted variant image in mixture makes media READY",
  );
  assert.equal(
    classifyMerchantMedia(UNTRUSTED_1, [TRUSTED_2]),
    "READY",
    "Case D: trusted variant image overrides untrusted product primary",
  );
  assert.equal(
    classifyMerchantMedia(TRUSTED_1, [UNTRUSTED_1]),
    "READY",
    "Case D: trusted product primary overrides untrusted variant images",
  );

  // Case E: No image anywhere -> MISSING
  assert.equal(classifyMerchantMedia(null, null), "MISSING", "Case E: null on both is MISSING");
  assert.equal(classifyMerchantMedia(null, []), "MISSING", "Case E: null primary and empty variant array is MISSING");
  assert.equal(classifyMerchantMedia("   ", []), "MISSING", "Case E: blank primary and empty variant array is MISSING");
  assert.equal(classifyMerchantMedia(null, [null, "  "]), "MISSING", "Case E: null/blank entries in variant array is MISSING");

  // Bounded scan: candidate scanning is capped at MAX_MEDIA_CANDIDATES_SCANNED (100)
  // 100 untrusted candidates followed by a trusted candidate beyond the budget must NOT be reached
  const overflowArray = [...Array.from({ length: 100 }, () => UNTRUSTED_1), TRUSTED_1];
  assert.equal(
    classifyMerchantMedia(null, overflowArray),
    "UNTRUSTED",
    "Candidates beyond MAX_MEDIA_CANDIDATES_SCANNED budget are not evaluated",
  );
});

/** Built from char codes so the fixture itself stays readable and greppable in the source. */
function withCode(code: number): string {
  return `Ao${String.fromCharCode(code)}so mi`;
}

/**
 * MALFORMED means XML-unserializable, not ugly. XML-illegal code points and lone surrogates cannot
 * be escaped into valid XML, while XML-legal characters such as U+007F remain READY.
 */
test("M1 text readiness separates missing copy from copy a feed cannot serialize", () => {
  assert.equal(classifyMerchantText("Ao so mi LA"), "READY");
  assert.equal(classifyMerchantText(null), "MISSING");
  assert.equal(classifyMerchantText("   "), "MISSING");

  assert.equal(classifyMerchantText(withCode(0x00)), "MALFORMED", "NUL cannot be escaped into XML");
  assert.equal(classifyMerchantText(withCode(0x1b)), "MALFORMED", "nor an escape character");
  assert.equal(classifyMerchantText(withCode(0x7f)), "READY", "DEL is XML-legal");
  assert.equal(classifyMerchantText(withCode(0xd83d)), "MALFORMED", "nor a lone high surrogate");
  assert.equal(classifyMerchantText(withCode(0xdc55)), "MALFORMED", "nor a lone low surrogate");

  assert.equal(classifyMerchantText("Ao \u{1F455} so mi"), "READY", "a real emoji is a valid pair");
  assert.equal(classifyMerchantText(withCode(0x0a)), "READY", "a newline is serializable");
  assert.equal(classifyMerchantText(withCode(0x09)), "READY", "so is a tab");
});

test("M1 catalog facts are counted only for emittable records", () => {
  const summary = summarizeMerchantIdentity([
    row({ pancakeVariationId: "v-ready" }),
    row({ pancakeVariationId: "v-no-price", sku: "LA-2", retailPrice: null }),
    row({ pancakeVariationId: "v-oos", sku: "LA-3", stockQuantity: 0 }),
    row({ pancakeVariationId: "v-bad-media", sku: "LA-4", primaryImageUrl: "https://evil.example/a.jpg" }),
    row({ pancakeVariationId: "v-bad-text", sku: "LA-5", title: withCode(0x00) }),
    // Neither of these is emittable, so neither contributes a fact.
    row({ pancakeVariationId: "v-composite", sku: "LA-6", isComposite: true, retailPrice: null }),
    row({ pancakeVariationId: "v-hidden", sku: "LA-7", isStorefrontVisible: false, retailPrice: null }),
  ]);

  assert.equal(summary.totalVariations, 7);
  assert.equal(summary.emittableStandaloneVariations, 5);
  assert.deepEqual(summary.price, { READY: 4, PRICE_UNRESOLVED: 1 });
  assert.deepEqual(summary.availability, {
    IN_STOCK: 4,
    OUT_OF_STOCK: 1,
    AVAILABILITY_UNRESOLVED: 0,
  });
  assert.deepEqual(summary.media, { READY: 4, MISSING: 0, UNTRUSTED: 1 });
  assert.deepEqual(summary.title, { READY: 4, MISSING: 0, MALFORMED: 1 });
  assert.deepEqual(summary.description, { READY: 5, MISSING: 0, MALFORMED: 0 });

  assert.equal(
    summary.merchantFactsReady,
    2,
    "the out-of-stock record is still Merchant-ready: it simply carries out_of_stock",
  );
});

/**
 * The exact boundary of what the report may echo.
 *
 * It is not "counts and verdicts only": a duplicate report is useless without naming the value that
 * collides, so identifiers deliberately survive into the diagnostics. What must never survive is
 * free text — a product title or a description is where a person's name or phone number would end
 * up, and an audit summary gets pasted into issues.
 *
 * Pinned in both directions, because a one-sided assertion would be satisfied by a report that
 * echoes nothing useful as easily as by one that echoes too much.
 */
test("M1 the report echoes colliding identifiers and never free text", () => {
  const summary = summarizeMerchantIdentity([
    row({
      pancakeVariationId: "v-1",
      sku: "LA-DUP",
      title: "Ao cho Nguyen Van A",
      publishedDescription: "Lien he 0912345678",
    }),
    row({
      pancakeVariationId: "v-2",
      sku: "LA-DUP",
      title: "Ao cho Nguyen Van A",
      publishedDescription: "Lien he 0912345678",
    }),
  ]);
  const serialized = JSON.stringify(summary);

  assert.deepEqual(
    summary.duplicateSkus,
    [{ value: "LA-DUP", occurrences: 2 }],
    "an admin cannot act on a duplicate report that will not say which value collided",
  );
  assert.equal(serialized.includes("LA-DUP"), true);

  for (const freeText of ["Nguyen", "0912345678", "Ao cho", "Lien he"]) {
    assert.equal(
      serialized.includes(freeText),
      false,
      `${freeText} is catalog free text and must never reach the summary`,
    );
  }
});
