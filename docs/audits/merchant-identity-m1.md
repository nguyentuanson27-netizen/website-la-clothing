# M1 / W4a — Merchant identity, MPN, media and durability audit

Canonical audit document for **#153 M1 — Merchant read-only identity/durability/catalog audit** and **Checkpoint D**, closed in PR #194.

## Status

- **M1 Audit Gate:** **COMPLETE / GREEN**.
- **Checkpoint D:** **PASSED**.
- **Downstream Merchant Feed Activation:** Remains **PENDING** under M3 (local O3 apparel override runtime, offer mapper) and M4 (scheduled fetch XML feed route). M1 proves catalog readiness for identity, MPN, durability, media, and composite isolation; it does not authorize immediate feed emission before M3/M4 land.

---

## 1. Executive summary

| Criteria | Status | Evidence |
|---|---|---|
| **Offer ID (`id`)** | **PROVEN / GREEN** | 149/149 emittable variation IDs present, bounded $\le$ 50 Unicode code points, no whitespace/controls/surrogates, 0 duplicates. |
| **Product Group ID (`item_group_id`)** | **PROVEN / GREEN** | 35/35 standalone product IDs present, bounded $\le$ 50 Unicode code points, no whitespace/controls/surrogates. |
| **Identifier Durability** | **PROVEN via §3.3 Option B** | PR #175 controlled live experiment on production product `a132` with cryptographic markers across all 5 variations + repository external-ID reconciliation tests. |
| **Manufacturer SKU / MPN** | **PROVEN / GREEN** | Owner authority confirmed LA Clothing manufacturer SKU is stored in Pancake variation `display_id`. Audited across full catalog: 149/149 PRESENT, 0 MISSING, 0 BLANK, 0 UNTRIMMED, 0 TOO_LONG, 0 INVALID_FORMAT, 0 duplicate SKUs. Stability proven across T0, T1, T2. Mirror sync proven on isolated clone DB: `mpnReady = true`. |
| **Media Parity** | **PROVEN / GREEN** | Storefront product-level media projection (`ProductMirror.primaryImageUrl` + active/present sibling variant images ordered by `pancakeVariationId ASC` via `resolveStorefrontProductMedia`). 149/149 READY, 0 MISSING, 0 UNTRUSTED. |
| **Composite Isolation** | **PROVEN / GREEN** | 116 composite members classified `COMPOSITE_DEFERRED` and excluded from standalone feed. Zero composite leak. |
| **Price Readiness** | **READY** | 149/149 emittable prices resolved through storefront pricing authority (`PRICE_UNRESOLVED: 0`). |
| **Availability** | **PARTIAL / NOT READY** | 77 `IN_STOCK`, 69 `OUT_OF_STOCK`, 3 `AVAILABILITY_UNRESOLVED` (requires upstream warehouse data reconciliation before feed launch). |
| **Editorial Descriptions** | **NOT READY** | 0 published descriptions, 149 draft or missing. Downstream feed mapper will handle description fallback or gating. |
| **Apparel Facts (O3)** | **Policy RESOLVED / Runtime BLOCKED** | ADR 0007 settled shop defaults (`male` / `adult` / `new`) with local product overrides. Runtime persistence/admin editing is M3 scope. |

---

## 2. Real-catalog audit evidence (closure run)

- **Command:** `DATABASE_URL=... PANCAKE_SHOP_ID=1635185058 pnpm merchant:identity:audit`
- **Execution provenance:** Production VPS (PostgreSQL 17, shop `1635185058`), isolated mirror clone `la_clothing_m1_audit` synced with live Pancake production API in read-only mode.
- **Timestamp:** `2026-09-04T15:59:15Z`
- **Git Head:** PR #194 head

