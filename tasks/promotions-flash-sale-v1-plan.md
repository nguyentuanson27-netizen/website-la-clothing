# Promotions & Flash Sale v1 — implementation plan

Status: **PLANNING ONLY — implementation has not started.**

Source of truth: `docs/specs/promotions-flash-sale-v1.md`.

Planning review base: `main@31f88b3cc1517a8c2123f41924e3d5e65361d6df`. This plan is part of PR #151 and must be refreshed against then-current `main` before every implementation slice starts.

This plan follows the project lifecycle and `planning-and-task-breakdown` contract: dependency-first, tests travel with behavior, verification checkpoints are explicit, and no production implementation belongs in PR #151.

## Final self-review gate before build

Review order: correctness → security → architecture → simplicity → performance.

Latest independent review `5061370559` found **0 Critical / 3 Required** on head `8585038d`. All three are resolved below as normative plan locks: exact percentage arithmetic across the full safe-integer domain, query-wide/resume-safe storefront freshness, and explicit finite admin/input bounds.

### R1 — Buyer-visible quote must be compared before initial DRAFT creation

The approved contract says a customer must explicitly confirm a changed price. Comparing only an already-created `OrderMirror(DRAFT)` against fresh Pancake facts is insufficient: the price can change between the checkout page render and the first submit, causing the server to create a DRAFT at a price the buyer never saw.

Plan lock:
- checkout render produces a server-derived `expectedQuote` containing only stale-detection facts: variant IDs, quantities, effective unit prices, merchandise subtotal, shipping, and total;
- browser returns those expected facts on submit, but they are **never price authority**;
- server reconstructs current authoritative quote before creating a new DRAFT;
- if browser-expected quote differs, return typed `PRICE_CHANGED` with refreshed quote and create no submit-capable order attempt;
- customer must review the refreshed totals and explicitly submit again;
- after a DRAFT exists, fresh Pancake validation is a second stale-detection boundary and may refresh that DRAFT again before requiring another explicit submit.

Browser tampering cannot reduce price because server recomputation is authoritative; malformed/oversized expected-quote input fails closed.

### R2 — Campaign mutation concurrency must lock the campaign row too

Product/variant locks serialize cross-campaign coverage races but do not by themselves prevent two admins from concurrently editing/publishing/disabling the **same campaign**.

Plan lock:
- existing campaign mutations lock the campaign row first with `FOR UPDATE` (or an equivalent compare-and-swap/version guard if later proven simpler);
- then lock owning ProductMirror rows in deterministic ID order;
- then lock required VariantMirror rows in deterministic ID order;
- create-new-Draft has no existing campaign row, but publish/update/disable/copy-from-existing use the same ordering discipline;
- same-campaign lost updates and cross-campaign overlap races both have explicit concurrency tests.

PostgreSQL recommends acquiring multiple locks in a consistent order to reduce deadlocks. Do not keep transactions open while waiting for user input.

### R3 — Production activation requires a technical kill switch, not only a checklist

The feature is implemented over several dependency-safe PRs. Admin UI can exist before Pancake submission, SEO, analytics, and rollout proof are converged. A procedural note alone is not enough to prevent a partially implemented production campaign from being enabled.

Plan lock:
- introduce a server-only activation gate, conceptually `WEBSITE_PROMOTIONS_ACTIVATION_ENABLED`, defaulting to **false** unless explicitly configured;
- Draft creation/editing, admin reads, and campaign health inspection remain usable while the gate is off;
- publish/re-enable of pricing-effective campaigns fails closed with typed `ACTIVATION_DISABLED` while the gate is off;
- no storefront pricing path treats Draft as effective;
- gate may be turned on only after the price-readiness audit, Pancake semantic acceptance, SEO/analytics convergence, and final DoD are accepted;
- rollback can turn the gate off immediately and then disable active campaigns through the reviewed admin path.

No third-party feature-flag dependency is introduced for v1.

### R4 — One request clock snapshot must drive discovery count, sort, hydration, and cards

`/shop` currently performs multiple reads: count, ordered IDs, then hydrated products. Around `startsAt`/`endsAt`, separate clocks can produce a count/filter state from one campaign instant and cards from another.

Plan lock:
- capture one `requestNow` at the storefront request boundary;
- pass that exact instant to discovery count, ordered-ID query, effective-price SQL projection, hydrated quote projection, representative card selection, and route transition calculation;
- SQL must not independently call `CURRENT_TIMESTAMP`/`now()` for campaign eligibility when a server-supplied `requestNow` is available;
- PDP and `/flash-sale` likewise resolve one request clock snapshot per server render;
- transaction flows may obtain a newer explicit `now` when they intentionally revalidate.

### R5 — Final convergence is split and analytics ownership must be rediscovered

SEO, analytics, observability/rollout, and browser final QA are independent subsystems. They must not be bundled into one giant implementation PR. This is especially important because GTM/TikTok integration work may land in parallel and change analytics ownership.

Plan lock:
- G1 owns SEO + commerce analytics monetary convergence only;
- G2 owns observability + activation gate + readiness/rollback operations;
- G3 owns browser/a11y + full final DoD convergence;
- before G1 starts, re-read then-current `main` and identify the actual analytics event ownership after any GTM/TikTok changes; do **not** assume today's Meta-specific files remain the final owner;
- promotion code exposes/consumes one authoritative customer-price quote; tracking integrations consume it and must not reimplement promotion pricing.

