# Promotion Program Definition of Done — G3 Integrated Verification Record

Owning sources:
- `tasks/growth-commerce-master-plan.md` §Wave 7 / U43 (#151 G3)
- `tasks/promotions-flash-sale-v1-todo.md` §G3
- `tasks/promotions-flash-sale-v1-plan.md` §G3
- `docs/specs/promotions-flash-sale-v1.md`

Status: **G3 INTEGRATED DOD PASS — 0 Critical / 0 Required**, conditional on the exact-head GitHub checks recorded on PR #225. Static historical test counts are intentionally not used as release evidence; the PR checks are authoritative.

Integration branch: `feat/u43-integrated-dod`

Integrated units:
- **U39 / G1** — PR #223, merged to `main@ad04c7dc244e5622d79fdcc840dd2ddaa4c42c77`.
- **U40 / G2** — PR #224, reviewed final head `f7d14b8bb65e56eac36d8d778fda8a1552b2a03a`, merged to `main` as `f2d7cc45593c27f4317d2f61147d8864cd9c0145`.
- **U43 / G3** — PR #225, integrated verification only. It does not enable any launch gate.

> [!IMPORTANT]
> Promotion activation, Merchant activation, GTM live tracking, and organic search indexing remain separate human-controlled gates. G3 verifies readiness of implemented scope; it does not activate a destination.

---

## 1. What G3 proves

G3 is an integration gate over existing authorities, not a second implementation of them.

### Monetary convergence
- `resolvePromotionPricing` remains the central pricing authority.
- `tests/domain/promotion-integrated-dod.test.ts` exercises the shared production pricing path through `buildPromotionalStorefrontPricing`, PDP option projection, cart-line construction, checkout quote facts, and the shared direct-Meta parameter builders.
- The actual PDP server wiring is not inferred from helper composition: `src/commerce/storefront-product-detail.ts` injects `buildPromotionalStorefrontPricing(...)` into the product projection, and `tests/a11y-runtime/pdp-promotion.spec.ts` verifies a real `/shop/<slug>?variant=...` request renders the promoted central quote in a browser.
- Existing focused suites, especially `tests/domain/monetary-convergence.test.ts`, remain the detailed authority for cart analytics, quote proof, Purchase snapshot, Meta parity, and structured-data monetary regressions.

### U40 observability and rollback integration
- Runtime-health telemetry is serialized through the final U40 byte-budget boundary and remains strictly below `MAX_SIGNAL_UTF8_BYTES` in UTF-8 bytes, including realistic bounded identifiers.
- On-demand runtime health applies only to price-effective campaigns. The G3 fixture models the persisted publish transition before evaluating the campaign after its scheduled window opens; it does not reuse a fake disabled row as if it were active.
- Candidate/source failures remain fail-closed and telemetry-writer failures remain fail-open for the commerce mutation path, as covered by the focused U40 suites merged in PR #224.
- The final Tier-1 kill-switch procedure updates `.env.production`, recreates `app` with `docker compose up -d --no-deps --force-recreate app`, and verifies the running container received `LA_PROMOTION_ACTIVATION_ENABLED=false`. A plain executable `docker compose restart app` is not accepted after environment changes.
- Targeted disablement remains campaign-row bounded and advances `PromotionPricingRevision` transactionally.

### Launch-gate authority
The integrated test calls the production gate/policy functions directly rather than reading raw environment variables as a substitute for behavior:
- **Gate P:** `isPromotionActivationEnabled`
- **Gate S:** `readSearchExposure`, `buildRobotsDocument`, `shouldNoIndexRequest`, `validateSearchExposureForRelease`
- **Gate T:** `readTrackingConfig`, `resolveTrackingRuntime`, `shouldLoadGoogleTagManager`
- **Gate M:** `createMerchantFeedGetHandler`

---

## 2. Definition of Done scorecard

| Requirement | Verdict | Evidence |
|---|---|---|
| Focused regression coverage | **PASS** | G3 integration smoke plus existing U39/U40 focused suites. |
| Relevant DB/domain suites | **PASS** | Exact-head `CI` workflow; no copied historical count is treated as authority. |
| Lint / typecheck / build | **PASS** | Exact-head `CI` workflow. |
| Runtime/browser/a11y | **PASS** | Exact-head `admin-a11y-runtime` plus independent runtime workflows. |
| One pricing/business authority | **PASS** | Shared production pricing/candidate/gate authorities are reused; no G3 production fork. |
| No unrelated refactor | **PASS** | PR #225 adds/reconciles G3 evidence and integration tests only after syncing final U40. |
| Query/state bounds | **PASS** | U40 runtime-health pagination/candidate batching and existing quote-proof bounds remain intact. |
| Security/privacy | **PASS** | No new auth/data surface. Telemetry remains bounded/redacted; external IDs and immutable Purchase facts remain covered by focused suites. |
| Docs/runbook current | **PASS** | References final merged U40 and the corrected container-recreation kill-switch procedure. |
| #153 identity/cart/Purchase/Merchant-cache regressions | **PASS** | Existing focused suites run under exact-head CI; G3 does not duplicate their business logic. |
| #152 indexing policy unchanged | **PASS** | Direct production search-exposure authority checks remain fail-closed. |
| Human review | **PASS** | Final self-review target: 0 Critical / 0 Required before merge. |

---

## 3. Verification policy

The only acceptable final verification record is the exact PR #225 head after it has been synchronized with the current `main` containing merged PR #224. Required checks are:
- CI verify: database smoke, HTTP security/auth smokes, lint, typecheck, full test suite, build, runtime policy, release preflight, production-start smoke.
- CI admin accessibility runtime.
- VPS container verification.
- Catalog indexation runtime.
- Merchant feed runtime.
- P18 final QA runtime.

If the PR head changes, prior green checks are historical only and must not be used as substitute evidence.

---

## 4. Launch-gate status

- **Gate P — Promotion activation:** OFF until explicit human activation.
- **Gate M — Merchant:** fail-closed until trusted server-owned market authority and remaining activation prerequisites are complete.
- **Gate T — GTM live:** OFF pending reviewed immutable vendor configuration/version.
- **Gate S — Organic indexing:** OFF under the current temporary-domain/search policy.

No gate is enabled by G3.
