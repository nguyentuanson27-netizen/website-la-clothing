# Promotions & Flash Sale v1 — implementation plan

Status: **PLANNING ONLY — implementation has not started.**

Source of truth: `docs/specs/promotions-flash-sale-v1.md`.

Planning review base: `main@8eb4925de729827292c3d5a344ddfe78d4a5f96d` after PR #152 merged. This branch has been refreshed to include that merge commit. Before every implementation slice, refresh against then-current `main` and re-read directly affected ownership because GTM/TikTok/SEO work may land in parallel.

Review order: correctness → security → architecture → simplicity → performance.

## Latest review resolution
The latest review on head `f65466ca` found 3 Required issues. This revision closes them as normative plan locks.

### R9 — Disable and Copy are not expansion-gated operations
The 2000-variant cap exists to bound mutations that must prove effective coverage: `publish`, `re-enable`, and material Scheduled edit.

Do **not** apply that expansion probe/variant lock set to every campaign mutation.

Mutation classes:

**Coverage-validating mutation** — publish / re-enable / Scheduled material edit:
1. parse/canonicalize and enforce syntactic bounds;
2. lock existing campaign row when applicable;
3. resolve + lock owning ProductMirror rows in deterministic ID order;
4. bounded expansion probe at `MAX_EXPANDED_VARIANTS_PER_CAMPAIGN + 1`;
5. if >2000, fail `TARGET_EXPANSION_LIMIT_EXCEEDED` before variant locks;
6. lock required VariantMirror rows deterministically;
7. re-read lifecycle/base/targets/overlap under lock;
8. validate and atomically commit.

**Disable/end-early**:
1. authn/authz + campaign identifier bound;
2. lock campaign row;
3. validate that transition to Disabled is legal;
4. update Disabled state/`disabledAt` atomically;
5. do **not** expand PRODUCT coverage or lock all variants.

Disable must succeed in bounded work if an Active PRODUCT campaign grew from <=2000 to >2000 after activation. This is a rollback invariant.

**Copy**:
1. authn/authz + campaign identifier bound;
2. read/lock source campaign sufficiently to get a consistent snapshot;
3. read source explicit `PromotionTarget` rows only (max 200 by contract);
4. create new Draft with copied config/explicit targets + deterministic copy name;
5. do **not** expand PRODUCT coverage or reject because current dynamic expansion >2000;
6. Draft health may subsequently report `TARGET_EXPANSION_LIMIT_EXCEEDED`.

Required regressions:
- Active PRODUCT enabled at 1900 variants → sync grows to 2001 → Disable still succeeds;
- source campaign with current PRODUCT expansion >2000 → Copy still creates Draft;
- expansion >2000 still blocks publish/re-enable/Scheduled material edit.

### R10 — Copy naming is deterministic at the 120-code-unit limit
Use exact suffix:

```ts
const COPY_NAME_SUFFIX = " - Bản sao";
```

Create a helper owned by campaign domain, conceptually:

```ts
function buildPromotionCopyName(sourceName: string): string
```

Rules:
- normalize/trim source;
- reserve suffix length inside `MAX_CAMPAIGN_NAME_LENGTH=120`;
- truncate retained prefix to remaining UTF-16 code-unit budget without splitting a surrogate pair;
- trim trailing whitespace from retained prefix;
- append exact suffix;
- final result must be non-empty and <=120 code units.

Repeated Copy applies the same algorithm to immediate source. It may produce repeated suffixes when they fit; it never fails solely because source name is 119/120 code units.

Tests: 119, 120, surrogate-pair boundary, Copy-of-Copy.

### R11 — `/flash-sale` reuses both storefront page and offset bounds
Existing repository evidence on current `main`:
- `STOREFRONT_DISCOVERY_LIMITS.page = 10_000` in `src/commerce/storefront-discovery.ts`;
- `MAX_STOREFRONT_PRODUCTS = 48` and `MAX_STOREFRONT_OFFSET = 50_000` in `src/commerce/storefront-catalog.ts`.

`/flash-sale` must reuse the same parser/guard contract or factor a shared helper; it must not implement only a page-size cap while allowing arbitrarily expensive OFFSET.

For page size 48:
- page 1042 → offset 49,968: within current repository window;
- page 1043 → offset 50,016: reject before expensive query.