### Review follow-up — SQL parity, shared membership projection, lifecycle mechanics

A prior implementation-plan review surfaced additional technical gaps. They remain locked as follows:

- SQL percentage arithmetic must never round directly on mirrored `double precision`. After the base passes the positive safe-integer VND boundary, cast that integer-like base to PostgreSQL `numeric` **before** multiplication/division and round there, conceptually `ROUND((base::numeric * (100 - pct)) / 100)`.
- SQL↔TS parity fixtures must contain exact-half cases with fixed expected results: `base=150,pct=1 → 149`, `base=350,pct=1 → 347`, `base=110,pct=5 → 105`.
- One sanctioned bounded storefront SQL projection serves both `/shop` effective-price filter/sort and `/flash-sale` active-valid membership before pagination. Do not introduce a second Flash Sale-specific promotion predicate.
- When a never-Active Disabled campaign is re-enabled, the same transaction writes the new `enabledAt`, sets `publishState=ENABLED`, and clears `disabledAt=null`. A campaign whose prior enabled interval contained any Active time is terminal and cannot take this path.

### Review `5061370559` — three Required locks

#### R6 — Percentage calculation is exact integer arithmetic, not floating `Math.round`

The accepted base domain is the full positive `Number.isSafeInteger` range. A literal JavaScript `Math.round(base * multiplier / 100)` can lose one VND near the upper safe-integer boundary before rounding. Therefore the TypeScript resolver's normative percentage path is:

```ts
const numerator = BigInt(basePriceVnd) * BigInt(100 - discountPercent);
const effectiveBigInt = (numerator + 50n) / 100n;
const effectivePriceVnd = Number(effectiveBigInt);
```

The conversion back to `number` occurs only after safe-integer validation. The SQL projection implements the same exact rational value with `numeric` before multiplication/division. Mandatory domain + SQL↔TS parity includes:
- `150 @ 1% → 149`;
- `350 @ 1% → 347`;
- `110 @ 5% → 105`;
- `9007199254740989 @ 1% → 8917127262193579`.

`Math.round(...)` is not the reference implementation across the accepted domain.

#### R7 — Storefront freshness is query-wide and uses server-derived relative delay

`nextTransitionAt` derived only from hydrated page rows is insufficient because a transition on an off-page product can change `/shop` filter/sort/page membership, and `/flash-sale` may be empty immediately before its first Scheduled sale starts.

Plan lock:
- `/shop` computes a query-wide earliest future relevant transition over the full pre-pagination candidate universe for that request, including off-page products/variants whose campaign boundary can change effective-price membership/order;
- `/flash-sale` includes upcoming enabled Flash Sale boundaries even when active membership is currently empty;
- transition discovery is an aggregate/bounded database operation, not application-side all-row loading;
- server computes `refreshAfterMs` from `requestNow` and the query-wide transition, capped at `60_000`; if no future transition is known, use `60_000` as fallback;
- client schedules from the relative `refreshAfterMs`, never from `Date.now()` against an absolute server timestamp;
- on `visibilitychange` to visible and `pageshow`, if the server-provided delay elapsed while suspended, immediately call `router.refresh()`;
- each refresh receives a new server-computed delay.

Mandatory browser/runtime cases: off-page campaign enters the current sorted/filter page, empty Flash Sale becomes populated at first sale start, browser wall-clock skew, and tab/page resume after a boundary.

#### R8 — Explicit finite bounds are named and testable

Use these v1 constants as server-side contract:
- `MAX_CAMPAIGN_NAME_LENGTH = 120` trimmed JavaScript string code units;
- `MAX_TARGETS_PER_CAMPAIGN = 200` normalized explicit targets;
- `MAX_PROMOTION_IDENTIFIER_LENGTH = 128` browser-supplied identifier code units before lookup;
- `MAX_ADMIN_PROMOTION_PAGE_SIZE = 50`;
- `ADMIN_TARGET_SEARCH_LIMIT = 50`;
- public `/shop` and `/flash-sale` page size reuse existing storefront max `48`;
- `MAX_EXPANDED_VARIANTS_PER_CAMPAIGN = 2000` unique current variants for activation/re-enable/Scheduled-edit validation.

Oversized syntactic input is rejected even for Draft. Draft PRODUCT expansion may be detected with a bounded `2001` read and shown as health invalid; publish/re-enable/Scheduled edit fails typed `TARGET_EXPANSION_LIMIT_EXCEEDED`. The expansion cap protects admin transaction/lock work only: post-activation dynamic PRODUCT coverage may grow beyond 2000 without becoming invalid solely because of this cap; runtime reads/health stay bounded and paginated. Every limit gets `max`/`max+1` tests.

### Previously locked clarifications retained

#### S1 — Storefront discovery uses effective price

Current `/shop` has `minPriceVnd`, `maxPriceVnd`, `price-asc`, and `price-desc` before pagination. Filter/sort must use current authoritative effective price for the same eligible candidate-variant set that card presentation uses.

Because filtering/sorting happens before pagination, the plan explicitly allows one sanctioned SQL pricing projection with mandatory parity tests against the TypeScript pricing authority. That same projection is also sanctioned for bounded `/flash-sale` membership before pagination.

#### S2 — Composite pricing follows the real variant owner

