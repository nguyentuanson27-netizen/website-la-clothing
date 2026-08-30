# Promotions & Flash Sale v1 — execution checklist

Status: **PLANNED / NOT IMPLEMENTED**

Source of truth:
- `docs/specs/promotions-flash-sale-v1.md`
- `tasks/promotions-flash-sale-v1-plan.md`

PR #151 remains docs/planning only. Production implementation starts from then-current reviewed `main` after approval.

## Planning/self-review gate

- [x] Re-read approved promotion/flash-sale spec
- [x] Re-check Prisma Product/Variant/Order persistence
- [x] Re-check storefront equality-gated pricing
- [x] Re-check `/shop` price filter/sort before pagination
- [x] Re-check composite parent PDP can project child-owned variants
- [x] Re-check DRAFT checkout snapshot + submit flow
- [x] Re-check Pancake live-price comparison/totals/request mapping
- [x] Verify current Next.js App Router `connection()` / `router.refresh()` behavior from official docs
- [x] Verify PostgreSQL consistent lock-order guidance from official docs
- [x] Self-review: 0 Critical
- [x] Resolve R1 buyer-visible quote → initial DRAFT stale window
- [x] Resolve R2 same-campaign lost-update concurrency
- [x] Resolve R3 server-only production activation kill switch
- [x] Resolve R4 one `requestNow` across multi-read storefront projections
- [x] Resolve R5 split G1/G2/G3 and rediscover analytics ownership after parallel GTM/TikTok work
- [x] Retain S1 discovery effective-price semantics
- [x] Retain S2 composite real-owner semantics
- [x] Close SQL `float8` vs `numeric` percentage-rounding review gap
- [x] Require exact-half SQL↔TS parity fixtures with fixed expected values
- [x] Share one sanctioned SQL pricing/membership projection across `/shop` and `/flash-sale`
- [x] Lock legal never-Active re-enable to atomically clear `disabledAt`
- [x] Confirm fixed-price PRODUCT affected-variant runtime fallback supersedes earlier wholesale-invalid draft
- [x] Review `5061370559`: replace floating `Math.round` reference with exact BigInt percentage arithmetic
- [x] Review `5061370559`: add upper-safe-integer TS + SQL parity fixture
- [x] Review `5061370559`: make boundary refresh query-wide with server-derived relative delay and resume guard
- [x] Review `5061370559`: define named finite input/admin/expansion bounds with max/max+1 tests
- [ ] Human approves revised PR #151 spec + plan
- [ ] Confirm no unresolved Critical/Required review findings on latest head

## P1 — Persistence + migration

- [ ] Add campaign kind/discount/target/publish-state enums
- [ ] Add website-owned PromotionCampaign persistence
- [ ] Add PromotionTarget persistence
- [ ] DB-check target row PRODUCT/VARIANT shape
- [ ] Prevent duplicate identical targets
- [ ] Keep mirrored Pancake prices as `Float?`
- [ ] Add OrderLineSnapshot `baseUnitPriceVnd`
- [ ] Add nullable promotion ID/name/kind/type/value audit snapshots
- [ ] Historical non-promotion orders remain readable
- [ ] No campaign delete action
- [ ] Migration RED/GREEN tests
- [ ] `prisma:validate` / `prisma:generate` / migration deploy on test DB

## P2 — Central pricing domain + readiness audit

