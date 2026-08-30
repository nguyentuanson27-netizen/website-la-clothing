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
- [ ] Human approves revised PR #151 spec + plan
- [ ] Confirm no unresolved Critical/Required review threads

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
- [ ] Integer-safe nearest-VND rounding
- [ ] FIXED_PRICE means final customer price
- [ ] Fixed rule `0 < fixed < base`
- [ ] Invalid promo falls back only affected variant
- [ ] Multiple active candidates fail closed to no promotion
- [ ] Base unavailable is distinct from promotion invalid
- [ ] Quote contains promotion audit metadata
- [ ] Quote contains `nextTransitionAt`
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
- [ ] Bounded query-count test
- [ ] Lifecycle regression: Draft → enable → disable-before-Active → re-enable clears stale disabled timestamp
- [ ] Lifecycle regression: disable-after-Active remains terminal

## P4 — Concurrency-safe admin domain + activation gate

- [ ] Existing ADMIN authorization required
- [ ] Bound name/ID/array/enum/money/time input
- [ ] Draft save may remain invalid/non-effective
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
- [ ] Existing campaign row locked first for mutation
- [ ] Owning products locked in deterministic ID order
- [ ] Required variants locked in deterministic ID order
- [ ] Same-campaign concurrent edit cannot lost-update
- [ ] Concurrent conflicting publish: at most one commits
- [ ] Failed mutation leaves previous enabled definition unchanged
- [ ] Runtime catalog drift handled by resolver, not sync auto-disable

## Checkpoint A — Domain/persistence

- [ ] P1–P4 focused tests green
- [ ] Migration clean on test DB
- [ ] Concurrency tests stable across repeated runs
- [ ] Activation disabled by default in production-like fixture
- [ ] No framework/UI dependency in pricing resolver
- [ ] No N+1 in campaign lookup
- [ ] 0 Critical
- [ ] 0 Required

## P5 — Admin promotions UX

- [ ] `/admin/promotions` protected
- [ ] List name/kind/discount/time/targets/status/health
- [ ] Create Draft
- [ ] Edit lifecycle-allowed campaign
- [ ] Bounded multi PRODUCT/VARIANT target search/selection
- [ ] Publish/re-enable action delegates to P4
- [ ] Gate-off Publish/Re-enable gives explicit readiness-disabled feedback
- [ ] Disable/end-early action
- [ ] Copy → Draft
- [ ] Terminal campaign read-only except Copy
- [ ] Target-specific typed validation messages
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
- [ ] Price min/max use current effective price
- [ ] `price-asc` / `price-desc` use current effective price
- [ ] Color/size/availability constrain same candidate set
- [ ] Conflict/invalid SQL fallback matches TS resolver
- [ ] SQL↔TS parity tests: no-promo/%/fixed/invalid/conflict/time boundaries
- [ ] Exact-half parity fixture: `base=150,pct=1 → 149`
- [ ] Exact-half parity fixture: `base=350,pct=1 → 347`
- [ ] Exact-half parity fixture: `base=110,pct=5 → 105`
- [ ] Projection contract is reused by P7b `/flash-sale` membership rather than forked
- [ ] Boundary test proves multi-query request stays internally consistent across transition
- [ ] Pagination/count bounded/stable

## P7b — `/flash-sale` + boundary freshness

- [ ] Add `/flash-sale`
- [ ] Paginate/bound query
- [ ] Active valid Flash Sale variants only
- [ ] Membership before pagination uses same sanctioned P7a SQL pricing/membership projection
- [ ] No second Flash Sale-specific promotion eligibility formula/predicate
- [ ] Exclude regular-only/Scheduled/Ended/Disabled/invalid/conflicted
- [ ] One server `requestNow` per route render
- [ ] Representative uses Flash Sale variants only
- [ ] Project earliest relevant `nextTransitionAt`
- [ ] Add client promotion-boundary refresher
- [ ] Refresher schedules from server timestamp only
- [ ] `router.refresh()` at start/end boundary
- [ ] No persistent promotion price cache
- [ ] DB membership parity against central resolver
- [ ] Bounded query-count proof
- [ ] Browser scheduled→active proof
- [ ] Browser active→ended proof
- [ ] Countdown never authorizes transaction price

## Checkpoint B — Storefront

- [ ] PDP/card/discovery agree for same variant/requestNow
- [ ] Composite ownership regression green
- [ ] SQL↔TS parity green, including exact-half fixtures
- [ ] `/shop` and `/flash-sale` use one sanctioned SQL promotion projection contract
- [ ] Flash Sale boundary tests green
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
