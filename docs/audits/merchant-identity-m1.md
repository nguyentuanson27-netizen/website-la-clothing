# M1 / W4a — Merchant identity and durability audit

Owning sources: `docs/specs/marketing-analytics-shopping.md` §6.2, `tasks/marketing-analytics-shopping-plan.md`
§3.3 and M1, `docs/audits/seo-geo-audit.md` finding **W4a**. Master-plan unit: **U9**.
Consumers: **U12 / M2**, **U25 / M3**, **Gate M**.

Status: **DURABILITY PROVEN via §3.3 Option B.** A controlled experiment on production product
`a132` (`4b838ecb-6eb3-4e38-bc89-c1e6e8890a3d`) using independent owner-controlled cryptographic markers
at the raw Pancake API boundary established that the same upstream product and variations retain the exact
same `pancakeProductId` and `pancakeVariationId` across controlled reversible mutations and repeated
full-catalog resync observations, with zero remap, verified pagination completeness, and verified restoration.
Combined with repository tests proving mirror reconciliation by external ID, this satisfies §3.3 Option B.
Emitted offers additionally remain blocked on owner apparel runtime (**O3**) and catalog fact readiness (SKU/MPN, media).

## Verdict summary

| Question | Status |
|---|---|
| Are `pancakeVariationId` / `pancakeProductId` present, bounded and well-formed in the mirror? | **PROVEN** — 149/149 emittable variation IDs present, 35/35 product IDs present |
| Are emitted variation ids unique? | **PROVEN** — 0 duplicate variation IDs across the catalog |
| Is SKU usable as MPN (present, unique across emitted variations)? | **NOT READY** — 149/149 standalone variations missing SKU in Pancake |
| Are composites excluded? | **PROVEN** — 116 composite members classified `COMPOSITE_DEFERRED` and excluded |
| Does the mirror reconcile rows by external id rather than slug/position/local id? | **PROVEN** — repository tests (`tests/database/merchant-identity-audit.test.ts`). Renaming a product or modifying option text updates the existing rows by external id |
| Do upstream objects keep those ids for their lifetime? | **PROVEN via §3.3 Option B** — controlled reversible mutations and multi-run raw catalog observations on production product `a132` proved that independently-correlated upstream objects retain the same `pancakeProductId` and `pancakeVariationId` across mutations and resyncs; combined with repository reconciliation tests |
| Does every emittable record have a price the website would publish? | **READY** — 149/149 emittable prices resolved (`PRICE_UNRESOLVED: 0`) |
| Is stock status known? | **READY** — 77 `IN_STOCK`, 71 `OUT_OF_STOCK`, 1 `AVAILABILITY_UNRESOLVED` |
| Does every emittable record have a trusted image? | **NOT READY** — 149/149 missing variant-level media |
| Is title and published description text serializable into a feed? | **READY** (title 149/149, description 5 published / 144 draft) |
| Is a GTIN available? | **Not asserted, by design** |
| Are `gender` / `age_group` / `condition` ready? | **Policy RESOLVED** by ADR 0007; **runtime BLOCKED** — no override persistence, validation, admin editing or effective-fact projection exists yet |

## What the audit does

```bash
DATABASE_URL=... PANCAKE_SHOP_ID=... pnpm merchant:identity:audit
```

Read-only, scoped to the configured shop, bounded at 50,000 variations, and it refuses rather than
truncating if the catalog exceeds that.

It audits only what would actually be **emitted**: standalone, storefront-visible variations. A
hidden variation's missing SKU is not a Merchant problem, and counting it would produce a verdict
nobody can act on. Composites are counted separately as `COMPOSITE_DEFERRED` and excluded, so a
component's missing SKU never drags down the standalone MPN verdict.

`mpnReady` is true only when **every** emittable variation has a present SKU and no SKU is shared.
SKU is nullable and not database-unique, which is precisely why this needs measuring rather than
assuming.

### Catalog facts

Beyond identity, the audit counts the facts an offer needs, for emittable records only:

