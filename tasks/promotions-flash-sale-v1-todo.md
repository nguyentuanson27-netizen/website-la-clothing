# Promotions & Flash Sale v1 — execution checklist

Status: **PLANNED / NOT IMPLEMENTED**

Source of truth:
- `docs/specs/promotions-flash-sale-v1.md`
- `tasks/promotions-flash-sale-v1-plan.md`

Planning base: `main@8eb4925de729827292c3d5a344ddfe78d4a5f96d` after PR #152 merge. This branch has been refreshed to include that merge. Refresh from latest reviewed `main` before every implementation slice.

## Planning/review gate
- [x] Pricing ownership/product contract consolidated
- [x] Pancake three raw-live-price submission assumptions identified
- [x] Percentage runtime fallback unified at affected-variant granularity
- [x] Product FIXED_PRICE activation-all-valid vs later partial runtime fallback locked
- [x] Positive safe-integer website money boundary + mirror Float preservation locked
- [x] Exact BigInt percentage arithmetic locked
- [x] SQL numeric-before-arithmetic + exact-half/upper-safe parity locked
- [x] Shared `/shop` + `/flash-sale` SQL projection locked
- [x] Query-wide relative 60s freshness + resume guard locked
- [x] Same-campaign + cross-campaign concurrency model locked
- [x] Activation kill switch locked
- [x] Legal re-enable clears `disabledAt`
- [x] Explicit input/admin/expansion bounds locked
- [x] Latest review: Disable removed from expansion-gated path
- [x] Latest review: Copy removed from expansion-gated path
- [x] Latest review: deterministic Copy naming at 120-code-unit boundary
- [x] Latest review: `/flash-sale` page + offset bounds reuse storefront contract
- [x] PR #152 W3 Pancake catalog evidence dependency absorbed
- [x] PR #152 W4 structured-data fail-closed/no-AggregateOffer constraint absorbed
- [x] PR #152 W15 SEO test-coverage inventory requirement absorbed
- [x] Branch refreshed with merged PR #152 / current planning base
- [ ] Fresh review on latest head: 0 Critical / 0 Required
- [ ] Exact-head CI green
- [ ] Human approves PR #151

## Shared constants/contract
- [ ] `MAX_CAMPAIGN_NAME_LENGTH = 120`
- [ ] `COPY_NAME_SUFFIX = " - Bản sao"`
- [ ] `MAX_TARGETS_PER_CAMPAIGN = 200`
- [ ] `MAX_PROMOTION_IDENTIFIER_LENGTH = 128`
- [ ] `MAX_ADMIN_PROMOTION_PAGE_SIZE = 50`
- [ ] `ADMIN_TARGET_SEARCH_LIMIT = 50`
- [ ] public page-size max reuses 48
- [ ] public page parser reuses `STOREFRONT_DISCOVERY_LIMITS.page = 10_000`
- [ ] repository offset guard preserves `MAX_STOREFRONT_OFFSET = 50_000`
- [ ] `MAX_EXPANDED_VARIANTS_PER_CAMPAIGN = 2000` applies only to publish/re-enable/Scheduled material edit coverage validation

## P1 — persistence + migration
- [ ] Add campaign kind/discount/target/publish-state enums
- [ ] Add PromotionCampaign persistence
- [ ] Add PromotionTarget persistence
- [ ] DB guard exact PRODUCT/VARIANT target shape
- [ ] Prevent duplicate explicit target identity
- [ ] Prevent PRODUCT + own variant duplicate coverage in one campaign
- [ ] Website-owned VND fields integer/BigInt
- [ ] Keep `pancakeRetailPrice` / `pancakeRetailPriceAfterDiscount` Float?
- [ ] Add OrderLineSnapshot base-price audit field
- [ ] Add nullable promotion ID/name/kind/type/value snapshots
- [ ] Historical orders remain readable
- [ ] No campaign delete
- [ ] Prisma validate/generate/migration RED→GREEN