Also keep the parser-level page <=10,000 constraint. The tighter offset bound wins when page size makes it smaller.

### R12 — PR #152 SEO/GEO audit is now an explicit dependency
PR #152 changed docs only, so there is no code conflict, but it adds two semantic gates relevant to this feature.

**W3 / Pancake sale-price evidence:** before P6 removes the current equality gate, run `pnpm pancake:catalog:audit`, record sanitized mismatch facts, verify upstream semantics, and assess the approved website-owned pricing consequence. The current product decision remains `pancakeRetailPrice` + website campaign state; evidence that materially contradicts that assumption triggers product review rather than silent authority change.

**W4 / structured data:** promotion G1 updates Offer price only when the current SEO contract can truthfully represent that Offer. Do not introduce `AggregateOffer` for variants. `ProductGroup` / per-variant Offer stays outside this feature until variant identity → deep-link/preselection → canonical/query contract prerequisites are separately implemented.

Before adding SEO runtime tests, inventory PR #152/W15 coverage so we add only missing gates rather than duplicating CI.

## Previously locked invariants retained

### R1 — rendered buyer quote must be checked before initial DRAFT
Browser returns expected quote only for stale detection. Server recomputes current quote before creating submit-capable DRAFT. Mismatch returns `PRICE_CHANGED`, no Pancake write, explicit resubmit.

### R2 — same-campaign concurrency
Existing campaign writes serialize same-row mutation with campaign `FOR UPDATE` or equivalent CAS. Coverage-validating mutations then use deterministic product → variant ordering.

### R3 — technical activation kill switch
Server-only gate, conceptually `WEBSITE_PROMOTIONS_ACTIVATION_ENABLED`, defaults false. Draft/read/health usable while off; publish/re-enable fail typed `ACTIVATION_DISABLED`. Gate stays off until price audit, Pancake semantic acceptance, SEO/analytics convergence and final DoD are accepted.

### R4 — one request clock
Each storefront render captures one `requestNow` and passes it through count/order/projection/hydration/card/transition calculations. SQL campaign eligibility does not call its own wall clock when a bound `requestNow` is available.

### R5 — G1/G2/G3 separation
- G1: SEO + commerce analytics monetary convergence;
- G2: observability + activation/readiness/rollback;
- G3: browser/a11y + final DoD.

Before G1, rediscover then-current analytics ownership after GTM/TikTok work.

### R6 — exact percentage arithmetic
Normative TypeScript formula:

```ts
const numerator = BigInt(basePriceVnd) * BigInt(100 - discountPercent);
const effectiveBigInt = (numerator + 50n) / 100n;
const effectivePriceVnd = Number(effectiveBigInt);
```

No floating `Math.round(base * multiplier / 100)` reference across full accepted domain. SQL uses `numeric` before multiplication/division.

Mandatory parity:
- 150 @1% →149
- 350 @1% →347
- 110 @5% →105
- 9007199254740989 @1% →8917127262193579

### R7 — query-wide, relative storefront freshness
`/shop` transition aggregate includes off-page candidates that can change page membership/order. `/flash-sale` includes upcoming enabled Flash Sale boundaries even if current membership is empty.

Server emits `refreshAfterMs <= 60_000`; no known transition → 60s fallback. Client schedules relative delay, not browser wall-clock subtraction. `visibilitychange`/`pageshow` refresh if delay elapsed while suspended.

### R8 — finite bounds
- campaign name 120 code units;
- explicit targets 200;
- browser IDs 128;
- admin list/search 50;
- public page size 48;
- public page parser max 10,000;
- public catalog offset max 50,000;
- activation/re-enable/Scheduled expansion 2000.

All named bounds get max/max+1 coverage where meaningful.

### S1 — discovery uses effective price
`/shop` min/max and price sort happen pre-pagination and use authoritative current effective price on the same eligible candidate set.

### S2 — composite ownership
Promotion ownership follows actual selected VariantMirror + real owning product, not the parent PDP that happens to render it.

## Architecture

### A. Persistence
Add website-owned campaign + explicit target persistence and additive order-line audit fields.