Parent PDP can project a component `VariantMirror` owned by another `ProductMirror`. Promotion resolution follows the actual selected `VariantMirror.id` + its owning `productId`; rendering a child component inside a parent PDP does not transfer PRODUCT-campaign ownership.

## High-level dependency graph

```text
P0 planning closeout
  ↓
P1 persistence + migration
  ↓
P2 pricing domain + readiness audit
  ↓
P3 campaign repository + lifecycle/runtime health
  ↓
P4 concurrency-safe admin mutation + activation gate
  ↓
Checkpoint A
  ├──────────────→ P5 admin UX + product linkage
  └──────────────→ P6 PDP/variant/composite quotes
                       ↓
                    P7a discovery/cards SQL parity
                       ↓
                    P7b /flash-sale + boundary refresh
                       ↓
                    Checkpoint B
                       ↓
                    P8 cart + checkout rendered quote + mutable DRAFT
                       ↓
                    P9 two-stage PRICE_CHANGED reconfirmation
                       ↓
                    P10 Pancake submission convergence + semantic acceptance
                       ↓
        ┌──────────────┼──────────────┐
        ↓              ↓              ↓
      G1 SEO +      G2 ops +       G3 browser +
      analytics     observability   final DoD
        └──────────────┴──────────────┘
                       ↓
                   launch gate
```

Implementation branches start from the then-current reviewed `main` **for every slice**, not only once at feature kickoff. Before each slice, re-read directly affected files because other planned work may have landed in parallel.

## Architecture decisions

### A. Persistence shape

Prefer the minimum explicit website-owned model:

- `PromotionCampaign`
  - `id`
  - `name`
  - `kind: PROMOTION | FLASH_SALE`
  - `discountType: PERCENTAGE | FIXED_PRICE`
  - `discountPercent Int?`
  - `fixedPriceVnd BigInt?`
  - `publishState: DRAFT | ENABLED | DISABLED`
  - `enabledAt DateTime?`
  - `disabledAt DateTime?`
  - `startsAt DateTime?`
  - `endsAt DateTime?`
  - timestamps
- `PromotionTarget`
  - `id`
  - `campaignId`
  - `targetType: PRODUCT | VARIANT`
  - `productId String?`
  - `variantId String?`
- `OrderLineSnapshot`
  - additive base-price and promotion audit fields from the approved spec.

Do **not** materialize PRODUCT-target membership into a frozen variant list. PRODUCT is semantic/dynamic.

Migration SQL/server validation must enforce:
- target row matches target type and populates exactly one FK;
- duplicate identical target identity is impossible;
- percentage/fixed field shape is valid where DB-level checks are practical;
- PRODUCT + separately targeted owned VARIANT duplicate coverage inside the same campaign is rejected transactionally;
- existing historical order rows remain valid through additive nullable audit columns.

No campaign delete action in v1.

### B. Lifecycle derivation without traffic-dependent writes

Persist publication intent/history and derive user-visible time status.

```text
effectiveStart = max(enabledAt, startsAt ?? enabledAt)
```

Derived status:
- `DRAFT` → Draft;
- `DISABLED` → Disabled;
- ENABLED and `now < effectiveStart` → Scheduled;
- ENABLED and `effectiveStart <= now < endsAt` (or no end) → Active;
- ENABLED and finite `endsAt <= now`, after a non-empty enabled active interval → Ended.

A fully expired interval cannot be newly enabled. A Disabled campaign is re-enableable only when it never had a non-empty active interval. This must remain correct with zero traffic and after restart.

For the approved v1 mutable timestamp model, re-enabling a never-Active Disabled campaign is atomic: write a fresh `enabledAt`, set `publishState=ENABLED`, and clear `disabledAt=null` in the same transaction. A campaign whose previous enabled interval contained any Active time is terminal and cannot be re-enabled, so its terminal history is not erased by this rule.

### C. Central TypeScript pricing authority

Create one pure pricing resolver with explicit `now`:

```ts
type EffectivePriceQuote = {
  basePriceVnd: number;
  effectivePriceVnd: number;
  isDiscounted: boolean;
  promotion: PromotionSnapshot | null;
  reason: null | "BASE_PRICE_UNAVAILABLE" | "PROMOTION_INVALID" | "PROMOTION_CONFLICT";
  nextTransitionAt: Date | null;
};
```

Rules:
- external Float base must cross the website boundary as positive safe-integer VND;
- percentage integer `1..99` uses the exact BigInt rational algorithm in R6; no floating multiplication/division is normative;
- after conversion from BigInt, effective price must still be a positive safe integer and strictly below base;
- FIXED_PRICE is final price with `0 < fixed < base`;
- invalid promotion falls back only the affected variant when base is usable;
- >1 applicable campaign candidate means conflict → no website promotion;
- unusable base means variant is not purchasable;
- no UI/cart/checkout/tracking module reimplements promotion arithmetic.

### D. Active campaign batch lookup

Batch by requested real variant IDs. For each variant resolve:
- direct VARIANT targets;
- PRODUCT targets for the variant's real owning product;
- enabled campaign facts relevant at explicit `now`;
- nearest future per-variant transition required for PDP/card facts.

Return candidate facts; central resolver decides valid/invalid/conflict. Never pick an arbitrary first campaign. Route-wide transition discovery for paginated storefront membership is owned by the sanctioned SQL projection/refresh design, not by only the hydrated variant batch.

