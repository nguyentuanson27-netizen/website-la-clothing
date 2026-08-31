# Promotions & Flash Sale v1 — implementation plan

Status: **PLANNING ONLY — implementation has not started.**

Source of truth: `docs/specs/promotions-flash-sale-v1.md`.

Planning base: `main@323c07cf25c834e36e4a43952df3f0ee7321d756` after PR #152 (SEO/GEO audit) and PR #153 (marketing analytics + Google Shopping) merged.

This is the feature-local promotion plan. The promotion spec owns campaign/pricing behavior; PR #153 owns canonical analytics/Merchant identity and cart-event contracts; PR #152 owns SEO/GEO planning constraints. Shared contracts are implemented once and consumed by all workstreams.

Review order: correctness → security → architecture → simplicity → performance.

## A. Cross-feature ownership

### Pricing
- Website campaign state + one TypeScript resolver own promotional effective price.
- `pancakeRetailPrice` is the Pancake base-price input after evidence gates.
- UI, cart, checkout, order audit, analytics, Merchant, structured data and Pancake submission consume authoritative quote/snapshot facts; none reimplement promotion math.
- One SQL projection is sanctioned only where bounded pre-pagination storefront behavior requires it and must stay parity-tested with TypeScript.

### Identity from PR #153
- unselected product-level upper funnel: `pancakeProductId`;
- concrete selected/committed variant: `pancakeVariationId`;
- internal `VariantMirror.id`: authorization/mutation only, never vendor item ID;
- Purchase transaction/event ID: `OrderMirror.publicCode`.

### Cart truth from PR #153
- PDP AddToCart is atomic `+1`, not absolute set-to-1;
- accepted mutations return committed quantity transition + bounded server-authoritative non-PII item snapshot;
- browser tracking has no rendered/client-cached fallback for price/identity/name/quantity;
- `view_cart` / `begin_checkout` use one complete all-or-nothing canonical cart projection;
- promotion pricing plugs into this shared API instead of creating a second cart path.

### SEO/Merchant from #152/#153
- #152 W3 requires `pnpm pancake:catalog:audit` evidence before removing the retail/after-discount equality gate.
- #153 M2 owns standalone variant deep link `/shop/<slug>?variant=<pancakeVariationId>` and its preselection/canonical-query contract.
- Merchant v1 remains standalone-only; composites fail closed/defer.
- Merchant price consumes storefront effective price.
- #153 M4 keeps one fixed-key complete-success cache/single-flight/60s negative-backoff domain. Its 300s success TTL is the normal **maximum**, not permission to serve across a known promotion boundary or a later promotion mutation.
- Promotion owns one durable bounded-cardinality `BigInt`/equivalent promotion-pricing revision. Every successful price/schedule-changing publish/re-enable/Disable/end-early/Scheduled material edit advances that revision **inside the same DB transaction** as the campaign mutation. Merchant cache decisions/in-flight publication validate against it; no post-commit `after()`/fire-and-forget signal is correctness authority.
- Structured Offer price uses effective price only when the variant URL/schema contract can represent it truthfully; no `AggregateOffer` shortcut for variants.
- Organic indexing remains a separate ADR 0004 gate.

### Enabled-consumer launch rule
Promotion activation does **not** require future integrations that are still mechanically disabled/fail-closed. It requires every **currently enabled price-bearing consumer** to be correct:
- active storefront/cart/checkout/Pancake paths must converge;
- existing direct Meta price/value behavior must consume authoritative facts where it emits money;
- if GTM destinations are not yet loaded/published, they may remain off without blocking promotion activation;
- if Merchant data source is not activated, it may remain off without blocking promotion activation;
- once GTM/Merchant are enabled, their own launch gate requires promotion-aware monetary convergence first.

## B. Reviewed promotion invariants retained