- [ ] Pure resolver with explicit `now`
- [ ] Base price positive safe-integer VND at website authority boundary
- [ ] Percentage integer `1..99`
- [ ] Percentage uses exact BigInt rational formula `(BigInt(base) * BigInt(100-pct) + 50n) / 100n`
- [ ] Convert BigInt result to `number` only after safe-integer validation
- [ ] No floating `Math.round(base * multiplier / 100)` path is normative
- [ ] Exact-half domain fixture: `base=150,pct=1 → 149`
- [ ] Exact-half domain fixture: `base=350,pct=1 → 347`
- [ ] Exact-half domain fixture: `base=110,pct=5 → 105`
- [ ] Upper-safe domain fixture: `base=9007199254740989,pct=1 → 8917127262193579`
- [ ] FIXED_PRICE means final customer price
- [ ] Fixed rule `0 < fixed < base`
- [ ] Invalid promo falls back only affected variant
- [ ] Multiple active candidates fail closed to no promotion
- [ ] Base unavailable is distinct from promotion invalid
- [ ] Quote contains promotion audit metadata
- [ ] Quote contains per-variant `nextTransitionAt`
- [ ] Read-only mirrored-price readiness audit
- [ ] Domain edge tests

## P3 — Campaign repository/lifecycle/runtime health

- [ ] Persist/read Draft/Enabled/Disabled intent
- [ ] Derive Draft/Scheduled/Active/Ended/Disabled with explicit `now`
- [ ] `effectiveStart = max(enabledAt, startsAt ?? enabledAt)`
- [ ] Zero-traffic active window still derives Ended/terminal history correctly
- [ ] Disabled-before-Active remains editable/re-enableable
- [ ] Legal never-Active re-enable atomically writes fresh `enabledAt`, sets `publishState=ENABLED`, and clears `disabledAt=null`
- [ ] Campaign whose prior enabled interval contained any Active time cannot take re-enable path
- [ ] Disabled-after-Active terminal
- [ ] Ended terminal
- [ ] Copy any state → new Draft
- [ ] PRODUCT targets dynamically expand current variants
- [ ] New/restored variant joins PRODUCT target automatically
- [ ] Batch direct VARIANT + owning PRODUCT target lookup
- [ ] PARTIALLY_INVALID at affected-variant granularity
- [ ] Runtime conflict returns no promotion
- [ ] Runtime recovery automatic
- [ ] Draft expansion health probes at most `MAX_EXPANDED_VARIANTS_PER_CAMPAIGN + 1`
- [ ] Draft expansion >2000 reports typed `TARGET_EXPANSION_LIMIT_EXCEEDED` health without loading all variants
- [ ] Post-activation dynamic expansion >2000 is an operational/bounded-query condition only, not a terminal lifecycle or pricing invalidation by itself
- [ ] Bounded query-count test
- [ ] Lifecycle regression: Draft → enable → disable-before-Active → re-enable clears stale disabled timestamp
- [ ] Lifecycle regression: disable-after-Active remains terminal

## P4 — Concurrency-safe admin domain + activation gate

- [ ] Existing ADMIN authorization required
- [ ] `MAX_CAMPAIGN_NAME_LENGTH = 120` after trim
- [ ] `MAX_TARGETS_PER_CAMPAIGN = 200` normalized explicit targets
- [ ] `MAX_PROMOTION_IDENTIFIER_LENGTH = 128` browser-supplied ID code units before lookup
- [ ] `MAX_EXPANDED_VARIANTS_PER_CAMPAIGN = 2000` current unique affected variants for activation/re-enable/Scheduled edit
- [ ] Oversized syntactic input rejected before persistence even for Draft
- [ ] Draft save may otherwise remain business-invalid/non-effective
- [ ] Existing campaign row is locked first; owning product rows are locked in deterministic order before the bounded 2001-variant expansion probe
- [ ] Expansion >2000 returns typed `TARGET_EXPANSION_LIMIT_EXCEEDED` before acquiring a huge variant lock set
- [ ] Name boundary tests 120/121
- [ ] Target-count boundary tests 200/201
- [ ] Identifier boundary tests 128/129
- [ ] Expansion boundary tests 2000/2001
- [ ] Server activation gate defaults disabled in production-like config
- [ ] Publish/re-enable returns typed `ACTIVATION_DISABLED` while gate off
- [ ] Gate-off still allows Draft create/edit/read/copy-health
- [ ] Gate-on publish/re-enable performs full current-target validation
- [ ] Scheduled edit performs full atomic validation
- [ ] Active material price/target/time edits rejected
- [ ] Fully expired interval cannot be newly enabled
- [ ] Legal re-enable clears `disabledAt` atomically in same transaction as new enabled state
- [ ] Reject PRODUCT + own covered VARIANT duplicate coverage
- [ ] PRODUCT↔PRODUCT overlap
- [ ] PRODUCT↔VARIANT overlap
- [ ] VARIANT↔VARIANT overlap
- [ ] `[start,end)` exact boundary handoff allowed
- [ ] Required variants locked in deterministic ID order after bounded expansion passes
- [ ] Same-campaign concurrent edit cannot lost-update
- [ ] Concurrent conflicting publish: at most one commits
- [ ] Failed mutation leaves previous enabled definition unchanged
- [ ] Runtime catalog drift handled by resolver, not sync auto-disable

