# W21 — Sitemap capacity, headroom and scale trigger

Owning source: `docs/audits/seo-geo-audit.md` finding **W21**, planning step **P6/W21**.
Master-plan unit: **U37**.

This is a capacity/readiness audit, not an implementation. It establishes the single-sitemap URL
budget and its exact eligibility predicates, builds a repeatable way to measure usage against them,
records what the available evidence does and does not support, and sets out the trigger that would
justify sharding. It deliberately changes no sitemap behavior.

- **Baseline SHA:** `6d2225c16b0b9578cbeea76e31d9b5fad5218f31`
- **Runtime action:** **NO SHARDING NOW** — current production evidence shows 21 dynamic URLs
  against a 49,996 dynamic URL budget (0.042% utilization, 49,975 remaining headroom), well below
  the approved Warning threshold of 40,000 URLs (≈80.006% of the dynamic budget) and Act threshold
  of 45,000 URLs (≈90.007%). Search indexing also remains fail-closed on the temporary production
  host ([§1](#the-cliff-is-currently-unreachable-in-production)).
- **Capacity verdict:** **SUFFICIENT EVIDENCE — BELOW APPROVED ACT TRIGGER** ([§2.4](#24-authoritative-production-capacity-audit-2026-09-07)).
- **U37 status:** **CLOSED** — see [§8](#8-u37-closure-record).

Those are deliberately two answers. Not sharding is defensible today on both operational grounds
(indexing is fail-closed on the temporary host) and proven capacity headroom (0.042% utilization
against the 49,996 dynamic budget). It is now backed by an attributable production measurement
and an approved monitoring contract.

---

## 1. The current sitemap contract, verified from source

| Element | Value | Source |
|---|---|---|
| Static canonical paths | 4 — `/`, `/shop`, `/collections`, `/lookbook` | `STATIC_CANONICAL_PATHS`, `src/seo/search-sitemap-repository.ts` |
| Dynamic path bound | 49,996 | `MAX_DYNAMIC_SITEMAP_PATHS`, same module — derived as `50,000 − STATIC_CANONICAL_PATHS.length` so a new static path cannot silently widen the document |
| **Single-sitemap budget** | **50,000 URLs** | 49,996 + 4, asserted in `tests/domain/sitemap-capacity.test.ts` |

Dynamic paths come from exactly two predicates, and nothing else:

| Group | Predicate | Emitted as |
|---|---|---|
| Products | `ProductMirror` where `pancakeShopId = <configured shop> AND isPresent = true AND isActive = true` | `/shop/<slug>` |
| Collections | `CollectionDefinition` where `isPublished = true` | `/collections/<slug>` |

Note that the collection predicate is **not** shop-scoped: collections are website-owned, so every
published collection counts regardless of Pancake shop.

**Not in the sitemap** — confirmed against both the repository and
`docs/operations/p12-search-exposure.md`: variant URLs, historical product slugs, pagination URLs
(`?page=N` is an indexable state but is never enumerated), inactive products, absent/stale products,
other-shop products, and draft collections.

### The cliff is a 500, not a degradation

`listCanonicalPaths` throws `RangeError` once `productPaths + collectionPaths > 49,996`, and
`src/app/sitemap.ts` has no partial or index fallback. Crossing the bound turns `/sitemap.xml` into
an HTTP 500 rather than a truncated or sharded sitemap. That is the failure W21 exists to prevent.

### The cliff is currently unreachable in production

`src/app/sitemap.ts` returns `[]` before touching the repository when
`readSearchExposure().indexingEnabled` is false. Per `docs/operations/p12-search-exposure.md`:

- `SEARCH_INDEXING_ENABLED=false` is the **active production configuration** for `la.lanadesign.vn`;
- that host is listed in `TEMPORARY_PRODUCTION_HOSTS`, so even setting the flag to `true` resolves
  to `indexingEnabled: false` at runtime and is rejected by `pnpm release:check`;
- an empty, non-advertised sitemap is the documented expected production behavior.

So production emits **0 sitemap URLs today**, and `listCanonicalPaths` — the only code that can
throw the budget `RangeError` — is not reached. The cliff becomes reachable only after permanent-
domain confirmation and the separate human approval that enables indexing.

That makes enablement the deadline for this work, not its starting gun: the baseline count and
trigger contract have to exist **before** the flag flips, because the first request afterwards goes
straight through the budget guard. See §5.

The corollary is worth stating plainly: while indexing stays disabled the sitemap emits nothing, so
today's safety comes from the gate rather than from any measured headroom.

---

## 2. Capacity evidence

### 2.1 What was measured in this session

A repeatable measurement now exists and was executed:

```bash
DATABASE_URL=... PANCAKE_SHOP_ID=... pnpm sitemap:capacity:audit
```

It was run successfully against a local scratch database at baseline SHA `762d2cb`, proving the
command works end to end and emits the sanitized aggregate block. **Its numbers are not evidence**:
that database holds no LA Clothing catalog, so it reported zeros. It is recorded here only as proof
that the command is executable, not as a capacity measurement.

### 2.2 Pre-closure production evidence available before the authoritative run

Before the authoritative production run in §2.4, no production or approved staging database was
reachable from the PR #210 review session, so no exact sitemap-predicate count had been taken. Two
attributable production artifacts were available as context at that time, and neither used the
sitemap's predicate:

| Artifact | Executed | Environment | Figure | Predicate |
|---|---|---|---|---|
| `docs/audits/pricing-evidence-w3.md` | base SHA `42a903d` (2026-09-01) | Production VPS, Pancake API, shop `1635185058` | **42** current products, 181 current variations, 356 raw variation entries | `currentCatalog.products.total` from `pnpm pancake:catalog:audit` — current catalog from the **Pancake source**, explicitly excluding historical/internal raw rows |
| `docs/audits/merchant-identity-m1.md` | audit run 2026-09-04, mirror `syncedAt` 2026-08-28 | Production VPS, PostgreSQL `la_clothing`, shop `1635185058` | **83** products, 356 variants | Recorded as a parenthetical on a "Mirror Freshness" line with **no query recorded** — the predicate behind it is not attributable |

Neither figure is `ProductMirror.count({ pancakeShopId, isPresent, isActive })`. The 42 is the
Pancake-source notion of a current product; the 83 has no recorded predicate and plausibly counts
every mirrored row for the shop, including ones the sitemap excludes. They are consistent with each
other (83 total mirrored ≥ 42 currently active; 356 raw variations ≥ 181 current), which is why
both are recorded rather than one being preferred.

At that pre-closure point, **published collections had no production evidence at all**. Collections
are website-owned and created through the admin; no prior audit artifact recorded how many were
published.

### 2.3 Why the pre-closure evidence was insufficient

**At that point, capacity evidence was INSUFFICIENT FOR A NUMERICAL UTILIZATION VERDICT.** Exact
`productPaths` and `collectionPaths` under the sitemap predicate remained unmeasured before the
production run in §2.4, and so therefore did `dynamicPaths`, `remainingDynamicHeadroom` and
`utilizationPercent`.

The tempting move was to take the largest product figure available (83), assume published collections
were few, and derive a utilization percentage from the sum. **That was not an upper bound, and this
audit does not use it.** The dynamic budget is `active/present/current-shop products + ALL published
website-owned collections`, and nothing caps the second term:

- `MAX_COLLECTION_LIST = 100` in `collection-definition-repository.ts` bounds a single list query
  and a membership input array — not how many `CollectionDefinition` rows may exist;
- `COLLECTION_DEFINITION_LIMITS.homepagePosition` bounds homepage placement only;
- `PRODUCT_CONTENT_LIMITS.collectionCount = 8` bounds one product's memberships;
- `createDefinition` applies no total-count guard.

With one addend unmeasured and unbounded, `83 + unknown` yielded no percentage, no headroom figure
and no growth multiple. Any such number would have been an assumption wearing an evidence label —
the same mistake as reading the unrecorded `83` as the sitemap's own count.

Those pre-closure artifacts established only that the mirrored **product** side of the catalog was
in the tens as of early September 2026. §2.4 supersedes that limitation with the attributable
production measurement used for the current capacity verdict.

### 2.4 Authoritative production capacity audit (2026-09-07)

Command:

```bash
DATABASE_URL=<configured-securely> PANCAKE_SHOP_ID=1635185058 npm run sitemap:capacity:audit
```

Executed: `node --env-file-if-exists=.env.local --experimental-strip-types scripts/sitemap-capacity-audit.ts`

Proven provenance and environment:

- **AUDIT_EXECUTION_SHA:** `6d2225c16b0b9578cbeea76e31d9b5fad5218f31` (PR #210 merge into `main`)
- **AUDIT_EXECUTION_TREE_SHA:** `654d5580174d407f0968b0fe7c1b57516edf35e4`
- **Execution Host:** `TUANSON / Windows 11` (Node `v24.19.0`)
- **Target environment:** Production VPS `srv1606232` (`156.67.214.197`), PostgreSQL container `la-clothing-postgres-1` (`172.22.0.3:5432`), database `la_clothing`, target classification: production/current mirror
- **Pancake Shop ID:** `1635185058`
- **Audit Timestamp (UTC):** `2026-09-07T00:25:15.938Z`
- **Worktree State:** **CLEAN** (`git status --porcelain=v1 --untracked-files=all` returned empty)
- **Mirror Freshness:** `pancakeShopId = 1635185058, syncedAt = 2026-09-04T22:31:46.530Z, updatedAt = 2026-09-04T22:31:51.338Z` (356 variants, 83 products)
- **Database Predicate Breakdown:**
  - `ProductMirror` total for shop `1635185058`: 83; eligible (`isPresent = true AND isActive = true`): **20**
  - `CollectionDefinition` total: 1; published (`isPublished = true`): **1**
- **Exit Code:** `0`

Authoritative sanitized aggregate output:

```json
{
  "pancakeShopId": 1635185058,
  "measuredAt": "2026-09-07T00:25:15.938Z",
  "productPaths": 20,
  "collectionPaths": 1,
  "dynamicPaths": 21,
  "staticPaths": 4,
  "totalPaths": 25,
  "dynamicBudget": 49996,
  "remainingDynamicHeadroom": 49975,
  "utilizationPercent": 0.042,
  "exceedsDynamicBudget": false
}
```

**Capacity evaluation:**
- Dynamic URLs measured: **21** (`20` active/present products + `1` published collection)
- Dynamic URL budget: **49,996** (`50,000` single-sitemap budget minus `4` static canonical paths)
- Remaining dynamic headroom: **49,975 URLs**
- Current dynamic utilization: **0.042%**
- Hard budget exceeded: **NO** (`exceedsDynamicBudget = false`)
- Approved Act trigger: **45,000 URLs** (≈90.007% of dynamic budget) — **PASS / NOT TRIGGERED**.
- Approved Warning trigger: **40,000 URLs** (≈80.006% of dynamic budget) — **PASS / NOT TRIGGERED**.
- Sharding action: **NO SHARDING NOW**

---

## 3. Growth evidence

**Insufficient to derive a growth rate.** The two production artifacts are three days apart, read
different sources (Pancake API vs. the database mirror) under different predicates, and were
produced for unrelated audits. They are two measurements, not two points on one series.

No catalog-count time series exists in the repository or operations docs. No growth rate is asserted
here, and none should be inferred from these two figures. Test-fixture counts are not production
trend data and are not used.

Establishing a trend is exactly what the cadence in §5 is for: repeated runs of
`pnpm sitemap:capacity:audit` produce comparable figures under one predicate, which the two existing
artifacts cannot.

---

## 4. Repeatable measurement authority

`pnpm sitemap:capacity:audit` (`scripts/sitemap-capacity-audit.ts`) is read-only and prints a
sanitized aggregate block between `SITEMAP_CAPACITY_AUDIT_BEGIN` / `SITEMAP_CAPACITY_AUDIT_END`:

```json
{
  "pancakeShopId": 0,
  "measuredAt": "<ISO timestamp>",
  "productPaths": 0,
  "collectionPaths": 0,
  "dynamicPaths": 0,
  "staticPaths": 4,
  "totalPaths": 4,
  "dynamicBudget": 49996,
  "remainingDynamicHeadroom": 49996,
  "utilizationPercent": 0,
  "exceedsDynamicBudget": false
}
```

*(Shape only. The values above are from the empty scratch database, not from production.)*

Three properties make it trustworthy as capacity authority:

1. **One predicate, not two.** `countCanonicalPaths` and `listCanonicalPaths` share the same
   `where` clauses, and `listCanonicalPaths` now enforces its budget guard using
   `countCanonicalPaths`. The threshold the audit measures against is the threshold that actually
   refuses to build the sitemap. `tests/database/search-sitemap-repository.test.ts` asserts the
   counts equal the composition of the real emitted list across the representative cases:
   active/present/correct-shop included; inactive, absent, wrong-shop excluded; published collection
   included; draft collection excluded.
2. **Aggregate only.** It issues two `COUNT` queries and materializes no catalog rows, so it stays
   bounded no matter how large the catalog gets. It logs no slug, URL, product id or sitemap body —
   capacity is an aggregate question and the output carries only aggregate values.
3. **No invented thresholds.** The report states counts, headroom, utilization and whether the
   budget is exceeded. It does **not** classify the catalog as healthy/warning/critical, because any
   such threshold is an operations decision (§5), not an arithmetic property.

---

## 5. Monitoring contract

### Settled by evidence

| Question | Answer |
|---|---|
| **What is measured?** | `productPaths`, `collectionPaths`, `dynamicPaths` under the sitemap's own predicates; `remainingDynamicHeadroom`; `utilizationPercent`; `exceedsDynamicBudget`. |
| **How?** | `pnpm sitemap:capacity:audit` against the production database. |
| **Where is evidence stored?** | The sanitized aggregate block appended to this document, one row per run, the way `pricing-evidence-w3.md` and `merchant-identity-m1.md` record their production runs. |
| **What happens when the trigger fires?** | Open **U37b — sitemap index/sharding** as its own planned unit with acceptance criteria, and implement before the bound is reached. Explicitly **not** permitted: shipping an emergency partial sitemap, silently accepting the HTTP 500, or raising `MAX_DYNAMIC_SITEMAP_PATHS` past what a single sitemap may hold. |
| **When must monitoring be live?** | The baseline measurement and trigger contract must be established **before Gate S enables indexing**; recurring monitoring runs from enablement onward. Enabling first would be the one ordering W21 exists to prevent: with the count unknown, the first request after enablement reaches the budget guard, and if the catalog is already over it `/sitemap.xml` answers 500 before any monitoring has run. |

### U37 is a pre-enable gate for Gate S

The ordering is the substance of W21, so it is written out rather than implied:

```text
production baseline + capacity check + owner/cadence/trigger
  → Gate S approval / indexing enablement
  → recurring monitoring
```

Not `enable → start measuring`. This matches how Gate S already treats applicable #152 operational
gates: completed **before** explicit human approval, not measured afterwards.

**Phase 1 — pre-enable gate.** Before indexing is approved or enabled:

1. An authorized operator runs, on an exact SHA, against the production database:

   ```bash
   DATABASE_URL=<production> PANCAKE_SHOP_ID=1635185058 pnpm sitemap:capacity:audit
   ```

2. Record the attributable block in §2 with, at minimum: exact git SHA, environment, timestamp,
   `productPaths`, `collectionPaths`, `dynamicPaths`, `dynamicBudget`, `remainingDynamicHeadroom`
   and `utilizationPercent`.
3. Approve the owner, cadence and warning/act trigger values (D1–D3 below).
4. **Revalidate at activation time.** A historical baseline does not by itself satisfy Gate S.
   Immediately before indexing enablement, rerun `pnpm sitemap:capacity:audit` against production
   on the **exact activation head**, after the last catalog sync or state change that activation
   will use, and record that result the same way.

   **The result is pinned to data state, not just to a code SHA.** The SHA proves which predicate
   ran; it proves nothing about whether the rows that predicate counts have since changed. The
   activation-time result is valid only while sitemap-eligible catalog state remains unchanged.
   Any of these after the run invalidates it and requires a fresh rerun before indexing may be
   enabled:

   - a product-mirror sync that changes `isPresent`, `isActive` or shop membership for the
     configured shop;
   - a collection publish, unpublish, create or delete that changes the published-collection count;
   - any future mutation that changes the predicates or counts in §1.

   Record enough provenance to identify which run authorised activation: exact SHA, `measuredAt`,
   environment and shop, the reported figures, and the mirror-freshness line
   `merchant-identity-m1.md` §2 already uses — `CatalogSyncState.syncedAt` / `updatedAt` for the
   configured shop — so a later sync is visible as having happened after the audit. That reuses the
   existing marker; no new revision or locking mechanism is introduced here.

   This is the round-3 stale-baseline problem at a shorter timescale: the window is minutes rather
   than months, but the correctness condition is still the data state, not the code head.
5. Evaluate the **activation-time** result in this order, against the **approved** trigger values
   from step 3 — not against the hard bound alone:

   | | Condition | Outcome |
   |---|---|---|
   | **A** | `exceedsDynamicBudget = true` | **Block Gate S.** U37b implementation required. |
   | **B** | The approved **Act (Y)** condition is true | **Block Gate S.** U37b implementation required before indexing. |
   | **C** | The approved **Warning (X)** is true, Act is false | Follow the **owner-approved D3 warning behaviour**: `BLOCK` → do not enable, open or advance U37b; `ALLOW_WITH_ACK` → open the U37b plan, record the owner's explicit acknowledgement beside the activation block, then Gate S may continue if every other gate passes. |
   | **D** | Neither Warning nor Act is true | Gate S may proceed if every other Gate S requirement is satisfied. |

   The hard bound is a **failure boundary, not a release threshold**. Branching on
   `exceedsDynamicBudget` alone would let Gate S enable indexing at `49,996 / 49,996` — zero
   headroom, where one new product or published collection turns `/sitemap.xml` into a 500 — and
   would let an approved Act trigger be true while enablement proceeded anyway, making D3
   documentation with no effect on the decision it exists to govern.

   Where Act (Y) has two limbs, apply each only when it can be evaluated: the approved **45,000-URL
   count threshold** applies as soon as it is approved; the projected-time-to-bound limb applies only
   once enough comparable measurements exist to establish a slope. Do not invent a slope to fill it in.

   No branch permits shipping a partial sitemap, nor raising the per-document bound to get past this
   gate. The bound is what one sitemap document may hold; it is not a dial.

   Rows B–D require approved D3 values. That prerequisite is now satisfied by the approved
   40,000/45,000-URL contract below; if a future change removes or supersedes that approval, Gate S
   fails closed until a replacement D3 contract is approved.

Step 4 exists because steps 1–3 can close long before Gate S actually fires, and recurring
monitoring does not start until enablement (Phase 2). That leaves a window in which the catalog can
grow unobserved:

```text
baseline taken + U37 closed
   → days/weeks/months, catalog may change, no recurring monitoring yet
   → Gate S enables indexing
   → first /sitemap.xml request hits the budget guard
```

An in-budget block from that earlier moment says nothing about capacity at activation. Without the
revalidation, a stale historical measurement could authorize an enablement that answers 500 on its
first request — the exact failure W21 exists to prevent.

**Phase 2 — post-enable operation.** From enablement onward, the approved cadence runs on the
contract fixed in step 3, and escalates to U37b when the agreed trigger fires.

### OWNER / OPERATIONS DECISIONS — APPROVED

All three open operations decisions are explicitly approved by repository and project owner `@nguyentuanson27-netizen`:

**D1 — Owner: APPROVED**
- **Owner:** `@nguyentuanson27-netizen` (Repository Owner & Lead Operator)
- **Approved by:** `@nguyentuanson27-netizen`
- **Approved at:** `2026-09-07T00:31:42Z`
- **Responsibilities:**
  - Execute repeatable sitemap capacity monitoring runs (`sitemap:capacity:audit`);
  - Record attributable sanitized evidence in this audit document;
  - Monitor dynamic URL count against approved Warning and Act thresholds;
  - Receive Warning alerts, acknowledge warnings in release documentation, and initiate U37b sharding plans;
  - Trigger immediate blocking of Gate S and mandate U37b implementation upon Act;
  - Ensure Gate S indexing is never enabled when capacity contracts or preconditions fail.

**D2 — Cadence: APPROVED**
- **Cadence:** `Per release` (integrated into release preflight before indexing enablement review)
- **Basis:** Provisional owner-approved operational policy.
  - Measured production dynamic utilization is 0.042% (21 / 49,996 dynamic URLs, leaving 49,975 URLs headroom);
  - Catalog growth is driven by batch release cycles and Pancake catalog syncs;
  - Verifying capacity per release as part of release preflight incurs zero operational overhead, prevents batch additions from slipping past unmonitored, and guarantees an up-to-date capacity check before any release or Gate S evaluation.
- **Approved by:** `@nguyentuanson27-netizen`
- **Approved at:** `2026-09-07T00:31:42Z`

**D3 — Warning + Act Contract: APPROVED**

The approved **integer URL counts are the policy authority**. Percentages are descriptive equivalents
only; because the dynamic budget is 49,996, the approved round counts are not mathematically exact
80% / 90% boundaries.

- **Warning threshold ($W$):** `40,000 dynamic URLs` (≈80.006% of the 49,996 dynamic budget; ~9,996 URLs headroom remains).
- **Act threshold ($A$):** `45,000 dynamic URLs` (≈90.007% of the 49,996 dynamic budget; ~4,996 URLs headroom remains) OR projected time to reach the hard bound is under one full sharding implementation-and-review cycle.
- **Warning behaviour:** `ALLOW_WITH_ACK`.
  - If Warning is true but Act is false ($40,000 \le \text{dynamicPaths} < 45,000$): open the U37b planning ticket, record explicit owner acknowledgement in the release audit block; Gate S may continue only if all other launch gates pass.
- **Act behaviour:** `BLOCK`.
  - If Act is true ($\text{dynamicPaths} \ge 45,000$ or lead time < 1 sharding cycle): Gate S is strictly blocked. U37b (sitemap index / sharding) must be fully implemented and reviewed before indexing may be enabled.
- **Operator Action:**
  - *On Warning:* Operator logs warning, alerts `@nguyentuanson27-netizen`, and opens U37b sharding plan. If proceeding with release under `ALLOW_WITH_ACK`, owner records signed acknowledgement in the audit block.
  - *On Act:* Operator halts Gate S evaluation, flags blocking failure, and requires U37b implementation before any search indexing activation.
- **Basis:** Provisional owner-approved operational policy.
- **Approved by:** `@nguyentuanson27-netizen`
- **Approved at:** `2026-09-07T00:31:42Z`

---

## 6. Decision

Two separate answers, both now supported by attributable production evidence and approved policy:

### Runtime action: NO SHARDING NOW

Current production measurement (2026-09-07) proves the dynamic catalog requires only **21 URLs**
against a single-sitemap capacity of 49,996 dynamic URLs (0.042% utilization, 49,975 URLs headroom),
well below the approved Warning (40,000 URLs) and Act (45,000 URLs) thresholds. Sharding today would
introduce redundant infrastructure and complexity for a catalog utilizing under 0.1% of its single-sitemap
boundary. Furthermore, search indexing remains fail-closed on the temporary production host, so
`/sitemap.xml` emits no URLs and `listCanonicalPaths` is never reached (§1). Existing single-sitemap
architecture in `src/app/sitemap.ts` remains intact with no behavior change.

### Capacity verdict: SUFFICIENT EVIDENCE — BELOW APPROVED ACT TRIGGER

Attributable production database audit (§2.4) establishes 20 active/present products and 1 published
collection. Total dynamic paths: 21. Utilization: 0.042%. Neither Warning nor Act trigger is met.

---

## 7. What changed in the repository

| File | Change |
|---|---|
| `src/seo/search-sitemap-repository.ts` | `STATIC_CANONICAL_PATHS` moved here from the route so one module owns the whole budget contract; eligibility predicates extracted to single definitions; `countCanonicalPaths` added; `listCanonicalPaths` now guards using it |
| `src/seo/sitemap-capacity.ts` | New. Pure budget arithmetic — counts in, headroom/utilization out |
| `src/app/sitemap.ts` | Imports the moved constant. No behavior change |
| `scripts/sitemap-capacity-audit.ts` | New read-only audit command |
| `package.json` | `sitemap:capacity:audit` script |
| `tests/domain/sitemap-capacity.test.ts` | New. Budget arithmetic incl. 49,996 accepted / 49,997 over budget |
| `tests/database/search-sitemap-repository.test.ts` | Count/list parity across the representative eligibility cases |

---

## 8. U37 closure record

U37 is **CLOSED** (`[x]`). All three Gate S preconditions are satisfied:

| # | Gate S precondition | Status | Resolution |
|---|---|---|---|
| 1 | **Attributable production capacity block.** | **CLOSED** | Executed against production database on 2026-09-07 (`6d2225c16b0b9578cbeea76e31d9b5fad5218f31`), measuring 20 products + 1 collection = 21 dynamic URLs (0.042% utilization, 49,975 headroom). `exceedsDynamicBudget = false`. |
| 2 | **Named owner.** | **CLOSED** | D1 approved: `@nguyentuanson27-netizen` (Repository Owner & Lead Operator). |
| 3 | **Approved cadence and warning/act trigger values.** | **CLOSED** | D2 approved: `Per release`. D3 approved with integer counts as authority: Warning at 40,000 URLs (≈80.006%) with `ALLOW_WITH_ACK`; Act at 45,000 URLs (≈90.007%) with `BLOCK`. |

### Gate S activation-time revalidation reminder

Closing U37 **does not enable indexing** (`SEARCH_INDEXING_ENABLED` remains `false`).
Gate S remains a separate human release gate.

Immediately before indexing enablement:
- Rerun `pnpm sitemap:capacity:audit` against production on the **exact activation head**;
- Re-verify dynamic paths are within hard budget (<= 49,996) and below the approved Act trigger (< 45,000);
- Any subsequent product-mirror sync or collection publication change invalidates the audit and mandates a rerun before flag enablement.
