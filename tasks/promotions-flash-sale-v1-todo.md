# Promotions & Flash Sale v1 — execution checklist

Status: **PLANNED / NOT IMPLEMENTED**

Source spec: `docs/specs/promotions-flash-sale-v1.md`

Execution plan: `tasks/promotions-flash-sale-v1-plan.md`

Planning base: `main@323c07cf25c834e36e4a43952df3f0ee7321d756` with PR #152 + PR #153 merged.

PR #153 owns canonical analytics/Merchant identity/cart contracts; PR #152 owns SEO/GEO planning constraints. Promotion consumes them and must not create parallel price, identity, cart or variant-URL authorities.

## P0 — planning reconciliation
- [x] Refresh #151 against `main` containing #152 + #153.
- [x] Sync spec/plan/todo planning baseline to `main@323c07cf...` with #152 + #153 binding.
- [x] Replace deferred GTM/TikTok rediscovery with explicit #153 dependencies; then-current module ownership is re-verified, not redefined ad hoc.
- [x] Product upper-funnel ID = `pancakeProductId`.
- [x] Selected/committed variant ID = `pancakeVariationId`.
- [x] `VariantMirror.id` remains internal-only.
- [x] Purchase transaction/event ID = `OrderMirror.publicCode`.
- [x] Shared cart API and #153 M2 variant URL ownership are explicit.
- [x] Merchant success cache is promotion-transition-aware and the 300s #153 TTL is maximum normal success TTL when Merchant is enabled.
- [x] Merchant promotion freshness uses one durable non-negative BigInt/equivalent promotion-pricing revision advanced in the same DB transaction as each successful effective mutation; no best-effort post-commit hook is correctness authority.
- [x] Merchant cache decisions have explicit revision-read linearization: a decision reading revision after a mutation commit cannot serve prior-revision bytes; a decision whose read completed before the concurrent commit is ordered before that mutation.
- [x] Stage-1 rendered-quote proof v1 is stateless server-MAC only; no DB nonce/proof rows or unbounded proof state.
- [x] Raw `la_cart` UUID remains HttpOnly/server-only MAC context and is never serialized into the browser-visible proof.
- [x] Promotion activation requires convergence only for currently enabled price-bearing consumers; disabled GTM/Merchant may remain fail-closed/off.
- [ ] Fresh review on latest head: 0 Critical / 0 Required.
- [ ] Exact-head CI green.
- [ ] Human plan approval before `/build`.

## P1 — persistence + additive order audit + durable pricing revision
- [ ] Add campaign/target persistence with DB/server shape and uniqueness guards.
- [ ] Website money uses integer/BigInt VND; Pancake mirrors stay `Float?`.
- [ ] Add base/final/promotion audit fields to `OrderLineSnapshot`.
- [ ] Preserve purchased `pancakeVariationId`, name/options/quantity facts used by #153 Purchase.
- [ ] Add one durable singleton/equivalent server-owned promotion-pricing revision record using non-negative `BigInt`/equivalent monotonic integer semantics; bounded cardinality, monotonic effective-mutation ordering, cheap read for Merchant cache validation.
- [ ] Migration additive; historical rows readable; no campaign delete.

Verification:
- [ ] RED/GREEN DB tests.
- [ ] Prisma validate/generate/migration deploy.
- [ ] Historical compatibility.
- [ ] Revision initialization + transaction lock/increment behavior.

## P2 — central pricing + evidence
- [ ] Pure explicit-`now` resolver is the only semantic pricing authority.
- [ ] Positive safe-integer base boundary.
- [ ] Percentage uses exact BigInt rational arithmetic.
- [ ] Fixed price is final customer unit price and `0 < fixed < base`.
- [ ] Resolver returns base/effective price, promotion snapshot, discounted flag, typed invalid/conflict reason and transition fact.
- [ ] >1 applicable campaign => conflict/no promotion; never arbitrary winner.
- [ ] Affected-variant invalid fallback when base remains usable.
- [ ] Unusable base => non-purchasable.
- [ ] Run mirrored-money audit.
- [ ] Run approved real-catalog `pnpm pancake:catalog:audit` before equality-gate removal.
- [ ] Record sanitized retail vs after-discount mismatch evidence.
- [ ] Materially contradictory evidence => stop for product review.

Mandatory fixtures:
- [ ] `150 @ 1% -> 149`.
- [ ] `350 @ 1% -> 347`.
- [ ] `110 @ 5% -> 105`.
- [ ] `9007199254740989 @ 1% -> 8917127262193579`.
- [ ] low-price invalidation such as `50 @ 1%`.
- [ ] fixed valid/invalid + fresher-base drift/recovery.
- [ ] malformed external values + conflict.