## Checkpoint A — Domain/persistence

- [ ] P1–P4 focused tests green
- [ ] Migration clean on test DB
- [ ] Concurrency tests stable across repeated runs
- [ ] Activation disabled by default in production-like fixture
- [ ] All named bounds max/max+1 tests green
- [ ] No framework/UI dependency in pricing resolver
- [ ] No N+1 in campaign lookup
- [ ] 0 Critical
- [ ] 0 Required

## P5 — Admin promotions UX

- [ ] `/admin/promotions` protected
- [ ] `MAX_ADMIN_PROMOTION_PAGE_SIZE = 50`
- [ ] `ADMIN_TARGET_SEARCH_LIMIT = 50`
- [ ] Campaign list/search paginated; never returns >50 per request
- [ ] Product/variant target search paginated/bounded; never returns >50 per request
- [ ] List/search 50/51 boundary behavior tested
- [ ] List name/kind/discount/time/targets/status/health
- [ ] Create Draft
- [ ] Edit lifecycle-allowed campaign
- [ ] Bounded multi PRODUCT/VARIANT target search/selection
- [ ] Publish/re-enable action delegates to P4
- [ ] Gate-off Publish/Re-enable gives explicit readiness-disabled feedback
- [ ] Disable/end-early action
- [ ] Copy → Draft
- [ ] Terminal campaign read-only except Copy
- [ ] Target-specific typed validation messages including expansion limit
- [ ] Product admin shows current/upcoming campaign + link only
- [ ] No pricing logic in React/server action layer
- [ ] Admin keyboard/Axe/mobile/overflow proof
- [ ] Forged/non-admin mutation rejected

## P6 — PDP/variant/composite quote projection

- [ ] Remove Pancake after-discount equality gate as website price authority
- [ ] Unusable base non-purchasable
- [ ] Standalone selected variant uses central quote
- [ ] Strike-through + sale price + badge
- [ ] Flash Sale badge + countdown metadata
- [ ] Selection change updates exact quote
- [ ] Non-promoted selection returns base/no sale UI
- [ ] Composite uses actual selected VariantMirror ID
- [ ] Composite PRODUCT scope uses real owning product
- [ ] Parent PRODUCT campaign does not bleed onto child-owned component
- [ ] No per-option DB query
- [ ] PDP boundary refresh consumes server-derived relative delay capped at 60s
- [ ] PDP resume guard refreshes when delay elapsed while hidden
- [ ] Existing composite availability/mapping regressions green

## P7a — Cards + shared effective-price storefront SQL