Detailed rules remain normative in the spec. Implementation must preserve:
- dynamic PRODUCT coverage; no frozen membership table;
- exact BigInt percentage arithmetic and PostgreSQL `numeric` parity including upper-safe fixture;
- affected-variant fail-closed runtime invalidity/conflict with healthy siblings continuing;
- no overlapping enabled campaigns on effective variant coverage;
- deterministic concurrency locks for coverage-validating writes;
- expansion cap only for publish/re-enable/Scheduled material edit; Disable/Copy remain bounded rollback paths even after >2000 dynamic variants;
- restart/zero-traffic lifecycle correctness and atomic `disabledAt` clearing for legal never-Active re-enable;
- activation kill switch default-off;
- one request clock, query-wide transition awareness, max 60s storefront staleness and existing `/shop`/`/flash-sale` page/offset bounds;
- Stage-1 rendered-price acknowledgement uses a bounded **stateless server-MAC** proof; the raw HttpOnly cart UUID remains server-only MAC context and is never serialized into browser-readable token bytes;
- two stale-price handshakes: verified rendered quote → DRAFT → fresher Pancake quote;
- immutable final order-line base/final/promotion audit;
- final Pancake submission removes raw-live-price comparison, totals and outbound-price assumptions;
- enabled Merchant cache is transition-aware and durable-revision-validated with an explicit revision-read linearization point; committed promotion mutations cannot leave later cache decisions treating an old revision as current;
- controlled Pancake custom-price semantic acceptance before real discounted activation.

## C. Dependency graph

```text
P0 reconcile #151 with current main (#152 + #153)
 ↓
P1 persistence + additive order audit + durable promotion pricing revision
 ↓
P2 central pricing + Pancake/catalog evidence
 ↓
P3 repository/lifecycle/runtime health
 ↓
P4 concurrency-safe admin domain + activation gate + atomic revision advance
 ↓
Checkpoint A
 ├─ P5 admin UX
 └─ #153 T4 identity facts → P6 PDP/composite
                              ↓
                           P7a /shop/cards
                              ↓
                           P7b /flash-sale/freshness
                              ↓
                           Checkpoint B
                              ↓
                 shared #153 T5/T6 cart contract
                              ↓
                           P8 DRAFT quote/audit
                              ↓
                           P9a stateless render→DRAFT proof/reconfirm
                              ↓
                           P9b DRAFT→fresh Pancake reconfirm
                              ↓
                           P10 Pancake final price
                              ↓
                  #153 T7 Purchase consumes snapshot
                              ↓
                 G1 enabled-consumer convergence
                    G2 readiness/rollback
                    G3 final DoD
```

## P0 — planning reconciliation

**Description:** Make #151 implementation-ready against current `main` after #152/#153.

**Acceptance criteria:**
- [ ] branch includes current reviewed `main`;
- [ ] spec, plan and todo all name `main@323c07cf...` / #152 + #153 as the planning baseline and preserve #153 ownership instead of “rediscover later”;
- [ ] analytics/Merchant/cart/deep-link ownership is explicit;
- [ ] plan/todo keep all reviewed promotion correctness/rollback gates;
- [ ] fresh review has 0 Critical / 0 Required before `/build`.

**Verification:** branch compare; exact-head CI; spec/plan/todo consistency review; grep that stale pre-#153 “rediscover analytics ownership” wording is gone.

**Dependencies:** none.

**Likely files:** planning docs only.

**Scope:** S.

## P1 — persistence + additive order audit + durable promotion pricing revision

**Description:** Add minimal website-owned campaign/target persistence, final order promotion audit facts, and one durable bounded revision used to make Merchant freshness orderable with committed promotion mutations.

**Acceptance criteria:**
- [ ] enforce campaign/target shape/uniqueness and integer website money;
- [ ] add base/final/promotion audit to `OrderLineSnapshot` while preserving purchased `pancakeVariationId`, quantity/name/options required by #153 Purchase;
- [ ] add one additive durable singleton/equivalent non-negative `BigInt`/equivalent promotion-pricing revision record that can be locked/advanced transactionally and read cheaply by Merchant cache validation;
- [ ] revision is server-owned, monotonic for effective mutation ordering, not request-controlled, and has no per-campaign/per-request cardinality growth;
- [ ] keep Pancake mirror prices `Float?`; migration additive; no campaign delete.

**Verification:** RED/GREEN DB tests; Prisma validate/generate/migrate deploy; historical-row compatibility; singleton/revision initialization and concurrent increment/lock behavior.

**Dependencies:** P0.

**Likely files:** Prisma schema/migration + DB/domain tests.

**Scope:** M; split if >5 files.

## P2 — central pricing domain + evidence