## P3 — repository/lifecycle/runtime health
- [ ] Batch direct VARIANT + actual owning PRODUCT campaign lookup.
- [ ] Composite follows real component variant/owner, not presentation parent.
- [ ] Dynamic PRODUCT coverage; no frozen membership table.
- [ ] Restart/zero-traffic-safe Draft/Scheduled/Active/Ended/Disabled derivation.
- [ ] Legal never-Active re-enable writes fresh `enabledAt` + `disabledAt=null` atomically.
- [ ] Runtime invalid/conflict/recovery per affected variant; healthy siblings continue.
- [ ] Copy snapshots explicit targets only and never expands PRODUCT coverage.
- [ ] Deterministic bounded Copy naming.

Regression:
- [ ] 119/120 code units.
- [ ] trailing-space normalization.
- [ ] surrogate boundary.
- [ ] Copy-of-Copy.
- [ ] >2000 dynamic expansion source still copies to Draft.
- [ ] bounded queries/no N+1.

## P4 — concurrency-safe admin domain + activation gate + atomic revision
- [ ] Admin authz + named input bounds.
- [ ] Coverage-validating write order: campaign lock → owning-product locks → bounded expansion probe → needed variant locks → re-read → atomic commit.
- [ ] 2000 allowed / 2001 rejected for publish/re-enable/Scheduled material edit.
- [ ] Same-campaign lost update prevented.
- [ ] PRODUCT↔PRODUCT / PRODUCT↔VARIANT / VARIANT↔VARIANT overlap race-safe.
- [ ] Disable uses campaign-row bounded path only.
- [ ] 1900 variants at activation → later 2001 → Disable still succeeds.
- [ ] Copy remains non-expanding.
- [ ] Activation gate defaults off; publish/re-enable => `ACTIVATION_DISABLED` while off.
- [ ] Failed writes leave previous definition unchanged.
- [ ] Successful publish/re-enable/Disable/end-early/Scheduled material edit advances the durable promotion-pricing revision **inside the same DB transaction**.
- [ ] All effective mutation paths acquire/update the revision in one deterministic position in the lock order so concurrent campaign mutations cannot deadlock or lose increments.
- [ ] Draft-only edits/Copy do not advance revision solely for Merchant.
- [ ] No `after()`/fire-and-forget/external post-commit signal is required for cache correctness.

Verification:
- [ ] Effective mutation + revision increment commit together.
- [ ] Failed/rolled-back mutation leaves revision unchanged.
- [ ] Draft-only edit/Copy leaves revision unchanged.
- [ ] Concurrent effective mutations do not lose revision increments or deadlock on inconsistent revision lock ordering.
- [ ] Repeated concurrency tests, 2000/2001 expansion, 1900→2001 Disable, gate-off/no-partial-write.

### Checkpoint A
- [ ] P1–P4 focused suites green.
- [ ] Migration clean.
- [ ] Repeated concurrency tests green.
- [ ] Security review: authz/bounds/external-data/no PII or secrets in logs.
- [ ] 0 Critical / 0 Required.

## P5 — admin UX
- [ ] Protected `/admin/promotions`.
- [ ] List/search bounded 50.
- [ ] Lifecycle-valid create/edit/publish/re-enable/disable/copy.
- [ ] Typed invalid/overlap/expansion/activation feedback.
- [ ] Product admin only shows related-campaign summary/link.
- [ ] No price/overlap math in React.
- [ ] Keyboard/Axe/mobile + non-admin rejection.

## #153 T4 identity prerequisite
- [ ] Product/list/PDP upper-funnel facts propagate `pancakeProductId`.
- [ ] Concrete options/cart facts propagate real `pancakeVariationId`.
- [ ] Local variant CUID never becomes vendor item ID.

## P6 — PDP/composite promotion projection
- [ ] Remove equality gate only after P2 evidence acceptance.
- [ ] Selected option uses central quote and retains `pancakeVariationId`.
- [ ] Composite campaign ownership follows real component owner.
- [ ] Sale/Flash UI has no local discount formula.
- [ ] No per-option N+1.
- [ ] Compatible with #153 M2 `/shop/<slug>?variant=<pancakeVariationId>`; no competing promotion URL state.

Verification:
- [ ] standalone/composite owner tests.
- [ ] invalid base and selected exact quote.
- [ ] deep-link compatibility when M2 lands.
- [ ] browser/a11y PDP checks.

