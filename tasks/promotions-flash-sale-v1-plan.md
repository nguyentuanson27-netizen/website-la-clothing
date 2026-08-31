# Promotions & Flash Sale v1 — implementation plan

Status: **PLANNING ONLY — implementation has not started.**

Source of truth: `docs/specs/promotions-flash-sale-v1.md`.

Planning base: `main@323c07cf25c834e36e4a43952df3f0ee7321d756` after PR #152 (SEO/GEO audit) and PR #153 (marketing analytics + Google Shopping) merged.

This plan is the feature-local execution plan for promotions. Cross-feature ownership is no longer left to “rediscover later”: PR #153 is now a binding dependency wherever analytics, external item identity, cart mutation snapshots, Merchant, or variant deep links intersect promotion work.

Review order: correctness → security → architecture → simplicity → performance.

## 1. Non-negotiable ownership contracts

### Pricing authority
- `VariantMirror.pancakeRetailPrice` is the Pancake base-price input after the approved evidence gates.
- Website campaign state owns promotional pricing.
- One TypeScript semantic resolver owns base/effective price, promotion metadata, conflict/invalid state and transition facts.
- One sanctioned SQL projection may mirror that contract only for bounded pre-pagination storefront queries and must stay parity-tested against the TypeScript resolver.
- UI, cart, checkout, analytics, Merchant, structured data and Pancake submission must consume authoritative quote/snapshot facts; none may reimplement promotion math.

### Identity authority from PR #153
- product-level upper funnel identity: `pancakeProductId` when a concrete variant is not selected;
- selected/committed variant identity: `pancakeVariationId`;
- internal `VariantMirror.id` remains authorization/mutation identity and is never a vendor external item ID;
- Purchase transaction/event identity remains `OrderMirror.publicCode`.

Promotion work must preserve these identities when extending storefront, cart, checkout and final order snapshots.

### Cart/checkout truth from PR #153
- PDP “Thêm vào giỏ hàng” is a dedicated atomic `+1` server mutation, not absolute `set quantity = 1`;
- accepted cart mutations return committed quantity transition + bounded server-authoritative non-PII item facts;
- mutation analytics never fall back to rendered/client-cached price, identity, quantity or name;
- `view_cart` / `begin_checkout` use one complete all-or-nothing canonical projection; an unsafe line suppresses the event, not commerce;
- promotion pricing must plug into these server-authoritative facts rather than create a parallel cart API.

### SEO/GEO + Merchant ownership
- PR #152 W3 still requires `pnpm pancake:catalog:audit` evidence before the current equality gate is removed.
- PR #153 M2 owns the standalone variant deep-link shape `/shop/<slug>?variant=<pancakeVariationId>` and its preselection/canonical-query contract; promotion PDP work must support this URL rather than invent another variant URL.
- Merchant v1 is standalone-only; composite Merchant offers remain deferred.
- Merchant mapper consumes the current authoritative storefront effective price after promotion pricing is implemented.
- JSON-LD may emit/update an Offer only when the SEO contract can truthfully represent it; do not use `AggregateOffer` as a shortcut for variants.
- Organic indexing remains separately gated by ADR 0004 and is not enabled by promotion, GTM or Merchant work.

## 2. Previously reviewed promotion invariants retained

The detailed rules stay normative in the spec. Implementation must preserve at least these reviewed constraints:

