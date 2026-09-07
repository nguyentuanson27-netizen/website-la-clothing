import assert from "node:assert/strict";
import test from "node:test";

import {
  findProductMetadataCollisions,
  metadataPairKey,
  normalizeMetadataText,
  readPublishMetadataReadiness,
} from "../../src/seo/product-metadata-uniqueness.ts";

/** "Áo" written as a precomposed character and as A + combining acute: the same text to a reader. */
const PRECOMPOSED = "\u00c1o Oxford";
const DECOMPOSED = "A\u0301o Oxford";

test("B5 metadata text normalization keeps the editor's own present/absent reading", () => {
  assert.equal(normalizeMetadataText(null), null);
  assert.equal(normalizeMetadataText(undefined), null);
  assert.equal(normalizeMetadataText(""), null);
  assert.equal(normalizeMetadataText("   "), null);
  // The JS whitespace set, not Postgres' ASCII-only BTRIM: an NBSP-only value is still absent.
  assert.equal(normalizeMetadataText("\u00a0\u00a0"), null);
  assert.equal(normalizeMetadataText("  Áo Oxford  "), "Áo Oxford");
});

test("B5 normalization is Unicode canonical equivalence, not case folding or fuzzy matching", () => {
  assert.notEqual(PRECOMPOSED, DECOMPOSED);
  assert.equal(normalizeMetadataText(DECOMPOSED), normalizeMetadataText(PRECOMPOSED));

  // Deliberately case-sensitive and deliberately not whitespace-collapsing: the owner-approved
  // rule is uniqueness of the pair, and anything looser would block copy the owner did not ban.
  assert.notEqual(normalizeMetadataText("áo oxford"), normalizeMetadataText("Áo Oxford"));
  assert.notEqual(normalizeMetadataText("Áo  Oxford"), normalizeMetadataText("Áo Oxford"));
});

test("B5 publish readiness requires both SEO fields to carry text", () => {
  assert.deepEqual(
    readPublishMetadataReadiness({ seoTitle: null, seoDescription: "Mô tả." }),
    { ok: false, reason: "SEO_TITLE_REQUIRED" },
  );
  assert.deepEqual(
    readPublishMetadataReadiness({ seoTitle: "   ", seoDescription: "Mô tả." }),
    { ok: false, reason: "SEO_TITLE_REQUIRED" },
  );
  assert.deepEqual(
    readPublishMetadataReadiness({ seoTitle: "Áo Oxford", seoDescription: null }),
    { ok: false, reason: "SEO_DESCRIPTION_REQUIRED" },
  );
  assert.deepEqual(
    readPublishMetadataReadiness({ seoTitle: " ", seoDescription: " " }),
    { ok: false, reason: "SEO_TITLE_REQUIRED" },
  );

  assert.deepEqual(
    readPublishMetadataReadiness({
      seoTitle: "  Áo Oxford  ",
      seoDescription: "  Mô tả sản phẩm.  ",
    }),
    { ok: true, pair: { seoTitle: "Áo Oxford", seoDescription: "Mô tả sản phẩm." } },
  );
});

test("B5 uniqueness is the pair, so one field alone never decides a collision", () => {
  const key = metadataPairKey("Áo Oxford", "Mô tả sản phẩm.");

  assert.equal(key, metadataPairKey("  Áo Oxford  ", "Mô tả sản phẩm."));
  assert.equal(key, metadataPairKey(DECOMPOSED, "Mô tả sản phẩm."));

  assert.notEqual(key, metadataPairKey("Áo Oxford", "Mô tả khác."));
  assert.notEqual(key, metadataPairKey("Áo Linen", "Mô tả sản phẩm."));
  assert.notEqual(key, metadataPairKey("áo oxford", "Mô tả sản phẩm."));

  // A pair boundary cannot be forged by moving text across the two fields.
  assert.notEqual(metadataPairKey("ab", "c"), metadataPairKey("a", "bc"));
});

test("B5 the W2a collision report shares the same normalization authority", () => {
  const collisions = findProductMetadataCollisions([
    {
      slug: "ao-oxford-den",
      name: "Áo Oxford",
      seoTitle: PRECOMPOSED,
      seoDescription: "Mô tả sản phẩm.",
    },
    {
      slug: "ao-oxford-trang",
      name: "Áo Oxford",
      seoTitle: `  ${DECOMPOSED}  `,
      seoDescription: "Mô tả sản phẩm.",
    },
  ]);

  assert.equal(collisions.length, 1);
  assert.deepEqual(collisions[0]?.slugs, ["ao-oxford-den", "ao-oxford-trang"]);
});
