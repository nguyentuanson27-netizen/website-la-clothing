# W21 — Sitemap capacity, headroom and scale trigger

Owning source: `docs/audits/seo-geo-audit.md` finding **W21**, planning step **P6/W21**.
Master-plan unit: **U37**.

This is a capacity/readiness audit, not an implementation. It establishes the single-sitemap URL
budget and its exact eligibility predicates, builds a repeatable way to measure usage against them,
records what the available evidence does and does not support, and sets out the trigger that would
justify sharding. It deliberately changes no sitemap behavior.

- **Baseline SHA:** `762d2cb6ef802e54ba4a49c19a71b1782df2f485`
- **Runtime action:** **NO SHARDING NOW** — search indexing is fail-closed on the temporary
  production host, so production emits an empty sitemap and the dynamic-capacity path is
  unreachable ([§1](#the-cliff-is-currently-unreachable-in-production)).
- **Capacity verdict:** **INSUFFICIENT EVIDENCE** — no attributable production count exists under
  the sitemap predicate, published collections least of all ([§2](#2-capacity-evidence)).
- **U37 status:** **OPEN** — see [§8](#8-what-still-blocks-u37).

Those are deliberately two answers. Not sharding is defensible today on an operational ground that
does not depend on any count. It is **not** a measured-headroom result, and this audit does not
claim one.

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

### 2.2 What production evidence exists

No production or approved staging database was reachable from this session, so **no exact
sitemap-predicate count was taken**. Two attributable production artifacts bound the catalog's
scale, and neither uses the sitemap's predicate:

| Artifact | Executed | Environment | Figure | Predicate |
|---|---|---|---|---|
| `docs/audits/pricing-evidence-w3.md` | base SHA `42a903d` (2026-09-01) | Production VPS, Pancake API, shop `1635185058` | **42** current products, 181 current variations, 356 raw variation entries | `currentCatalog.products.total` from `pnpm pancake:catalog:audit` — current catalog from the **Pancake source**, explicitly excluding historical/internal raw rows |
| `docs/audits/merchant-identity-m1.md` | audit run 2026-09-04, mirror `syncedAt` 2026-08-28 | Production VPS, PostgreSQL `la_clothing`, shop `1635185058` | **83** products, 356 variants | Recorded as a parenthetical on a "Mirror Freshness" line with **no query recorded** — the predicate behind it is not attributable |

Neither figure is `ProductMirror.count({ pancakeShopId, isPresent, isActive })`. The 42 is the
Pancake-source notion of a current product; the 83 has no recorded predicate and plausibly counts
every mirrored row for the shop, including ones the sitemap excludes. They are consistent with each
other (83 total mirrored ≥ 42 currently active; 356 raw variations ≥ 181 current), which is why
both are recorded rather than one being preferred.

**Published collections: no production evidence exists at all.** Collections are website-owned and
created through the admin; no audit artifact records how many are published.

### 2.3 What can and cannot be claimed

**Capacity evidence: INSUFFICIENT FOR A NUMERICAL UTILIZATION VERDICT.** Exact `productPaths` and
`collectionPaths` under the sitemap predicate remain unmeasured, and so therefore do `dynamicPaths`,
`remainingDynamicHeadroom` and `utilizationPercent`.

The tempting move is to take the largest product figure available (83), assume published collections
are few, and derive a utilization percentage from the sum. **That is not an upper bound, and this
audit does not make it.** The dynamic budget is
`active/present/current-shop products + ALL published website-owned collections`, and nothing caps
the second term:

- `MAX_COLLECTION_LIST = 100` in `collection-definition-repository.ts` bounds a single list query
  and a membership input array — not how many `CollectionDefinition` rows may exist;
- `COLLECTION_DEFINITION_LIMITS.homepagePosition` bounds homepage placement only;
- `PRODUCT_CONTENT_LIMITS.collectionCount = 8` bounds one product's memberships;
- `createDefinition` applies no total-count guard.

With one addend unmeasured and unbounded, `83 + unknown` yields no percentage, no headroom figure and
no growth multiple. Any such number would be an assumption wearing an evidence label — the same
mistake as reading the unrecorded `83` as the sitemap's own count.

What the artifacts do establish is narrower and still useful: the mirrored **product** side of the
catalog was in the tens as of early September 2026. That is context for the eventual measurement,
not a capacity verdict.

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

The ordering is the substance of W21, so it is written out rather than implied. Before indexing is
approved or enabled:

1. An authorized operator runs `pnpm sitemap:capacity:audit` against the production database on an
   exact SHA and records the attributable block in §2.
2. Confirm `exceedsDynamicBudget` is `false`. **If the catalog is already over the bound, do not
   enable indexing** — open U37b and shard first. Enabling would publish a 500 at `/sitemap.xml`.
3. Agree owner, cadence and the warning/act trigger values (D1–D3 below).
4. Only once §8's three blockers are closed may Gate S / indexing enablement proceed.
5. From enablement onward, the agreed cadence runs on the contract fixed in step 3.

This matches how Gate S already treats applicable #152 operational gates — completed **before**
explicit human approval, not measured afterwards.

### OWNER / OPERATIONS DECISION REQUIRED

The repository has no `CODEOWNERS` file and no named operational owner convention beyond the
"human owner" who approves ADR-level decisions, so this audit does not assign an owner or invent a
threshold. Three decisions are open:

**D1 — Owner.** Who runs the audit and receives its result? The repo's existing production audits
(`merchant:identity:audit`, `pancake:catalog:audit`) were run by an authorized operator against the
production VPS; the same role is the natural fit, but it must be named.

**D2 — Cadence.** No utilization figure and no growth rate exist yet (§2.3, §3), so cadence cannot
be derived from how close the catalog is to the bound — that distance is precisely what is unknown.
The first run's numbers are what make a considered cadence possible; until then the argument is
about how fast to *establish* a baseline and a trend.

| Option | Argument for | Argument against |
|---|---|---|
| Per release | Free to attach to an existing gate; establishes a baseline and trend fastest | Likely far more often than a slow-moving catalog needs |
| Monthly | Gives a usable trend within a quarter at low operational cost | Requires a standing operational reminder |
| Quarterly | Cheapest to sustain | Four points a year is a weak basis for projection, and the first is still unmeasured |

**D3 — Trigger thresholds.** A defensible trigger has to be justified by headroom, observed growth,
cadence, engineering lead time and a safety buffer — and two of those (growth, owner response time)
are not yet known. Rather than pick a round number, the shape is proposed and the values are left to
the owner:

- **Warning (X):** projected dynamic paths at the next scheduled measurement exceed *W* % of the
  dynamic budget → start the U37b plan.
- **Act (Y):** dynamic paths exceed *A* % of the budget, **or** the projected time to reach the
  bound is under one full sharding implementation-and-review cycle → U37b implementation required.

Once a cadence and at least two comparable measurements exist, *W* and *A* can be derived from the
observed slope plus lead time instead of chosen. Until then any specific number here would be a
guess wearing a contract's clothing.

---

## 6. Decision

Two separate answers, because the evidence supports one of them and not the other.

### Runtime action: NO SHARDING NOW

Rests on one fact that needs no count: search indexing is fail-closed on the temporary production
host, so `/sitemap.xml` returns no URLs and `listCanonicalPaths` — the only code that can throw the
budget error — is never reached (§1). Building sitemap index/sharding today would add a second
sitemap topology, change a live public contract and widen what `p12-search-exposure` governs, to
protect a path that does not currently execute. `src/app/sitemap.ts` keeps its existing HTTP
contract unchanged.

This is an operational choice under the current indexing-disabled state. It is **not** a proven
numerical headroom result, and it stops being self-supporting the moment indexing is enabled — which
is exactly when the monitoring in §5 must already be running.

### Capacity verdict: INSUFFICIENT EVIDENCE

No attributable production count exists under the sitemap's own predicate, and published collections
have no evidence at all and no cap (§2.3). Utilization, headroom and time-to-cliff are therefore
unknown, and no figure for them appears in this audit.

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

## 8. What still blocks U37

U37 stays **open**. Three items remain, and none of them is sharding:

1. **No attributable production count.** The exact `productPaths` / `collectionPaths` under the
   sitemap predicate have never been measured. The blocker is access, not tooling: an authorized
   operator must run, against the production database,

   ```bash
   DATABASE_URL=<production> PANCAKE_SHOP_ID=1635185058 pnpm sitemap:capacity:audit
   ```

   and append the sanitized block to §2 with its SHA, environment and timestamp — the provenance
   format `merchant-identity-m1.md` §2 already uses.
2. **No owner (D1).**
3. **No agreed cadence or trigger values (D2, D3).**

The **runtime no-sharding action** is not blocked while indexing remains fail-closed, because the
capacity path is not executed. The **capacity decision remains blocked** until an attributable
production count exists and owner/cadence/trigger values are approved. U37 therefore stays open.

All three are preconditions for enabling indexing, not follow-ups to it — see §5.