## P2 — pricing domain + catalog/readiness evidence
- [ ] Pure resolver with explicit `now`
- [ ] Base requires positive `Number.isSafeInteger`
- [ ] Unusable base = `BASE_PRICE_UNAVAILABLE`
- [ ] Percentage 1..99 only
- [ ] Percentage uses exact BigInt rational formula
- [ ] Convert BigInt result to number only after safe-integer assertion
- [ ] Fixed price means final customer price
- [ ] Fixed requires `0 < fixed < base`
- [ ] Invalid promotion falls back affected variant only
- [ ] >1 applicable campaign candidate = conflict/no promotion
- [ ] Quote includes base/effective/promotion metadata/reason/transition
- [ ] Exact-half domain 150@1%→149
- [ ] Exact-half domain 350@1%→347
- [ ] Exact-half domain 110@5%→105
- [ ] Upper-safe 9007199254740989@1%→8917127262193579
- [ ] Low-price 50@1%→50 => promotion invalid, base still usable
- [ ] Read-only base-money audit: null/zero/negative/fractional/nonfinite/unsafe
- [ ] Run `pnpm pancake:catalog:audit` in approved real-catalog context
- [ ] Record sanitized retail vs after-discount mismatch counts/examples
- [ ] Document verified Pancake field semantics/evidence
- [ ] If evidence materially contradicts website-owned pricing assumption, stop for product review

## P3 — repository/lifecycle/runtime health
- [ ] Deterministic Draft/Scheduled/Active/Ended/Disabled with explicit now
- [ ] Zero-traffic active window still terminal when ended
- [ ] Disabled-before-Active editable/re-enableable
- [ ] Re-enable atomically fresh `enabledAt` + enabled state + `disabledAt=null`
- [ ] Disabled-after-Active terminal
- [ ] Ended terminal
- [ ] Dynamic PRODUCT coverage
- [ ] New/restored/re-associated variants join PRODUCT target
- [ ] Batch direct VARIANT + owning PRODUCT lookup
- [ ] PARTIALLY_INVALID affected-variant health
- [ ] Runtime overlap fail-closed and recovery
- [ ] Draft expansion probe max 2001 rows
- [ ] Draft >2000 reports typed health without loading all variants
- [ ] Runtime >2000 expansion is not itself pricing/lifecycle invalidity

### Copy behavior
- [ ] Copy every lifecycle state → new Draft
- [ ] Copy snapshots source campaign + explicit targets only
- [ ] Copy does not expand PRODUCT coverage
- [ ] Source dynamic expansion >2000 still Copy succeeds
- [ ] Copy does not inherit lifecycle/order/history/source identity
- [ ] `buildPromotionCopyName` reserves exact suffix inside 120 code units
- [ ] Truncation does not split UTF-16 surrogate pair
- [ ] Retained prefix `trimEnd()` before suffix
- [ ] Name 119 code units Copy succeeds <=120
- [ ] Name 120 code units Copy succeeds <=120
- [ ] Surrogate-boundary Copy test
- [ ] Copy-of-Copy deterministic test

## P4 — admin domain/concurrency + activation gate
- [ ] ADMIN authz on every mutation
- [ ] Syntactic names/IDs/explicit arrays bounded before transaction/persistence
- [ ] Draft may remain business-invalid but syntactically bounded
- [ ] Activation gate default false in production-like config
- [ ] Gate-off publish/re-enable → typed `ACTIVATION_DISABLED`
- [ ] Gate-off Draft/read/health/Copy remains available

### Coverage-validating mutation path only: publish/re-enable/Scheduled material edit
- [ ] Campaign row lock first when existing
- [ ] Owning product rows deterministic lock order
- [ ] Bounded expansion probe 2001 while product locks held
- [ ] 2001 => typed `TARGET_EXPANSION_LIMIT_EXCEEDED` before variant lock set
- [ ] <=2000 required variants deterministic lock order
- [ ] Re-read lifecycle/base/targets/overlap under lock
- [ ] Full activation validation
- [ ] `[start,end)` exact handoff allowed
- [ ] Same-campaign concurrent edit cannot lost-update
- [ ] Concurrent overlapping publish: at most one succeeds
- [ ] Failed mutation preserves previous effective definition