### E. Concurrency-safe admin mutation

For existing campaign publish/re-enable/Scheduled edit/disable/copy-source reads:
1. parse/canonicalize and enforce explicit input bounds before opening the transaction where possible;
2. lock the campaign row first (`FOR UPDATE`) when mutating an existing campaign;
3. resolve involved owning product IDs;
4. perform a bounded affected-variant expansion probe capped at `MAX_EXPANDED_VARIANTS_PER_CAMPAIGN + 1`; fail typed `TARGET_EXPANSION_LIMIT_EXCEEDED` before acquiring a huge variant lock set when over limit;
5. lock ProductMirror rows in deterministic ID order;
6. lock required VariantMirror rows in deterministic ID order when current expansion is within the cap;
7. re-read campaign lifecycle, target ownership, base prices, and overlapping enabled campaigns while locks are held;
8. validate lifecycle, activation gate, target shape, price validity, schedule, overlap, and bounds;
9. for a legal never-Active re-enable, atomically write new `enabledAt`, clear `disabledAt`, and set `publishState=ENABLED`;
10. atomically commit or write nothing.

Two concurrent edits to the same campaign must not silently overwrite one another. Two concurrent overlapping campaigns must not both become effective. Disjoint variants of the same product may serialize for simplicity but can both succeed when semantically valid.

Catalog sync is not required to take these admin locks. Runtime catalog-created invalidity/conflict fails closed through the resolver. Post-activation expansion beyond 2000 does not itself invalidate an Active campaign; runtime access stays bounded rather than taking one giant lock set.

### F. Server-only activation gate

Add one small server configuration boundary, no new dependency.

Conceptual behavior:

```text
activation disabled:
  Draft save/edit/read/copy-health = allowed
  publish/re-enable = ACTIVATION_DISABLED

activation enabled:
  normal lifecycle validation applies
```

Scheduled/Active campaigns that already exist during an emergency rollback are not made safe merely by hiding UI; operational rollback must disable them explicitly after preventing new activations.

The gate is a rollout control, not campaign status and not client-visible authority.

### G. Sanctioned SQL storefront projection for discovery and Flash Sale membership

One shared storefront SQL projection may replace/extend the current price CTE to compute **current effective price and active-valid promotion membership before pagination** where bounded query semantics require it.

Sanctioned consumers:
- `/shop` count/filter/sort and ordered IDs that depend on effective price;
- `/flash-sale` active-valid Flash Sale product/variant membership before page slicing;
- route-wide aggregate discovery of the earliest future relevant campaign transition for `/shop` and `/flash-sale`.

Requirements:
- receives explicit `requestNow` as a bound parameter;
- does not independently use database wall clock for campaign eligibility;
- uses the same usable-base predicate as TS;
- treats the mirrored `Float?` base only as external input: once validated as positive safe-integer VND, percentage arithmetic casts that integer-like base to PostgreSQL `numeric` **before** multiplication/division and produces the same exact rational rounding as R6; do not call `ROUND()` on a `double precision` percentage expression;
- matches direct variant and owning-product campaign targets;
- applies `[start,end)` semantics;
- matches percentage/fixed validity;
- counts multiple applicable candidates and fails closed to base/no website promotion;
- drives `/shop` `minPrice`, `maxPrice`, `price-asc`, `price-desc`;
- drives `/flash-sale` membership using the same active-valid campaign projection rather than a separate Flash Sale-specific predicate;
- preserves color/size/availability candidate semantics;
- transition aggregate considers pre-pagination relevant candidates, not only returned IDs/currently active members;
- `/flash-sale` transition aggregate includes upcoming enabled Flash Sale campaigns when current membership is empty;
- parity tests compare SQL and TS over no-promo, percentage, fixed, invalid, conflict, and time-boundary cases;
- parity tests include exact-half fixtures `150 @ 1% → 149`, `350 @ 1% → 347`, `110 @ 5% → 105`;
- parity tests include upper-safe-integer fixture `9007199254740989 @ 1% → 8917127262193579`.

The SQL projection is a performance projection, not a second pricing authority. There is one sanctioned projection contract; do not fork separate promotion formulas for `/shop` and `/flash-sale`.

### H. Request clock and boundary refresh

At each storefront server render:
- capture one `requestNow`;
- use it across all queries/projections for that render;
- for paginated `/shop` and `/flash-sale`, compute `queryWideNextTransitionAt` over the full relevant pre-pagination candidate universe, not only hydrated rows/current active membership;
- compute `refreshAfterMs` server-side as `min(max(queryWideNextTransitionAt - requestNow, 0), 60_000)` when a future transition exists, otherwise `60_000`;
- PDP may derive its transition from current product/selected-variant facts because route membership is not paginated, but still receives a server-computed relative delay capped at 60 seconds.

Current `/shop` and PDP use `connection()`, so keep dynamic request rendering. For an already-open page, a small Client Component receives server-computed **relative** `refreshAfterMs` and calls App Router `router.refresh()` when the delay expires. It must not schedule by comparing an absolute server timestamp to browser `Date.now()`.

Resume behavior:
- track elapsed time with a monotonic client source such as `performance.now()`;
- if the page becomes hidden/suspended and later fires `visibilitychange` to visible or `pageshow`, immediately refresh when the server-provided delay has elapsed;
- after refresh, replace the prior delay with the new Server Component payload;
- this yields a visible-page maximum promotional staleness of 60 seconds even when no future transition is currently known, and avoids browser wall-clock skew as a correctness input.