Preferred conceptual fields:
- PromotionCampaign: id/name/kind/discount fields/publishState/enabledAt/disabledAt/startsAt/endsAt/timestamps;
- PromotionTarget: id/campaignId/targetType/productId?/variantId?;
- OrderLineSnapshot: additive base price + immutable promotion snapshots.

Keep Pancake mirrored price fields `Float?`.

DB/server guards:
- target shape exactly one product/variant;
- duplicate identical target impossible;
- PRODUCT + own variant duplicate coverage rejected;
- money field shapes;
- historical orders readable.

No campaign delete.

### B. Lifecycle
Persist publication intent/history and derive status with explicit `now`.

Conceptually:

```text
effectiveStart = max(enabledAt, startsAt ?? enabledAt)
```

Derived Draft/Scheduled/Active/Ended/Disabled must be correct with restart and zero traffic.

Legal never-Active re-enable atomically writes fresh `enabledAt`, enabled state, `disabledAt=null`. Prior Active interval means terminal.

### C. Central pricing resolver
Pure TypeScript domain resolver with explicit `now` returns:
- base/effective price;
- promotion snapshot;
- discounted flag;
- typed failure/conflict reason;
- per-variant transition fact.

Rules:
- positive safe-integer base only;
- exact BigInt percentage;
- fixed final price `0 < fixed < base`;
- invalid promotion falls back affected variant only when base usable;
- >1 candidate = conflict → no promotion;
- unusable base = non-purchasable;
- no downstream reimplementation.

### D. Candidate lookup
Batch by real variant IDs, resolving direct VARIANT + owning PRODUCT candidates at explicit `now`. Never arbitrary first winner.

### E. Mutation concurrency
Use R9 mutation classes. Only coverage-validating mutations take product locks + bounded expansion + variant locks. Disable and Copy are intentionally separate bounded paths.

### F. Activation gate
No new dependency. Server-only configuration. Gate-off means no new pricing-effective publish/re-enable. Existing active campaigns require explicit Disable for rollback.

### G. Shared SQL storefront pricing/membership projection
One sanctioned projection serves:
- `/shop` effective-price count/filter/sort/ordered IDs;
- `/flash-sale` active-valid membership before pagination;
- query-wide transition aggregate where required.

Requirements:
- explicit `requestNow` bind;
- same positive-safe-integer base predicate;
- validated base cast to `numeric` before percentage arithmetic;
- same direct/owning-product target semantics;
- `[start,end)`;
- same invalid/conflict fallback;
- color/size/availability candidate semantics preserved;
- no second Flash Sale pricing predicate;
- SQL↔TS parity including exact-half + upper-safe fixture.

### H. Pagination/freshness
`/shop` and `/flash-sale` use existing page/window bounds per R11. Transition aggregate is bounded/index-friendly and pre-pagination where membership/order can change.

### I. Checkout
Two stale windows:
1. rendered quote → initial DRAFT;
2. DRAFT → fresher Pancake catalog.

Both mismatch cases return `PRICE_CHANGED`, remain outside `POS_SUBMITTING`, perform no stale Pancake write, and require explicit customer resubmit.

Final pricing freezes at guarded transition out of DRAFT.

## Dependency graph

```text
P0 planning closeout
 ↓
P1 persistence
 ↓
P2 pricing domain + catalog/readiness audit
 ↓
P3 repository/lifecycle/runtime health
 ↓
P4 admin domain/concurrency + activation gate
 ↓
Checkpoint A
 ├─ P5 admin UX
 └─ P6 PDP/composite + resolver ownership change
      ↓
    P7a /shop cards/discovery/shared SQL
      ↓
    P7b /flash-sale + pagination + freshness
      ↓
    Checkpoint B
      ↓
    P8 cart/rendered checkout quote/DRAFT
      ↓
    P9a render→DRAFT reconfirm
      ↓
    P9b DRAFT→fresh Pancake reconfirm
      ↓
    P10 Pancake final submission + semantic acceptance
      ↓
    G1 SEO/analytics   G2 ops/readiness   G3 final browser/DoD
      └────────────── launch gate ──────────────┘
```

## P0 — planning closeout
Acceptance:
- PR #151 remains planning/docs only;
- spec/plan/todo agree;
- PR #152 W3/W4 dependencies reflected;
- latest review R9–R11 reflected;
- no unresolved Critical/Required on fresh review;
- exact-head CI state recorded.