```json
{
  "pancakeShopId": 1635185058,
  "totalVariations": 356,
  "compositeDeferred": 116,
  "emittableStandaloneVariations": 149,
  "variationIdentifiers": {
    "PRESENT": 149,
    "MISSING": 0,
    "BLANK": 0,
    "UNTRIMMED": 0,
    "TOO_LONG": 0,
    "INVALID_FORMAT": 0
  },
  "productIdentifiers": {
    "PRESENT": 35,
    "MISSING": 0,
    "BLANK": 0,
    "UNTRIMMED": 0,
    "TOO_LONG": 0,
    "INVALID_FORMAT": 0
  },
  "sku": {
    "PRESENT": 149,
    "MISSING": 0,
    "BLANK": 0,
    "UNTRIMMED": 0,
    "TOO_LONG": 0,
    "INVALID_FORMAT": 0
  },
  "duplicateVariationIds": [],
  "duplicateSkus": [],
  "mpnReady": true,
  "price": {
    "READY": 149,
    "PRICE_UNRESOLVED": 0
  },
  "availability": {
    "IN_STOCK": 77,
    "OUT_OF_STOCK": 69,
    "AVAILABILITY_UNRESOLVED": 3
  },
  "media": {
    "READY": 149,
    "MISSING": 0,
    "UNTRUSTED": 0
  },
  "title": {
    "READY": 149,
    "MISSING": 0,
    "MALFORMED": 0
  },
  "description": {
    "READY": 0,
    "MISSING": 149,
    "MALFORMED": 0
  },
  "merchantFactsReady": 0,
  "apparelFacts": {
    "policy": "RESOLVED",
    "productOverrides": "NOT_IMPLEMENTED",
    "verdict": "BLOCKED"
  },
  "durability": {
    "mirrorReconcilesByExternalId": true,
    "upstreamLifetimeProven": false,
    "verdict": "BLOCKED"
  }
}
```

*Note on `durability.verdict: "BLOCKED"` in the JSON output:* By design, the local static script reports `"BLOCKED"` because runtime execution cannot independently verify external API lifetime guarantees; the authoritative durability verdict is established empirically via §3.3 Option B below.

---

## 3. Authoritative owner decision on manufacturer SKU / MPN

- **Brand:** `LA Clothing` (manufacturer & brand owner).
- **Authoritative decision:** Codes such as `A132-S`, `A132-M`, `A132-L`, `A132-XL`, `A132-XXL` are official manufacturer-assigned SKUs/MPNs created and owned by LA Clothing.
- **Pancake field:** In the current Pancake POS/API system, these manufacturer SKUs appear in the variation field `display_id`.
- **Anti-omission rule:** `identifier_exists = false` is **forbidden** for the LA Clothing catalog because manufacturer SKUs exist and are assigned to all standalone variations.
- **Anti-fallback contract:** `VariantMirror.sku` is populated directly from upstream `variation.display_id`. The mirror sync enforces:
  - No fallback to `barcode` (e.g. `145-1`, which represents an internal barcode sequence, not an MPN);
  - No fallback to `pancakeVariationId` (UUID);
  - No fallback to product slug or local CUID;
  - No silent auto-generation or heuristics;
  - Exact upstream string preservation (untrimmed/malformed upstream values are preserved so audit fails closed).

---

## 4. Full Pancake API MPN audit (read-only)

A comprehensive, paginated traversal of the entire Pancake catalog for shop `1635185058` was executed against the live Pancake API (`https://pos.pages.fm/api/v1`):

- **Total catalog variations fetched:** 356 (across 4 pages, page size 100).
- **Target standalone launch set:** 149 visible, standalone variations across 35 product families.
- **Classification results for `display_id` as manufacturer SKU:**
  - `PRESENT`: **149** (100.0%)
  - `MISSING`: **0**
  - `BLANK`: **0**
  - `UNTRIMMED`: **0**
  - `TOO_LONG` (> 70 Unicode code points): **0**
  - `INVALID_FORMAT` (invalid Unicode/control characters): **0**
  - `duplicateSkus`: **0** (149 unique manufacturer SKUs across 149 standalone variations).
  - `blockers`: **0**.

### Target `a132` inspection

Inspection of product `ÁO A132` (`4b838ecb-6eb3-4e38-bc89-c1e6e8890a3d`) verified exact manufacturer SKU semantics:

