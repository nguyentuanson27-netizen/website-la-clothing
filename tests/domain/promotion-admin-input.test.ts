import assert from "node:assert/strict";
import test from "node:test";

import {
  parseDiscountInputs,
  parseTargets,
  parseVietnamDateTime,
} from "../../src/commerce/promotion-admin-input.ts";
import {
  MAX_PROMOTION_IDENTIFIER_LENGTH,
  MAX_TARGETS_PER_CAMPAIGN,
  validateDraftInput,
} from "../../src/commerce/promotion-activation.ts";

test("Finding 1: parseTargets preserves oversized target IDs without truncation so domain validator rejects IDENTIFIER_TOO_LONG", () => {
  const oversizedId = "p_".concat("x".repeat(MAX_PROMOTION_IDENTIFIER_LENGTH + 10));
  assert.ok(oversizedId.length > MAX_PROMOTION_IDENTIFIER_LENGTH);

  const formData = new FormData();
  formData.append("targetProductId", `  ${oversizedId}  `);
  formData.append("targetVariantId", "  v-valid  ");

  const targets = parseTargets(formData);
  assert.equal(targets.length, 2);

  // Critical: the ID must NOT have been sliced down to 128 characters!
  assert.equal(targets[0]?.productId, oversizedId, "oversized ID is preserved verbatim (after trim)");
  assert.equal(targets[1]?.variantId, "v-valid");

  // When passed to validateDraftInput, the domain validator catches it!
  const validated = validateDraftInput({ targets });
  assert.equal(validated.ok, false);
  assert.ok(!validated.ok && validated.errors.includes("IDENTIFIER_TOO_LONG"));
});

test("Finding 1: parseTargets bounds target count extraction to prevent memory denial-of-service", () => {
  const formData = new FormData();
  for (let i = 0; i < MAX_TARGETS_PER_CAMPAIGN + 20; i++) {
    formData.append("targetProductId", `prod-${i}`);
  }

  const targets = parseTargets(formData);
  assert.equal(targets.length, MAX_TARGETS_PER_CAMPAIGN + 1);

  const validated = validateDraftInput({ targets });
  assert.equal(validated.ok, false);
  assert.ok(!validated.ok && validated.errors.includes("TOO_MANY_TARGETS"));
});

test("Finding 2: parseDiscountInputs strictly rejects malformed fixed price and never coerces invalid representations", () => {
  const malformedInputs = [
    "-100",
    "+100",
    "1e6",
    "1.5",
    "199,000",
    "199 000",
    "abc500000",
    "500000abc",
    "0",
    "-0",
    "NaN",
    "Infinity",
    "0199000", // leading zero
  ];

  for (const bad of malformedInputs) {
    const formData = new FormData();
    formData.append("discountType", "FIXED_PRICE");
    formData.append("fixedPriceVnd", bad);

    const parsed = parseDiscountInputs(formData);
    assert.equal(
      parsed.ok,
      false,
      `expected input "${bad}" to be strictly rejected, but got ${JSON.stringify(parsed)}`,
    );
    if (!parsed.ok) {
      assert.equal(parsed.reason, "MALFORMED_FIXED_PRICE");
    }
  }
});

test("Finding 2: parseDiscountInputs accepts strict positive decimal integer VND and parses exact BigInt", () => {
  const validCases = [
    { input: "199000", expected: BigInt(199000) },
    { input: " 500000 ", expected: BigInt(500000) },
    { input: "1", expected: BigInt(1) },
    { input: "999999999", expected: BigInt(999999999) },
  ];

  for (const { input, expected } of validCases) {
    const formData = new FormData();
    formData.append("discountType", "FIXED_PRICE");
    formData.append("fixedPriceVnd", input);

    const parsed = parseDiscountInputs(formData);
    assert.equal(parsed.ok, true, `expected "${input}" to be accepted`);
    if (parsed.ok) {
      assert.equal(parsed.discountType, "FIXED_PRICE");
      assert.equal(parsed.fixedPriceVnd, expected);
      assert.equal(parsed.percentageValue, null);
    }
  }
});

test("Finding 2: parseDiscountInputs strictly validates percentage value", () => {
  for (const bad of ["-10", "0", "100", "105", "1e2", "abc", "50.5"]) {
    const formData = new FormData();
    formData.append("discountType", "PERCENTAGE");
    formData.append("percentageValue", bad);

    const parsed = parseDiscountInputs(formData);
    assert.equal(parsed.ok, false, `expected percentage "${bad}" to be rejected`);
    if (!parsed.ok) {
      assert.equal(parsed.reason, "INVALID_PERCENTAGE");
    }
  }

  const valid = new FormData();
  valid.append("discountType", "PERCENTAGE");
  valid.append("percentageValue", " 25 ");
  const parsedValid = parseDiscountInputs(valid);
  assert.equal(parsedValid.ok, true);
  if (parsedValid.ok) {
    assert.equal(parsedValid.percentageValue, 25);
    assert.equal(parsedValid.fixedPriceVnd, null);
  }
});

test("parseVietnamDateTime parses ISO local time to Vietnam UTC+7 instant", () => {
  const parsed = parseVietnamDateTime("2026-09-20T10:00");
  assert.ok(parsed instanceof Date);
  assert.equal(parsed.toISOString(), "2026-09-20T03:00:00.000Z");

  assert.equal(parseVietnamDateTime(""), null);
  assert.equal(parseVietnamDateTime("not-a-date"), null);
});