### Disable/end-early path
- [ ] Authz + bounded identifier
- [ ] Lock campaign row
- [ ] Validate legal transition
- [ ] Write Disabled/`disabledAt` atomically
- [ ] No PRODUCT expansion probe
- [ ] No full variant lock set
- [ ] Regression: campaign enabled at 1900 → sync to 2001 → Disable still succeeds
- [ ] Rollback path uses this bounded Disable

### Bound tests
- [ ] Name 120/121
- [ ] Explicit targets 200/201
- [ ] Browser ID 128/129
- [ ] Expansion 2000/2001 for coverage-validating mutations

## Checkpoint A
- [ ] P1–P4 focused tests green
- [ ] Migration clean
- [ ] Repeated concurrency tests stable
- [ ] Gate default-safe
- [ ] Disable >2000 rollback regression green
- [ ] Copy >2000 regression green
- [ ] All bound tests green
- [ ] No N+1 in campaign lookup
- [ ] 0 Critical / 0 Required

## P5 — admin UX
- [ ] `/admin/promotions` protected
- [ ] Campaign list/search max 50 per request
- [ ] Target search max 50 per request
- [ ] Create Draft
- [ ] Edit lifecycle-allowed campaign
- [ ] Publish/re-enable delegates to P4
- [ ] Gate-off feedback explicit
- [ ] Disable/end early delegates to bounded Disable path
- [ ] Copy delegates to P3 copy helper/path
- [ ] Terminal campaigns read-only except Copy
- [ ] Typed errors: overlap/base/discount/time/bounds/expansion/activation-disabled
- [ ] Product admin shows current/upcoming summary + link only
- [ ] No promotion arithmetic in React/actions
- [ ] Non-admin mutation rejected
- [ ] Keyboard/Axe/mobile/overflow proof

## P6 — PDP/composite + pricing ownership transition
### Precondition
- [ ] P2 `pancake:catalog:audit` evidence reviewed
- [ ] PR #152 W3 consequence explicitly accepted under current product decision

### Behavior
- [ ] Remove `retailPrice === retailPriceAfterDiscount` gate as website price authority only after evidence review
- [ ] `pancakeRetailPriceAfterDiscount` mismatch alone no longer makes price unresolved
- [ ] Website may intentionally use higher base than Pancake after-discount per approved decision
- [ ] Unusable base non-purchasable
- [ ] Selected variant central quote
- [ ] Base strike-through/effective price/badge/countdown
- [ ] Variant selection updates exact quote
- [ ] Composite uses real VariantMirror + owning product
- [ ] Parent PRODUCT campaign cannot bleed to child-owned component
- [ ] No per-option DB query
- [ ] Relative refresh delay <=60s + resume guard

## P7a — `/shop` cards/discovery/shared SQL
- [ ] Representative promoted variant = lowest effective price, stable tie
- [ ] `Từ` only if sale representative is actual product minimum
- [ ] `Sale từ` when cheaper unpromoted variant exists
- [ ] One `requestNow` for count/ordered IDs/projection/hydration/card
- [ ] SQL campaign eligibility uses bound requestNow
- [ ] Base validated then cast `numeric` before percentage arithmetic
- [ ] No ROUND on double-precision promotion expression
- [ ] SQL result matches BigInt TS contract
- [ ] min/max/price-asc/price-desc use effective price before pagination
- [ ] color/size/availability same candidate set
- [ ] Conflict/invalid fallback matches TS
- [ ] SQL↔TS no-promo/%/fixed/invalid/conflict/time parity
- [ ] SQL↔TS 150@1%→149
- [ ] SQL↔TS 350@1%→347
- [ ] SQL↔TS 110@5%→105
- [ ] SQL↔TS upper-safe fixture
- [ ] Query-wide earliest transition includes off-page candidates able to change membership/order
- [ ] Page size <=48
- [ ] Page parser <=10,000
- [ ] Repository offset <=50,000

## P7b — `/flash-sale` + pagination/freshness
- [ ] Active valid Flash Sale variants only
- [ ] Same P7a SQL pricing/membership projection before pagination
- [ ] No second Flash-specific pricing predicate
- [ ] Exclude regular-only/Scheduled/Ended/Disabled/invalid/conflicted
- [ ] One requestNow per render
- [ ] Representative only among active Flash variants