- [ ] Card sale representative follows approved rules
- [ ] `Từ` only when sale price is true product minimum
- [ ] `Sale từ` when cheaper unpromoted variant exists
- [ ] One server `requestNow` captured per `/shop` render
- [ ] Same `requestNow` passed to count query
- [ ] Same `requestNow` passed to ordered-ID/sort query
- [ ] Same `requestNow` passed to effective-price SQL projection
- [ ] Same `requestNow` used for hydrated card quote/representative selection
- [ ] SQL does not independently use DB clock for campaign eligibility
- [ ] Validated integer-like base is cast to PostgreSQL `numeric` before percentage multiplication/division
- [ ] No promotion percentage formula calls `ROUND()` on a `double precision` expression
- [ ] SQL result matches exact BigInt rational TypeScript contract
- [ ] Price min/max use current effective price
- [ ] `price-asc` / `price-desc` use current effective price
- [ ] Color/size/availability constrain same candidate set
- [ ] Conflict/invalid SQL fallback matches TS resolver
- [ ] SQL↔TS parity tests: no-promo/%/fixed/invalid/conflict/time boundaries
- [ ] Exact-half parity fixture: `base=150,pct=1 → 149`
- [ ] Exact-half parity fixture: `base=350,pct=1 → 347`
- [ ] Exact-half parity fixture: `base=110,pct=5 → 105`
- [ ] Upper-safe parity fixture: `base=9007199254740989,pct=1 → 8917127262193579`
- [ ] Projection contract is reused by P7b `/flash-sale` membership rather than forked
- [ ] Query-wide transition aggregate operates on full pre-pagination relevant candidate universe
- [ ] Off-page campaign transition fixture is visible to aggregate
- [ ] Public `/shop` page size remains bounded by existing max 48
- [ ] Boundary test proves multi-query request stays internally consistent across transition
- [ ] Pagination/count bounded/stable

## P7b — `/flash-sale` + boundary freshness

- [ ] Add `/flash-sale`
- [ ] Paginate/bound query with max page size 48
- [ ] Active valid Flash Sale variants only
- [ ] Membership before pagination uses same sanctioned P7a SQL pricing/membership projection
- [ ] No second Flash Sale-specific promotion eligibility formula/predicate
- [ ] Exclude regular-only/Scheduled/Ended/Disabled/invalid/conflicted
- [ ] One server `requestNow` per route render
- [ ] Representative uses Flash Sale variants only
- [ ] `/shop` computes query-wide earliest future transition including off-page candidates that can change page membership/order
- [ ] `/flash-sale` transition aggregate includes upcoming Scheduled/Enabled sale even when current membership is empty
- [ ] Transition aggregate is bounded/index-friendly; no all-row application materialization
- [ ] Server emits relative `refreshAfterMs`
- [ ] `refreshAfterMs <= 60_000`
- [ ] No-known-transition fallback is `60_000`
- [ ] Client never derives scheduling from browser `Date.now()` against absolute server timestamp
- [ ] Client tracks elapsed delay with monotonic clock
- [ ] `visibilitychange` to visible refreshes immediately if delay elapsed while hidden
- [ ] `pageshow` refreshes immediately if delay elapsed while suspended
- [ ] `router.refresh()` obtains a new server-derived delay
- [ ] No persistent promotion price cache
- [ ] DB membership/transition parity against central resolver
- [ ] Bounded query-count proof
- [ ] Browser scheduled→active proof
- [ ] Browser active→ended proof
- [ ] Browser off-page promotion enters current sorted/filter `/shop` page
- [ ] Browser empty `/flash-sale` → first sale starts
- [ ] Browser clock-skew fixture proves `Date.now()` offset cannot postpone refresh
- [ ] Browser hidden-tab/pageshow resume-after-boundary proof
- [ ] Visible-page promotional display staleness never exceeds 60s
- [ ] Countdown never authorizes transaction price

## Checkpoint B — Storefront

- [ ] PDP/card/discovery agree for same variant/requestNow
- [ ] Composite ownership regression green
- [ ] SQL↔TS parity green, including exact-half + upper-safe fixtures
- [ ] `/shop` and `/flash-sale` use one sanctioned SQL promotion projection contract
- [ ] Query-wide/off-page/empty-state Flash Sale boundary tests green
- [ ] Clock-skew/resume freshness tests green
- [ ] No N+1
- [ ] 0 Critical
- [ ] 0 Required