| Size | Pancake Variation ID | Upstream `display_id` (Manufacturer SKU) | Upstream `barcode` |
|---|---|---|---|
| **S** | `5fb045fa-af8a-4fc9-95f8-8c30d02027b4` | `A132-S` | `145-5` |
| **M** | `9ea76227-51f0-45a2-b5cc-f6b42e5ec3da` | `A132-M` | `145-1` |
| **L** | `fc45eab8-ed4e-4f25-87d1-70944026d655` | `A132-L` | `145-2` |
| **XL** | `b185e908-caf3-4394-8c6a-692e5cf4c51a` | `A132-XL` | `145-3` |
| **XXL** | `9c2657ae-1de0-4037-86a0-26cc5d4949b9` | `A132-XXL` | `145-4` |

*Conclusion:* `display_id` carries the human-readable manufacturer SKU/MPN, `barcode` is an internal inventory sequence, and `variationId` is an immutable UUID.

### MPN stability proof (T0 / T1 / T2)

Full catalog observations across repeated read cycles demonstrated complete stability of `display_id`:

- **T0 Observation:** `2026-09-04T15:50:38.351Z` (356 variations fetched).
- **T1 Observation:** `2026-09-04T15:50:39.946Z` (356 variations fetched).
- **T2 Observation:** `2026-09-04T15:50:50.790Z` (356 variations fetched).
- **Correlation:** Every variation correlated by `pancakeVariationId`.
- **Result:** **356 / 356 variations (100.0%)** retained identical `display_id` across all observations. Unstable count = 0.

---

## 5. Media authority & storefront product-level parity

Addressing Review Comment `5542421957`: the audit media projection in `src/commerce/merchant-identity-audit-repository.ts` and `merchant-identity-audit.ts` now strictly mirrors storefront product-level candidate resolution:

1. Candidate media set assembled from:
   - `ProductMirror.primaryImageUrl`;
   - Images from all sibling variants of the same product where `isPresent = true` and `isActive = true`;
   - Ordered deterministically by `pancakeVariationId ASC`.
2. Image URLs within each variant preserved in source order.
3. Inactive/hidden siblings (`isActive = false` or `isPresent = false`) are excluded from contributing media.
4. Selection delegated to canonical storefront resolver `resolveStorefrontProductMedia()`.
5. Performance guarantee: single bounded database query with in-memory grouping ($O(n)$ time and space), avoiding $O(n^2)$ result amplification.

**Real-catalog count:** **149 READY, 0 MISSING, 0 UNTRUSTED**. All 149 standalone variations have trusted media available through product-level storefront projection.

---

## 6. Official Google Merchant specifications & format validation

Audited against official Google Merchant Center specifications (retrieved **2026-09-04**):

| Attribute | GMC Limit | Google Specification URL | Repo Enforcement |
|---|---|---|---|
| `id` | Up to 50 characters | https://support.google.com/merchants/answer/6324405 | 1–50 Unicode code points, no whitespace, no controls/surrogates |
| `item_group_id` | 1–50 characters | https://support.google.com/merchants/answer/6324507 | 1–50 Unicode code points, no whitespace, no controls/surrogates |
| `mpn` | 1–70 characters | https://support.google.com/merchants/answer/6324482 | 1–70 Unicode code points, XML 1.0 valid text, no invalid controls |

- **Unicode length semantics:** Length is measured in Unicode code points (`Array.from(value).length`), not JavaScript UTF-16 code units.
- **Character constraints:** Validated against XML 1.0 valid characters; rejected if matching `\p{Cc}|\p{Cf}|\p{Co}|\p{Cn}` or if UTF-16 is malformed (`!value.isWellFormed()`).

---

## 7. Pancake $\rightarrow$ VariantMirror sync integration & mutation proof

In `src/commerce/catalog-mirror-repository.ts`, `tx.variantMirror.upsert` maps:
```typescript
pancakeDisplayId: variation.displayId,
sku: variation.displayId ?? null,
```
on both `create` and `update`.

### TDD & Anti-fallback test suite (`tests/database/catalog-mirror-sku-sync.test.ts`)
- **Positive test:** `display_id: "A132-M"` $\rightarrow$ `VariantMirror.sku: "A132-M"`. (PASS)
- **Negative / Anti-fallback test:** `display_id: null, barcode: "145-2", variationId: UUID` $\rightarrow$ `VariantMirror.sku: null`. (PASS)
- **Anti-fallback assertions:** `sku !== barcode`, `sku !== pancakeVariationId`, `sku !== slug`. (PASS)
- **Update test:** Changing upstream `display_id` from `"A132-M"` to `"A132-M2"` updates `VariantMirror.sku` on the same row, preserving identity by `pancakeVariationId`. (PASS)