### Pagination/window
- [ ] Reuse/storefront-share page parser guard <=10,000
- [ ] Page size <=48
- [ ] Reuse/storefront-share offset guard <=50,000
- [ ] 48-item page 1042 offset 49,968 accepted
- [ ] 48-item page 1043 offset 50,016 rejected before expensive query
- [ ] Oversized page never reaches unbounded SQL

### Freshness
- [ ] Upcoming enabled Flash boundary included even when active membership empty
- [ ] Query-wide transition aggregate bounded/index-friendly
- [ ] Server emits relative `refreshAfterMs <= 60_000`
- [ ] No known transition => 60,000ms fallback
- [ ] Client does not use browser wall-clock subtraction
- [ ] `visibilitychange` visible refresh if delay elapsed
- [ ] `pageshow` refresh if delay elapsed
- [ ] Each refresh gets new server delay
- [ ] No persistent promotion price cache
- [ ] scheduled→active browser proof
- [ ] active→ended browser proof
- [ ] empty Flash → first sale browser proof
- [ ] off-page `/shop` promotion changes current page browser proof
- [ ] clock-skew proof
- [ ] background-tab resume proof

## Checkpoint B
- [ ] PDP/card/discovery agree for same variant/requestNow
- [ ] Composite ownership green
- [ ] SQL↔TS parity green including exact-half + upper-safe
- [ ] `/shop` + `/flash-sale` one SQL projection
- [ ] Page/offset boundary tests green
- [ ] Query-wide freshness tests green
- [ ] No N+1
- [ ] 0 Critical / 0 Required

## P8 — cart/rendered quote/mutable DRAFT
- [ ] Cart reconstructs current effective quote
- [ ] Cart never locks expired promotion price
- [ ] Invalid promo fallback/base unavailable behavior consistent
- [ ] Checkout render emits server-derived bounded expectedQuote
- [ ] Expected quote only contains IDs/qty/prices/subtotal/shipping/total needed for acknowledgement
- [ ] Browser expected quote never calculates authoritative price
- [ ] Matching quote may create DRAFT
- [ ] DRAFT stores base/final/promotion audit snapshot
- [ ] DRAFT shipping/totals effective values
- [ ] Historical non-promo orders readable
- [ ] Activation gate remains off while downstream convergence incomplete

## P9a — rendered quote → initial DRAFT
- [ ] Recompute current quote before DRAFT
- [ ] Mismatch → `PRICE_CHANGED` + refreshed totals
- [ ] No submit-capable stale DRAFT
- [ ] No Pancake write
- [ ] Explicit buyer resubmit
- [ ] Manipulated browser quote cannot lower server price
- [ ] Buyer saw 400k → expiry → first click 500k/no POS write → second confirmation may proceed

## P9b — DRAFT → fresh Pancake
- [ ] Fresh catalog base enters central resolver
- [ ] Mismatch atomically refreshes DRAFT
- [ ] Return `PRICE_CHANGED`
- [ ] Stay out of `POS_SUBMITTING`
- [ ] Explicit buyer resubmit
- [ ] Repeated drift repeats reconfirmation without infinite mirror/live loop
- [ ] Concurrent submit remains one-shot safe
- [ ] SYNC_UNKNOWN/PROCESSING semantics unchanged

## P10 — Pancake final submission
- [ ] Fresh catalog validates variation identity/stock
- [ ] Price comparison uses fresh effective quote, not raw base
- [ ] Subtotal uses final/effective lines
- [ ] Shipping uses effective subtotal
- [ ] Total uses final/effective values
- [ ] Request line uses finalized OrderLineSnapshot.unitPriceVnd
- [ ] `variation_info.retail_price` receives final customer price
- [ ] Promoted order not rejected merely because final != raw base
- [ ] No blind retry
- [ ] Ambiguous create remains SYNC_UNKNOWN
- [ ] Independent regression: comparison path
- [ ] Independent regression: totals path
- [ ] Independent regression: request mapping path

### Controlled semantic acceptance
- [ ] Explicitly authorized safe/test Pancake context
- [ ] One line price intentionally differs from catalog base
- [ ] Pancake accepts it
- [ ] Pancake preserves it without silent reprice
- [ ] Cleanup/cancel if safely supported
- [ ] Sanitized evidence recorded
- [ ] Never recurring CI write
- [ ] If unavailable/fails, activation gate stays off

