# Promotions & Flash Sale v1 — execution checklist

Status: **PLANNED / NOT IMPLEMENTED**

Source of truth:
- `docs/specs/promotions-flash-sale-v1.md`
- `tasks/promotions-flash-sale-v1-plan.md`

PR #151 is planning/spec only. Production implementation starts from then-current `main` after review/approval.

## Planning/self-review gate

- [x] Re-read approved promotion/flash-sale spec after latest review fixes
- [x] Re-check current Prisma Product/Variant/Order persistence
- [x] Re-check current storefront price resolver/equality gate
- [x] Re-check `/shop` price filter/sort SQL before pagination
- [x] Re-check composite parent PDP can project variants owned by another product
- [x] Re-check DRAFT checkout snapshot architecture
- [x] Re-check current Pancake live-price comparison/totals/request mapping
- [x] Verify current Next.js 16.2 `router.refresh()` semantics from official App Router docs
- [x] Self-review result: 0 Critical
- [x] Lock R1: discovery price filter/sort uses effective price
- [x] Lock R2: composite pricing follows actual variant/owning product
- [ ] Human approves PR #151 spec + plan
- [ ] Confirm no unresolved Critical/Required review threads before implementation
- [ ] Refresh implementation start SHA from current `main`

## P1 — Persistence + migration

- [ ] Add campaign kind/discount/target/publish-state enums
- [ ] Add website-owned PromotionCampaign persistence
- [ ] Add PromotionTarget persistence
- [ ] DB-check target row exactly matches PRODUCT or VARIANT shape
- [ ] Prevent duplicate identical campaign target
- [ ] Keep Pancake mirror prices as `Float?`
- [ ] Add OrderLineSnapshot `baseUnitPriceVnd`
- [ ] Add nullable promotion ID/name/kind/type/value audit snapshots
- [ ] Keep historical orders/money backward compatible
- [ ] No campaign delete action
- [ ] Migration RED/GREEN tests
- [ ] Prisma validate/generate/migrate deploy

## P2 — Central pricing domain

- [ ] Add typed campaign/target/lifecycle domain
- [ ] Add pure central effective-price resolver
- [ ] Explicit `now`
- [ ] Base price must be positive safe-integer VND at authority boundary
- [ ] Percentage integer `1..99`
- [ ] Integer-safe nearest-VND rounding
- [ ] Fixed price means final customer price
- [ ] Fixed validation `0 < fixed < base`
- [ ] Invalid promotion falls back only affected variant
- [ ] Multiple active candidates fail closed to no promotion
- [ ] Base unavailable is distinct from promotion invalid
- [ ] Include promotion audit metadata in quote
- [ ] Include `nextTransitionAt`
- [ ] Add read-only mirrored price readiness audit
- [ ] Domain RED/GREEN edge tests

## P3 — Campaign repository/lifecycle/runtime health

- [ ] Persist/read Draft/Enabled/Disabled intent
- [ ] Derive Draft/Scheduled/Active/Ended/Disabled with explicit `now`
- [ ] Effective start uses `max(enabledAt, startsAt ?? enabledAt)`
- [ ] Zero-traffic scheduled window still derives terminal Ended correctly
- [ ] Disabled-before-Active remains editable/re-enableable
- [ ] Disabled-after-Active is terminal
- [ ] Ended is terminal
- [ ] Copy any state → new Draft
- [ ] Product targets dynamically expand current variants
- [ ] Restored/new variant automatically joins product target
- [ ] Batch direct VARIANT + owning PRODUCT target lookup
- [ ] PARTIALLY_INVALID health at affected-variant granularity
- [ ] Runtime conflict returns no promotion
- [ ] Runtime recovery applies automatically
- [ ] Repository query-count/bounded lookup tests

## P4 — Publish/overlap/admin domain

- [ ] Require current ADMIN authorization
- [ ] Bound name/id/target arrays/money/time inputs
- [ ] Draft save may remain invalid and non-effective
- [ ] Publish/re-enable full current-target validation
- [ ] Scheduled edit full validation
- [ ] Active pricing/target/time mutation rejected
- [ ] Fully expired interval cannot be newly enabled
- [ ] Reject PRODUCT + own covered VARIANT duplicate coverage in same campaign
- [ ] PRODUCT↔PRODUCT overlap
- [ ] PRODUCT↔VARIANT overlap
- [ ] VARIANT↔VARIANT overlap
- [ ] `[start,end)` exact boundary allows handoff
- [ ] Deterministically lock owning products/affected variants in transaction
- [ ] Concurrent conflicting publish: at most one commits
- [ ] Failed mutation leaves old enabled definition unchanged
- [ ] Runtime catalog drift handled by resolver, not sync auto-disable

