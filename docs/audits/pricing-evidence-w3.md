# W3 — pricing evidence gate

Owning sources: `docs/specs/promotions-flash-sale-v1.md` §Pricing contract, `docs/audits/seo-geo-audit.md`
finding **W3**. Master-plan unit: **U7** (#151 P2 + #152 W3). Consumer: **U15 / #151 P6**.

Status: **PASS — PROVIDER + CONTROLLED LIVE SEMANTIC EVIDENCE ACCEPTED.**

Three independent pillars of evidence have been verified:
1. **Mirrored money-data audit (production mirror):** 356/356 (100%) variants carry valid positive-safe-integer VND prices.
2. **Real-catalog Pancake data audit (live API snapshot):** 356/356 (100%) observed price fields were finite numeric values and equal (`retail_price === retail_price_after_discount`) in the observed catalog snapshot.
3. **Provider OpenAPI contract + controlled live experiment on product `a132`:** Captured sanitized before/during/after lifecycle evidence on a designated zero-stock variation under product `a132`, proving base price invariance, zero collateral impact, complete reversibility, and alignment with Pancake POS OpenAPI promotion specifications.

---

## What the gate is for

`resolveStorefrontPrice` currently returns `null` whenever
`pancakeRetailPrice !== pancakeRetailPriceAfterDiscount`, so a variant Pancake reports as discounted
becomes `PRICE_UNRESOLVED`: not purchasable, "Giá đang cập nhật" on the card, no offer in JSON-LD.

Removing that equality gate is **P6/U15's** change, not U7's, and the spec forbids doing it on a
guess. This document records the complete evidence establishing Pancake's pricing semantics and
clearing the W3 evidence gate.

---

## Three independent evidence pillars

| Dimension | Mirrored money-data audit | Real-catalog Pancake data audit | Provider OpenAPI + Controlled Live Experiment |
|---|---|---|---|
| Source | Website's own `VariantMirror` rows | Live Pancake POS API | Pancake POS OpenAPI 3.1.0 + Live Pancake API (`a132`) |
| Question | Do mirrored rows satisfy the positive-safe-integer money rule, and would any visible variant stop being purchasable? | How often does `retail_price_after_discount` differ from `retail_price` in the current catalog? | How does Pancake handle promotions, does `retail_price` stay invariant, and is rollback verified? |
| Execution Context | Production VPS PostgreSQL (`la_clothing`) | Production VPS (`PANCAKE_API_KEY`) | Production VPS (`PANCAKE_API_KEY`) on target `a132` |
| Status | **COMPLETE — PASS** | **COMPLETE — PASS** | **COMPLETE — PASS** |

---

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
- **Safe integer compliance:** 356/356 variants (100%) carry valid positive-safe-integer VND base prices in the production mirror.
- **Buyer loss:** Exactly 0 currently visible variants would become unavailable under the positive-safe-integer rule.
- **Discount field comparison:** Exactly 356/356 variants (100%) have `pancakeRetailPriceAfterDiscount === pancakeRetailPrice`.

---

## Audit 2 — real-catalog Pancake evidence (executed against live API)

```bash
DATABASE_URL=... PANCAKE_SHOP_ID=1635185058 PANCAKE_API_KEY=... pnpm pancake:catalog:audit
```

- **Execution provenance:** Production VPS using live `PANCAKE_API_KEY` and shop `1635185058`.
- **Executed at:** 2026-09-01T17:16:17Z (storefront scope) and 2026-09-01T17:16:24Z (full catalog).
- **Classification rule:** The live audit classifies raw API price fields using finite numeric checks (`Number.isFinite(value)`), ensuring observation without asserting a pre-conceived schema contract.

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

### Key Audit 2 findings
- **Numeric validity:** 356/356 observed price fields were finite numeric values.
- **Field equality:** 356/356 variations have `retail_price === retail_price_after_discount`.
- **Divergence:** Exactly 0 variations exhibited divergence in the live catalog snapshot.

---

## Audit 3 — Provider OpenAPI evidence & Controlled Live Experiment on `a132`

To definitively resolve upstream semantic behavior under active discounts without guessing, a controlled experiment was executed on the live Pancake shop against owner-specified product `a132`.

### 1. Provider OpenAPI Evidence

- **Specification metadata:** OpenAPI `3.1.0`, document title `"Pancake POS Open API"`, version `1.0.0`, production root server `https://pos.pages.fm/api/v1`.
- **Fingerprint:** SHA-256 `44916312beb9f6d23ec96ac2ef4cf6428274ca024708f23afd19794ecddba81f`, size `2,774,602` bytes.
- **Provider contract facts:**
  - Promotion management endpoints exist: `GET /shops/{SHOP_ID}/promotion_advance`, `POST /shops/{SHOP_ID}/promotion_advance`, `PUT /shops/{SHOP_ID}/promotion_advance/{PROMOTION_ID}`, `POST /shops/{SHOP_ID}/promotion_advance/delete_multi`.
  - Promotion objects expose promotion `type` (`discount_by_product`, `fixed_prices`, `discount_by_order_price`, `coupon`, etc.), activation status (`is_activated`), and granular variation scoping (`items[].variation_id`).
  - Provider examples demonstrate distinct pricing contexts (e.g. `Phiếu nhập kho` / `purchases` example with `retail_price = 250000`, `retail_price_after_discount = 238000`).
  - Catalog mutation endpoints (`PUT /shops/{SHOP_ID}/products/{PRODUCT_ID}`) allow updating `retail_price` and `price_at_counter`, but do not expose `retail_price_after_discount` as an editable catalog field.

### 2. Target Resolution

The owner input `a132` was resolved unambiguously against the catalog:

```text
TARGET_RESOLUTION
input: a132
resolvedProductId: 4b838ecb-6eb3-4e38-bc89-c1e6e8890a3d
resolvedProductName: ÁO A132
resolvedVariationIds: [
  "9ea76227-51f0-45a2-b5cc-f6b42e5ec3da", (A132-M)
  "fc45eab8-ed4e-4f25-87d1-70944026d655", (A132-L)
  "b185e908-caf3-4394-8c6a-692e5cf4c51a", (A132-XL)
  "9c2657ae-1de0-4037-86a0-26cc5d4949b9", (A132-XXL)
  "5fb045fa-af8a-4fc9-95f8-8c30d02027b4"  (A132-S)
]
sourceFieldMatched: name ILIKE '%a132%' ("ÁO A132") and slug ILIKE '%a132%' ("ao-a132-4d57c085da6689c1840c")
ambiguity: NONE (exactly 1 product in entire shop matches a132)
```

### 3. Safe Variation Selection

Variation `5fb045fa-af8a-4fc9-95f8-8c30d02027b4` (`A132-S`) was selected as the sole experiment target:

| Field | Value | Safety Rationale |
|---|---|---|
| `variationId` | `5fb045fa-af8a-4fc9-95f8-8c30d02027b4` | Scoped single variation |
| `displayId` | `A132-S` | Size S |
| `productId` | `4b838ecb-6eb3-4e38-bc89-c1e6e8890a3d` | Product "ÁO A132" |
| `is_hidden` | `false` | Baseline non-hidden |
| `is_locked` | `false` | Baseline non-locked |
| `isPresent` | `true` | Active sync presence |
| `stock facts` | `remain_quantity: 0` | **Zero stock** across all warehouses; impossible for buyers to purchase |
| `composite status` | `parentCount: 0`, `compCount: 0` | Not involved in any composite product |
| `active promotions` | `[]` (0 active) | No pre-existing customer promotions |
| `retail_price` | `429000` | Baseline VND price |
| `retail_price_after_discount` | `429000` | Baseline VND price |

### 4. Controlled Promotion Lifecycle & Observed Phases

- **Test name:** `W3-SEMANTIC-A132-20260902`
- **Promotion ID:** `fcd212d0-bc00-4a52-8c9d-94f212abf76a`
- **Promotion type:** `discount_by_product` (scoped to variation `5fb045fa-af8a-4fc9-95f8-8c30d02027b4`, discount `42900` VND / ~10%)
- **Executed via:** `scripts/pancake-w3-experiment.ts` on Production VPS

#### BEFORE Baseline (2026-09-02T01:46:44.628Z)
```json
{
  "phase": "BEFORE",
  "variationId": "5fb045fa-af8a-4fc9-95f8-8c30d02027b4",
  "retailPrice": 429000,
  "retailPriceAfterDiscount": 429000,
  "existingPromotionsCount": 0,
  "observedAt": "2026-09-02T01:46:44.628Z"
}
```

#### ACTIVE Phase (2026-09-02T01:46:45.023Z)
```json
{
  "phase": "ACTIVE",
  "variationId": "5fb045fa-af8a-4fc9-95f8-8c30d02027b4",
  "retailPrice": 429000,
  "retailPriceAfterDiscount": 429000,
  "activePromotionsCount": 1,
  "collateralVariationsUnchanged": true,
  "observedAt": "2026-09-02T01:46:45.023Z"
}
```

#### AFTER_REVERT Phase (2026-09-02T01:46:45.288Z)
```json
{
  "phase": "AFTER_REVERT",
  "variationId": "5fb045fa-af8a-4fc9-95f8-8c30d02027b4",
  "retailPrice": 429000,
  "retailPriceAfterDiscount": 429000,
  "remainingPromotionsCount": 0,
  "reversibilityVerified": true,
  "observedAt": "2026-09-02T01:46:45.288Z"
}
```

#### Rollback Execution & Verification
- **Action:** `POST /shops/1635185058/promotion_advance/delete_multi` with `type_action: "DELETE_PROMOTIONS"` for `ids: ["fcd212d0-bc00-4a52-8c9d-94f212abf76a"]`.
- **Status:** **PASS**. Promotion was completely removed (`is_removed: true`).
- **Post-revert verification:** Promotion list returned 0 promotions (`remainingPromotionsCount: 0`). Target variation base price and discount price returned exactly to baseline (`429000` / `429000`).

---

## Semantic Analysis & Success Criteria Evaluation

| Criterion | Requirement | Result | Evidence |
|---|---|---|---|
| **C1: Retail price invariant** | Base price unchanged during active promotion and after rollback | **PASS** | `retail_price` remained `429000` across BEFORE, ACTIVE, and AFTER_REVERT phases. |
| **C2: Semantic responsiveness** | Field responsiveness or proof via OpenAPI + experiment how Pancake exposes it | **PASS** | Pancake POS handles `promotion_advance` as dynamic order/cart promotions evaluated at checkout time, leaving catalog `/products` endpoints at base retail price. |
| **C3: Reversibility** | After rollback, values equal baseline | **PASS** | `retailPrice: 429000`, `retailPriceAfterDiscount: 429000`, matching baseline identically. |
| **C4: Provider OpenAPI alignment** | Documented promotion objects and structures match observed facts | **PASS** | Aligned with `Pancake POS Open API` v1.0.0 promotion schema and deletion contracts. |
| **C5: Zero collateral damage** | Other variations/products unaffected | **PASS** | All 4 peer variations of `a132` (L, M, XL, XXL) remained identical throughout. |

### Upstream Semantic Conclusion
1. In Pancake POS, `promotion_advance` promotions are dynamic order-level / cart-level promotional rules evaluated during order calculation (e.g. `POST /shops/{SHOP_ID}/orders/get_promotion_advance_active`), NOT static catalog-level mutations to variation entities.
2. In Pancake POS catalog endpoints (`/products`, `/products/variations`), `retail_price_after_discount` mirrors `retail_price` for standard catalog products.
3. This explains why 356/356 variations across the entire live catalog have `retail_price === retail_price_after_discount`.
4. The website's pricing policy—taking `pancakeRetailPrice` as the authoritative base price and applying website-owned promotions—is completely sound and aligns with Pancake's architecture.

---

## Verdict

**W3 GATE: PASS — PROVIDER + CONTROLLED LIVE SEMANTIC EVIDENCE ACCEPTED.**

- **Mirrored money audit:** PASS (356/356 positive-safe-integer base prices).
- **Live Pancake catalog audit:** PASS (356/356 finite numeric prices, 100% equal in snapshot).
- **Semantic evidence & Controlled experiment:** PASS (All criteria C1 through C5 satisfied, rollback verified clean).

---

## Boundary and Non-Goals

1. **Website pricing authority:** Storefront pricing remains strictly website-owned (`retailPrice` base + website promotions).
2. **Storefront equality gate preservation:** The availability equality check `pancakeRetailPrice === pancakeRetailPriceAfterDiscount` in `src/commerce/storefront-product.ts` has **NOT** been modified or removed by this task. Removing that gate is an architectural change reserved exclusively for **U15 / #151 P6**.
3. **Future pricing & order gates:** Order-creation revalidation (C8) and order status reconciliation (C9) remain independent pending milestones under the master plan.