## P8 — Cart + rendered checkout quote + mutable DRAFT

- [ ] Cart reconstructs current effective price
- [ ] Cart never locks expired promotion price
- [ ] Composite cart line preserves real-owner semantics
- [ ] Invalid promo falls back to base
- [ ] Unusable base blocks purchase
- [ ] Checkout render emits server-derived `expectedQuote` stale-detection facts
- [ ] Expected quote includes only variant IDs, quantities, effective unit prices, subtotal, shipping, total needed for acknowledgement
- [ ] Expected quote input is bounded/validated on submit
- [ ] Browser expected quote never calculates authoritative price
- [ ] Matching quote may create DRAFT
- [ ] Initial DRAFT stores baseUnitPriceVnd
- [ ] Initial DRAFT stores final unitPriceVnd/lineTotalVnd
- [ ] Initial DRAFT stores campaign ID/name/kind/type/value snapshots
- [ ] Non-promo promotion snapshots null
- [ ] Shipping subtotal uses effective final line prices
- [ ] Historical order compatibility green

## P9a — Rendered quote → initial DRAFT reconfirmation

- [ ] Recompute authoritative current quote before DRAFT creation
- [ ] Buyer-expected mismatch returns typed `PRICE_CHANGED`
- [ ] Refreshed lines/totals returned to browser
- [ ] No submit-capable DRAFT created from stale buyer quote
- [ ] No Pancake write
- [ ] Buyer explicitly submits again
- [ ] Browser manipulation cannot lower server-computed price
- [ ] Required test: buyer saw 400k → promo expires → first submit shows 500k/no POS write → second confirmation may proceed

## P9b — DRAFT → fresh Pancake reconfirmation

- [ ] Fresh Pancake base fact enters central effective resolver
- [ ] DRAFT/fresh quote mismatch returns typed `PRICE_CHANGED`
- [ ] No stale DRAFT enters `POS_SUBMITTING`
- [ ] Atomically refresh DRAFT line/audit/totals with fresh effective quote
- [ ] Refreshed values returned to browser
- [ ] Buyer explicitly submits again
- [ ] Repeated drift requires repeated confirmation
- [ ] No infinite stale-mirror/live-price loop
- [ ] Concurrent submit guards one-shot safe
- [ ] SYNC_UNKNOWN/PROCESSING semantics unchanged

## P10 — Pancake final submission convergence

- [ ] Fresh catalog validates variation identity
- [ ] Fresh catalog validates stock
- [ ] Price comparison uses effective quote vs DRAFT/final snapshot
- [ ] Subtotal validation uses final effective lines
- [ ] Shipping validation uses effective subtotal
- [ ] Total validation uses final effective values
- [ ] Request line price uses finalized OrderLineSnapshot.unitPriceVnd
- [ ] `variation_info.retail_price` receives final customer price
- [ ] Promoted order does not reject merely because final != raw base
- [ ] No blind retry
- [ ] Ambiguous create remains SYNC_UNKNOWN
- [ ] Three independent regressions: comparison / totals / request mapping

### Controlled Pancake semantic acceptance

- [ ] Run only in explicitly authorized testable context
- [ ] Never as recurring CI write
- [ ] Use safe/test shop + known variation
- [ ] Submit line price intentionally different from catalog base
- [ ] Verify Pancake accepts it
- [ ] Verify Pancake preserves it without silent reprice
- [ ] Clean up/cancel when safely supported
- [ ] Record sanitized evidence
- [ ] If unavailable/fails, activation gate stays off

## G1 — SEO + commerce analytics monetary convergence