## Checkpoint A — Domain/persistence

- [ ] P1–P4 focused tests green
- [ ] Migration clean on test DB
- [ ] Concurrency test stable across repeated runs
- [ ] No framework/UI dependency inside pricing resolver
- [ ] No N+1 in batch campaign lookup
- [ ] 0 Critical review findings
- [ ] 0 Required review findings

## P5 — Admin promotions UX

- [ ] `/admin/promotions` protected
- [ ] List campaign name/kind/discount/time/targets/status/health
- [ ] Create Draft
- [ ] Edit lifecycle-allowed campaign
- [ ] Multi PRODUCT/VARIANT target selection
- [ ] Bounded target search/selection
- [ ] Publish/re-enable action
- [ ] Disable/end-early action
- [ ] Copy → Draft action
- [ ] Terminal campaign read-only except Copy
- [ ] Target-specific typed validation messages
- [ ] Server actions delegate to admin domain; no pricing logic in React
- [ ] Revalidate affected admin/storefront paths after mutation
- [ ] Product admin page shows current/upcoming related campaigns + link
- [ ] Product admin page is not a duplicate promotion editor
- [ ] Admin keyboard/Axe/mobile/overflow proof
- [ ] Forged/non-admin mutation rejected

## P6 — PDP/variant/composite quote projection

- [ ] Remove Pancake after-discount equality gate as website price authority
- [ ] Unusable base marks option non-purchasable
- [ ] Standalone selected variant uses central quote
- [ ] PDP strike-through + sale price + badge
- [ ] Flash Sale badge + countdown metadata
- [ ] Selection change updates exact quote
- [ ] Non-promoted selection returns base/no sale UI
- [ ] Composite component lookup uses actual selected VariantMirror ID
- [ ] Composite component promotion PRODUCT scope uses component owning product
- [ ] Parent PRODUCT promotion does not bleed onto separately owned child component
- [ ] No per-option DB query
- [ ] Existing composite mapping/availability tests remain green

## P7a — Cards + discovery effective-price SQL projection

- [ ] Card sale state if at least one purchasable promoted variant
- [ ] Representative variant = lowest active effective promo price
- [ ] Tie deterministic
- [ ] Strike base price from same representative variant
- [ ] `Từ` only when sale price is true product minimum
- [ ] `Sale từ` when cheaper unpromoted variant exists
- [ ] Replace old discovery price CTE with safe-integer effective-price projection
- [ ] Price min/max use current effective price
- [ ] `price-asc` / `price-desc` use current effective price
- [ ] Color/size/availability filters constrain same candidate set
- [ ] Conflict/invalid promo SQL fallback matches TS resolver
- [ ] SQL projection parity tests for no-promo/%/fixed/invalid/conflict/time edges
- [ ] Pagination/count remain bounded/stable

## P7b — `/flash-sale` + boundary freshness

- [ ] Add `/flash-sale`
- [ ] Paginate/bound query
- [ ] Active valid Flash Sale variants only
- [ ] Exclude regular-only/Scheduled/Ended/Disabled/invalid/conflicted
- [ ] Representative selection on route uses Flash Sale variants only
- [ ] Project earliest relevant `nextTransitionAt`
- [ ] Add client promotion-boundary refresher
- [ ] Refresher uses server-provided transition only
- [ ] `router.refresh()` on start/end boundary
- [ ] No new persistent price cache
- [ ] Existing `/shop` and PDP dynamic request behavior preserved
- [ ] Browser scheduled→active proof
- [ ] Browser active→ended proof
- [ ] Countdown cannot authorize transaction price

## Checkpoint B — Storefront

- [ ] PDP/card/discovery agree for same variant/time
- [ ] Composite ownership regression green
- [ ] SQL↔TS parity green
- [ ] Flash Sale route/boundary tests green
- [ ] No N+1
- [ ] 0 Critical review findings
- [ ] 0 Required review findings

## P8 — Cart + mutable DRAFT audit snapshot