- PRODUCT target coverage is dynamic over current/restored/later variants; no frozen membership table.
- same campaign cannot target a PRODUCT and separately target an already-covered variant.
- percentage is integer `1..99`; fixed value is final customer unit price.
- base money boundary is positive safe-integer VND; mirrored Pancake columns remain `Float?`.
- percentage arithmetic uses exact integer/BigInt semantics; SQL casts validated base to `numeric` before arithmetic; mandatory parity includes exact-half and upper-safe fixtures.
- runtime invalidity/conflict is affected-variant fail-closed; healthy siblings continue and product health may be `PARTIALLY_INVALID`.
- enabled campaigns cannot overlap on effective variant coverage, including PRODUCT↔VARIANT races.
- publish/re-enable/Scheduled material edit uses deterministic lock order and bounded expansion; Disable and Copy remain separate bounded paths so rollback cannot be blocked by later catalog growth.
- lifecycle derives Draft/Scheduled/Active/Ended/Disabled correctly with restart and zero traffic; legal never-Active re-enable writes fresh `enabledAt` and clears `disabledAt` atomically.
- activation gate defaults safe/off; activation is not enabled merely because code is deployed.
- cards/PDP/Flash Sale use one request clock and relative freshness with maximum 60s stale window; `/shop` and `/flash-sale` reuse existing page/offset bounds.
- checkout has two stale windows: rendered buyer quote → DRAFT and DRAFT → fresher Pancake quote; mismatch returns typed `PRICE_CHANGED` and requires explicit resubmit.
- final order-line base/final/promotion audit facts become immutable on finalization.
- Pancake submission must remove all three raw-live-price assumptions: comparison, totals recomputation and outbound unit price.
- controlled Pancake semantic acceptance of website-provided discounted `variation_info.retail_price` remains a launch prerequisite.

## 3. Dependency graph

```text
P0 reconcile planning with current main (#152 + #153)
 ↓
P1 promotion persistence + additive order audit
 ↓
P2 central pricing domain + Pancake/catalog evidence
 ↓
P3 campaign repository/lifecycle/runtime health
 ↓
P4 concurrency-safe admin domain + activation gate
 ↓
Checkpoint A
 ├──────────────→ P5 admin UX
 └──────────────→ P6 PDP/composite promotion projection
                       ↑
                 PR #153 T4 identity facts
                       ↓
                    P7a /shop cards/discovery/shared SQL
                       ↓
                    P7b /flash-sale + freshness
                       ↓
                    Checkpoint B
                       ↓
              PR #153 T5/T6 cart mutation/projection contract
                       ↓
                    P8 DRAFT quote + promotion audit
                       ↓
                    P9a rendered quote → DRAFT reconfirm
                       ↓
                    P9b DRAFT → fresh Pancake reconfirm
                       ↓
                    P10 final Pancake price convergence
                       ↓
              PR #153 T7 confirmed Purchase consumer
                       ↓
            G1 SEO/analytics/Merchant monetary convergence
              G2 ops/readiness   G3 final browser/DoD
                       ↓
                    launch gates
```

Coordination rule: shared API contracts are defined once before parallel consumers. Do not let #151 and #153 land competing product/variant/cart fact shapes.

## 4. Implementation slices

### P0 — Planning reconciliation and implementation gate

**Description:** Refresh promotion planning against current `main` after #152/#153 and lock cross-feature ownership before runtime work.

**Acceptance criteria:**
- [ ] branch is based on current reviewed `main` containing #152 and #153;
- [ ] no promotion task claims ownership of GTM/dataLayer/vendor event mapping or Merchant identity rules;
- [ ] #153 identity/cart/deep-link contracts are referenced explicitly where promotion work depends on them;
- [ ] fresh review has no Critical/Required findings before `/build`.

**Verification:** compare branch to `main`; review spec/plan/todo consistency; exact-head CI.

**Dependencies:** none.

**Files likely touched:** planning artifacts only.

**Estimated scope:** S.

---

### P1 — Persistence + additive migration

**Description:** Add minimal website-owned campaign/target persistence and additive immutable order-line promotion audit fields.

**Acceptance criteria:**
- [ ] campaign/target shape, uniqueness and money constraints are enforced server/DB-side;
- [ ] `OrderLineSnapshot` gains base/final/promotion audit fields without removing the #153-required purchased `pancakeVariationId` and existing immutable facts;
- [ ] mirrored Pancake prices remain `Float?`; no campaign delete is introduced.

**Verification:** RED/GREEN DB tests; Prisma validate/generate/migration deploy; historical-row compatibility; focused schema tests.

**Dependencies:** P0.