## P7a — cards + `/shop`
- [ ] Representative sale variant/wording follows spec.
- [ ] Filter/min/max/price sort use effective price before pagination.
- [ ] One `requestNow` spans count/order/SQL/hydration/card/transition aggregation.
- [ ] SQL casts validated base to `numeric` before percentage arithmetic.
- [ ] SQL target/time/conflict/invalid semantics match TypeScript.
- [ ] Product-level analytics remains product-level; representative variant is not fabricated as selected item.
- [ ] Query-wide transition aggregate includes off-page membership/order changes.

Verification:
- [ ] SQL↔TS parity including P2 fixtures.
- [ ] filter/sort/pagination.
- [ ] off-page transition.
- [ ] page/offset guards.
- [ ] no N+1.

## P7b — `/flash-sale` + freshness
- [ ] Same sanctioned pricing/membership projection; no duplicate Flash formula.
- [ ] Active-valid Flash variants only.
- [ ] page <=10000, size <=48, offset <=50000.
- [ ] page 1042@48 allowed; 1043@48 rejected before expensive query.
- [ ] Empty route knows next enabled Flash boundary.
- [ ] Relative refresh <=60s.
- [ ] Browser wall clock not authority.
- [ ] visibility/pageshow resume guard.

Verification:
- [ ] empty→active.
- [ ] end boundary.
- [ ] clock skew.
- [ ] background resume.
- [ ] pagination/query budget.

### Checkpoint B
- [ ] PDP/cards/shop/Flash share one price authority.
- [ ] #153 identity contract remains green.
- [ ] SQL parity green.
- [ ] Browser freshness/a11y green.
- [ ] 0 Critical / 0 Required.

## Shared #153 T5/T6 cart contract
- [ ] PDP AddToCart is atomic `+1`, never absolute set-to-1.
- [ ] Update/remove return committed transition + bounded authoritative item snapshot.
- [ ] Snapshot includes real `pancakeVariationId` and server-current resolver price.
- [ ] No stale browser fallback.
- [ ] `view_cart` / `begin_checkout` are complete all-or-nothing projections.
- [ ] If #151 reaches this boundary first, implement this API once and make #153 consume it; no duplicate temporary path.

## P8 — DRAFT quote + promotion audit
- [ ] DRAFT stores purchased external variant identity + quantity/name/options + base/final/promotion audit.
- [ ] Checkout render may expose bounded non-PII quote facts for proof issuance, but unsigned/client-editable quote fields never prove buyer acknowledgement.
- [ ] Raw browser quote facts alone cannot create submit-capable DRAFT.
- [ ] DRAFT mutable/retryable until guarded finalization.
- [ ] Final pricing freezes when leaving DRAFT for submission.

Verification:
- [ ] no promo / % / fixed.
- [ ] composite external identity.
- [ ] invalid base.
- [ ] retryable DRAFT replacement.
- [ ] unsigned quote facts alone rejected for submit-capable DRAFT.

## P9a — stateless rendered quote proof -> DRAFT
- [ ] Re-read then-current `anonymous-cart.ts` and `anonymous-cart-cookie.ts`; current baseline is max 50 distinct anonymous-cart lines and raw cart UUID in HttpOnly `la_cart`.
- [ ] Checkout render issues bounded opaque proof bound to current anonymous cart/checkout identity + canonical rendered non-PII quote facts.
- [ ] Proof v1 uses deterministic canonical payload bytes + standard-library server-only HMAC/MAC; **no DB proof rows, nonce table, append-only proof state, or third-party crypto dependency**.
- [ ] Key is server-only and domain-separated from other uses; derive from an existing validated server secret or use a dedicated validated server-only secret after re-reading current config ownership.
- [ ] Raw HttpOnly cart UUID is **server-only MAC context**. Include the server-read cart identity in MAC input/binding but never serialize the raw UUID into browser-visible token bytes or another client-readable field.
- [ ] Proof binds browser-visible variant IDs, quantities, effective unit prices, merchandise subtotal, shipping, total and server issue/version/format fact.
- [ ] `MAX_RENDERED_QUOTE_PROOF_BYTES = 16 * 1024`, sized for current 50-line cart cap; if that cap changes, re-prove token envelope instead of silently unbounding it.
- [ ] max+1 rejected before decode/MAC work.
- [ ] Proof/secret/customer PII/cart UUID is never logged; constant-time MAC comparison where supported.
- [ ] Submit verifies length + format + MAC authenticity + binding to the **current server-read cart identity** before stale comparison, then recomputes current authoritative quote independently.
- [ ] Missing/oversized/malformed/forged/wrong-cart/unverifiable proof => refreshed quote + fresh proof, no submit-capable DRAFT, no `POS_SUBMITTING`, no Pancake create.
- [ ] Verified rendered quote mismatch => typed `PRICE_CHANGED` + refreshed totals + fresh proof.
- [ ] Explicit resubmit required; proof never becomes price authority.