**Description:** Establish the one pricing authority before consumers switch behavior.

**Acceptance criteria:**
- [ ] pure explicit-`now` resolver returns base/effective price, promotion snapshot, discounted flag, typed conflict/invalid reason and transition fact;
- [ ] positive-safe-integer base, exact BigInt percentage and fixed-final-price rules are enforced;
- [ ] invalid/conflict behavior matches affected-variant fail-closed semantics;
- [ ] mirrored-money audit + approved real-catalog `pnpm pancake:catalog:audit` evidence is recorded before equality-gate removal;
- [ ] contradictory upstream evidence returns to product review rather than silently changing authority.

**Verification:** domain table tests including `150@1%=149`, `350@1%=347`, `110@5%=105`, upper-safe fixture, low-price invalidation, fixed drift/recovery, malformed/conflict cases; sanitized audit evidence.

**Dependencies:** P1.

**Likely files:** pricing domain/tests + bounded audit evidence.

**Scope:** M.

## P3 — repository/lifecycle/runtime health

**Description:** Resolve applicable campaigns and durable lifecycle/health around the pricing resolver.

**Acceptance criteria:**
- [ ] batch direct VARIANT + actual owning PRODUCT lookup; composite follows real component owner;
- [ ] Draft/Scheduled/Active/Ended/Disabled is deterministic across restart/zero traffic; legal re-enable writes fresh `enabledAt` + `disabledAt=null`;
- [ ] runtime invalid/conflict/recovery is per affected variant and exposes bounded typed health;
- [ ] Copy snapshots explicit targets only, uses deterministic 120-code-unit-safe naming and works even when dynamic expansion >2000.

**Verification:** lifecycle boundaries; composite-owner cases; Copy 119/120/trailing-space/surrogate/Copy-of-Copy/>2000 source; query-count tests.

**Dependencies:** P2.

**Scope:** M; split lifecycle and candidate repository if needed.

## P4 — concurrency-safe admin domain + activation gate + atomic revision advance

**Description:** Make enabled mutations race-safe while keeping rollback bounded and advance the durable promotion-pricing revision in the same transaction as every successful effective price/schedule mutation.

**Acceptance criteria:**
- [ ] admin authz and all named bounds enforced;
- [ ] publish/re-enable/Scheduled material edit locks campaign → owning products → bounded expansion probe → needed variants, re-reads facts and commits atomically;
- [ ] same-campaign lost-update and cross-campaign PRODUCT↔VARIANT overlap races fail closed;
- [ ] Disable is campaign-row bounded and succeeds after PRODUCT coverage grows above 2000; Copy remains non-expanding;
- [ ] activation gate defaults off and publish/re-enable fail typed `ACTIVATION_DISABLED` while off;
- [ ] successful publish/re-enable/Disable/end-early/Scheduled material edit advances the P1 durable promotion-pricing revision **inside that same DB transaction** before commit;
- [ ] all effective mutation paths acquire/update the singleton/equivalent revision in one deterministic position in the mutation lock order so concurrent campaign writes cannot deadlock or lose increments;
- [ ] Draft-only edits and Copy do not advance the revision solely because they are not storefront-effective;
- [ ] no `after()`, fire-and-forget task, external event, or best-effort post-commit hook is relied upon for Merchant cache correctness. P4 does not calculate Merchant prices or own Merchant cache bodies.

**Verification:** repeated concurrency tests; 2000/2001 expansion; 1900→2001 Disable; gate-off/no-partial-write tests; successful effective mutation and revision increment commit/roll back together; failed/rolled-back/Draft-only/Copy writes do not advance revision; concurrent effective mutations serialize the revision monotonically without lost increment/deadlock.

**Dependencies:** P3 + P1 revision persistence.

**Scope:** M slices.

### Checkpoint A
Migration clean; focused P1–P4 tests green; activation gate default-off; security review (authz, bounded input, external data untrusted, no PII/secrets in logs); 0 Critical/Required.

## P5 — admin UX

**Description:** Build `/admin/promotions` over the P4 service boundary.

**Acceptance criteria:**
- [ ] bounded list/search and lifecycle-valid create/edit/publish/re-enable/disable/copy;
- [ ] typed overlap/validation/expansion/activation feedback;
- [ ] product admin links to campaigns instead of duplicating editor; no pricing math in React.