**Likely files:** `prisma/schema.prisma`, additive migration, DB/domain tests.

**Estimated scope:** M; split migration/tests if >5 files.

---

### P2 — Central pricing domain + evidence gate

**Description:** Implement the pure pricing authority before any storefront/cart/Merchant consumer switches behavior.

**Acceptance criteria:**
- [ ] explicit-`now` resolver covers base/effective price, percentage/fixed rules, promotion snapshot, conflict/invalid reasons and transition fact;
- [ ] exact BigInt percentage semantics and positive-safe-integer boundary are tested across half/upper-safe/low-price cases;
- [ ] read-only mirrored-money audit and `pnpm pancake:catalog:audit` evidence required by #152 W3 are recorded before removing the current equality gate;
- [ ] no evidence automatically promotes `pancakeRetailPriceAfterDiscount` to website authority.

**Verification:** focused domain table tests including `150@1%=149`, `350@1%=347`, `110@5%=105`, upper-safe fixture, fixed drift/recovery, invalid/conflict/unusable base; sanitized audit evidence.

**Dependencies:** P1.

**Likely files:** new pricing domain module/tests, bounded audit script/test/docs.

**Estimated scope:** M.

---

### P3 — Campaign repository, lifecycle and runtime health

**Description:** Add bounded candidate lookup and durable lifecycle semantics around the central resolver.

**Acceptance criteria:**
- [ ] dynamic PRODUCT coverage and direct VARIANT coverage resolve by real variant + owning product;
- [ ] zero-traffic lifecycle/terminality and legal re-enable clearing `disabledAt` are deterministic with explicit `now`;
- [ ] runtime invalid/conflict/recovery is per affected variant and exposes typed health;
- [ ] Copy snapshots explicit targets only, uses deterministic bounded name and does not expand PRODUCT coverage.

**Verification:** lifecycle boundary tests; composite real-owner tests; Copy 119/120/surrogate/Copy-of-Copy; >2000 source Copy; bounded query-count tests.

**Dependencies:** P2.

**Estimated scope:** M; split lifecycle/candidate repository if necessary.

---

### P4 — Concurrency-safe admin domain + activation gate

**Description:** Make enabled mutations race-safe and keep incident rollback bounded.

**Acceptance criteria:**
- [ ] ADMIN authz + all named bounds enforced;
- [ ] publish/re-enable/Scheduled material edit locks campaign → owning products → bounded expansion probe → needed variants and atomically rejects overlap/invalid state;
- [ ] same-campaign lost update and cross-campaign overlap races are guarded;
- [ ] Disable is campaign-row bounded and still succeeds after dynamic PRODUCT coverage grows beyond 2000;
- [ ] server activation gate defaults off and blocks new effective activation with typed `ACTIVATION_DISABLED`.

**Verification:** repeated concurrency tests; 2000/2001 expansion; 1900→2001 Disable; gate-off regressions; no partial writes.

**Dependencies:** P3.

**Estimated scope:** M per sub-slice; split concurrency primitive from admin mutation service if >5 files.

### Checkpoint A
- migration/repository tests green;
- concurrency regression repeated successfully;
- activation gate default-off verified;
- security review: admin authz, bounded input, no secret/PII logging;
- 0 Critical/Required.

---

### P5 — Admin UX

**Description:** Build `/admin/promotions` on the P4 service boundary without duplicating business logic.

**Acceptance criteria:**
- [ ] bounded list/search and lifecycle-appropriate create/edit/publish/re-enable/disable/copy;
- [ ] typed validation/overlap/expansion/activation-disabled feedback;
- [ ] product admin shows related-campaign summary/link only;
- [ ] no pricing or overlap math in React.

**Verification:** focused service/action/component tests; non-admin rejection; keyboard/Axe/mobile checks.

**Dependencies:** P4.

**Estimated scope:** M slices.

---

### P6 — PDP/composite promotion projection on shared identity facts

**Description:** Switch selected variant pricing to the central resolver while preserving #153 external identity and later deep-link requirements.