- [ ] Refresh from latest reviewed `main` before implementation
- [ ] Re-discover actual analytics ownership after any GTM/TikTok changes
- [ ] Do not assume Meta-specific files remain canonical
- [ ] Structured Product/Offer uses current effective price
- [ ] View/content/add-to-cart/checkout commerce event values use authoritative effective price
- [ ] Purchase uses immutable final order snapshot
- [ ] GTM/TikTok/Meta integrations consume central quote/snapshot and do not reimplement promotion math
- [ ] Tracking script is not required for SEO-visible content/price
- [ ] Existing indexing policy unchanged
- [ ] Focused SEO/analytics tests green

## G2 — Observability + activation/readiness/rollback

- [ ] Structured event: activation rejected
- [ ] Structured event: variant invalidated/recovered
- [ ] Structured event: PARTIALLY_INVALID/recovered
- [ ] Structured event: runtime conflict/recovered
- [ ] Structured event: checkout PRICE_CHANGED
- [ ] Structured event: promotion-aware Pancake rejection
- [ ] No PII/secrets in diagnostics
- [ ] Price-readiness audit runnable/documented
- [ ] Activation gate default-safe behavior tested
- [ ] Rollback disables new activation first
- [ ] Rollback disables active campaigns through reviewed admin path
- [ ] Rollback never rewrites finalized order history
- [ ] Gate cannot be enabled before audit + Pancake semantic evidence + G1 accepted

## G3 — Browser/a11y + final Definition of Done

- [ ] Admin mobile/keyboard/Axe proof
- [ ] Storefront card/PDP/Flash Sale mobile/keyboard/Axe proof
- [ ] Browser proof for P9a rendered-quote price change
- [ ] Browser proof for P9b fresh-Pancake/DRAFT price change where testable with controlled fixture
- [ ] Browser proof for scheduled→active / active→ended refresh
- [ ] Browser proof for off-page `/shop` transition changing current page membership/order
- [ ] Browser proof for empty Flash Sale → first sale start
- [ ] Browser proof for wall-clock skew immunity
- [ ] Browser proof for hidden-tab/pageshow resume after elapsed boundary
- [ ] Visible promotional display staleness ≤60s

### Full repository verification

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
- [ ] CI green on exact implementation head
- [ ] Catalog indexation runtime green
- [ ] P18 final QA runtime green
- [ ] Price-readiness audit evidence accepted
- [ ] Pancake semantic evidence accepted
- [ ] Final correctness review
- [ ] Final security review
- [ ] Final architecture review
- [ ] Final simplicity review
- [ ] Final performance review
- [ ] 0 Critical
- [ ] 0 Required
- [ ] Explicit human decision recorded before enabling activation gate

## Implementation PR sequence

- [ ] A1 persistence
- [ ] A2 pricing domain
- [ ] B1 repository/lifecycle
- [ ] B2 concurrency/admin + activation gate
- [ ] C admin UX/product linkage
- [ ] D1 PDP/projection
- [ ] D2 discovery/cards
- [ ] D3 Flash Sale/boundary refresh
- [ ] E1 cart/rendered checkout quote/DRAFT
- [ ] E2a rendered-quote reconfirmation
- [ ] E2b fresh-Pancake reconfirmation
- [ ] F Pancake submission
- [ ] G1 SEO/analytics
- [ ] G2 ops/readiness
- [ ] G3 final QA

Each implementation PR:
- [ ] starts from latest reviewed `main` for that slice
- [ ] re-reads directly affected ownership before coding
- [ ] includes tests proving its behavior
- [ ] avoids unrelated refactor
- [ ] is split before implementation if it crosses independent subsystems
- [ ] is independently reviewable/revertable
- [ ] gets correctness/security review before merge
- [ ] may land dormant while activation gate remains off

## Launch gate

- [ ] P1–P10 converged
- [ ] G1 converged against current analytics ownership
- [ ] G2 rollout/rollback readiness accepted
- [ ] G3 full DoD green
- [ ] Mirrored-price audit accepted
- [ ] Pancake discounted-price semantic acceptance accepted
- [ ] Human explicitly enables server activation gate
