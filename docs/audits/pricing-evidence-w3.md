# W3 — pricing evidence gate

Owning sources: `docs/specs/promotions-flash-sale-v1.md` §Pricing contract, `docs/audits/seo-geo-audit.md`
finding **W3**. Master-plan unit: **U7** (#151 P2 + #152 W3). Consumer: **U15 / #151 P6**.

Status: **DATA AUDIT COMPLETE — SEMANTIC EVIDENCE BLOCKED.** Both the mirrored money-data
audit and the live Pancake catalog audit have been executed against production data on the VPS.
Evidence confirms that 100% of mirrored and live variations satisfy the positive-safe-integer money
rule, and 100% currently have equal retail and discount fields. However, upstream business semantics
when a discount is active in Pancake remain unproven by this observational snapshot alone.

## What the gate is for

`resolveStorefrontPrice` currently returns `null` whenever
`pancakeRetailPrice !== pancakeRetailPriceAfterDiscount`, so a variant Pancake reports as discounted
becomes `PRICE_UNRESOLVED`: not purchasable, "Giá đang cập nhật" on the card, no offer in JSON-LD.

Removing that equality gate is **P6/U15's** change, not U7's, and the spec forbids doing it on a
guess. This document records the evidence gathered to date and the remaining semantic blocker.

## Two independent audits and semantic verification

| Dimension | Mirrored money-data audit | Real-catalog Pancake data audit | Upstream discount semantics |
|---|---|---|---|
| Source | Website's own `VariantMirror` rows | Live Pancake POS API | Pancake API contract or controlled experiment |
| Question | Do mirrored rows satisfy the positive-safe-integer money rule, and would any visible variant stop being purchasable? | How often does `retail_price_after_discount` differ from `retail_price` in the current catalog? | What does Pancake actually mean by `retail_price_after_discount` when a discount is active? |
| Needs credentials | No (shop id only) | Yes — approved API context (`PANCAKE_API_KEY`) | Yes — provider documentation or owner-approved test variation |
| Status | **COMPLETE — PASS** | **COMPLETE — SNAPSHOT VERIFIED** | **BLOCKED — SEMANTIC EVIDENCE REQUIRED** |

## Audit 1 — mirrored money data (executed on production mirror)

```bash
DATABASE_URL=... PANCAKE_SHOP_ID=1635185058 pnpm money:audit
```

- **Execution provenance:** Production VPS (PostgreSQL 17 container `la-clothing-postgres-1`, database `la_clothing`).
- **Executed at:** 2026-09-01T17:16:04Z.
- **Base SHA:** `42a903da5ae0a5827ca5e650e8842e2794fd70f2`.

```json
{
  "pancakeShopId": 1635185058,
  "totalVariants": 356,
  "visibleVariants": 181,
  "counts": {
    "USABLE": 356,
    "NULL": 0,
    "ZERO": 0,
    "NEGATIVE": 0,
    "NON_FINITE": 0,
    "NON_INTEGER": 0,
    "UNSAFE_INTEGER": 0
  },
  "examples": {
    "USABLE": [],
    "NULL": [],
    "ZERO": [],
    "NEGATIVE": [],
    "NON_FINITE": [],
    "NON_INTEGER": [],
    "UNSAFE_INTEGER": []
  },
  "visibleVariantsBecomingUnavailable": 0,
  "visibleUnavailableExamples": [],
  "discountField": {
    "equalToBase": 356,
    "lowerThanBase": 0,
    "higherThanBase": 0,
    "unusableForComparison": 0,
    "lowerThanBaseExamples": []
  }
}
```

### Key Audit 1 findings
- **Safe integer compliance:** 356/356 variants (100%) carry valid positive-safe-integer VND base prices.
- **Buyer loss:** Exactly 0 currently visible variants would become unavailable under the positive-safe-integer rule.
- **Discount field comparison:** Exactly 356/356 variants (100%) have `pancakeRetailPriceAfterDiscount === pancakeRetailPrice`.

## Audit 2 — real-catalog Pancake evidence (executed against live API)

```bash
DATABASE_URL=... PANCAKE_SHOP_ID=1635185058 PANCAKE_API_KEY=... pnpm pancake:catalog:audit
```

- **Execution provenance:** Production VPS using live `PANCAKE_API_KEY` and shop `1635185058`.
- **Executed at:** 2026-09-01T17:16:17Z (storefront scope) and 2026-09-01T17:16:24Z (full catalog).
- **Head SHA:** `53ffa28` (extended with variation-level pricing evidence).

### Current storefront scope (181 active variations across 42 active products)

```json
{
  "source": {
    "rawVariationEntries": 356
  },
  "currentCatalog": {
    "products": {
      "total": 42,
      "withNoteProduct": 0,
      "withoutNoteProduct": 42,
      "noteProductCoveragePercent": 0,
      "malformedNoteProductCount": 0,
      "withCategoryAssignments": 42,
      "categoryAssignmentCoveragePercent": 100
    },
    "variations": {
      "total": 181
    },
    "images": {
      "totalReferences": 177,
      "malformedCount": 0,
      "credentialBearingCount": 0,
      "nonDefaultPortCount": 0,
      "origins": [
        {
          "scheme": "https",
          "hostname": "content.pancake.vn",
          "referenceCount": 177,
          "pathShapes": [
            "/:segment/:id/:id/:id/:file.jpg"
          ]
        }
      ]
    },
    "categories": {
      "count": 4,
      "rootCount": 4,
      "maxDepth": 1,
      "duplicateNormalizedNameCount": 0,
      "duplicateIdCount": 0,
      "assignedProductCount": 42,
      "knownAssignmentReferenceCount": 42,
      "unknownAssignmentReferenceCount": 0,
      "assignmentSourceLocations": [
        "product.categories"
      ],
      "classification": "usable"
    },
    "pricing": {
      "totalVariations": 181,
      "equalRetailAndDiscount": 181,
      "discountLowerThanRetail": 0,
      "discountHigherThanRetail": 0,
      "retailNullOrMalformed": 0,
      "discountNullOrMalformed": 0,
      "bothUnusable": 0,
      "lowerExamples": [],
      "higherExamples": []
    }
  }
}
```

### Full live catalog (all 356 raw variations)

```json
{
  "totalVariations": 356,
  "equalRetailAndDiscount": 356,
  "discountLowerThanRetail": 0,
  "discountHigherThanRetail": 0,
  "retailNullOrMalformed": 0,
  "discountNullOrMalformed": 0,
  "bothUnusable": 0,
  "lowerExamples": [],
  "higherExamples": []
}
```

## Factual answers to W3 evidence questions

1. **How does Pancake actually send price fields?**
   Pancake returns both `retail_price` and `retail_price_after_discount` as positive numbers for every variation.
2. **How many variations have `discount < retail`?**
   0 (0.0%).
3. **How many variations have `discount > retail`?**
   0 (0.0%).
4. **How many variations have equal prices?**
   356 out of 356 (100.0% of the live catalog; 181/181 in the storefront scope).
5. **Are differing variations visible on the website?**
   None. No variation has differing prices.
6. **What is the practical impact of taking `retailPrice` as website base authority?**
   Zero divergence, zero buyer disruption, zero pricing ambiguity. The website-owned pricing model (`retailPrice` base + website promotions) operates on 100% consistent provider data.

## Upstream semantic evidence gap

While the current catalog snapshot proves that 100% of variations (356/356) have `retail_price === retail_price_after_discount`, this observational snapshot alone **does not establish Pancake's business semantics when a discount is active**:

1. **No provider contract or documentation:** The repository contains no Pancake POS documentation or written API contract defining under what circumstances `retail_price_after_discount` differs from `retail_price`, whether it represents a promotional sale, wholesale tier, member pricing, or external coupon. In `docs/integrations/pancake.md` §71, the contract explicitly notes:
   > "The adapter preserves `is_hidden`, `is_locked`, `retail_price`, `retail_price_after_discount`, and attribute field values as reviewed raw contract data. It does **not** infer business meaning from arbitrary field names or descriptions."
2. **No observed live discount:** Because the current live catalog contains 0 discounted variations, observational audit alone cannot prove how Pancake populates these fields during an active discount.
3. **No unapproved mutation:** Testing discount transitions requires creating or editing a discount on a designated test variation in Pancake POS. Operating permissions for this task are strictly restricted to evidence collection; modifying catalog pricing on production Pancake is prohibited.

## Verdict

**W3 GATE: DATA AUDIT COMPLETE — SEMANTIC EVIDENCE BLOCKED.**

- **Data audits (Mirrored Money + Live Pancake Catalog):** **COMPLETE (PASS)**. Positive-safe-integer compliance is 100%, and 0 variations have differing prices in the current catalog snapshot.
- **Upstream semantic evidence:** **BLOCKED**. Semantic verification of `retail_price_after_discount` under active discounts requires approved external context.

## Remaining blockers to clear W3

To move W3 from `DATA AUDIT COMPLETE — SEMANTIC EVIDENCE BLOCKED` to `PASS`, one of the following must be provided:

1. **Path 1 (Provider/API Contract):** Official Pancake POS API documentation or contract confirming the exact lifecycle and semantics of `retail_price` vs `retail_price_after_discount`.
2. **Path 2 (Controlled Integration Experiment):** An owner-approved controlled experiment on a designated non-purchasable test variation in Pancake:
   - Apply a known discount in Pancake POS;
   - Probe raw API responses and record before/after values;
   - Revert the discount to restore initial state;
   - Verify zero buyer impact, no credential leakage, and document exact provenance.

## Stop rule compliance for U15 / P6

The storefront availability/equality gate (`pancakeRetailPrice === pancakeRetailPriceAfterDiscount` in `src/commerce/storefront-product.ts`) has **not** been modified or removed by this task. It remains strictly in place until semantic evidence is resolved and U15 / P6 is executed per the master plan.