Verification:
- [ ] buyer saw 400k, sale ended, first submit shows 500k/fresh proof/zero POS write, second unchanged submit may continue.
- [ ] client edits hidden/rendered quote to current 500k but stale/forged proof cannot bypass reconfirmation.
- [ ] proof from another cart/checkout fails closed.
- [ ] valid bound proof + unchanged quote succeeds.
- [ ] 16 KiB/max+1 + deterministic canonicalization.
- [ ] decoded/browser-visible token inspection cannot recover the raw HttpOnly cart UUID.
- [ ] checkout render/submit creates zero quote-proof persistence rows/state.

## P9b — DRAFT -> fresh Pancake
- [ ] Fetch fresh trusted Pancake catalog facts.
- [ ] Feed fresh base into central resolver.
- [ ] Compare DRAFT quote to fresh effective website quote, never raw retail.
- [ ] Mismatch atomically refreshes DRAFT line/audit/totals + `PRICE_CHANGED`.
- [ ] No create-order on mismatch.
- [ ] Percentage recalculates; fixed revalidates; repeated drift can reconfirm again.

Verification:
- [ ] % and fixed fresh-base drift.
- [ ] promotion start/end during checkout.
- [ ] invalid/recovery.
- [ ] zero POS write on mismatch.

## P10 — final Pancake convergence
- [ ] Fresh effective quote used for price-change comparison.
- [ ] Authoritative effective/final money used for merchandise/shipping/total integrity.
- [ ] Outbound `variation_info.retail_price` comes from finalized immutable `OrderLineSnapshot.unitPriceVnd`.
- [ ] Fresh stock/identity validation retained.
- [ ] No blind retry; `SYNC_UNKNOWN` retained for ambiguous outcome.
- [ ] Three independent regressions cover comparison/totals/outbound price reverting to raw `livePrice`.
- [ ] Controlled authorized Pancake test proves non-base requested line price accepted/preserved.
- [ ] Sanitized evidence recorded; cleanup if safe.
- [ ] Failed/unavailable semantic acceptance => discounted production activation stays blocked.

## #153 T7 Purchase consumer
- [ ] Only CONFIRMED emits Purchase.
- [ ] Purchase uses immutable finalized order snapshot price/quantity/`pancakeVariationId`.
- [ ] `publicCode` remains transaction/event ID.
- [ ] Tracking never recalculates promotion.

## G1 — enabled-consumer convergence
Analytics/Meta:
- [ ] Current-state/cart events use authoritative effective price.
- [ ] Product price range never masquerades as selected exact price.
- [ ] Purchase uses immutable final snapshot money.
- [ ] GTM only maps/routes; no promotion formula.
- [ ] Existing direct Meta remains direct; if it emits monetary value, value source is promotion-aware.

Merchant:
- [ ] #153 M2 owns standalone deep-link contract.
- [ ] M3 consumes storefront effective price; no Merchant promotion formula.
- [ ] Composite Merchant remains deferred.
- [ ] #153 300s success TTL is maximum normal TTL; effective expiry is `min(300s, nearest relevant known promotion transition)` or equivalent tested invalidation.
- [ ] Success-cache entry stores the durable promotion-pricing revision it was built under.
- [ ] Each cache-hit decision linearizes at one bounded cheap current-revision read. Read after promotion commit => prior-revision bytes invalid; read completed before concurrent commit => request is ordered before mutation even if response completes later.
- [ ] Current-revision read is not heavy feed regeneration and remains inside route DB budget.
- [ ] Heavy generation captures current durable revision before work and re-reads immediately before publishing. If changed, do not publish as current; if a commit races after final read, the entry remains tagged old revision and later cache decisions observing newer revision cannot serve it.
- [ ] Effective promotion mutation advances revision in the **same DB transaction**, so no later cache decision depends on a best-effort invalidation callback.
- [ ] Draft-only edits/Copy do not advance revision solely because they are not storefront-effective.
- [ ] Existing fixed-key/single-flight/complete-success-only/60s negative-backoff/no-partial-200 semantics remain unchanged.
- [ ] No request-controlled cache dimensions or unbounded per-campaign cache keys.
- [ ] If durable revision visibility + same cache-domain single-flight/backoff cannot be guaranteed by current topology, Merchant activation remains blocked.
- [ ] Tests: cached normal → immediate Publish → next cache decision reads newer revision/rebuild.
- [ ] Tests: cached sale → Disable/end-early → next cache decision reads newer revision/rebuild.
- [ ] Tests: Scheduled edit moves boundary inside TTL → transactional revision advance/rebuild.
- [ ] Tests race A: cache revision read before commit may complete with old body as a logically pre-mutation request.
- [ ] Tests race B: cache revision read after commit must reject prior-revision body.
- [ ] Tests: concurrent GET after revision change => at most one heavy generation.
- [ ] Tests: pre-mutation in-flight generator cannot be served as current after a later cache decision observes newer revision.
- [ ] Tests: negative failure sentinel remains isolated from valid success generation.