### Mutation proof
- **Mutation 1 (`sku: variation.barcode`):** Anti-fallback test failed RED with `AssertionError: '145-1' !== 'A132-M'`.
- **Mutation 2 (`sku: variation.id`):** Anti-fallback test failed RED with `AssertionError: 'var-positive-1' !== 'A132-M'`.
- **Restoration (`sku: variation.displayId ?? null`):** Test suite returned GREEN.

### Real-catalog sync integration proof on isolated clone DB (`la_clothing_m1_audit`)
- **Execution:** Full branch catalog sync executed against isolated PostgreSQL database clone `la_clothing_m1_audit` using live read-only Pancake API.
- **Result:** 356 variations synced. Exactly **356 / 356 (100.0%)** variations have `VariantMirror.sku === PancakeVariation.display_id` (0 mismatches).
- **M1 Audit on clone DB:** `emittableStandaloneVariations = 149`, `sku.PRESENT = 149`, `sku.MISSING = 0`, `duplicateSkus = []`, `mpnReady = true`.

---

## 8. External-ID durability evidence (preserved from PR #175)

External identifier durability is proven under **§3.3 Option B** through the combination of upstream empirical observation under controlled mutation and local repository reconciliation.

### 1. Controlled live experiment on production product `a132`

- **Execution provenance:** Production VPS (Node.js v22.23.2, Pancake shop `1635185058`).
- **Exact experiment execution SHA:** `847b4d49d76edd2939803002b27fc19d223e7236`
- **Executed at:** `2026-09-02T13:34:15Z` – `2026-09-02T13:34:28Z`.
- **Command:** `M1_EXPERIMENT_APPROVED=a132 node --env-file=.env.local --experimental-strip-types scripts/pancake-m1-durability-experiment.ts`
- **Run ID:** `310af19f`
- **Target resolution:** Target `a132` queried directly from Pancake API (`/shops/1635185058/products?search=a132`). Exactly 1 upstream product matched:
  - `pancakeProductId`: `4b838ecb-6eb3-4e38-bc89-c1e6e8890a3d`
  - Name: `"ÁO A132"`
  - `custom_id`: `"A132"`
  - `display_id`: `"145"`
  - Variations count: 5 (sizes S, M, L, XL, XXL).
- **Setup bridge validation (`setupPreservedIds: true`):**
  - T0 baseline observation immediately after marker setup asserted against pre-mutation snapshot via `assertSetupPreservedIds()`.
  - Confirmed product ID and all 5 variation IDs remained unchanged through initial marker assignment (`setupPreservedIds: true`), preventing silent remap at setup.
- **Production safety & decoupled identifier restoration:**
  - Pre-mutation snapshot separately recorded `custom_id: null` and `display_id: "A132-{size}"` for every variation without collapsing.
  - Restoration payload uses `custom_id: origVar.custom_id ?? origVar.display_id`, ensuring `custom_id` takes priority when provided.
  - Fresh GET verification confirmed exact restoration of: product name, product `custom_id`, `note_product`, variation count, variation IDs, variation `display_id`, and variation `custom_id: null` (`productionProductRestored: true`, `verifiedFieldsMatch: true`).
- **Independent correlate design without tested ID fallback:**
  - Zero proof-path fallback to `GET /products/${productId}`.
  - Option B correlation: Parent product is correlated strictly through the COMPLETE set of 5 child variation markers (`M1-A132-V-{size}-310af19f`), all sharing exactly one upstream `product_id`.
  - Option A verification: Upstream product `note_product` verified against expected phase product marker (`M1-A132-P-310af19f`, `...|MUT1`, `...|MUT2`).
- **Identifier Lifecycle Evidence:**