Verified against current Next.js App Router docs on 2026-08-30:
- `connection()` defers rendering until an incoming request;
- `router.refresh()` makes a new request and re-renders Server Components without making the client authoritative for pricing.

Countdown remains presentation-only.

### I. Two-stage checkout stale-price handshake

There are two separate stale windows and both must require explicit acknowledgement.

#### Stage 1 — rendered checkout → initial DRAFT

Checkout render/reconstruction provides an `expectedQuote` stale-detection payload derived from server-authoritative current cart pricing.

On first submit:
1. validate/bound the browser-returned expected quote structure;
2. server recomputes current mirror-based authoritative quote using a fresh explicit `now`;
3. if expected quote differs, return `PRICE_CHANGED` with refreshed quote and do **not** create a submit-capable DRAFT;
4. buyer reviews refreshed values and submits again;
5. only a matching expected quote may become the initial DRAFT snapshot.

The browser quote is not trusted to calculate price; it only says what the buyer was shown.

#### Stage 2 — DRAFT → fresh Pancake validation

Fresh Pancake validation may observe newer trusted base-price facts than the mirror used to create DRAFT.

If fresh effective quote differs:
- atomically refresh the same mutable DRAFT lines/audit/totals;
- mark/return typed `PRICE_CHANGED` with refreshed quote;
- remain out of `POS_SUBMITTING`;
- require another explicit submit;
- repeated drift repeats the handshake instead of looping against stale mirror data.

When DRAFT matches current fresh effective quote, final pricing becomes immutable no later than the guarded transition out of DRAFT toward POS submission.

## P0 — Planning closeout

**Description:** Merge reviewed spec + plan only and record the resolved self-review/review findings.

**Acceptance criteria:**
- [ ] PR #151 remains docs/tasks only;
- [ ] approved spec remains product source of truth;
- [ ] R1–R8 and S1–S2 are reflected in plan + todo;
- [ ] human approves PR #151;
- [ ] no unresolved Critical/Required review findings;
- [ ] exact head/CI state recorded before merge.

**Verification:** compare PR against `main`; confirm no production/test/migration file changes; planning review correctness → security → architecture → simplicity → performance.

---

## P1 — Persistence + additive migration

**Suggested PR:** `promo-A1-persistence`.

**Acceptance criteria:**
- [ ] add campaign/target enums/models;
- [ ] website-owned money uses integer/BigInt VND;
- [ ] Pancake mirror price fields remain `Float?`;
- [ ] DB-guard target row shape and duplicate identical targets;
- [ ] add OrderLineSnapshot base/promotion audit columns;
- [ ] historical orders remain readable;
- [ ] no campaign delete endpoint.

**Verification:** RED/GREEN DB schema tests; `prisma:validate`; `prisma:generate`; migration deploy on clean/test DB; rollback compatibility review.

**Likely files:** Prisma schema, one migration, focused DB schema tests.

---

## P2 — Central pricing domain + price-readiness audit

**Suggested PR:** `promo-A2-pricing-domain`.

**Acceptance criteria:**
- [ ] pure resolver with explicit `now`;
- [ ] positive safe-integer base boundary;
- [ ] percentage `1..99` uses exact BigInt rational arithmetic `(BigInt(base) * BigInt(100-pct) + 50n) / 100n`;
- [ ] result is safe-converted to `number` only after boundary validation;
- [ ] no floating `Math.round(base * multiplier / 100)` path is normative;
- [ ] FIXED_PRICE validity unchanged;
- [ ] invalid variant fallback and conflict fail-closed;
- [ ] promotion snapshot metadata + per-quote `nextTransitionAt`;
- [ ] read-only mirrored-price audit reports null/zero/negative/non-integer/unsafe categories.

**Verification:** domain table includes `base=50,1%`, exact-half fixtures, and `9007199254740989 @ 1% → 8917127262193579`; fixed-price drift/recovery; multiple-candidate conflict; malformed external price facts.

---

## P3 — Campaign repository + lifecycle/runtime health

**Suggested PR:** `promo-B1-repository`.

**Acceptance criteria:**
- [ ] deterministic Draft/Scheduled/Active/Ended/Disabled derivation;
- [ ] zero-traffic terminality;
- [ ] Disabled-before-Active vs Disabled-after-Active;
- [ ] legal re-enable of never-Active Disabled campaign rewrites `enabledAt` and clears `disabledAt=null` atomically;
- [ ] campaign with any prior non-empty Active interval cannot take re-enable path;
- [ ] Copy → new Draft;
- [ ] dynamic PRODUCT coverage;
- [ ] batch direct-VARIANT + owning-PRODUCT candidate lookup;
- [ ] affected-variant PARTIALLY_INVALID health;
- [ ] runtime conflict/recovery without arbitrary winner;
- [ ] bounded query count;
- [ ] Draft expansion health detects `>2000` via bounded probe without loading all variants.

**Verification:** DB lifecycle/coverage/query-count tests, including Draft → enable → disable-before-Active → re-enable and terminal disable-after-Active cases; expansion health at 2000/2001.

---

## P4 — Concurrency-safe admin domain + activation gate

**Suggested PR:** `promo-B2-admin-domain`.