**Verification:** service/action/component tests; non-admin rejection; keyboard/Axe/mobile.

**Dependencies:** P4.

**Scope:** M slices.

## P6 — PDP/composite promotion projection on #153 identity facts

**Description:** Switch selected-option storefront pricing to the central resolver without inventing new identity/URL contracts.

**Acceptance criteria:**
- [ ] equality gate removed only after P2 evidence acceptance;
- [ ] selected option preserves `pancakeVariationId`; composite campaign ownership follows real component variant + actual owning product;
- [ ] sale/Flash UI consumes resolver quote; no client formula or per-option N+1;
- [ ] compatible with #153 M2 deep link `/shop/<slug>?variant=<pancakeVariationId>`; promotion adds no competing variant URL/state model.

**Verification:** standalone/composite owner tests; invalid base; selected variant exact quote; M2 deep-link compatibility; browser PDP/a11y checks.

**Dependencies:** P4 + #153 T4 identity propagation + P2 evidence acceptance.

**Scope:** M.

## P7a — cards + `/shop` effective-price discovery

**Description:** Apply authoritative pricing before bounded listing pagination.

**Acceptance criteria:**
- [ ] min/max/price sort and representative card pricing use current effective price with spec-approved non-misleading wording;
- [ ] one `requestNow` spans count/order/SQL/hydration/card/query-wide transition aggregation;
- [ ] SQL casts validated base to `numeric` before percentage arithmetic and matches TypeScript target/time/conflict/invalid semantics;
- [ ] product-level analytics identity remains product-level even when a representative sale variant supplies display price.

**Verification:** SQL↔TS parity; filter/sort/pagination; off-page transition enters page; existing page/offset bounds; no N+1.

**Dependencies:** P6.

**Scope:** M.

## P7b — `/flash-sale` + freshness

**Description:** Add active-valid Flash membership through the same pricing/membership projection.

**Acceptance criteria:**
- [ ] no second promotion predicate; page parser ≤10000, page size ≤48, offset ≤50000;
- [ ] page 1042@48 allowed and 1043@48 rejected before expensive query;
- [ ] empty route knows next enabled Flash boundary;
- [ ] server emits relative refresh ≤60s; visibility/pageshow resumes after suspended boundary; browser wall clock is not authority.

**Verification:** empty→active, end boundary, clock skew, tab resume, pagination/query budget.

**Dependencies:** P7a.

**Scope:** M.

### Checkpoint B
PDP/cards/shop/Flash share one pricing authority; #153 identity contract remains intact; SQL↔TS parity + browser freshness/a11y green; 0 Critical/Required.

## Shared cart checkpoint — #153 T5/T6

Before P8/P9 modifies checkout orchestration, converge on one shared API:
- PDP add is atomic `+1`;
- update/remove return committed transition + authoritative bounded item snapshot;
- concrete cart lines carry real `pancakeVariationId`;
- cart/checkout analytics projection is complete/all-or-nothing;
- current server unit price comes from the central promotion resolver when promotion exists.

If #151 reaches this boundary first, implement the shared contract once and make #153 consume it. Do not create a temporary duplicate mutation/projection path.

## P8 — mutable DRAFT quote + promotion audit

**Description:** Persist current quote/audit in retryable DRAFT while preserving #153 Purchase facts; raw browser quote fields never become acknowledgement authority.

**Acceptance criteria:**
- [ ] DRAFT line keeps purchased `pancakeVariationId`, name/options/quantity plus base/final/promotion audit;
- [ ] checkout render can produce bounded non-PII quote facts for P9a proof issuance, but unsigned/client-editable quote facts alone cannot authorize a DRAFT;
- [ ] DRAFT is mutable until guarded finalization; pricing freezes when leaving DRAFT for submission.

**Verification:** no-promo/%/fixed snapshots; composite identity; invalid base; retryable DRAFT replacement; unsigned quote facts alone cannot create submit-capable DRAFT.

**Dependencies:** P7b + shared T5/T6 contract.

**Scope:** M.

## P9a — stateless rendered quote proof → DRAFT reconfirmation