**Acceptance criteria:**
- [ ] equality gate is removed only after P2 evidence review;
- [ ] selected concrete option carries/retains `pancakeVariationId`; composite price ownership follows the real selected component variant/owning product;
- [ ] sale/Flash UI consumes resolver quote and never computes discount locally;
- [ ] the planned `/shop/<slug>?variant=<pancakeVariationId>` preselection from #153 M2 can land without a competing promotion URL/state model;
- [ ] no per-option N+1 query.

**Verification:** standalone/composite selected-option tests; promotion from actual owner only; invalid/unusable base; deep-link compatibility fixtures when M2 lands; browser PDP checks.

**Dependencies:** P4 + #153 T4 identity propagation; P2 audit accepted.

**Estimated scope:** M.

---

### P7a — Cards + `/shop` effective-price discovery

**Description:** Make bounded listing filter/sort/card presentation use the same current effective-price contract.

**Acceptance criteria:**
- [ ] min/max/price sort run pre-pagination on authoritative effective price;
- [ ] one `requestNow` spans count/order/SQL projection/hydration/card/transition aggregate;
- [ ] sanctioned SQL casts validated base to `numeric` before percentage arithmetic and matches TypeScript semantics;
- [ ] representative sale wording follows the spec and preserves product-level identity for upper-funnel analytics;
- [ ] off-page future transition can trigger refresh before membership/order becomes stale.

**Verification:** SQL↔TS parity; filter/sort/pagination; off-page transition; existing page/offset bounds; no N+1.

**Dependencies:** P6.

**Estimated scope:** M.

---

### P7b — `/flash-sale` + freshness

**Description:** Add active-valid Flash Sale membership using the same SQL projection and bounded storefront query contract.

**Acceptance criteria:**
- [ ] active-valid Flash variants only; no second promotion predicate;
- [ ] page parser ≤10000, page size ≤48, offset ≤50000; page 1042/1043 boundary covered for size 48;
- [ ] empty route knows the next enabled Flash boundary;
- [ ] server emits relative refresh delay ≤60s; client has visibility/pageshow resume guard and does not depend on browser wall-clock correctness.

**Verification:** empty→active sale, boundary end, clock skew, background resume, pagination/offset, query budget.

**Dependencies:** P7a.

**Estimated scope:** M.

### Checkpoint B
- storefront/PDP/cards/Flash use the central resolver/projection;
- #153 product-level vs selected-variant identity remains intact;
- SQL↔TS parity green;
- browser freshness/a11y checks pass for touched surfaces;
- 0 Critical/Required.

---

### Shared cart contract checkpoint — #153 T5/T6

Before P8/P9 changes checkout orchestration, the implementation sequence must converge on one cart API shape owned jointly by commerce requirements:
- PDP add is atomic `+1`;
- update/remove return committed transition + authoritative bounded item snapshot;
- concrete cart lines propagate `pancakeVariationId`;
- cart/checkout analytics projection is complete/all-or-nothing;
- server-authoritative unit price comes from the current promotion resolver when promotions are present.

If #153 T5/T6 has not landed yet, implement the shared API once in the earlier of the two workstreams and make the other consume it; do not create temporary duplicate mutation paths.

---

### P8 — Mutable DRAFT quote + promotion audit

**Description:** Create/update DRAFT order facts from the central quote and retain the identity/snapshot facts required by #153 Purchase.

**Acceptance criteria:**
- [ ] DRAFT line stores base/final/promotion audit plus purchased `pancakeVariationId`, product/name/options/quantity facts;
- [ ] browser-supplied rendered quote is stale-detection input only, never price authority;
- [ ] mutation remains retryable/mutable only while DRAFT; final pricing freezes at the guarded transition out of DRAFT;
- [ ] no campaign activation is possible in production while downstream P9/P10 convergence is incomplete.

**Verification:** initial DRAFT price/audit; promotion/no-promotion; composite real variant identity; retryable DRAFT replacement; invalid base.

**Dependencies:** P7b + shared #153 T5/T6 cart contract.