**Acceptance criteria:**
- [ ] require existing ADMIN authorization;
- [ ] enforce `MAX_CAMPAIGN_NAME_LENGTH=120` after trim;
- [ ] enforce `MAX_TARGETS_PER_CAMPAIGN=200` normalized explicit targets;
- [ ] enforce `MAX_PROMOTION_IDENTIFIER_LENGTH=128` on browser-supplied IDs before lookup;
- [ ] enforce `MAX_EXPANDED_VARIANTS_PER_CAMPAIGN=2000` on publish/re-enable/Scheduled-edit validation;
- [ ] reject oversized syntactic input before persistence even for Draft;
- [ ] Draft may otherwise save business-invalid/non-effective configuration;
- [ ] expansion over cap returns typed `TARGET_EXPANSION_LIMIT_EXCEEDED` before acquiring a huge variant lock set;
- [ ] publish/re-enable fails `ACTIVATION_DISABLED` while server gate is off;
- [ ] when gate is on, full current-target activation validation applies;
- [ ] Scheduled edits are atomically revalidated;
- [ ] Active material pricing/target/time edits rejected;
- [ ] terminal lifecycle enforced;
- [ ] legal re-enable atomically clears stale `disabledAt` while writing new enabled state;
- [ ] campaign row lock prevents same-campaign lost updates;
- [ ] deterministic campaign → product → variant lock order;
- [ ] PRODUCT↔PRODUCT, PRODUCT↔VARIANT, VARIANT↔VARIANT overlap race-safe;
- [ ] failed mutation leaves previous effective definition unchanged;
- [ ] post-activation runtime expansion above 2000 does not invalidate campaign solely due the transaction cap.

**Verification:** first discriminating RED concurrency tests; same-campaign concurrent edit; cross-campaign conflicting publish; exact A.end == B.start; forged/stale/129-char IDs; name 120/121; targets 200/201; expansion 2000/2001; gate-on/gate-off behavior; re-enable timestamp-state regression.

---

## Checkpoint A — Domain/persistence gate

- [ ] P1–P4 focused tests green;
- [ ] migration clean;
- [ ] concurrency tests stable under repeated runs;
- [ ] activation disabled by default in production-like fixture;
- [ ] explicit bounds max/max+1 tests green;
- [ ] no framework dependency inside pricing domain;
- [ ] no N+1;
- [ ] 0 Critical / 0 Required review findings.

---

## P5 — Admin promotions UX + product linkage

**Suggested PRs:** split campaign UX and product linkage before implementation if they exceed one reviewable slice.

**Acceptance criteria:**
- [ ] `/admin/promotions` protected;
- [ ] campaign list/search is paginated and returns at most `MAX_ADMIN_PROMOTION_PAGE_SIZE=50` per request;
- [ ] PRODUCT/VARIANT target search returns at most `ADMIN_TARGET_SEARCH_LIMIT=50` candidates per request;
- [ ] list status/health/targets/time/discount;
- [ ] create/edit/publish/re-enable/disable/copy actions according to lifecycle;
- [ ] while activation gate is off, Publish/Re-enable shows explicit disabled-readiness feedback instead of pretending success;
- [ ] target-specific typed errors including expansion limit;
- [ ] product admin shows current/upcoming campaign summary + link only;
- [ ] server actions delegate to domain; no pricing arithmetic in React.

**Verification:** server-action mapping tests; list/search max/max+1/pagination tests; Playwright keyboard/Axe/mobile; forged non-admin mutation rejected.

---

## P6 — PDP/variant/composite quote projection

**Suggested PR:** `promo-D1-storefront-projection`.

**Acceptance criteria:**
- [ ] remove after-discount equality gate as website authority;
- [ ] unusable base is not purchasable;
- [ ] selected variant shows exact base/effective quote + promotion metadata;
- [ ] selection changes price/badge/countdown;
- [ ] no-promo selection returns base/no sale UI;
- [ ] composite component uses its real variant + owning product;
- [ ] parent PRODUCT campaign does not bleed onto child-owned component;
- [ ] no per-option promotion DB query;
- [ ] PDP boundary refresher uses server-derived relative delay capped at 60s and resume guard.

**Verification:** domain/projection tests plus composite ownership regression; PDP start/end + clock-skew/resume refresh smoke.

---

## P7a — Cards + shared effective-price storefront SQL

**Suggested PR:** `promo-D2-discovery`.

**Acceptance criteria:**
- [ ] representative card sale rules match spec;
- [ ] discovery min/max and price sort use effective price;
- [ ] one `requestNow` drives count, ID order, hydration, card quote, and transition facts;
- [ ] SQL receives bound `requestNow`, not independent DB clock;
- [ ] validated integer-like base is cast to PostgreSQL `numeric` before percentage multiplication/division; no `ROUND(double precision ...)` promotion formula;
- [ ] SQL produces exact rational parity with the BigInt TypeScript algorithm across full accepted safe-integer domain;
- [ ] color/size/availability constrain same candidate set;
- [ ] SQL↔TS parity covers no-promo/%/fixed/invalid/conflict/time edges;
- [ ] SQL↔TS exact-half parity is mandatory: `150 @ 1% → 149`, `350 @ 1% → 347`, `110 @ 5% → 105`;
- [ ] SQL↔TS upper-safe parity is mandatory: `9007199254740989 @ 1% → 8917127262193579`;
- [ ] projection contract is reusable by P7b `/flash-sale` membership rather than forked;
- [ ] query-wide earliest future transition can be aggregated from the full pre-pagination route candidate universe;
- [ ] public page size remains bounded by existing storefront maximum `48`;
- [ ] pagination/count remain bounded and stable.