**Description:** Prevent submission at a price the buyer has not seen by binding the rendered quote to a bounded stateless server-MAC proof while keeping the current quote server-authoritative and the HttpOnly cart identity confidential.

**Repository fact:** current `anonymous-cart.ts` caps anonymous carts at 50 distinct items; current `la_cart` stores the raw cart UUID in an HttpOnly cookie. P9a must re-check those facts on then-current `main` before implementation.

**Acceptance criteria:**
- [ ] checkout render issues an opaque proof bound to the current anonymous cart/checkout identity and canonical rendered non-PII quote facts (variant IDs, quantities, effective unit prices, merchandise subtotal, shipping, total, plus a server issue/version fact);
- [ ] v1 proof is **stateless**: canonical payload bytes + standard-library server-only HMAC/MAC; no quote-proof DB rows, nonce table, append-only proof state, or third-party crypto dependency;
- [ ] implementation uses a domain-separated server-only key derived from an existing validated secret or a dedicated validated server-only secret after re-reading current config ownership; key material is never client-visible/logged;
- [ ] the raw HttpOnly cart UUID is server-only MAC context: include the server-read cart ID in the MAC input/binding, but never serialize that UUID into the browser-visible token payload or another client-readable field;
- [ ] proof string is ASCII/base64url and bounded by `MAX_RENDERED_QUOTE_PROOF_BYTES = 16 * 1024`, sized for the current 50-line cart cap; if the cart cap changes, re-prove this envelope instead of silently unbounding it;
- [ ] max+1 proof is rejected before decode/MAC work;
- [ ] canonical serialization is deterministic and includes a proof format/version so format evolution fails closed rather than parsing ambiguously;
- [ ] proof is non-PII/non-session-handle and no proof/secret/customer PII/cart UUID is logged; use constant-time MAC comparison where supported;
- [ ] submit verifies proof length, format, MAC authenticity and binding to the **current server-read cart identity** before stale comparison, then independently recomputes current authoritative quote;
- [ ] missing/oversized/malformed/forged/wrong-cart/unverifiable proof fails closed with refreshed quote + fresh proof, no submit-capable DRAFT, no `POS_SUBMITTING`, no Pancake create;
- [ ] verified rendered quote != current quote returns typed `PRICE_CHANGED` + refreshed totals + fresh proof, no `POS_SUBMITTING`, no Pancake create;
- [ ] explicit resubmit with the fresh proof is required; the proof never becomes price authority.

**Verification:** buyer saw 400k → sale ended → first submit returns 500k `PRICE_CHANGED`/fresh proof/zero POS write → second unchanged submit can continue; client edits hidden quote to 500k or forges/reuses proof and cannot bypass reconfirmation; proof from another cart fails closed; valid bound proof + unchanged quote succeeds; 16 KiB/max+1; deterministic canonicalization; browser-visible token inspection cannot recover the raw cart UUID; render/submit creates zero quote-proof persistence rows/state.

**Dependencies:** P8.

**Likely files:** guest checkout render/action/service + focused tests + existing anonymous-cart cookie/server-secret config modules as appropriate. Use Node standard crypto; no new third-party dependency and no proof-state migration.

**Scope:** M.

## P9b — DRAFT → fresher Pancake reconfirmation

**Description:** Re-resolve fresher trusted base through the same resolver immediately before final write.

**Acceptance criteria:**
- [ ] compare DRAFT quote with fresh effective website quote, never raw Pancake retail;
- [ ] mismatch atomically refreshes DRAFT line/audit/totals and returns `PRICE_CHANGED` with no create-order call;
- [ ] percentage recalculates; fixed price revalidates; repeated drift can reconfirm again without stale-loop behavior.

**Verification:** fresh-base drift %/fixed; promotion start/end; invalid/recovery; no POS call on mismatch.

**Dependencies:** P9a.

**Scope:** M.

## P10 — final Pancake price convergence + semantic acceptance

**Description:** Remove all raw-live-price money assumptions from final submission and prove Pancake honors website final price.

**Acceptance criteria:**
- [ ] comparison uses fresh effective quote;
- [ ] merchandise/shipping/total integrity uses authoritative effective/final money;
- [ ] outbound `variation_info.retail_price` uses immutable finalized `OrderLineSnapshot.unitPriceVnd`;
- [ ] three independent tests fail if comparison, totals or outbound price regresses to raw `livePrice`;
- [ ] authorized controlled Pancake test proves a requested line price differing from catalog base is accepted/preserved; no blind retry and `SYNC_UNKNOWN` semantics retained.