**Estimated scope:** M.

---

### P9a — Rendered quote → DRAFT reconfirmation

**Description:** Prevent first-click submission when the customer-visible quote changed before DRAFT creation.

**Acceptance criteria:**
- [ ] server recomputes current quote before submit-capable DRAFT acceptance;
- [ ] mismatch returns typed `PRICE_CHANGED` with refreshed totals, remains outside `POS_SUBMITTING`, makes no Pancake create call;
- [ ] explicit second submit is required after the buyer sees the refreshed price.

**Verification:** customer sees 400k → promotion ends → first submit returns 500k `PRICE_CHANGED` with zero POS write → second unchanged submit may continue.

**Dependencies:** P8.

**Estimated scope:** S/M.

---

### P9b — DRAFT → fresher Pancake quote reconfirmation

**Description:** Re-resolve a fresher trusted Pancake base through the same pricing resolver immediately before final submission.

**Acceptance criteria:**
- [ ] compare DRAFT final quote to fresh effective website quote, never raw Pancake retail;
- [ ] mismatch atomically refreshes DRAFT line/audit/totals and returns `PRICE_CHANGED` with no Pancake create call;
- [ ] percentage recalculates; fixed price is revalidated against fresh base; repeated drift repeats the handshake without stale-loop behavior.

**Verification:** fresh base drift for %/fixed, promotion start/end, invalid/recovery, no POS call on mismatch.

**Dependencies:** P9a.

**Estimated scope:** M.

---

### P10 — Pancake final-price convergence + semantic acceptance

**Description:** Remove every raw-live-price assumption from final order submission and prove Pancake accepts website-owned final unit price.

**Acceptance criteria:**
- [ ] `PRICE_CHANGED` comparison uses fresh effective quote;
- [ ] merchandise/shipping/total integrity uses authoritative effective/final values;
- [ ] outbound `variation_info.retail_price` uses finalized immutable `OrderLineSnapshot.unitPriceVnd`;
- [ ] tests fail independently if any one of the three paths regresses to raw `livePrice`;
- [ ] controlled authorized Pancake semantic acceptance verifies requested discounted line price is accepted/preserved; no blind retry and ambiguous outcomes retain `SYNC_UNKNOWN` semantics.

**Verification:** three independent regressions; full submission tests; sanitized controlled acceptance evidence; cleanup if safe.

**Dependencies:** P9b.

**Estimated scope:** M.

---

### G1 — SEO + analytics + Merchant monetary convergence

**Description:** Make downstream consumers read promotion pricing from the already-merged contracts instead of redesigning their ownership.

**Acceptance criteria:**
- [ ] PR #153 canonical events consume current authoritative `effectivePriceVnd` for storefront/cart events and immutable finalized order money for Purchase;
- [ ] product-level upper-funnel events do not fabricate a selected variation or exact price from a range;
- [ ] Merchant mapper M3 consumes current storefront effective price for eligible standalone variants; no Merchant promotion formula exists;
- [ ] structured Offer price uses the same effective price only when #152/#153 variant URL/schema contract can represent it truthfully; unsupported cases fail closed/omit rather than use misleading `AggregateOffer`;
- [ ] inventory W15 SEO runtime coverage before adding new smoke jobs.

**Verification:** mapping/unit tests; Purchase snapshot regression; Merchant normal/sale/ended-sale fixtures; visible PDP ↔ Merchant ↔ JSON-LD consistency where representable; no duplicate GTM/Meta ownership.

**Dependencies:** P10 + relevant #153 T1–T8/M2–M4 slices.

**Estimated scope:** split by consumer; do not combine independent SEO/GTM/Merchant code into one implementation PR.

---

### G2 — Observability, readiness and rollback

**Description:** Make activation/incident behavior observable and reversible.

**Acceptance criteria:**
- [ ] bounded/redacted telemetry for activation rejection, overlap conflict, PARTIALLY_INVALID/recovery, `PRICE_CHANGED`, Pancake semantic validation and activation-gate state;
- [ ] no PII/secrets or raw external payloads logged;
- [ ] rollback procedure: activation gate off + existing campaign Disable remains available even after dynamic growth;
- [ ] rollout evidence includes mirrored-money audit and Pancake custom-price acceptance.