**Verification:** DB parity tests including exact-half + upper-safe fixture; boundary-time test where campaign transition sits between multiple query calls but one request clock preserves internal consistency; off-page transition aggregate fixture; page-size 48/max+1 rejection or normalization according to existing parser; query-count check.

---

## P7b — `/flash-sale` + boundary refresh

**Suggested PR:** `promo-D3-flash-refresh`.

**Acceptance criteria:**
- [ ] bounded/paginated `/flash-sale` active valid Flash Sale membership using max page size 48;
- [ ] membership uses the same sanctioned SQL active-valid pricing/membership projection from P7a before pagination, not a second Flash Sale-specific promotion predicate;
- [ ] representative only among active Flash Sale variants;
- [ ] one server `requestNow` per render;
- [ ] `/shop` uses query-wide earliest relevant future transition across pre-pagination candidates, including off-page campaigns capable of changing current filter/sort/page membership;
- [ ] `/flash-sale` transition aggregate includes upcoming enabled Flash Sale even when current membership is empty;
- [ ] server sends relative `refreshAfterMs`, capped at `60_000`, with 60s fallback when no future transition is known;
- [ ] client does not use browser `Date.now()` to derive schedule from an absolute server timestamp;
- [ ] client uses monotonic elapsed-time tracking and immediate `router.refresh()` on `visibilitychange`/`pageshow` when delay elapsed while suspended;
- [ ] no persistent promotion cache introduced;
- [ ] countdown cannot authorize transaction price.

**Verification:** DB membership/transition parity against central resolver plus browser:
- scheduled→active and active→ended;
- off-page promotion start changes current `/shop` sorted/filter page;
- empty `/flash-sale` → first Scheduled Flash Sale starts;
- browser `Date.now()` skew does not postpone refresh;
- hidden/background page resumes after boundary and refreshes immediately;
- visible page has no >60s stale display path;
- bounded query-count check.

---

## Checkpoint B — Storefront convergence

- [ ] PDP/card/discovery agree for same variant/requestNow;
- [ ] composite ownership green;
- [ ] SQL↔TS parity green, including exact-half and upper-safe-integer fixtures;
- [ ] `/shop` and `/flash-sale` use one sanctioned SQL promotion projection contract;
- [ ] query-wide/off-page/empty-state boundary refresh green;
- [ ] clock-skew/resume guard green;
- [ ] no N+1;
- [ ] 0 Critical / 0 Required review findings.

---

## P8 — Cart + rendered checkout quote + mutable DRAFT audit

**Suggested PR:** `promo-E1-cart-checkout-quote`.

**Acceptance criteria:**
- [ ] cart reconstructs current effective quote;
- [ ] cart never locks expired promotion price;
- [ ] composite cart line keeps real ownership semantics;
- [ ] checkout render produces server-derived bounded `expectedQuote` stale-detection facts;
- [ ] expected quote contains only IDs/quantities/prices/totals needed to prove what buyer saw;
- [ ] browser expected quote is never used to calculate authoritative price;
- [ ] matching submit may create DRAFT with base/final/promotion audit snapshots;
- [ ] DRAFT shipping/totals use effective final prices;
- [ ] historical non-promotion orders stay readable.

**Verification:** cart start/end repricing; checkout-render expected quote fixture; manipulated expected quote cannot lower server price; audit snapshot assertions.

---

## P9 — Two-stage `PRICE_CHANGED` reconfirmation

**Suggested PR:** split into `promo-E2a-render-to-draft-reconfirm` and `promo-E2b-draft-to-fresh-reconfirm` if one slice crosses too many ownership files.

**Stage 1 acceptance:**
- [ ] server recomputes current quote before initial DRAFT creation;
- [ ] rendered expected quote mismatch returns `PRICE_CHANGED` + refreshed lines/totals;
- [ ] no submit-capable DRAFT/Pancake write is created from a buyer-stale quote;
- [ ] buyer must explicitly resubmit refreshed values;
- [ ] test: buyer saw 400k → sale expires → first click returns 500k and no POS write → second click can proceed.

**Stage 2 acceptance:**
- [ ] fresh Pancake base enters central resolver;
- [ ] DRAFT mismatch refreshes DRAFT atomically and returns `PRICE_CHANGED`;
- [ ] DRAFT remains out of `POS_SUBMITTING`;
- [ ] buyer must explicitly resubmit;
- [ ] repeated drift requires repeated confirmation without infinite stale-mirror loop;
- [ ] concurrent submit guards remain one-shot safe;
- [ ] SYNC_UNKNOWN/PROCESSING semantics remain unchanged.

**Verification:** domain/state-machine + browser feedback tests for both stale windows independently.

---

## P10 — Pancake final submission convergence + semantic acceptance

**Suggested PR:** `promo-F-pancake-submit`.

**Acceptance criteria:**
- [ ] fresh catalog validates identity/stock and feeds base facts to central resolver;
- [ ] price comparison uses effective quote vs DRAFT/final snapshot;
- [ ] subtotal/shipping/total validation uses final effective line values;
- [ ] request line price comes from immutable finalized `OrderLineSnapshot.unitPriceVnd`;
- [ ] mapper sends it as `variation_info.retail_price`;
- [ ] promoted order does not reject merely because final != raw base;
- [ ] no blind retry; ambiguous create remains SYNC_UNKNOWN.

