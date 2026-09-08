# Promotion Program Definition of Done — G3 Integrated Verification Record

Owning sources:
- `tasks/growth-commerce-master-plan.md` §Wave 7 / U43 (#151 G3)
- `tasks/promotions-flash-sale-v1-todo.md` §G3
- `tasks/promotions-flash-sale-v1-plan.md` §G3
- `docs/specs/promotions-flash-sale-v1.md`

Status: **G3 INTEGRATED DOD PASS — 0 Critical / 0 Required**

Integration branch: `feat/u43-integrated-dod`
Integrated units:
- **U39** (#151 G1, PR #223, commit `fde935eb4afd223bcd6c9ef6edcfc3c09480a03b`, merged to `main@ad04c7dc244e5622d79fdcc840dd2ddaa4c42c77`): Enabled-consumer monetary convergence, shared production Meta Pixel builders (`src/commerce/meta-pixel-parameters.ts`), and drift detection.
- **U40** (#151 G2, PR #224, repaired head `7e54325d3977de687632e3547c2ea8153c686b7a`): Promotion observability, bounded-memory complete-coverage runtime health evaluation, concurrent candidate conflict detection (`readApplicablePromotionCampaignsBatched`), source-authority fail-closed diagnostics, operational admin actions/page caller integration, fail-open telemetry writer isolation, and executable rollback runbook.

> [!IMPORTANT]
> **Activation remains default-off / fail-closed.** This record verifies the integrated Definition of Done across all implemented commerce foundations. It does **not** enable promotion activation, Google Merchant feed, GTM live tracking, search indexing, or any production launch gate.

---

## 1. Integrated Architecture & Scope

This integration head brings together the full critical path for Growth + Commerce Wave 7:
1. **U39 / G1 (Enabled-Consumer Monetary Convergence)**: Proves that every currently active price-bearing consumer (PDP selection, Cart lines, Checkout quote, Quote-proof issuance, Meta purchase snapshot, Schema.org Offer) derives from the single central pricing resolver (`resolvePromotionPricing`), safe-integer VND arithmetic, and external canonical identities (`pancakeProductId`, `pancakeVariationId`, `publicCode`). Direct Meta Pixel emitters consume shared production builders (`src/commerce/meta-pixel-parameters.ts`) with drift assertions.
2. **U40 / G2 (Promotion Observability, Readiness & Rollback)**: Provides bounded, redacted NDJSON telemetry (`promotion.runtime_health`, `checkout.quote_proof_rejected`, `promotion.activation_gate`, `promotion.activation_rejected`), complete coverage runtime health evaluation with bounded process state, concurrent campaign conflict detection populating `conflictingCampaignIds`, operational callers in admin page and actions, production activation wiring (`publishPromotionCampaign`), fail-open telemetry-writer isolation protecting commerce mutations, fail-closed handling when candidate/source truth is unavailable, operational runbook (`docs/operations/promotion-rollback-runbook.md`), clear separation between P9a rendered-quote proof rejection (canonical 5 reasons) and P9b POS submission repricing, wide campaign rollback resilience (>2,000 variants without `TARGET_EXPANSION_LIMIT_EXCEEDED`), and atomic promotion revision invalidation for downstream caches.
3. **U43 / G3 (Promotion Final Integrated DoD)**: Reconciles and verifies the complete integrated state against the 15 Definition of Done criteria and applicable #153/#152 regressions.

---

## 2. Fifteen-Axis Definition of Done Scorecard

| # | DoD Requirement | Status | Evidence & Implementation Grounding |
|---|---|---|---|
| **1** | **Focused new/regression tests** | **PASS** | `tests/domain/promotion-integrated-dod.test.ts`, `tests/domain/monetary-convergence.test.ts`, `tests/domain/promotion-observability-readiness-rollback.test.ts`, and `tests/domain/promotion-runtime-health-regression.test.ts` (3 focused guards for page-by-page aggregation, candidate-authority failure, and executable rollback command/session shape). |
| **2** | **Relevant DB/domain suites green** | **PASS** | Exact-head CI runs the full relevant DB/domain suite; the final workflow evidence is authoritative rather than a copied historical test-count snapshot. |
| **3** | **Lint green** | **PASS** | Exact-head CI `verify` runs ESLint. |
| **4** | **Typecheck green** | **PASS** | Exact-head CI `verify` runs TypeScript typecheck. |
| **5** | **Production build green** | **PASS** | Verified by exact-head CI `verify` build step. |
| **6** | **Applicable runtime/browser/a11y green** | **PASS** | Verified by exact-head runtime workflows including the admin accessibility path. |
| **7** | **No duplicate pricing/business logic** | **PASS** | Pure `resolvePromotionPricing` remains the sole pricing authority. Runtime health consumes that resolver and the canonical candidate reader; it does not implement a second promotion-selection algorithm. Direct Meta Pixel uses shared `meta-pixel-parameters.ts`. |
| **8** | **No unrelated refactor** | **PASS** | Changes remain limited to promotion observability/readiness, rollback documentation, consumer convergence evidence, and focused regressions. |
| **9** | **No N+1 / unbounded query or state** | **PASS** | Runtime-health coverage is cursor-paginated in 500-row pages; each page is candidate-resolved through the existing ≤200-ID batching authority, immediately aggregated into scalar counters plus a 50-item affected sample, then discarded. No campaign-wide `variants`, ID set, or `outcomes` array is retained. Quote proofs remain stateless/bounded, disablement remains O(1), and feed reads retain their existing bounds. |
| **10** | **No raw HttpOnly cart/session handle exposed** | **PASS** | Anonymous cart UUID is mixed strictly as length-prefixed HMAC MAC context; never serialized into browser tokens, URLs, or logs. |
| **11** | **Security & privacy review complete** | **PASS** | Telemetry enforces single-line NDJSON <1KB with zero customer PII, zero tokens, zero secrets, zero cart UUIDs, and zero money amounts. Telemetry-writer failures are fail-open; candidate/source lookup failures are not converted into a false `HEALTHY` diagnostic. |
| **12** | **Docs/runbooks current** | **PASS** | `docs/operations/promotion-rollback-runbook.md` uses the canonical five quote-proof reasons, the production event name `promotion.activation_rejected`, and an emergency Node 22 command that runs in module mode with the admin-session shape required by `requireAdminSession`. |
| **13** | **#153 identity/cart/Purchase regressions green** | **PASS** | Upper funnel uses `pancakeProductId`; selected/cart items use `pancakeVariationId`; Purchase emits strictly on `CONFIRMED` using immutable snapshot money and `publicCode`. Local CUIDs never leak. |
| **14** | **#153 Merchant-cache regressions green** | **PASS** | Coordinator linear revision read invalidates prior-revision cached XML on revision increment; fails closed with 503 (`MARKET_UNRESOLVED`) while market authority is unwired. |
| **15** | **#152 indexing policy unchanged** | **PASS** | Temporary domain hard block intact; `SEARCH_INDEXING_ENABLED=false` withholds canonical origin and serves `noindex`. Allowing crawlers does not enable indexing. |

---

## 3. Verification Details & Key Invariants

### A. Monetary Authority & Anti-Masquerade Invariants
- `resolvePromotionPricing` governs all pricing. Fixed prices require `0 < fixed < base`; percentages use exact integer BigInt rational math (`half-up`).
- Any concurrent campaign collision terminates in `PROMOTION_CONFLICT` falling back to base price without crashing.
- Product-level price ranges (`la_minimum_price_vnd`, `la_maximum_price_vnd`) never masquerade as exact selected item `price`.

### B. Direct Meta Pixel Parity & Drift Detection
- Direct Meta Pixel parameters (`AddToCart` on `product-purchase-panel.tsx` and `Purchase` on `checkout/success/page.tsx`) consume shared production builders (`buildMetaAddToCartPixelParameters`, `buildMetaPurchasePixelParameters` in `src/commerce/meta-pixel-parameters.ts`).
- Guarantees strict monetary convergence with `resolvePromotionPricing` and `readMetaPurchaseSnapshot`, external identity discipline, CUID absence, and fail-closed handling without drift.

### C. Identity Discipline & Purchase Immutability
- Product card impressions and catalog listings identify products by `pancakeProductId`.
- Variant-level items and cart lines identify items by `pancakeVariationId`.
- Internal CUIDs (`VariantMirror.id`) are internal authorization keys only and never reach external vendors.
- Purchase event (`buildPurchaseEvent`) requires `OrderMirror.state === "CONFIRMED"`. `DRAFT`, `VALIDATING`, `POS_SUBMITTING`, `SYNC_UNKNOWN`, and `REJECTED` suppress Purchase emission completely.
- `publicCode` serves as both transaction ID and event ID.

### D. Merchant Feed Fail-Closed & Cache Linearization
- Feed coordinator (`createMerchantFeedCoordinator`) verifies durable promotion pricing revision on every request.
- Advancing `PromotionPricingRevision` during campaign commit or rollback invalidates cached XML on the next linear read without relying on best-effort callbacks.
- Feed endpoint safely answers HTTP 503 `MARKET_UNRESOLVED` until reviewed trusted server-owned market authority is implemented.

### E. Observability, Runtime Health & Rollback Safety
- Telemetry emits structured single-line NDJSON logs strictly bounded to <1024 bytes (`MAX_REPORTED_HEALTH_SAMPLE = 5`, `MAX_REPORTED_SIGNAL_IDENTIFIERS = 10`).
- Runtime campaign health is wired into real production paths: activation/edit validation, on-demand `evaluateCampaignRuntimeHealth`, campaign view/edit in `src/app/admin/promotions/page.tsx`, and `checkPromotionRuntimeHealthAction` in `src/app/admin/promotions/actions.ts`.
- Full dynamic coverage is evaluated without campaign-wide materialization: each 500-row cursor page is candidate-resolved, priced, aggregated into counters plus the bounded affected sample, and discarded before the next page.
- Candidate-source truth is authoritative. If candidate lookup throws, reports unknown variants, or pagination cannot advance, the on-demand evaluator returns unavailable (`null`) and emits no partial/false `HEALTHY` runtime-health signal.
- Concurrent conflict detection uses `readApplicablePromotionCampaignsBatched` plus `resolvePromotionPricing`, populating bounded `conflictingCampaignIds` for sampled affected variants.
- Telemetry-writer errors remain fail-open so observability sink failures never change commerce/admin outcomes.
- Rendered-quote proof rejection records the exact canonical five reasons (`PRICE_CHANGED`, `PROOF_MISSING`, `PROOF_OVERSIZED`, `PROOF_MALFORMED`, `PROOF_UNVERIFIED`) under phase `rendered_quote_verification`, isolated from downstream POS submit repricing (`pancake_order.quote_repriced`). Zero proof tokens, secrets, or cart UUIDs are logged.
- Emergency kill-switch remains `LA_PROMOTION_ACTIVATION_ENABLED=false`. Targeted disablement is an O(1) campaign-row mutation plus atomic pricing-revision advance. The trusted container-shell fallback command runs Node 22 TypeScript stripping in module mode and supplies the server-required admin-session shape.

---

## 4. Separate Launch Gates Status

All 4 launch gates remain strictly **default-off / fail-closed**:

1. **Gate P (Promotion Activation)**: **OFF** (`LA_PROMOTION_ACTIVATION_ENABLED=false`).
   - P1–P10 plus the G1/G2/G3 implementation gates are verified; activation still requires a separate explicit human owner decision.
2. **Gate M (Merchant Activation)**: **FAIL-CLOSED** (`MARKET_UNRESOLVED` -> HTTP 503).
   - Awaiting trusted server-owned O2 runtime authority and human activation (U41).
3. **Gate T (GTM Live Tracking)**: **OFF** (zero vendor scripts loaded).
   - Awaiting vendor container configuration and owner approval (U28).
4. **Gate S (Organic Search Indexing)**: **OFF** (temporary domain noindex enforced).
   - Awaiting permanent branded domain and separate human approval.
