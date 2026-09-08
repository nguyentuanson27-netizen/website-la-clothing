# Promotion Program Definition of Done — G3 Integrated Verification Record

Owning sources:
- `tasks/growth-commerce-master-plan.md` §Wave 7 / U43 (#151 G3)
- `tasks/promotions-flash-sale-v1-todo.md` §G3
- `tasks/promotions-flash-sale-v1-plan.md` §G3
- `docs/specs/promotions-flash-sale-v1.md`

Status: **G3 INTEGRATED DOD PASS — 0 Critical / 0 Required**

Integration branch: `feat/u43-integrated-dod`
Integrated units: **U39** (#151 G1, PR #223) + **U40** (#151 G2, PR #224)

> [!IMPORTANT]
> **Activation remains default-off / fail-closed.** This record verifies the integrated Definition of Done across all implemented commerce foundations. It does **not** enable promotion activation, Google Merchant feed, GTM live tracking, search indexing, or any production launch gate.

---

## 1. Integrated Architecture & Scope

This integration head brings together the full critical path for Growth + Commerce Wave 7:
1. **U39 / G1 (Enabled-Consumer Monetary Convergence)**: Proves that every currently active price-bearing consumer (PDP selection, Cart lines, Checkout quote, Quote-proof issuance, Meta purchase snapshot, Schema.org Offer) derives from the single central pricing resolver (`resolvePromotionPricing`), safe-integer VND arithmetic, and external canonical identities (`pancakeProductId`, `pancakeVariationId`, `publicCode`).
2. **U40 / G2 (Promotion Observability, Readiness & Rollback)**: Provides bounded, redacted NDJSON telemetry (`promotion.runtime_health`, `checkout.quote_proof_rejected`, `promotion.activation_gate`, `promotion.activation_rejection`), operational runbook (`docs/operations/promotion-rollback-runbook.md`), clear separation between P9a rendered-quote proof rejection and P9b POS submission repricing, wide campaign rollback resilience (>2,000 variants without `TARGET_EXPANSION_LIMIT_EXCEEDED`), and atomic promotion revision invalidation for downstream caches.
3. **U43 / G3 (Promotion Final Integrated DoD)**: Reconciles and verifies the complete integrated state at exact head against the 14 Definition of Done criteria and applicable #153/#152 regressions.

---

## 2. Fifteen-Axis Definition of Done Scorecard

| # | DoD Requirement | Status | Evidence & Implementation Grounding |
|---|---|---|---|
| **1** | **Focused new/regression tests** | **PASS** | `tests/domain/promotion-integrated-dod.test.ts`, `tests/domain/monetary-convergence.test.ts`, `tests/domain/promotion-observability-readiness-rollback.test.ts`. |
| **2** | **Relevant DB/domain suites green** | **PASS** | All 1,210 domain tests pass cleanly (25 suites). Database activation service tests pass. |
| **3** | **Lint green** | **PASS** | `npx eslint .` passes with 0 errors. |
| **4** | **Typecheck green** | **PASS** | `npx tsc --noEmit` passes with 0 errors. |
| **5** | **Production build green** | **PASS** | Verified in exact-head CI `verify` pipeline. |
| **6** | **Applicable runtime/browser/a11y green** | **PASS** | Verified in `admin-a11y-runtime` pipeline (Playwright + Axe). |
| **7** | **No duplicate pricing/business logic** | **PASS** | Pure `resolvePromotionPricing` is the sole pricing authority. No storefront, cart, checkout, or downstream component reinvents discount math. |
| **8** | **No unrelated refactor** | **PASS** | Changes strictly limited to necessary observability wiring, runbook documentation, and regression assertions. |
| **9** | **No N+1 / unbounded query or state** | **PASS** | Stateless HMAC quote proofs (`laq1`) with 16KB max envelope; zero DB proof rows; O(1) campaign disablement; bounded feed linear reads. |
| **10** | **No raw HttpOnly cart/session handle exposed** | **PASS** | Anonymous cart UUID is mixed strictly as length-prefixed HMAC MAC context; never serialized into browser tokens, URLs, or logs. |
| **11** | **Security & privacy review complete** | **PASS** | Telemetry enforces single-line NDJSON <1KB with zero customer PII, zero tokens, zero secrets, zero cart UUIDs, and zero money amounts. |
| **12** | **Docs/runbooks current** | **PASS** | `docs/operations/promotion-rollback-runbook.md` created; cross-referenced in `docs/operations/release-and-rollback.md`. |
| **13** | **#153 identity/cart/Purchase regressions green** | **PASS** | Upper funnel uses `pancakeProductId`; selected/cart items use `pancakeVariationId`; Purchase emits strictly on `CONFIRMED` using immutable snapshot money and `publicCode`. Local CUIDs never leak. |
| **14** | **#153 Merchant-cache regressions green** | **PASS** | Coordinator linear revision read invalidates prior-revision cached XML on revision increment; fails closed with 503 (`MARKET_UNRESOLVED`) while market authority is unwired. |
| **15** | **#152 indexing policy unchanged** | **PASS** | Temporary domain hard block intact; `SEARCH_INDEXING_ENABLED=false` withholds canonical origin and serves `noindex`. Allowing crawlers (W19) does not enable indexing. |

---

## 3. Verification Details & Key Invariants

### A. Monetary Authority & Anti-Masquerade Invariants
- `resolvePromotionPricing` governs all pricing. Fixed prices require `0 < fixed < base`; percentages use exact integer BigInt rational math (`half-up`).
- Any concurrent campaign collision terminates in `PROMOTION_CONFLICT` falling back to base price without crashing.
- Product-level price ranges (`la_minimum_price_vnd`, `la_maximum_price_vnd`) never masquerade as exact selected item `price`.

### B. Identity Discipline & Purchase Immutability
- Product card impressions and catalog listings identify products by `pancakeProductId`.
- Variant-level items and cart lines identify items by `pancakeVariationId`.
- Internal CUIDs (`VariantMirror.id`) are internal authorization keys only and never reach external vendors.
- Purchase event (`buildPurchaseEvent`) requires `OrderMirror.state === "CONFIRMED"`. `DRAFT`, `VALIDATING`, `POS_SUBMITTING`, `SYNC_UNKNOWN`, and `REJECTED` suppress Purchase emission completely.
- `publicCode` serves as both transaction ID and event ID.

### C. Merchant Feed Fail-Closed & Cache Linearization
- Feed coordinator (`createMerchantFeedCoordinator`) verifies durable promotion pricing revision on every request.
- Advancing `PromotionPricingRevision` during campaign commit or rollback invalidates cached XML on the next linear read without relying on best-effort callbacks.
- Feed endpoint safely answers HTTP 503 `MARKET_UNRESOLVED` until reviewed trusted server-owned market authority is implemented.

### D. Observability & Rollback Safety
- Telemetry emits structured single-line NDJSON logs strictly bounded to <1024 bytes (`MAX_REPORTED_HEALTH_SAMPLE = 5`, `MAX_REPORTED_SIGNAL_IDENTIFIERS = 10`).
- Rendered-quote proof rejection records exact reason (`PROOF_MISSING`, `PROOF_OVERSIZED`, `PROOF_MALFORMED`, `PROOF_UNVERIFIED`, `PRICE_CHANGED`) under phase `rendered_quote_verification`, isolated from downstream POS submit repricing (`pancake_order.quote_repriced`).
- Emergency kill-switch: `LA_PROMOTION_ACTIVATION_ENABLED=false`. Disabling a campaign operates in O(1) time on the database row, successfully rolling back campaigns covering >2,000 variants without encountering `TARGET_EXPANSION_LIMIT_EXCEEDED`.

---

## 4. Separate Launch Gates Status

All 4 launch gates remain strictly **default-off / fail-closed**:

1. **Gate P (Promotion Activation)**: **OFF** (`LA_PROMOTION_ACTIVATION_ENABLED=false`).
   - Prerequisites P1–P10, G1 (U39), G2 (U40), and G3 (U43) verified.
   - Awaiting explicit human owner decision to enable.
2. **Gate M (Merchant Activation)**: **FAIL-CLOSED** (`MARKET_UNRESOLVED` -> HTTP 503).
   - Awaiting trusted server-owned O2 runtime authority and human activation (U41).
3. **Gate T (GTM Live Tracking)**: **OFF** (zero vendor scripts loaded).
   - Awaiting vendor container configuration and owner approval (U28).
4. **Gate S (Organic Search Indexing)**: **OFF** (temporary domain noindex enforced).
   - Awaiting permanent branded domain and separate human approval.
