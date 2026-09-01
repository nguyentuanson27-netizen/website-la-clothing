# W3 — pricing evidence gate

Owning sources: `docs/specs/promotions-flash-sale-v1.md` §Pricing contract, `docs/audits/seo-geo-audit.md`
finding **W3**. Master-plan unit: **U7** (#151 P2 + #152 W3). Consumer: **U15 / #151 P6**.

Status: **EVIDENCE COMPLETE (PASS).** Both the mirrored money-data audit and the real-catalog
Pancake audit have been executed against production data on the VPS. Evidence confirms that 100% of
mirrored and live variations satisfy the positive-safe-integer money rule, and 100% have equal retail
and discount fields.

## What the gate is for

`resolveStorefrontPrice` currently returns `null` whenever
`pancakeRetailPrice !== pancakeRetailPriceAfterDiscount`, so a variant Pancake reports as discounted
becomes `PRICE_UNRESOLVED`: not purchasable, "Giá đang cập nhật" on the card, no offer in JSON-LD.

Removing that equality gate is **P6/U15's** change, not U7's, and the spec forbids doing it on a
guess. This document records the evidence that has to exist first.

## Two independent audits

They are often conflated. They read different sources and answer different questions.

| | Mirrored money-data audit | Real-catalog Pancake audit |
|---|---|---|
| Source | The website's own `VariantMirror` rows | The live Pancake API |
| Question | How much of the mirrored catalog fails the positive-safe-integer money rule, and how many visible variants would stop being purchasable? | What does Pancake actually mean by `retailPriceAfterDiscount`, and how often is it lower? |
| Needs credentials | No (shop id only) | Yes — approved real-catalog context (`PANCAKE_API_KEY`) |
| Status | **COMPLETE — PASS** | **COMPLETE — PASS** |

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

## Verdict

**W3 GATE: PASS (evidence-complete).**
The approved ownership assumption is strongly supported by real-catalog data. No material contradiction exists.

## Stop rule compliance for U15 / P6

The storefront availability/equality gate (`pancakeRetailPrice === pancakeRetailPriceAfterDiscount` in `src/commerce/storefront-product.ts`) has **not** been modified or removed by this task. Removing it remains the responsibility of U15 / P6 as scheduled in the master plan.