## P1 — persistence + additive migration
Suggested PR: `promo-A1-persistence`.

Acceptance:
- campaign/target enums/models;
- target DB shape/uniqueness;
- website money integer/BigInt;
- Pancake mirrors remain Float;
- additive OrderLineSnapshot audit fields;
- historical compatibility;
- no delete.

Verification: RED/GREEN DB tests, prisma validate/generate/migrate deploy, rollback compatibility.

## P2 — pricing domain + readiness evidence
Suggested PR: `promo-A2-pricing-domain`.

Acceptance:
- pure resolver explicit now;
- base positive-safe-integer boundary;
- exact BigInt percentage + fixed rules;
- affected-variant fallback/conflict fail-closed;
- quote metadata;
- read-only money-data audit;
- run/record `pnpm pancake:catalog:audit` evidence required by PR #152 W3 before P6 ownership change is enabled.

Verification: domain table tests including 50@1%, exact-half, upper-safe, fixed drift/recovery, malformed external data.

## P3 — repository/lifecycle/runtime health
Suggested PR: `promo-B1-repository`.

Acceptance:
- deterministic statuses/zero-traffic terminality;
- legal re-enable clears disabledAt;
- Copy helper with deterministic bounded name;
- Copy snapshots explicit targets only and succeeds even if dynamic expansion >2000;
- dynamic PRODUCT coverage;
- batch candidate lookup;
- partial invalidity/conflict/recovery;
- Draft health bounded expansion probe;
- bounded query count.

Verification includes 119/120 name, surrogate boundary, Copy-of-Copy, >2000 source Copy.

## P4 — concurrency-safe admin domain + activation gate
Suggested PR: `promo-B2-admin-domain`.

Acceptance:
- ADMIN authz;
- syntactic bounds;
- gate-off publish/re-enable = `ACTIVATION_DISABLED`;
- coverage-validating mutation path exactly R9;
- expansion 2000/2001;
- same-campaign lost-update guard;
- cross-campaign overlap race-safe;
- legal re-enable atomic;
- Disable uses bounded campaign-only path with no expansion gate;
- active PRODUCT >2000 regression disables successfully;
- failed coverage mutation preserves previous definition.

Checkpoint A requires migration clean, repeated concurrency tests, gate default-off, 0 Critical/Required.

## P5 — admin UX
Acceptance:
- `/admin/promotions` protected;
- list/search bounded 50;
- create/edit/publish/re-enable/disable/copy according to lifecycle;
- explicit activation-disabled feedback;
- typed validation/expansion errors;
- product admin summary/link only;
- no pricing math in React;
- keyboard/Axe/mobile + non-admin rejection.

## P6 — PDP/variant/composite + ownership transition
Precondition: review P2 `pancake:catalog:audit` evidence and PR #152 W3 consequence. If evidence contradicts current ownership assumptions materially, stop for product review.

Acceptance:
- remove after-discount equality gate as website authority only after evidence review;
- unusable base non-purchasable;
- selected variant uses central quote;
- real composite owner semantics;
- sale/flash UI + relative refresh;
- no per-option DB query.

## P7a — cards + `/shop` shared SQL
Acceptance:
- representative card wording/spec;
- effective price min/max/sort;
- one requestNow across count/order/projection/hydration;
- numeric exact SQL;
- same candidate filters;
- mandatory SQL↔TS parity fixtures;
- query-wide off-page transition aggregate;
- existing page-size/page/offset guards retained.

## P7b — `/flash-sale` + pagination/freshness
Acceptance:
- same sanctioned pricing/membership projection;
- active-valid Flash only;
- reuse storefront page parser max 10,000 and offset max 50,000;
- page size max 48;
- 48-size page 1042 allowed by offset window, 1043 rejected;
- upcoming sale boundary visible even when page empty;
- relative refreshAfterMs <=60s + fallback;
- visibility/pageshow resume guard;
- no persistent promotion price cache.

Verification: DB membership parity, bounded query count, scheduled→active, active→ended, empty→first sale, off-page movement, clock skew, hidden-tab resume.

Checkpoint B: PDP/card/discovery agree; composite green; SQL parity green; one SQL contract; pagination/freshness boundaries green; no N+1; 0 Critical/Required.