**Verification:** focused submission suite + sanitized controlled semantic evidence.

**Dependencies:** P9b.

**Scope:** M.

## G1 — enabled-consumer monetary convergence

**Description:** Make each price-bearing consumer correct before that consumer is enabled with promotions.

**Acceptance criteria:**
- [ ] #153 canonical current-state/cart events consume authoritative effective price and Purchase consumes immutable finalized snapshot money; GTM never calculates promotion;
- [ ] existing active direct Meta value source is promotion-aware where money is emitted, while Meta Pixel+CAPI remain direct and deduplicated as before;
- [ ] Merchant M3 consumes storefront effective price with no Merchant-specific promotion formula;
- [ ] #153 `MERCHANT_FEED_CACHE_TTL_SECONDS=300` is treated as maximum normal success TTL; effective expiry is `min(300s, nearest relevant known promotion transition)` or equivalent tested invalidation;
- [ ] a Merchant cache entry stores the P4 durable promotion-pricing revision it was built under;
- [ ] each success-cache decision linearizes at one bounded cheap read of the current durable revision. If that read occurs after a promotion transaction commits, prior-revision cache bytes are invalid. If the read completed before a concurrent commit, that request is ordered before the mutation for cache freshness even if its response completes later;
- [ ] this revision read is not heavy feed regeneration and remains inside the existing bounded DB budget;
- [ ] heavy generation captures the durable revision before generation and re-reads it immediately before publishing success. If changed, discard/retry through existing single-flight rules. If a commit races after the final read, the entry remains tagged with the old revision and cannot be served by a later cache decision that observes the newer revision;
- [ ] because P4 advances revision in the same DB transaction as the effective mutation, no later cache decision depends on a best-effort invalidation callback; post-commit hooks may exist only for telemetry/non-critical work;
- [ ] Draft-only edits/Copy do not advance revision solely because they are not storefront-effective;
- [ ] durable-revision validation does not add request-controlled keys and does not weaken #153 fixed-key/single-flight/complete-success-only/60s negative-backoff/no-partial-200 semantics;
- [ ] if current deployment topology cannot provide the durable revision visibility plus the same cache-domain single-flight/backoff guarantees, Merchant remains mechanically disabled/fail-closed;
- [ ] structured Offer uses effective price only when #152 W4/#153 M2 can truthfully represent the variant; unsupported cases fail closed/omit;
- [ ] disabled GTM/Merchant consumers may remain mechanically off and do not block promotion activation; once enabled, their own gate requires these convergence checks first.

**Verification:** analytics mapping + Purchase snapshot tests; Meta regression where applicable; Merchant normal/sale/start/end transition cache tests; cached-normal→immediate Publish→next cache decision reads newer revision/rebuild; cached-sale→Disable→rebuild; Scheduled edit moving boundary inside TTL→rebuild; race A: revision read before commit may finish with old body as pre-mutation request; race B: revision read after commit must reject old body; concurrent GET after revision change still one heavy generation; stale in-flight pre-mutation generator cannot be served as current after a later cache decision observes the new revision; negative sentinel remains isolated from valid success generation; visible PDP ↔ Merchant ↔ JSON-LD consistency where representable; inventory W15 coverage before new SEO smoke gates.

**Dependencies:** P10 + P4 atomic durable revision + only the relevant enabled #153 consumer slices.

**Scope:** split into focused analytics/Meta, Merchant and SEO consumer PRs; do not bundle independent subsystems.

## G2 — observability, readiness and rollback

**Description:** Make incidents bounded, visible and reversible.

**Acceptance criteria:**
- [ ] redacted/bounded telemetry for activation rejection, invalid/recovery, conflict, `PARTIALLY_INVALID`, `PRICE_CHANGED`/quote-proof rejection, Merchant durable-revision mismatch/rebuild, Pancake semantic validation and activation-gate state;
- [ ] no PII/secrets/raw external payloads/raw quote proofs/cart UUIDs logged;
- [ ] rollback is activation gate off + explicit campaign Disable; Disable remains bounded after >2000 dynamic variants and advances the durable promotion-pricing revision in the same transaction;
- [ ] when Merchant is enabled, later cache decisions observe that revision and stale sale bytes cannot mask rollback; no best-effort post-commit invalidation is required for correctness;
- [ ] rollout evidence includes mirrored-money audit and Pancake custom-price acceptance.