| Fact | Source of truth | Why it is not re-derived here |
|---|---|---|
| Price | `resolveStorefrontPrice` | An audit with its own definition of a usable price would report a readiness the storefront does not share. That rule is still equality-gated on the mirrored Pancake fields pending **W3**, so `PRICE_UNRESOLVED` is exactly the number that decides whether the gate can move. |
| Media | `parseTrustedProductImageUrl` | An untrusted host is not a Merchant image, however well-formed the URL. |
| Description | `ProductContent.status === "PUBLISHED"` | A Draft is work in progress; auditing it would overstate readiness. |
| Availability | Validated `WarehouseStock.quantity` sources, then aggregate | Every source quantity is validated before aggregation. Valid positive stock is `IN_STOCK`; a real zero total is valid `OUT_OF_STOCK` and may later be emitted as `out_of_stock`. If any source row is non-finite or negative, the fact is `AVAILABILITY_UNRESOLVED` rather than fabricated as zero stock. M3 must exclude that unresolved row with a bounded reason. |
| Title / description text | XML 1.0 serializability | `MALFORMED` means at least one code point is outside the XML 1.0 `Char` production (including U+FFFE/U+FFFF) or a surrogate is unpaired. XML-legal characters such as U+007F remain `READY`. Not a style judgement. |

`merchantFactsReady` counts emittable records with a publishable price, a trusted image, serializable
title/description **and a resolved availability fact**. A valid zero-stock row still counts because
`out_of_stock` is a real Merchant state; `AVAILABILITY_UNRESOLVED` does not count as ready.

### What the report may echo

Counts and verdicts, plus **one deliberate exception**: the duplicate diagnostics name the colliding
`pancakeVariationId` or SKU. A duplicate report an admin cannot act on is not worth producing, and a
catalog identifier is not personal data.

Everything else is a count. **Catalog free text — a product title, a description — never reaches the
summary**, because that is where a person's name or phone number ends up and an audit report gets
pasted into issues. A malformed title is counted, never reproduced.

The boundary is pinned in both directions by test: a colliding SKU must appear, and free text must
not. A one-sided assertion would be satisfied by a report that echoes nothing useful just as easily
as by one that echoes too much.

### What it deliberately does not do

- **No apparel value is produced, derived or restated.** ADR 0007 settled the O3 *policy* — approved
  shop defaults plus local product-owned overrides — so the audit reports `policy: RESOLVED` with
  `productOverrides: NOT_IMPLEMENTED` and a verdict still `BLOCKED`, now by the missing runtime
  rather than by an open owner decision. It emits no value either way: a product name, a category or
  a size chart is not evidence of who a garment is for, and restating the approved defaults here
  would make this a second authority for a value the feed publishes. M3 applies them.
- **No vendor format is asserted.** Which shape a Pancake identifier takes is an observation to
  record, not a rule to enforce. Encoding a guessed format would turn the audit into the assumption
  it exists to replace.
- **`pancakeBarcode` is not read at all.** A field name is not proof of a GTIN. Not selecting it is
  a stronger guard than selecting and ignoring it, because it removes the temptation later.

## Audit execution — production mirror

```bash
DATABASE_URL=... PANCAKE_SHOP_ID=1635185058 pnpm merchant:identity:audit
```