## P8 — cart + rendered quote + mutable DRAFT
Acceptance:
- current effective cart price;
- checkout server-derived bounded expectedQuote;
- browser expected facts stale-detection only;
- matching quote can create DRAFT with base/final/promotion audit;
- shipping/totals effective prices;
- historical compatibility.

Activation gate remains off until P10/G1/G2/G3 launch criteria are complete.

## P9a — rendered quote → DRAFT
Acceptance:
- recompute before DRAFT;
- mismatch = PRICE_CHANGED + refreshed totals;
- no submit-capable stale DRAFT/Pancake write;
- explicit resubmit;
- 400k→500k expiry regression.

## P9b — DRAFT → fresh Pancake
Acceptance:
- fresh base enters central resolver;
- mismatch atomically refreshes DRAFT + PRICE_CHANGED;
- no stale POS_SUBMITTING;
- repeated drift reconfirmation without infinite loop;
- one-shot/SYNC_UNKNOWN semantics unchanged.

## P10 — Pancake convergence + semantic acceptance
Acceptance:
- fresh identity/stock validation;
- effective quote comparison;
- final/effective subtotal/shipping/total validation;
- request price from finalized OrderLineSnapshot.unitPriceVnd;
- mapper sends variation_info.retail_price;
- no raw-base rejection/substitution;
- no blind retry.

Three independent regression tests: comparison / totals / request mapping.

Controlled acceptance: authorized safe context, one discounted custom line price, verify accept+preserve, sanitized evidence. If not proven, gate stays off.

## G1 — SEO + commerce analytics convergence
Preconditions:
- refresh latest main;
- re-read PR #152 audit W3/W4/W15;
- rediscover analytics ownership after GTM/TikTok.

Acceptance:
- valid current Offer price uses authoritative effective price;
- if current variant SEO shape cannot truthfully represent differing prices, stay fail-closed/omit unsupported Offer;
- no AggregateOffer for variants;
- ProductGroup/deep-link work remains out of scope unless separately specified;
- analytics consume effective quote; Purchase immutable snapshot;
- tracking not required for SEO-visible content;
- indexing policy unchanged;
- inventory existing SEO CI/smoke coverage before adding new runtime tests.

## G2 — observability/readiness/rollback
Acceptance:
- reason-coded non-PII events;
- price audit + Pancake catalog audit evidence documented;
- activation gate default-safe;
- rollback turns off activation then disables active campaigns via bounded Disable path;
- regression proves disable works >2000 coverage;
- no finalized history rewrite.

## G3 — browser/a11y + final DoD
Acceptance:
- admin/storefront/checkout mobile/keyboard/Axe;
- both price-change flows browser proof;
- flash boundary/pagination proof;
- final correctness→security→architecture→simplicity→performance review;
- 0 Critical/Required.

Full gates:
- prisma validate/generate/migrate deploy;
- test:db;
- cart/checkout/admin HTTP smokes;
- lint/typecheck/test/build/release:check;
- isolated Playwright/Axe;
- exact-head CI/Catalog/P18 green;
- W3 catalog evidence accepted;
- custom Pancake price semantic evidence accepted;
- activation enable decision explicitly recorded.

## Implementation sequence
`A1 persistence → A2 pricing/evidence → B1 repository/lifecycle → B2 concurrency/admin+gate → C admin UX → D1 PDP → D2 discovery/cards → D3 Flash/pagination/freshness → E1 cart/quote/DRAFT → E2a render reconfirm → E2b fresh-Pancake reconfirm → F Pancake → G1 SEO/analytics → G2 ops/readiness → G3 final QA`

Every implementation PR:
- starts from latest reviewed main;
- re-reads affected ownership;
- includes tests proving behavior;
- avoids unrelated refactor;
- splits independent subsystems before implementation;
- is reviewable/revertable;
- receives correctness/security review;
- may land dormant while activation gate stays off.

## Human gates
Before `/build`:
- PR #151 fresh review has no Critical/Required;
- exact-head CI green;
- first slice selected from current main.

Before real activation:
- P1–P10 converged;
- G1/G2/G3 complete;
- mirrored money audit + Pancake catalog audit accepted;
- Pancake discounted custom-price semantic acceptance accepted;
- explicit human decision enables activation gate.