## G1 — SEO + commerce analytics
### Refresh ownership
- [ ] Refresh latest `main`
- [ ] Re-read PR #152 audit W3/W4/W15
- [ ] Rediscover analytics ownership after GTM/TikTok work

### Structured data
- [ ] Current valid Offer uses authoritative effective price
- [ ] If variant price cannot be truthfully represented by current URL/identity/canonical contract, Offer stays fail-closed/omitted
- [ ] Do not introduce AggregateOffer for product variants
- [ ] Do not pull ProductGroup/deep-link/preselection work into promotion scope without separate spec
- [ ] Existing indexing policy unchanged
- [ ] Tracking script not required for SEO-visible price/content

### Analytics
- [ ] View/add-to-cart/checkout values consume effective quote
- [ ] Purchase consumes immutable final snapshot
- [ ] GTM/TikTok/Meta do not reimplement promotion math

### Verification ownership
- [ ] Inventory W15 existing domain/runtime/CI coverage before adding SEO tests
- [ ] Add only missing SEO runtime gates

## G2 — observability/readiness/rollback
- [ ] Reason-coded activation rejection
- [ ] Variant invalidated/recovered
- [ ] PARTIALLY_INVALID/recovered
- [ ] Conflict/recovered
- [ ] Checkout PRICE_CHANGED
- [ ] Promotion-aware Pancake rejection
- [ ] No PII/secrets
- [ ] Money audit runnable/documented
- [ ] Pancake catalog W3 evidence runnable/documented
- [ ] Activation gate default-safe tested
- [ ] Rollback first disables new activation
- [ ] Rollback Disable succeeds with PRODUCT >2000
- [ ] Rollback never rewrites final orders

## G3 — browser/a11y/final DoD
- [ ] Admin mobile/keyboard/Axe
- [ ] Card/PDP/Flash mobile/keyboard/Axe
- [ ] P9a buyer-visible PRICE_CHANGED browser proof
- [ ] P9b fresh-Pancake PRICE_CHANGED browser proof where controlled
- [ ] Flash start/end/off-page/empty/resume browser proof
- [ ] Pagination 1042/1043 boundary runtime proof where applicable

### Full repository gates
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
- [ ] exact-head CI green
- [ ] Catalog indexation runtime green
- [ ] P18 final QA runtime green
- [ ] W3 catalog evidence accepted
- [ ] Pancake custom-price semantic evidence accepted
- [ ] final review correctness → security → architecture → simplicity → performance
- [ ] 0 Critical / 0 Required
- [ ] explicit human activation decision recorded

## Implementation sequence
- [ ] A1 persistence
- [ ] A2 pricing/evidence
- [ ] B1 repository/lifecycle
- [ ] B2 concurrency/admin + activation gate
- [ ] C admin UX
- [ ] D1 PDP/composite
- [ ] D2 discovery/cards
- [ ] D3 Flash/pagination/freshness
- [ ] E1 cart/rendered quote/DRAFT
- [ ] E2a rendered quote reconfirmation
- [ ] E2b fresh-Pancake reconfirmation
- [ ] F Pancake submission
- [ ] G1 SEO/analytics
- [ ] G2 ops/readiness
- [ ] G3 final QA

Each implementation PR:
- [ ] starts from latest reviewed main
- [ ] re-reads directly affected ownership
- [ ] includes tests proving behavior
- [ ] avoids unrelated refactor
- [ ] splits independent subsystems before implementation
- [ ] is independently reviewable/revertable
- [ ] receives correctness/security review
- [ ] may land dormant while activation gate remains off

## Launch gate
- [ ] P1–P10 converged
- [ ] G1 current SEO/analytics ownership converged
- [ ] G2 readiness/rollback accepted
- [ ] G3 DoD green
- [ ] Mirrored money audit accepted
- [ ] `pnpm pancake:catalog:audit` W3 evidence accepted
- [ ] Pancake discounted custom-price semantic acceptance accepted
- [ ] Human explicitly enables activation gate