- **Execution provenance:** Production VPS (PostgreSQL 17, shop `1635185058`).
- **Executed at:** 2026-09-01T17:16:09Z.

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
    "TOO_LONG": 0
  },
  "productIdentifiers": {
    "PRESENT": 35,
    "MISSING": 0,
    "BLANK": 0,
    "UNTRIMMED": 0,
    "TOO_LONG": 0
  },
  "sku": {
    "PRESENT": 0,
    "MISSING": 149,
    "BLANK": 0,
    "UNTRIMMED": 0,
    "TOO_LONG": 0
  },
  "duplicateVariationIds": [],
  "duplicateSkus": [],
  "mpnReady": false,
  "price": {
    "READY": 149,
    "PRICE_UNRESOLVED": 0
  },
  "availability": {
    "IN_STOCK": 77,
    "OUT_OF_STOCK": 71,
    "AVAILABILITY_UNRESOLVED": 1
  },
  "media": {
    "READY": 0,
    "MISSING": 149,
    "UNTRUSTED": 0
  },
  "title": {
    "READY": 149,
    "MISSING": 0,
    "MALFORMED": 0
  },
  "description": {
    "READY": 5,
    "MISSING": 144,
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

## Durability gate — PROVEN via §3.3 Option B

§3.3 requires at least one durability proof for both `pancakeVariationId` and `pancakeProductId`:

1. provider/API contract evidence that the IDs are stable for the lifetime of the same upstream product/variation; or
2. **controlled repeated full-catalog resync evidence showing the same upstream objects retain the same IDs, combined with repository tests proving mirror rows are reconciled by those IDs (Option B)**; or
3. equivalent historical evidence approved in review.

The gate is now **PROVEN via §3.3 Option B**, backed by a controlled live experiment on production product
`a132` (`scripts/pancake-m1-durability-experiment.ts`) and repository reconciliation tests (`tests/database/merchant-identity-audit.test.ts`).

### 1. Controlled live experiment on production product `a132`

- **Execution provenance:** Production VPS (Node.js v22.23.2, Pancake shop `1635185058`).
- **Executed at:** `2026-09-02T07:04:56Z` – `2026-09-02T07:05:07Z`.
- **Command:** `M1_EXPERIMENT_APPROVED=a132 node --env-file=.env.local --experimental-strip-types scripts/pancake-m1-durability-experiment.ts`
- **Target resolution:** Target `a132` was queried directly from the Pancake API (`/shops/1635185058/products?search=a132`). Exactly 1 upstream product matched:
  - `pancakeProductId`: `4b838ecb-6eb3-4e38-bc89-c1e6e8890a3d`
  - Name: `"ÁO A132"`
  - `custom_id`: `"A132"`
  - `display_id`: `"145"`
  - Variations count: 5 (sizes S, M, L, XL, XXL).
- **Production safety & guaranteed restoration:**
  - Pre-mutation snapshot captured all original product and variation fields.
  - Mutations were restricted to non-customer-facing metadata: `note_product` and variation `custom_id` (reflected as `display_id`). No prices, stock, variant axes, barcodes, or sales states were touched.
  - Restoration executed in a guaranteed `finally` block and verified via a fresh GET from the Pancake API (`productionProductRestored: true`, `verifiedFieldsMatch: true`).
- **Independent correlate design:**
  - Rather than relying on the IDs under test or local mirror rows, owner-controlled cryptographic markers were assigned:
    - Product marker: `M1-A132-P-ea6d7453`
    - Variation markers:
      - Size S: `M1-A132-V-S-ea6d7453`
      - Size M: `M1-A132-V-M-ea6d7453`
      - Size L: `M1-A132-V-L-ea6d7453`
      - Size XL: `M1-A132-V-XL-ea6d7453`
      - Size XXL: `M1-A132-V-XXL-ea6d7453`
- **Raw API Boundary observations:**
  - Each observation performed a complete traversal of all 4 catalog pages (356 total variations) directly from the live Pancake POS API (`/shops/1635185058/products/variations`) before any mirror write.
  - Products and variations were located exclusively by independent markers.
- **Phase observations & mutations:**
  - **T0 (Baseline snapshot, `2026-09-02T07:04:56.191Z`, 356 variations):**
    - `M1-A132-P-ea6d7453` $\rightarrow$ `4b838ecb-6eb3-4e38-bc89-c1e6e8890a3d`
    - `M1-A132-V-S-ea6d7453` $\rightarrow$ `5fb045fa-af8a-4fc9-95f8-8c30d02027b4`
    - `M1-A132-V-M-ea6d7453` $\rightarrow$ `9ea76227-51f0-45a2-b5cc-f6b42e5ec3da`
    - `M1-A132-V-L-ea6d7453` $\rightarrow$ `fc45eab8-ed4e-4f25-87d1-70944026d655`
    - `M1-A132-V-XL-ea6d7453` $\rightarrow$ `b185e908-caf3-4394-8c6a-692e5cf4c51a`
    - `M1-A132-V-XXL-ea6d7453` $\rightarrow$ `9c2657ae-1de0-4037-86a0-26cc5d4949b9`
  - **Mutation 1:** Updated `note_product` to `M1-A132-P-ea6d7453|MUT1`.
  - **T1 (After Mutation 1, `2026-09-02T07:04:59.648Z`, 356 variations):**
    - Identical mapped product ID and variation IDs across all markers.
  - **Mutation 2:** Updated `note_product` to `M1-A132-P-ea6d7453|MUT2`.
  - **T2 (After Mutation 2, `2026-09-02T07:05:03.244Z`, 356 variations):**
    - Identical mapped product ID and variation IDs across all markers.
- **Comparison evaluation:**
  - Evaluated via `compareCorrelatedObservations`:
    - `productMarkerStable`: `true`
    - `variationMarkersStable`: `true`
    - `allMarkersRetainedSameIds`: `true`
    - `remapDetected`: `false` (no ID swapping or remapping)
    - `duplicateMarkersDetected`: `false`
    - `missingMarkersDetected`: `false`
    - `verdict`: `"STABLE"`

```json
{
  "runsObserved": 3,
  "productMarker": "M1-A132-P-ea6d7453",
  "productMarkerStable": true,
  "observedProductIds": [
    "4b838ecb-6eb3-4e38-bc89-c1e6e8890a3d",
    "4b838ecb-6eb3-4e38-bc89-c1e6e8890a3d",
    "4b838ecb-6eb3-4e38-bc89-c1e6e8890a3d"
  ],
  "stableProductId": "4b838ecb-6eb3-4e38-bc89-c1e6e8890a3d",
  "variationMarkersStable": true,
  "variationResults": [
    { "variationMarker": "M1-A132-V-L-ea6d7453", "stableVariationId": "fc45eab8-ed4e-4f25-87d1-70944026d655", "isStable": true },
    { "variationMarker": "M1-A132-V-M-ea6d7453", "stableVariationId": "9ea76227-51f0-45a2-b5cc-f6b42e5ec3da", "isStable": true },
    { "variationMarker": "M1-A132-V-S-ea6d7453", "stableVariationId": "5fb045fa-af8a-4fc9-95f8-8c30d02027b4", "isStable": true },
    { "variationMarker": "M1-A132-V-XL-ea6d7453", "stableVariationId": "b185e908-caf3-4394-8c6a-692e5cf4c51a", "isStable": true },
    { "variationMarker": "M1-A132-V-XXL-ea6d7453", "stableVariationId": "9c2657ae-1de0-4037-86a0-26cc5d4949b9", "isStable": true }
  ],
  "allMarkersRetainedSameIds": true,
  "remapDetected": false,
  "duplicateMarkersDetected": false,
  "missingMarkersDetected": false,
  "verdict": "STABLE"
}
```

### 2. Repository reconciliation by external ID (proven in test)

`tests/database/merchant-identity-audit.test.ts` proves that `ProductMirror` and `VariantMirror` rows
are reconciled by `pancakeProductId` and `pancakeVariationId`: renaming a product or altering color/size
options updates the existing row rather than creating a duplicate row.

Together, parts (1) and (2) satisfy the two halves of **§3.3 Option B**:
1. Upstream raw Pancake boundary evidence proves the same marked objects retain their external IDs across updates and resyncs;
2. Repository tests prove local database mirror rows reconcile by those external IDs.

### 3. Historical time-separated stability (supporting context)

Comparing the production mirror database (synced at `2026-08-29T06:38:11.701Z` per `CatalogSyncState`)
against the live Pancake API fetched on `2026-09-01T17:16:42.377Z`:
- Time separation: **4 days**.
- Database variation count: 356.
- Live API variation count: 356.
- Stable variation IDs: **356 / 356 (100.0%)**.
- Disappeared variation IDs: **0**.
- Appeared variation IDs: **0**.

### Known limitations & scope

- **No perpetual contractual guarantee:** The Pancake POS OpenAPI does not provide an explicit contractual lifetime or non-reuse guarantee. Durability is proven via **§3.3 Option B** empirical controlled multi-run correlation evidence rather than provider contractual guarantee.
- **Target scope:** The controlled mutation experiment was conducted on production product `a132` (`4b838ecb-6eb3-4e38-bc89-c1e6e8890a3d`) across all 5 variations.

### Durability Verdict

**M1 DURABILITY GATE: PROVEN via §3.3 Option B.**

## Status of downstream Merchant gates

- **Identifier Durability (M1):** **PROVEN via §3.3 Option B.** Upstream external ID stability under controlled mutation and repeated observations is established, combined with repository reconciliation tests.
- **MPN (SKU readiness):** **NOT READY.** 149/149 standalone variants currently have no SKU in Pancake.
  **Owner decision required:** omit MPN from emitted offers rather than inventing an MPN, or populate SKUs upstream in Pancake.
- **Media readiness:** 149/149 standalone variants currently lack variant-level media in the mirror.
- **Editorial description:** 5 published, 144 draft.
- **Apparel facts (O3):** **Policy RESOLVED** by ADR 0007 (`male` / `adult` / `new` shop defaults with local product overrides); **runtime BLOCKED** — no override persistence, validation, admin editing or effective-fact projection exists. Offer emission (U25 / M3) cannot proceed until that runtime lands.