SEO/GEO:
- [ ] Structured Offer uses effective price only where #152 W4/#153 M2 can truthfully represent variant.
- [ ] No `AggregateOffer` shortcut for variants.
- [ ] Inventory W15 coverage before adding smoke jobs.
- [ ] Promotion/Tracking/Merchant does not enable organic indexing.

Activation rule:
- [ ] All currently enabled price-bearing consumers converge before promotions are activated.
- [ ] GTM/Merchant that are mechanically disabled/fail-closed may stay off and do not block promotion activation.
- [ ] Future GTM/Merchant activation must re-check promotion-aware monetary behavior if promotions are active.

## G2 — observability/readiness/rollback
- [ ] Bounded/redacted activation rejection telemetry.
- [ ] Invalid/recovery/PARTIALLY_INVALID telemetry.
- [ ] Conflict telemetry with bounded identifiers.
- [ ] `PRICE_CHANGED` phase and rendered-quote-proof rejection reason observable without logging proof/PII.
- [ ] Merchant durable-revision mismatch/rebuild observable when Merchant enabled.
- [ ] Pancake semantic acceptance evidence handled securely.
- [ ] No PII/secrets/raw external payloads/raw quote proofs/cart UUIDs/session handles in logs.
- [ ] Rollback runbook: gate off + explicit Disable; Disable works >2000 variants and advances durable pricing revision transactionally.
- [ ] Merchant-enabled rollback relies on later cache decisions observing new durable revision so stale sale bytes cannot mask rollback; no best-effort post-commit invalidation dependency.
- [ ] Mirrored-money audit accepted.

## G3 — Definition of Done
- [ ] Focused new/regression tests.
- [ ] Relevant DB/domain suites green.
- [ ] Lint green.
- [ ] Typecheck green.
- [ ] Production build green.
- [ ] Applicable runtime/browser/a11y green.
- [ ] No duplicate pricing/business logic.
- [ ] No unrelated refactor.
- [ ] No N+1/unbounded query or unbounded quote-proof state.
- [ ] No raw HttpOnly cart/session handle exposed in browser-visible proof or logs.
- [ ] Security review complete.
- [ ] Docs/runbooks current.
- [ ] #153 identity/cart/Purchase/Merchant-cache regressions remain green.
- [ ] #152 indexing policy unchanged unless separately approved.
- [ ] Human final review: 0 Critical / 0 Required.

## Recommended implementation sequence
- [ ] A1 P1 persistence + durable pricing revision.
- [ ] A2 P2 pricing/evidence.
- [ ] B1 P3 repository/lifecycle.
- [ ] B2 P4 concurrency/admin domain + atomic revision advance.
- [ ] C P5 admin UX.
- [ ] Converge #153 T4 identity.
- [ ] D1 P6 PDP/composite.
- [ ] D2 P7a shop/cards.
- [ ] D3 P7b Flash/freshness.
- [ ] Converge shared #153 T5/T6 cart API.
- [ ] E1 P8 DRAFT.
- [ ] E2 P9a stateless rendered quote proof/reconfirmation.
- [ ] E3 P9b fresh-Pancake reconfirmation.
- [ ] F P10 final Pancake price.
- [ ] #153 T7 Purchase consumer.
- [ ] G1 focused consumer PRs only for consumers intended/enabled at that rollout stage.
- [ ] G2 readiness.
- [ ] G3 integrated verification.

## Separate launch gates
Promotion:
- [ ] P1–P10 accepted.
- [ ] Price/catalog evidence accepted.
- [ ] Pancake custom-price semantic acceptance succeeds.
- [ ] All currently enabled price-bearing consumers converged or explicitly disabled/fail-closed.
- [ ] If Merchant enabled: transition-aware effective expiry + durable transactional promotion revision + cache-decision revision linearization + tagged in-flight revision guard proved in same #153 cache domain.
- [ ] G2 + G3 accepted.
- [ ] Human explicitly enables promotion activation gate.

GTM live, Merchant activation and organic indexing remain separate #153/#152 gates and are not implied by promotion readiness.
