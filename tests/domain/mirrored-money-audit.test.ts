import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyMirroredBasePrice,
  MAX_MIRRORED_MONEY_EXAMPLES,
  summarizeMirroredMoney,
  type MirroredVariantMoneyRow,
} from "../../src/commerce/mirrored-money-audit.ts";

function row(
  pancakeVariationId: string,
  pancakeRetailPrice: number | null,
  overrides: Partial<MirroredVariantMoneyRow> = {},
): MirroredVariantMoneyRow {
  return {
    pancakeVariationId,
    pancakeRetailPrice,
    pancakeRetailPriceAfterDiscount: pancakeRetailPrice,
    isStorefrontVisible: true,
    ...overrides,
  };
}

test("W3 every mirrored base value lands in exactly one audit class", () => {
  assert.equal(classifyMirroredBasePrice(890_000), "USABLE");
  assert.equal(classifyMirroredBasePrice(1), "USABLE");
  assert.equal(classifyMirroredBasePrice(Number.MAX_SAFE_INTEGER), "USABLE");

  assert.equal(classifyMirroredBasePrice(null), "NULL");
  assert.equal(classifyMirroredBasePrice(0), "ZERO");
  assert.equal(classifyMirroredBasePrice(-1), "NEGATIVE");
  assert.equal(classifyMirroredBasePrice(-0.5), "NEGATIVE");
  assert.equal(classifyMirroredBasePrice(Number.NaN), "NON_FINITE");
  assert.equal(classifyMirroredBasePrice(Number.POSITIVE_INFINITY), "NON_FINITE");
  assert.equal(classifyMirroredBasePrice(Number.NEGATIVE_INFINITY), "NON_FINITE");
  assert.equal(classifyMirroredBasePrice(1.5), "NON_INTEGER");
  assert.equal(classifyMirroredBasePrice(Number.MAX_SAFE_INTEGER + 1), "UNSAFE_INTEGER");
});

test("W3 the classifier agrees with the pricing authority about what is usable", async () => {
  const { isUsableBasePriceVnd } = await import("../../src/commerce/promotion-pricing.ts");

  for (const value of [
    null, 0, -1, 1, 1.5, -0.5, 890_000,
    Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.equal(
      classifyMirroredBasePrice(value) === "USABLE",
      isUsableBasePriceVnd(value),
      `${value} must be classified the same way the resolver treats it`,
    );
  }
});

test("W3 the summary counts every class and totals to the row count", () => {
  const summary = summarizeMirroredMoney([
    row("v-usable-1", 890_000),
    row("v-usable-2", 1),
    row("v-null", null),
    row("v-zero", 0),
    row("v-negative", -5),
    row("v-nonfinite", Number.NaN),
    row("v-noninteger", 1.5),
    row("v-unsafe", Number.MAX_SAFE_INTEGER + 1),
  ]);

  assert.deepEqual(summary.counts, {
    USABLE: 2,
    NULL: 1,
    ZERO: 1,
    NEGATIVE: 1,
    NON_FINITE: 1,
    NON_INTEGER: 1,
    UNSAFE_INTEGER: 1,
  });
  assert.equal(summary.totalVariants, 8);
  assert.equal(
    Object.values(summary.counts).reduce((total, count) => total + count, 0),
    summary.totalVariants,
  );
});

test("W3 the summary names how many currently visible variants the rule would remove", () => {
  const summary = summarizeMirroredMoney([
    row("v-visible-usable", 890_000, { isStorefrontVisible: true }),
    row("v-visible-null", null, { isStorefrontVisible: true }),
    row("v-visible-zero", 0, { isStorefrontVisible: true }),
    // Already invisible, so the rule takes nothing away from buyers here.
    row("v-hidden-null", null, { isStorefrontVisible: false }),
  ]);

  assert.equal(summary.visibleVariants, 3);
  assert.equal(summary.visibleVariantsBecomingUnavailable, 2);
  assert.deepEqual(
    summary.visibleUnavailableExamples.map((example) => example.pancakeVariationId),
    ["v-visible-null", "v-visible-zero"],
  );
});

test("W3 examples are bounded so the report cannot become an unbounded data dump", () => {
  const rows = Array.from({ length: MAX_MIRRORED_MONEY_EXAMPLES + 25 }, (_, index) =>
    row(`v-null-${index}`, null),
  );

  const summary = summarizeMirroredMoney(rows);

  assert.equal(summary.counts.NULL, MAX_MIRRORED_MONEY_EXAMPLES + 25, "counts stay complete");
  assert.equal(summary.examples.NULL.length, MAX_MIRRORED_MONEY_EXAMPLES, "examples are capped");
  assert.ok(summary.visibleUnavailableExamples.length <= MAX_MIRRORED_MONEY_EXAMPLES);
});

test("W3 examples carry only catalog identity and the offending value, never buyer data", () => {
  const summary = summarizeMirroredMoney([row("v-null", null)]);
  const [example] = summary.examples.NULL;

  assert.deepEqual(Object.keys(example ?? {}).sort(), [
    "pancakeRetailPrice",
    "pancakeRetailPriceAfterDiscount",
    "pancakeVariationId",
  ]);
});

/**
 * The W3 question: how often do the two mirrored fields disagree, and how often is the discount
 * field lower? This counts it without deciding anything about it — ownership of the effective price
 * is unchanged.
 */
test("W3 the summary counts where the mirrored discount field disagrees with base", () => {
  const summary = summarizeMirroredMoney([
    row("v-equal", 890_000, { pancakeRetailPriceAfterDiscount: 890_000 }),
    row("v-lower", 890_000, { pancakeRetailPriceAfterDiscount: 499_000 }),
    row("v-lower-2", 500_000, { pancakeRetailPriceAfterDiscount: 100_000 }),
    row("v-higher", 890_000, { pancakeRetailPriceAfterDiscount: 990_000 }),
    row("v-null-discount", 890_000, { pancakeRetailPriceAfterDiscount: null }),
  ]);

  assert.equal(summary.discountField.equalToBase, 1);
  assert.equal(summary.discountField.lowerThanBase, 2);
  assert.equal(summary.discountField.higherThanBase, 1);
  assert.equal(summary.discountField.unusableForComparison, 1);
  assert.deepEqual(
    summary.discountField.lowerThanBaseExamples.map((e) => e.pancakeVariationId),
    ["v-lower", "v-lower-2"],
  );
});

test("W3 an empty catalog summarizes to zeroes rather than throwing", () => {
  const summary = summarizeMirroredMoney([]);

  assert.equal(summary.totalVariants, 0);
  assert.equal(summary.visibleVariantsBecomingUnavailable, 0);
  assert.deepEqual(summary.examples.NULL, []);
});