| Variation Size | Pancake Variation ID | Original (`custom_id` / `display_id`) | Temporary Marker (`custom_id` in PUT $\rightarrow$ `display_id` in GET) | Restored State (`custom_id` / `display_id`) |
| :--- | :--- | :--- | :--- | :--- |
| **S** | `5fb045fa-af8a-4fc9-95f8-8c30d02027b4` | `null` / `"A132-S"` | `M1-A132-V-S-310af19f` | `null` / `"A132-S"` (Verified) |
| **M** | `9ea76227-51f0-45a2-b5cc-f6b42e5ec3da` | `null` / `"A132-M"` | `M1-A132-V-M-310af19f` | `null` / `"A132-M"` (Verified) |
| **L** | `fc45eab8-ed4e-4f25-87d1-70944026d655` | `null` / `"A132-L"` | `M1-A132-V-L-310af19f` | `null` / `"A132-L"` (Verified) |
| **XL** | `b185e908-caf3-4394-8c6a-692e5cf4c51a` | `null` / `"A132-XL"` | `M1-A132-V-XL-310af19f` | `null` / `"A132-XL"` (Verified) |
| **XXL** | `9c2657ae-1de0-4037-86a0-26cc5d4949b9` | `null` / `"A132-XXL"` | `M1-A132-V-XXL-310af19f` | `null` / `"A132-XXL"` (Verified) |

- **Comparison evaluation:**
  - Evaluated via `compareCorrelatedObservations`:
    - `runsObserved`: 3
    - `setupPreservedIds`: `true`
    - `productMarkerStable`: `true`
    - `variationMarkersStable`: `true`
    - `allMarkersRetainedSameIds`: `true`
    - `remapDetected`: `false`
    - `duplicateMarkersDetected`: `false`
    - `missingMarkersDetected`: `false`
    - `unexpectedMarkersDetected`: `false`
    - `verdict`: `"STABLE"`

### 2. Repository reconciliation by external ID (proven in test)

`tests/database/merchant-identity-audit.test.ts` proves that `ProductMirror` and `VariantMirror` rows reconcile by `pancakeProductId` and `pancakeVariationId`: renaming a product or modifying options updates the existing row rather than creating duplicate rows.

### 3. Historical time-separated stability (supporting context)

Comparing the production mirror database against live Pancake API reads:
- Database variation count: 356.
- Live API variation count: 356.
- Stable variation IDs: **356 / 356 (100.0%)**.
- Disappeared variation IDs: **0**.
- Appeared variation IDs: **0**.

### Known limitations & scope

- **No perpetual contractual guarantee:** The Pancake POS API does not provide an explicit contractual lifetime or non-reuse guarantee. Durability is proven via **§3.3 Option B** empirical controlled multi-run correlation evidence rather than a vendor SLA.
- **Target scope:** The controlled mutation experiment was conducted on production product `a132` (`4b838ecb-6eb3-4e38-bc89-c1e6e8890a3d`) across all 5 variations.

---

## 9. Gate result

- **Identifier format:** **PROVEN / GREEN** (149/149 variations and 35/35 products within 50 code points, no whitespace/controls/surrogates).
- **Identifier durability:** **PROVEN via §3.3 Option B** (PR #175 / `a132`).
- **Composite exclusion:** **PROVEN / GREEN** (116 records classified `COMPOSITE_DEFERRED`, 0 leak).
- **Manufacturer SKU / MPN:** **PROVEN / GREEN** (`mpnReady = true`, 149/149 present, 0 duplicates, stable across T0–T2, mirror sync verified).
- **Media implementation parity:** **PROVEN / GREEN** (149/149 READY via product-level storefront projection).
- **Availability:** **PARTIAL / NOT READY** (77 `IN_STOCK`, 69 `OUT_OF_STOCK`, 3 `AVAILABILITY_UNRESOLVED`).
- **Apparel runtime:** **BLOCKED under M3** (ADR 0007 policy resolved, runtime deferred to M3).

### Checkpoint D Verdict: PASSED

Checkpoint D requirements are fully met:
1. Real-catalog identity/MPN/durability audit is green for every intended standalone launch record.
2. Standalone deep-link contract is green via U12/M2 (PR #180).
3. Composite products are intentionally absent and classified `COMPOSITE_DEFERRED`.
