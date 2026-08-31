import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_CAMPAIGN_NAME_LENGTH,
  normalizePromotionCampaignName,
} from "../../src/commerce/promotion-campaign-name.ts";

/** One non-BMP character: two UTF-16 code units, but a single character to PostgreSQL. */
const NON_BMP = "𝒜";

test("P1 the campaign name bound is 120 JavaScript code units", () => {
  assert.equal(MAX_CAMPAIGN_NAME_LENGTH, 120);
});

test("P1 campaign names are trimmed before they are measured or persisted", () => {
  assert.deepEqual(normalizePromotionCampaignName("  Flash Sale thang 9  "), {
    ok: true,
    name: "Flash Sale thang 9",
  });

  // 120 code units surrounded by whitespace still fits once trimmed.
  assert.deepEqual(normalizePromotionCampaignName(`  ${"a".repeat(120)}  `), {
    ok: true,
    name: "a".repeat(120),
  });
});

test("P1 a blank or whitespace-only campaign name is invalid, including for a Draft", () => {
  for (const raw of ["", "   ", "\t\n ", " "]) {
    assert.deepEqual(
      normalizePromotionCampaignName(raw),
      { ok: false, error: "EMPTY_NAME" },
      `${JSON.stringify(raw)} must be rejected`,
    );
  }
});

test("P1 non-string input is rejected rather than coerced", () => {
  for (const raw of [undefined, null, 7, {}, ["a"]]) {
    assert.deepEqual(normalizePromotionCampaignName(raw), { ok: false, error: "EMPTY_NAME" });
  }
});

test("P1 the 120/121 code-unit boundary is exact", () => {
  assert.equal(normalizePromotionCampaignName("a".repeat(120)).ok, true);
  assert.deepEqual(normalizePromotionCampaignName("a".repeat(121)), {
    ok: false,
    error: "NAME_TOO_LONG",
  });
});

test("P1 a surrogate pair counts as the two code units it is", () => {
  // 60 non-BMP characters = 120 code units: at the bound, not over it.
  const atBound = NON_BMP.repeat(60);
  assert.equal(atBound.length, 120);
  assert.equal(normalizePromotionCampaignName(atBound).ok, true);

  // 61 = 122 code units. Only 61 *characters*, so a character-counting check would let this pass.
  const overBound = NON_BMP.repeat(61);
  assert.equal(overBound.length, 122);
  assert.deepEqual(normalizePromotionCampaignName(overBound), {
    ok: false,
    error: "NAME_TOO_LONG",
  });
});

test("P1 a surrogate pair is never split by normalization", () => {
  const result = normalizePromotionCampaignName(` ${NON_BMP.repeat(60)} `);

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.name, NON_BMP.repeat(60));
  assert.equal(result.ok && [...result.name].length, 60, "the pairs stay whole");
});

test("P1 an accepted name is always storable, so a NUL byte is rejected before persistence", () => {
  // PostgreSQL `text` cannot hold a NUL. Left unchecked, this reached the driver and failed there
  // with an empty error message rather than as a typed validation result.
  assert.deepEqual(normalizePromotionCampaignName("Flash\u0000Sale"), {
    ok: false,
    error: "UNSUPPORTED_NAME_CHARACTER",
  });
  assert.deepEqual(normalizePromotionCampaignName("\u0000"), {
    ok: false,
    error: "UNSUPPORTED_NAME_CHARACTER",
  });
});

test("P1 ordinary Vietnamese names and punctuation stay valid", () => {
  for (const name of [
    "Flash Sale th\u00e1ng 9",
    "Khuy\u1ebfn m\u00e3i 20% \u2014 \u00c1o Oxford",
    "Sale h\u00e8 2026 (\u0111\u1ee3t 2)",
    "B\u1ea3n sao - Flash Sale",
  ]) {
    assert.deepEqual(
      normalizePromotionCampaignName(name),
      { ok: true, name },
      `${name} must stay valid`,
    );
  }
});