- [ ] Cart reconstructs current effective price
- [ ] Cart never locks expired promotion price
- [ ] Composite cart line uses same real-variant ownership semantics
- [ ] Invalid promo falls back to base
- [ ] Unusable base blocks purchase
- [ ] Initial DRAFT saves baseUnitPriceVnd
- [ ] Initial DRAFT saves final unitPriceVnd/lineTotalVnd
- [ ] Initial DRAFT saves campaign ID/name/kind/type/value snapshots
- [ ] Non-promo line promotion snapshots null
- [ ] Shipping subtotal uses effective final line prices
- [ ] Browser price never becomes authority
- [ ] Existing historical order compatibility green

## P9 — PRICE_CHANGED reconfirmation

- [ ] Fresh Pancake base fact enters central effective resolver
- [ ] Quote mismatch returns typed `PRICE_CHANGED`
- [ ] No stale attempt enters `POS_SUBMITTING`
- [ ] No Pancake create-order on stale attempt
- [ ] Atomically refresh mutable DRAFT line/audit/totals with fresh quote
- [ ] Return refreshed totals/lines to browser
- [ ] UI shows explicit price-change warning
- [ ] Buyer must submit again
- [ ] Unchanged second submit may proceed
- [ ] Another price change requires another confirmation
- [ ] No infinite stale-mirror/live-price loop
- [ ] Concurrent submit guards remain one-shot safe
- [ ] SYNC_UNKNOWN semantics unchanged

## P10 — Pancake final submission convergence

- [ ] Fresh catalog still validates variation identity
- [ ] Fresh catalog still validates stock
- [ ] Price comparison is effective quote vs DRAFT/final snapshot, not raw base
- [ ] Subtotal validation uses final effective line values
- [ ] Shipping validation uses effective subtotal
- [ ] Total validation uses final effective values
- [ ] Request line price uses finalized OrderLineSnapshot.unitPriceVnd
- [ ] `variation_info.retail_price` receives final customer price
- [ ] Promoted order does not reject only because final != raw base
- [ ] No blind retry added
- [ ] Ambiguous create stays SYNC_UNKNOWN
- [ ] Three independent regression tests for comparison/totals/request mapping

### Controlled Pancake semantic acceptance

- [ ] Run only in explicitly authorized testable context
- [ ] Never run as recurring CI write
- [ ] Use safe/test shop + known variation
- [ ] Submit line price intentionally different from catalog base
- [ ] Verify Pancake accepts it
- [ ] Verify Pancake preserves it without silent reprice
- [ ] Clean up/cancel test order when safely supported
- [ ] Record sanitized evidence
- [ ] If unavailable/fails, production discounted campaign activation remains blocked

## P11 — Analytics/SEO/ops/final DoD

- [ ] Structured Offer uses current effective price
- [ ] ViewContent uses effective price
- [ ] AddToCart uses effective price
- [ ] InitiateCheckout uses effective price
- [ ] Purchase uses immutable final order snapshot
- [ ] Promotion history remains immutable after campaign changes
- [ ] Structured event: activation rejected
- [ ] Structured event: variant invalidated/recovered
- [ ] Structured event: target PARTIALLY_INVALID/recovered
- [ ] Structured event: runtime conflict/recovered
- [ ] Structured event: checkout PRICE_CHANGED
- [ ] Structured event: promotion-aware Pancake rejection
- [ ] No PII/secrets in promotion diagnostics
- [ ] Run/read price readiness audit
- [ ] Rollback steps reviewed
- [ ] No production campaign enabled before readiness gates pass

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
- [ ] final correctness review
- [ ] final security review
- [ ] final architecture review
- [ ] final simplicity review
- [ ] final performance review
- [ ] 0 Critical
- [ ] 0 Required

## Implementation PR sequence

- [ ] A1 persistence
- [ ] A2 pricing domain
- [ ] B1 repository/lifecycle
- [ ] B2 concurrency/admin domain
- [ ] C admin UX/product linkage (split C1/C2 before implementation if >5 files)
- [ ] D1 PDP/projection
- [ ] D2 discovery/cards
- [ ] D3 Flash Sale/boundary refresh
- [ ] E1 cart/snapshot
- [ ] E2 price reconfirmation
- [ ] F Pancake submission
- [ ] G convergence/rollout

Each implementation PR:
- [ ] starts from reviewed current main
- [ ] includes the tests proving its behavior
- [ ] avoids unrelated refactor
- [ ] stays ~≤5 files where practical or is split before implementation
- [ ] is independently reviewable/revertable
- [ ] gets human review before merge