**Verification:** focused telemetry tests/inspection; runbook review; rollback rehearsal where safe.

**Dependencies:** P10.

**Estimated scope:** S/M.

---

### G3 — Final browser/DoD convergence

**Description:** Run the standing Definition of Done against the integrated implementation, not isolated feature assumptions.

**Acceptance criteria:**
- [ ] relevant lint/typecheck/domain/DB/build/runtime/browser/a11y suites green on exact head;
- [ ] promotion code has no duplicate pricing authority, N+1 or unbounded queries;
- [ ] #153 identity/cart/Purchase contracts remain green;
- [ ] #152 indexation policy remains unchanged unless separately approved;
- [ ] docs/runbooks describe current truth and launch/rollback gates.

**Verification:** repository-native full gates plus targeted browser checks for card/PDP/Flash/cart/checkout/success; human final review.

**Dependencies:** G1 + G2.

**Estimated scope:** verification/ops only unless a verified defect requires a focused fix.

## 5. Recommended implementation PR sequence

1. `promo-A1-persistence` — P1
2. `promo-A2-pricing-domain` — P2
3. `promo-B1-repository-lifecycle` — P3
4. `promo-B2-admin-domain` — P4
5. `promo-C-admin-ux` — P5
6. converge #153 T4 identity facts before or with `promo-D1-pdp`
7. `promo-D1-pdp` — P6
8. `promo-D2-shop-discovery` — P7a
9. `promo-D3-flash-freshness` — P7b
10. converge one shared #153 T5/T6 cart mutation/projection contract
11. `promo-E1-draft-quote` — P8
12. `promo-E2-render-reconfirm` — P9a
13. `promo-E3-fresh-pancake-reconfirm` — P9b
14. `promo-F-pancake-final-price` — P10
15. #153 T7 Purchase consumes finalized snapshot
16. G1 split into focused analytics / Merchant / SEO consumer PRs as their own plans require
17. G2 readiness
18. G3 final integrated verification

Every implementation PR starts from then-current `main`, re-reads directly affected code and merged planning contracts, contains its directly affected tests, and is independently reviewable/revertable.

## 6. Parallelization

Safe before shared commerce APIs change:
- P1 persistence;
- #153 T1–T3 tracking preparation with **no GTM loader**;
- #152 indexation-enforcement work;
- read-only P2/M1 audits.

Needs contract-first coordination:
- P6 with #153 T4 product/variant identity;
- P8/P9 with #153 T5/T6 cart mutation/snapshot APIs;
- G1 with #153 T7/T8 and M3/M4 consumers;
- structured data with #152 W4 + #153 M2 variant deep link.

Must remain sequential:
- P1 → P2 → P3 → P4 for promotion authority;
- P8 → P9a → P9b → P10 for transactional pricing;
- Merchant sale-price activation only after storefront promotion pricing exists;
- real promotion activation only after P10 + G1/G2/G3 gates.

## 7. Launch gates are separate

Promotion runtime may be deployed with its activation gate off. Real discounted campaigns require:
- P1–P10 accepted;
- mirrored-money + Pancake catalog evidence accepted;
- controlled Pancake custom-price semantic acceptance succeeds;
- G1 consumer convergence accepted;
- G2 rollback/readiness accepted;
- G3 DoD green;
- human explicitly enables the promotion activation gate.

This does **not** automatically publish GTM, activate Merchant, or enable organic indexing. Those remain separate gates owned by #153/#152.

## 8. Out of scope

- coupons, stacking, BXGY, quotas, personalized pricing;
- promotion writeback to Pancake catalog;
- TikTok Events API;
- Meta migration into GTM;
- Merchant API realtime sync;
- composite Merchant offers;
- permanent-domain/indexing policy change;
- unrelated storefront/admin refactor.
