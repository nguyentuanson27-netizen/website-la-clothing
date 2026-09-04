# Promotions & Flash Sale v1 — execution checklist

Status: **P1–P8 IMPLEMENTED AND MERGED; P9a IMPLEMENTED IN OPEN PR #190, NOT MERGED. P5 is delivered via P5a PR #184 + P5b PR #185; Checkpoint A PASS on `main@d8b1a6696f03bdd683e15577b493e5cf46fa51e0`; Checkpoint B PASS on `main@649e04c328353c016e4ba41831b6eec7d49d1d54`. Shared T5/T6 is also integrated via PR #186. P8 is merged via PR #189. P9b/P10 remain planned.**

Delivered slices: **P1** (U3, PR #158), **P2** (U7, PR #162 resolver + PR #163 mirrored-money audit + PR #174 W3
real-catalog evidence), **P3** (U10, PR #167/#168/#169), **P4** (U11, PR #170/#171/#172), **P5** (U14, PR #184 P5a + PR #185 P5b), **P6** (U15, PR #181), **P7a** (U16, PR #182) and **P7b** (U17, PR #183). Integrated Checkpoint A
evidence is recorded in `docs/audits/wave-1-checkpoint-a.md`; Checkpoint B evidence is in `docs/audits/wave-2-checkpoint-b.md`; the W3 pricing evidence is in `docs/audits/pricing-evidence-w3.md`.

The promotion activation gate remains **default-off**. P5/P6/P7 storefront/admin work, the shared T5/T6 cart contract and P8's mutable DRAFT quote/audit are integrated. P9a's rendered-quote proof is implemented in PR #190 but is **not** integrated until that merges; P9b/P10 and later activation gates remain open.

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

These three P0 gates are left unticked deliberately. They belong to the planning PR's own approval, and the
repository carries no evidence of them that a later reader could verify; P1–P4 subsequently being built and merged
is not itself proof that they were recorded. They are not a statement that implementation is missing.

## P1 — persistence + additive order audit + durable pricing revision
- [x] Add campaign/target persistence with DB/server shape and uniqueness guards.
- [x] Website money uses integer/BigInt VND; Pancake mirrors stay `Float?`.
- [x] Add base/final/promotion audit fields to `OrderLineSnapshot`.
- [x] Preserve purchased `pancakeVariationId`, name/options/quantity facts used by #153 Purchase.
- [x] Add one durable singleton/equivalent server-owned promotion-pricing revision record using non-negative `BigInt`/equivalent monotonic integer semantics; bounded cardinality, monotonic effective-mutation ordering, cheap read for Merchant cache validation.
- [x] Migration additive; historical rows readable; no campaign delete.

Verification:
- [x] RED/GREEN DB tests.
- [x] Prisma validate/generate/migration deploy.
- [x] Historical compatibility.
- [x] Revision initialization + transaction lock/increment behavior.

## P2 — central pricing + evidence
- [x] Pure explicit-`now` resolver is the only semantic pricing authority.
- [x] Positive safe-integer base boundary.
- [x] Percentage uses exact BigInt rational arithmetic.
- [x] Fixed price is final customer unit price and `0 < fixed < base`.
- [x] Resolver returns base/effective price, promotion snapshot, discounted flag, typed invalid/conflict reason and transition fact.
- [x] >1 applicable campaign => conflict/no promotion; never arbitrary winner.
- [x] Affected-variant invalid fallback when base remains usable.
- [x] Unusable base => non-purchasable.
- [x] Run mirrored-money audit.
- [x] Run approved real-catalog `pnpm pancake:catalog:audit` before equality-gate removal.
- [x] Record sanitized retail vs after-discount mismatch evidence.
- [x] Materially contradictory evidence => stop for product review.

Mandatory fixtures:
- [x] `150 @ 1% -> 149`.
- [x] `350 @ 1% -> 347`.
- [x] `110 @ 5% -> 105`.
- [x] `9007199254740989 @ 1% -> 8917127262193579`.
- [x] low-price invalidation such as `50 @ 1%`.
- [x] fixed valid/invalid + fresher-base drift/recovery.
- [x] malformed external values + conflict.

## P3 — repository/lifecycle/runtime health
- [x] Batch direct VARIANT + actual owning PRODUCT campaign lookup.
- [x] Composite follows real component variant/owner, not presentation parent.
- [x] Dynamic PRODUCT coverage; no frozen membership table.
- [x] Restart/zero-traffic-safe Draft/Scheduled/Active/Ended/Disabled derivation.
- [x] Legal never-Active re-enable writes fresh `enabledAt` + `disabledAt=null` atomically.
- [x] Runtime invalid/conflict/recovery per affected variant; healthy siblings continue.
- [x] Copy snapshots explicit targets only and never expands PRODUCT coverage.
- [x] Deterministic bounded Copy naming.

Regression:
- [x] 119/120 code units.
- [x] trailing-space normalization.
- [x] surrogate boundary.
- [x] Copy-of-Copy.
- [x] >2000 dynamic expansion source still copies to Draft.
- [x] bounded queries/no N+1.

## P4 — concurrency-safe admin domain + activation gate + atomic revision
- [x] Admin authz + named input bounds.
- [x] Coverage-validating write order: campaign lock → owning-product locks → bounded expansion probe → needed variant locks → re-read → atomic commit.
- [x] 2000 allowed / 2001 rejected for publish/re-enable/Scheduled material edit.
- [x] Same-campaign lost update prevented.
- [x] PRODUCT↔PRODUCT / PRODUCT↔VARIANT / VARIANT↔VARIANT overlap race-safe.
- [x] Disable uses campaign-row bounded path only.
- [x] 1900 variants at activation → later 2001 → Disable still succeeds.
- [x] Copy remains non-expanding.
- [x] Activation gate defaults off; publish/re-enable => `ACTIVATION_DISABLED` while off.
- [x] Failed writes leave previous definition unchanged.
- [x] Successful publish/re-enable/Disable/end-early/Scheduled material edit advances the durable promotion-pricing revision **inside the same DB transaction**.
- [x] All effective mutation paths acquire/update the revision in one deterministic position in the lock order so concurrent campaign mutations cannot deadlock or lose increments.
- [x] Draft-only edits/Copy do not advance revision solely for Merchant.
- [x] No `after()`/fire-and-forget/external post-commit signal is required for cache correctness.

Verification:
- [x] Effective mutation + revision increment commit together.
- [x] Failed/rolled-back mutation leaves revision unchanged.
- [x] Draft-only edit/Copy leaves revision unchanged.
- [x] Concurrent effective mutations do not lose revision increments or deadlock on inconsistent revision lock ordering.
- [x] Repeated concurrency tests, 2000/2001 expansion, 1900→2001 Disable, gate-off/no-partial-write.

### Checkpoint A

**PASS** on `main@d8b1a6696f03bdd683e15577b493e5cf46fa51e0`. Full record: `docs/audits/wave-1-checkpoint-a.md`.

- [x] P1–P4 focused suites green. `pnpm test` 752/752 and `pnpm test:db` 292/292; lint 0 errors; typecheck and
      build clean.
- [x] Migration clean. `prisma validate` / `generate` / `migrate deploy` all succeed and the revision singleton is
      seeded by the migration.
- [x] Repeated concurrency tests green. Database-backed races in `tests/database/promotion-activation-service.test.ts`
      and `tests/database/promotion-admin-operations.test.ts`.
- [x] Security review: authz/bounds/external-data/no PII or secrets in logs.
- [x] 0 Critical / 0 Required. Three non-blocking observations carried to P5.

## P5 — admin UX
*(Delivered across P5a PR #184 and P5b PR #185; both merged and integrated.)*
- [x] Protected `/admin/promotions`.
- [x] List/search bounded 50.
- [x] Lifecycle-valid create/edit/publish/re-enable/disable/copy.
- [x] Typed invalid/overlap/expansion/activation feedback.
- [x] Product admin only shows related-campaign summary/link.
- [x] No price/overlap math in React.
- [x] Keyboard/Axe/mobile + non-admin rejection.

## #153 T4 identity prerequisite

**Delivered — U8, PR #164 (resolved cart lines) + PR #165 (product/option facts).** Merged on
`main@d8b1a6696f03bdd683e15577b493e5cf46fa51e0`; per-item state in
`tasks/marketing-analytics-shopping-todo.md` and the T4 record in `docs/audits/wave-1-checkpoint-a.md`.
This prerequisite is satisfied for P6, and **P6 is delivered via U15 / PR #181**.

- [x] Product/list/PDP upper-funnel facts propagate `pancakeProductId`. *(U8, PR #165)*
- [x] Concrete options/cart facts propagate real `pancakeVariationId`. *(U8, PR #164 + #165; composite
      component lines carry the actual purchased component variation ID, and unresolvable/private lines
      fail closed to no external identity.)*
- [x] Local variant CUID never becomes vendor item ID. *(U8, PR #164 + #165; `VariantMirror.id` stays the
      authorization/mutation key and presentation `kindKey` never stands in for external identity.)*

## P6 — PDP/composite promotion projection
*(Delivered via U15 / PR #181, merged.)*
- [x] Remove equality gate only after P2 evidence acceptance.
- [x] Selected option uses central quote and retains `pancakeVariationId`.
- [x] Composite campaign ownership follows real component owner.
- [x] Sale/Flash UI has no local discount formula.
- [x] No per-option N+1.
- [x] Compatible with #153 M2 `/shop/<slug>?variant=<pancakeVariationId>`; no competing promotion URL state.

Verification:
- [x] standalone/composite owner tests.
- [x] invalid base and selected exact quote.
- [x] deep-link compatibility with merged M2/U12.
- [x] browser/a11y PDP checks.

## P7a — cards + `/shop`
*(Delivered via U16 / PR #182, merged.)*
- [x] Representative sale variant/wording follows spec.
- [x] Filter/min/max/price sort use effective price before pagination.
- [x] One `requestNow` spans count/order/SQL/hydration/card/transition aggregation.
- [x] SQL casts validated base to `numeric` before percentage arithmetic.
- [x] SQL target/time/conflict/invalid semantics match TypeScript.
- [x] Product-level analytics remains product-level; representative variant is not fabricated as selected item.
- [x] Query-wide transition aggregate includes off-page membership/order changes.

Verification:
- [x] SQL↔TS parity including P2 fixtures.
- [x] filter/sort/pagination.
- [x] off-page transition.
- [x] page/offset guards.
- [x] no N+1.

## P7b — `/flash-sale` + freshness
*(Delivered via U17 / PR #183, merged.)*
- [x] Same sanctioned pricing/membership projection; no duplicate Flash formula.
- [x] Active-valid Flash variants only.
- [x] page <=10000, size <=48, offset <=50000.
- [x] page 1042@48 allowed; 1043@48 rejected before expensive query.
- [x] Empty route knows next enabled Flash boundary.
- [x] Relative refresh <=60s.
- [x] Browser wall clock not authority.
- [x] visibility/pageshow resume guard.

Verification:
- [x] empty→active.
- [x] end boundary.
- [x] clock skew.
- [x] background resume.
- [x] pagination/query budget.

### Checkpoint B

**PASS** on `main@649e04c328353c016e4ba41831b6eec7d49d1d54`. Full record: `docs/audits/wave-2-checkpoint-b.md`.

- [x] P5b / PR #185 is merged and integrated; PR #186 followed it on `main`.
- [x] PDP/cards/shop/Flash share one price authority.
- [x] #153 identity contract remains green, including merged U12/M2 addressability regressions.
- [x] SQL parity green.
- [x] Browser freshness/a11y green.
- [x] Activation remains default-off.
- [x] Exact-head CI `33739762266`, Catalog runtime `33739762252`, and VPS verification `33739762271` succeeded.
- [x] Fresh integrated review: **0 Critical / 0 Required**.

Checkpoint B unblocks P8/U20; it does not enable promotion activation or bypass later Checkpoint C requirements.

## Shared #153 T5/T6 cart contract
- [x] PDP AddToCart is atomic `+1`, never absolute set-to-1.
- [x] Update/remove return committed transition + bounded authoritative item snapshot.
- [x] Snapshot includes real `pancakeVariationId` and server-current resolver price.
- [x] No stale browser fallback.
- [x] `view_cart` / `begin_checkout` are complete all-or-nothing projections.
- [x] If #151 reaches this boundary first, implement this API once and make #153 consume it; no duplicate temporary path.

Delivered by Wave 3 (U18/U19, PR #186). Cart, checkout render and the order snapshot now price through
`resolvePromotionPricing`, so the enabled-consumer convergence rule holds for the currently enabled
price-bearing consumers. P8/P9/P10 remain unimplemented and consume this contract rather than
extending it.

## P8 — DRAFT quote + promotion audit

Delivered by U20 / PR #189.

- [x] DRAFT stores purchased external variant identity + quantity/name/options + base/final/promotion audit.
- [x] Checkout render may expose bounded non-PII quote facts for proof issuance, but unsigned/client-editable quote fields never prove buyer acknowledgement.
- [x] Raw browser quote facts alone cannot create submit-capable DRAFT.
- [x] DRAFT mutable/retryable until guarded finalization.
- [x] Final pricing freezes when leaving DRAFT for submission.

Verification:
- [x] no promo / % / fixed.
- [x] composite external identity.
- [x] invalid base.
- [x] retryable DRAFT replacement.
- [x] unsigned quote facts alone rejected for submit-capable DRAFT.

A DRAFT whose `pancakeShopId` no longer matches the configured shop is rejected with
`SHOP_SCOPE_UNVERIFIED` and re-snapshotted rather than stranding the cart: `DRAFT` is the one active
state stranded-checkout recovery never sweeps.

## P9a — stateless rendered quote proof -> DRAFT

Delivered by U21 in **open PR #190 — implemented but not merged, so not yet integrated**. Implemented
in `src/commerce/checkout-quote-proof.ts`, issued in
`src/app/checkout/page.tsx`, verified inside the snapshot transaction in
`src/commerce/guest-checkout-snapshot.ts`.

- [x] Re-read then-current `anonymous-cart.ts` and `anonymous-cart-cookie.ts`; baseline re-verified unchanged — max 50 distinct anonymous-cart lines and raw cart UUID in HttpOnly `la_cart`.
- [x] Checkout render issues bounded opaque proof bound to current anonymous cart/checkout identity + canonical rendered non-PII quote facts.
- [x] Proof v1 uses deterministic canonical payload bytes + standard-library server-only HMAC/MAC; **no DB proof rows, nonce table, append-only proof state, or third-party crypto dependency**.
- [x] Key is server-only and domain-separated: derived from the validated `BETTER_AUTH_SECRET` through its own context string, following the `deriveGuestCheckoutClientKey` precedent.
- [x] Raw HttpOnly cart UUID is **server-only MAC context**, length-prefixed into the MAC input and never serialized into token bytes or any client-readable field.
- [x] Proof binds variant IDs, quantities, effective unit prices, merchandise subtotal, shipping, total, line cardinality and a `laq1` format/version fact.
- [x] `MAX_RENDERED_QUOTE_PROOF_BYTES = 16 * 1024`, with the 50-line fit measured by a regression rather than asserted, so a raised cart cap fails the test instead of silently unbounding the envelope.
- [x] max+1 rejected before decode/MAC work; max reaches normal verification.
- [x] Proof/secret/customer PII/cart UUID is never logged; `timingSafeEqual` for MAC comparison.
- [x] Submit verifies length + format + MAC authenticity + cart binding before stale comparison, then compares against the quote recomputed inside the snapshot transaction.
- [x] Missing/oversized/malformed/forged/wrong-cart/unverifiable proof => refreshed quote + fresh proof, no submit-capable DRAFT, no `POS_SUBMITTING`, no Pancake create.
- [x] Verified rendered quote mismatch => typed `PRICE_CHANGED` + refreshed totals + fresh proof.
- [x] Explicit resubmit required; proof never becomes price authority — verification returns no money at all.

Verification:
- [x] buyer saw 400k, sale ended, first submit shows 500k/fresh proof/zero POS write, second unchanged submit may continue.
- [x] client edits hidden/rendered quote to current 500k but stale/forged proof cannot bypass reconfirmation.
- [x] proof from another cart/checkout fails closed.
- [x] valid bound proof + unchanged quote succeeds.
- [x] 16 KiB/max+1 + deterministic canonicalization.
- [x] decoded/browser-visible token inspection cannot recover the raw HttpOnly cart UUID.
- [x] checkout render/submit creates zero quote-proof persistence rows/state.

Two decisions worth recording. Verification runs **inside** the snapshot transaction rather than
ahead of it: a check before the transaction could pass and then have the price move underneath it
before the DRAFT was written, which is the substitution this slice exists to prevent. And every
unproven outcome converges on one buyer-visible result — the current price, a fresh proof, an
explicit re-submission — because reporting which check failed would tell a probing client which
guess was closer, while the buyer's next step is identical in every case.

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
- [x] A1 P1 persistence + durable pricing revision. *(U3, PR #158)*
- [x] A2 P2 pricing/evidence. *(U7, PR #162 + #163 + #174)*
- [x] B1 P3 repository/lifecycle. *(U10, PR #167 + #168 + #169)*
- [x] B2 P4 concurrency/admin domain + atomic revision advance. *(U11, PR #170 + #171 + #172)*
- [x] C P5 admin UX. *(P5a PR #184 + P5b PR #185, merged)*
- [x] Converge #153 T4 identity. *(U8, PR #164 + #165)*
- [x] D1 P6 PDP/composite. *(U15, PR #181 merged)*
- [x] D2 P7a shop/cards. *(U16, PR #182 merged)*
- [x] D3 P7b Flash/freshness. *(U17, PR #183 merged)*
- [x] Converge shared #153 T5/T6 cart API. *(U18/U19, PR #186 merged)*
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