**Verification:** three independent regressions for comparison/totals/request mapping; fixed 500k→100k request test; fresh % drift returns `PRICE_CHANGED`; existing stock/identity failure tests remain green.

### Controlled semantic acceptance

Before real campaign activation:
1. run only in explicitly authorized test/safe Pancake context;
2. submit one line price intentionally different from catalog base through reviewed create-order path;
3. verify Pancake accepts and preserves it without silent reprice/reject;
4. clean up when safely supported;
5. record sanitized evidence;
6. never run this write probe automatically in recurring CI.

If acceptance cannot be proven, activation gate remains off.

---

## G1 — SEO + commerce analytics monetary convergence

**Suggested PR:** `promo-G1-seo-analytics`.

**Precondition:** refresh from then-current `main` and re-discover analytics ownership after any GTM/TikTok work. Do not assume Meta-specific modules remain canonical.

**Acceptance criteria:**
- [ ] Product/Offer structured data uses current authoritative effective price;
- [ ] storefront analytics events use effective customer price;
- [ ] purchase reporting uses immutable final order snapshot;
- [ ] GTM/TikTok/Meta or other tracking integrations **consume** authoritative commerce quote/snapshot and do not reimplement promotion pricing;
- [ ] existing indexing policy is unchanged;
- [ ] no tracking script becomes a prerequisite for SEO-visible product price/content.

**Verification:** focused SEO/analytics tests plus ownership review against then-current main.

---

## G2 — Observability + activation/readiness/rollback operations

**Suggested PR:** `promo-G2-ops-readiness`.

**Acceptance criteria:**
- [ ] structured non-PII events cover activation rejection, runtime invalidation/recovery, conflict/recovery, checkout PRICE_CHANGED, promotion-aware Pancake rejection;
- [ ] price-readiness audit is runnable and documented;
- [ ] server activation gate defaults safe and its operational change is documented;
- [ ] rollback: disable new activation first, then disable active campaigns, never rewrite finalized orders;
- [ ] no campaign activation is permitted until audit + Pancake semantic evidence + G1 convergence are accepted.

**Verification:** config/gate tests; observability reason-code tests; rollout/rollback review; no secrets/PII in logs.

---

## G3 — Browser/a11y + final Definition of Done convergence

**Suggested PR:** `promo-G3-final-qa` or test-only convergence after prior slices merge.

**Acceptance criteria:**
- [ ] admin/storefront/checkout mobile, keyboard, Axe paths cover new behavior;
- [ ] buyer-visible Stage 1 and Stage 2 price-change flows have browser proof;
- [ ] storefront freshness browser proof includes off-page `/shop` membership/order transition, empty Flash Sale activation, browser clock skew, and hidden-tab/pageshow resume after boundary;
- [ ] visible promotion display staleness never exceeds 60 seconds under the approved refresher contract;
- [ ] final review order correctness → security → architecture → simplicity → performance;
- [ ] 0 Critical / 0 Required before launch.

**Full verification:** 
- [ ] `pnpm prisma:validate`
- [ ] `pnpm prisma:generate`
- [ ] `pnpm prisma:migrate:deploy`
- [ ] `pnpm test:db`
- [ ] cart Server Action HTTP smoke
- [ ] guest checkout Server Action HTTP smoke
- [ ] admin authz HTTP smoke
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm build`
- [ ] `pnpm release:check`
- [ ] isolated Playwright/Axe runtime
- [ ] CI / Catalog indexation runtime / P18 final QA green on exact implementation head
- [ ] price-readiness evidence reviewed
- [ ] Pancake semantic evidence reviewed
- [ ] activation gate enable decision explicitly recorded.

## Implementation PR sequence

```text
A1 persistence
A2 pricing domain
B1 repository/lifecycle
B2 concurrency/admin + activation gate
C admin UX/product linkage
D1 PDP/projection
D2 discovery/cards
D3 Flash Sale/boundary refresh
E1 cart/rendered checkout quote/DRAFT
E2a rendered-quote reconfirmation
E2b fresh-Pancake reconfirmation
F Pancake submission
G1 SEO/analytics
G2 ops/readiness
G3 final QA
```

Each implementation PR:
- starts from the latest reviewed `main` for that slice;
- re-reads directly affected ownership before coding;
- includes tests proving its behavior;
- avoids unrelated refactor;
- stays reviewable and is split before implementation when it crosses independent subsystems;
- gets correctness/security review before merge;
- can land dormant while activation gate remains off when buyer behavior is not yet end-to-end ready.

## Human / launch gates

Before `/build`:
- [ ] PR #151 spec + revised plan approved;
- [ ] no unresolved Critical/Required review comments;
- [ ] first implementation slice selected from refreshed current `main`.

Before enabling real promotions:
- [ ] P1–P10 merged and converged;
- [ ] G1 complete on then-current analytics ownership;
- [ ] G2 readiness/rollback complete;
- [ ] G3 full DoD green;
- [ ] mirrored-price audit accepted;
- [ ] Pancake discounted-price semantic acceptance accepted;
- [ ] explicit human decision enables the server activation gate.
