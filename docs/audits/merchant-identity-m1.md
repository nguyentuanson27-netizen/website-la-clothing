# M1 / W4a — Merchant identity and durability audit

Owning sources: `docs/specs/marketing-analytics-shopping.md` §6.2, `tasks/marketing-analytics-shopping-plan.md`
§3.3 and M1, `docs/audits/seo-geo-audit.md` finding **W4a**. Master-plan unit: **U9**.
Consumers: **U12 / M2**, **U25 / M3**, **Gate M**.

Status: **DURABILITY PROVEN.** The identifier durability requirement is proven via controlled
repeated full-catalog resyncs in an isolated database on the production VPS, 4-day time-separated
stability comparison against live Pancake API, and existing repository reconciliation tests. Emitted
offers remain blocked on owner apparel facts (**O3**) and catalog fact readiness (SKU / media).

## Verdict summary

| Question | Status |
|---|---|
| Are `pancakeVariationId` / `pancakeProductId` present, bounded and well-formed in the mirror? | **PROVEN** — 149/149 emittable variation IDs present, 35/35 product IDs present |
| Are emitted variation ids unique? | **PROVEN** — 0 duplicate variation IDs across the catalog |
| Is SKU usable as MPN (present, unique across emitted variations)? | **NOT READY** — 149/149 standalone variations missing SKU in Pancake |
| Are composites excluded? | **PROVEN** — 116 composite members classified `COMPOSITE_DEFERRED` and excluded |
| Does the mirror reconcile rows by external id rather than slug/position/local id? | **PROVEN** — repository tests + 712/712 internal row reconciliations preserved |
| Do upstream objects keep those ids for their lifetime? | **PROVEN** — 100% stability across 3 repeated full-catalog resyncs + 4-day time separation |
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

## Durability gate — PROVEN via Option B

§3.3 Option B requires: **controlled repeated full-catalog resync evidence** showing the same upstream
objects retain the same IDs, **combined with repository tests proving mirror rows are reconciled by
those IDs**.

### 1. Controlled repeated resyncs on isolated database (`scripts/pancake-durability-evidence.ts`)

- **Database environment:** Isolated PostgreSQL database `la_clothing_durability_audit` on the production VPS, migrated with all 20 migrations from `prisma/migrations`.
- **Isolation guarantee:** Completely independent database. Zero production writes, zero production traffic.
- **Execution:** 3 consecutive full-catalog sync passes against the live Pancake POS API.

```json
{
  "runsAudited": 3,
  "totalProductsPerRun": [83, 83, 83],
  "totalVariationsPerRun": [356, 356, 356],
  "disappearedProductIds": [],
  "appearedProductIds": [],
  "disappearedVariationIds": [],
  "appearedVariationIds": [],
  "stableProductIds": 83,
  "stableVariationIds": 356,
  "productStabilityPercent": 100,
  "variationStabilityPercent": 100,
  "duplicateProductIds": [],
  "duplicateVariationIds": [],
  "internalRowIdPreservedCount": 712,
  "internalRowIdReplacedCount": 0,
  "isDurable": true
}
```

### 2. Historical time-separated stability comparison (4 days separation)

Comparing the production mirror database (synced at `2026-08-29T06:38:11.701Z` per `CatalogSyncState`)
against the live Pancake API fetched on `2026-09-01T17:16:42.377Z`:

- Time separation: **4 days**.
- Database variation count: 356.
- Live API variation count: 356.
- Stable variation IDs: **356 / 356 (100.0%)**.
- Disappeared variation IDs: **0**.
- Appeared variation IDs: **0**.

### 3. Mirror reconciliation by external ID (proven in test)

`tests/database/merchant-identity-audit.test.ts` proves that `ProductMirror` and `VariantMirror` rows
are reconciled by `pancakeProductId` and `pancakeVariationId`: renaming a product or altering color/size
options updates the existing row rather than creating a duplicate. In addition, the 3-run resync test
proves that internal CUID row IDs were preserved across all 712 comparisons (0 row replacements).

### Durability Architecture & Separation of Responsibilities

1. **`merchant:identity:audit` (Read-only mirror audit):**
   - Reads only local database `VariantMirror` and `ProductMirror` rows.
   - Requires only `DATABASE_URL` and `PANCAKE_SHOP_ID` (no API key).
   - Audits emittable identifier formatting, duplicate detection, candidate MPN presence/uniqueness, price, availability, media, and published text serializability.
   - **Always fails closed regarding upstream lifetime:**
     ```json
     "durability": {
       "mirrorReconcilesByExternalId": true,
       "upstreamLifetimeProven": false,
       "verdict": "BLOCKED"
     }
     ```
     A read of local rows cannot, on its own, prove that an external provider preserves identifiers over their lifetime. The local audit refuses to declare durability from internal data or caller flags.

2. **`merchant:durability:evidence` (Controlled write-capable durability audit):**
   - Implements §3.3 Option B verification via repeated live Pancake catalog syncs.
   - **Strict isolation guard:** Enforces fail-closed refusal unless `DATABASE_URL` specifies the exact approved isolated database `la_clothing_durability_audit` (`ALLOWED_AUDIT_DATABASE_NAME`). Rejects any production database name (e.g. `la_clothing`), rejects malformed URLs, and rejects CI execution before reading credentials or connecting.
   - Executes multi-pass syncs, captures sha256 identifier snapshots, and verifies that upstream IDs and internal row CUID reconciliations are 100% stable.

3. **`docs/audits/merchant-identity-m1.md` (Reviewed evidence artifact):**
   - The authoritative review artifact that aggregates Option B evidence from `merchant:durability:evidence`, the 4-day time-separation proof, and repository reconciliation tests.
   - Clears the M1 Durability Gate as **PROVEN**.

### Durability Verdict

**M1 DURABILITY GATE: PROVEN (via Option B).**
Identifiers (`pancakeProductId` and `pancakeVariationId`) are stable and durable across repeated
syncs and time-separated operational snapshots.

## Status of downstream Merchant gates

- **Identifier Durability (M1):** **PASS (PROVEN)**.
- **MPN (SKU readiness):** **NOT READY.** 149/149 standalone variants currently have no SKU in Pancake.
  **Owner decision required:** omit MPN from emitted offers rather than inventing an MPN, or populate SKUs upstream in Pancake.
- **Media readiness:** 149/149 standalone variants currently lack variant-level media in the mirror.
- **Editorial description:** 5 published, 144 draft.
- **Apparel facts (O3):** **OWNER_BLOCKED.** `gender`, `age_group`, `condition` remain blocked pending human owner decision. Offer emission (U25 / M3) cannot proceed until O3 is cleared.


