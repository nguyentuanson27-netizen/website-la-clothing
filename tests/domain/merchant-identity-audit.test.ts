import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyExternalIdentifier,
  classifyMerchantAvailability,
  classifyMerchantMedia,
  classifyMerchantPrice,
  classifyMerchantText,
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
 * The apparel attributes are *reported*, because M1 has to say where they stand — but only ever as
 * a blocked state. What must never appear is a value: a name, a category or a size chart is not
 * evidence of who a garment is for, and guessing puts wrong data in front of shoppers.
 */
test("M1 apparel facts are reported as owner-blocked and never carry a derived value", () => {
  const summary = summarizeMerchantIdentity([
    row({ title: "Áo sơ mi nam người lớn", publishedDescription: "Dành cho nam giới trưởng thành." }),
  ]);

  assert.deepEqual(summary.apparelFacts, {
    gender: "OWNER_BLOCKED",
    ageGroup: "OWNER_BLOCKED",
    condition: "OWNER_BLOCKED",
    verdict: "BLOCKED",
  });

  const values = JSON.stringify(Object.values(summary.apparelFacts)).toLowerCase();
  for (const derived of ["male", "female", "unisex", "adult", "kids", "infant", "new", "used"]) {
    assert.equal(
      values.includes(derived),
      false,
      `${derived} must never be produced: O3 is an owner decision, not an inference`,
    );
  }
});

test("M1 the durability verdict is never satisfied by this audit alone", () => {
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

test("M1 availability is reported, and an unusable quantity is not evidence of stock", () => {
  assert.equal(classifyMerchantAvailability(4), "IN_STOCK");
  assert.equal(classifyMerchantAvailability(0), "OUT_OF_STOCK");
  assert.equal(classifyMerchantAvailability(-3), "OUT_OF_STOCK");
  assert.equal(classifyMerchantAvailability(Number.NaN), "OUT_OF_STOCK");
});

test("M1 media readiness uses the storefront's own trust parser", () => {
  assert.equal(classifyMerchantMedia("https://content.pancake.vn/catalog/1/2/3/shirt.jpg"), "READY");
  assert.equal(classifyMerchantMedia(null), "MISSING");
  assert.equal(classifyMerchantMedia("   "), "MISSING");
  assert.equal(
    classifyMerchantMedia("https://cdn.attacker.example/shirt.jpg"),
    "UNTRUSTED",
    "an untrusted host is not a Merchant image, however well-formed the URL is",
  );
  assert.equal(classifyMerchantMedia("http://content.pancake.vn/catalog/1/2/3/shirt.jpg"), "UNTRUSTED");
});

/** Built from char codes so the fixture itself stays readable and greppable in the source. */
function withCode(code: number): string {
  return `Ao${String.fromCharCode(code)}so mi`;
}

/**
 * MALFORMED means unserializable, not ugly. A control character or a lone surrogate cannot be
 * escaped into valid XML, so a feed carrying one is broken for every record after it, which is why
 * it is worth counting before anyone builds the serializer.
 */
test("M1 text readiness separates missing copy from copy a feed cannot serialize", () => {
  assert.equal(classifyMerchantText("Ao so mi LA"), "READY");
  assert.equal(classifyMerchantText(null), "MISSING");
  assert.equal(classifyMerchantText("   "), "MISSING");

  assert.equal(classifyMerchantText(withCode(0x00)), "MALFORMED", "NUL cannot be escaped into XML");
  assert.equal(classifyMerchantText(withCode(0x1b)), "MALFORMED", "nor an escape character");
  assert.equal(classifyMerchantText(withCode(0x7f)), "MALFORMED", "nor DEL");
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
  assert.deepEqual(summary.availability, { IN_STOCK: 4, OUT_OF_STOCK: 1 });
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