**Verification:** telemetry tests/inspection; runbook review; safe rollback rehearsal where possible; Merchant rollback durable-revision regression when enabled.

**Dependencies:** P10.

**Scope:** S/M.

## G3 — final DoD

**Description:** Verify integrated current truth on exact implementation head.

**Acceptance criteria:**
- [ ] focused + relevant DB/domain/lint/typecheck/build/runtime/browser/a11y gates green;
- [ ] no duplicate pricing authority, N+1, unbounded query/proof state, exposed cart session handle or unrelated refactor;
- [ ] #153 identity/cart/Purchase/Merchant-cache regressions remain green;
- [ ] #152 indexing policy remains unchanged unless separately approved;
- [ ] docs/runbooks describe current launch and rollback truth.

**Verification:** repository-native full gates + representative browser flows + human final review.

**Dependencies:** G1 + G2.

**Scope:** verification/ops only unless a focused defect fix is needed.

## D. Recommended PR sequence

1. `promo-A1-persistence` — P1 including durable promotion-pricing revision
2. `promo-A2-pricing-domain` — P2
3. `promo-B1-repository-lifecycle` — P3
4. `promo-B2-admin-domain` — P4 atomic revision advance
5. `promo-C-admin-ux` — P5
6. converge #153 T4 identity facts
7. `promo-D1-pdp` — P6
8. `promo-D2-shop-discovery` — P7a
9. `promo-D3-flash-freshness` — P7b
10. converge one shared #153 T5/T6 cart contract
11. `promo-E1-draft-quote` — P8
12. `promo-E2-stateless-render-proof-reconfirm` — P9a
13. `promo-E3-fresh-pancake-reconfirm` — P9b
14. `promo-F-pancake-final-price` — P10
15. #153 T7 Purchase consumes finalized snapshot
16. G1 consumer PRs only for consumers intended/enabled at that rollout stage
17. G2 readiness
18. G3 final integrated verification

Every implementation PR starts from then-current `main`, re-reads directly affected code/contracts, carries directly affected tests, targets S/M review size and is independently revertable.

## E. Parallelization

Safe early parallel work:
- P1 persistence/revision;
- #153 T1–T3 tracking preparation with **no GTM loader**;
- #152 temporary-domain indexation enforcement;
- read-only P2/M1 evidence collection.

Contract-first coordination:
- P6 ↔ #153 T4 identity;
- P8/P9 ↔ #153 T5/T6 cart mutation/snapshot;
- structured data ↔ #152 W4 + #153 M2 deep link;
- Merchant M3/M4 ↔ P7 effective pricing/transition facts + P4 atomic durable promotion-pricing revision.

Sequential:
- P1→P2→P3→P4;
- P8→P9a→P9b→P10;
- any enabled price-bearing consumer must converge before it is used with active promotions.

## F. Separate launch gates

Promotion code may deploy with activation gate off. Real discounted campaigns require:
- P1–P10 accepted;
- mirrored-money/Pancake catalog evidence accepted;
- controlled Pancake custom-price semantic acceptance succeeds;
- all **currently enabled** price-bearing consumers are converged, or remain explicitly disabled/fail-closed;
- if Merchant is enabled, durable transactional revision + cache-decision revision linearization + in-flight tagged-revision guard + transition-aware effective expiry are proved in the same cache domain;
- G2 rollback/readiness accepted;
- G3 DoD green;
- human explicitly enables promotion activation.

This does **not** publish GTM, activate Merchant or enable organic indexing. Those remain separate #153/#152 gates. Conversely, future GTM/Merchant activation must verify promotion-aware monetary behavior if promotions are then active.

## G. Out of scope

Coupons/stacking/BXGY/quotas/personalized pricing; promotion writeback to Pancake; TikTok Events API; Meta migration to GTM; Merchant API realtime sync; composite Merchant offers; permanent-domain/indexing change; unrelated storefront/admin refactor.