# Admin Product Management V3 — task checklist

Status: **APPROVED TODO — plan approved 2026-08-27; PR-A merged (#138); PR-C built**

Spec: `docs/design/admin-product-management-v3.md`
Plan: `tasks/admin-product-management-v3-plan.md`

## PR-A — Generic commerce activation

- [ ] **A1 — Catalog confirmation proof primitive**
  - [ ] actor/operation/target/warning-state/expiry binding
  - [ ] deterministic canonicalization for bulk sets
  - [ ] tamper/expiry/wrong-binding domain regressions
  - [ ] security review of secret use/domain separation

- [ ] **A2 — Generic variant activation backend**
  - [ ] ADMIN + strict 1..100 unique IDs
  - [ ] ordinary/composite parent/composite child all supported
  - [ ] cross-product/stale/not-present/mixed invalid => zero writes
  - [ ] normal-product inactive XL regression

- [ ] **A3 — Product catalog + combined quick-action backend**
  - [ ] product enable/disable changes only `ProductMirror.isActive`
  - [ ] single-product prepare/commit freshness + `RECONFIRM_REQUIRED`
  - [ ] quick action recomputes summed positive stock server-side
  - [ ] current incoming composite edge blocks quick action with zero writes

- [ ] **A4 — Unified variant editor table**
  - [ ] single-row + bulk activate/deactivate
  - [ ] select all / select stocked / indeterminate
  - [ ] >100 variants => <=100 deterministic page/window selection
  - [ ] page change clears selection; no silent truncation
  - [ ] Axe/overflow regression

- [ ] **A5 — Product catalog + quick-action editor UX**
  - [ ] two-phase enable confirmation
  - [ ] stale warning state => accessible reconfirmation, zero write
  - [ ] composite child has no combined shortcut
  - [ ] normal product quick action + storefront convergence
  - [ ] VoiceOver/status/error focus coverage

- [ ] **Checkpoint A**
  - [ ] exact-head CI verify green
  - [ ] admin Axe/VoiceOver green
  - [ ] P18/Catalog runtime green when triggered
  - [ ] 0 Critical / 0 Required fresh review
  - [ ] ADR 0005 scope check

## PR-B — Compact product editor

- [ ] **B1 — Compact editor information architecture**
  - [ ] summary metrics first
  - [ ] Website Commerce before long source content
  - [ ] editorial/collections/SEO/slug remain functional
  - [ ] keyboard/heading/order regression

- [ ] **B2 — Collapse Pancake source + remove duplicate activation UI**
  - [ ] semantic `<details>` collapsed by default
  - [ ] source/read-only data preserved
  - [ ] old composite-specific activation sections removed
  - [ ] generic table still activates parent/component variants

- [ ] **Checkpoint B**
  - [ ] exact-head CI + admin browser gates green
  - [ ] 0 Critical / 0 Required fresh review
  - [ ] no business-logic expansion hidden in layout PR

## PR-C — Bulk product operations and health

- [x] **C1 — Bulk collection add/remove backend**
  - [x] strict 1..100 selected products
  - [x] existing collection validation
  - [x] add/remove only selected slug
  - [x] preserve unrelated content/memberships
  - [x] atomic failure regression

- [x] **C2 — Bulk catalog enable/disable backend**
  - [x] exact target/warning sets in prepare proof
  - [x] relation/zero-active/target drift => `RECONFIRM_REQUIRED`
  - [x] zero writes for stale whole batch
  - [x] disable is atomic/idempotent and changes only product state

- [x] **C3 — Exact directory health read model**
  - [x] full-catalog DB-side predicates before pagination
  - [x] exact summed-stock semantics for `stocked-inactive`
  - [x] active/total variant metrics
  - [x] health parser/URL/page-reset contract
  - [x] no N+1 product reads
  - [x] `missing-image` matches `resolveStorefrontProductMedia(...).primary === null`
  - [x] media inputs match storefront: primary first, then `isPresent=true && isActive=true` variants ordered by `pancakeVariationId ASC`
  - [x] existing `parseTrustedProductImageUrl()` remains the per-candidate trust predicate
  - [x] effective scan bound/order matches `MAX_MEDIA_CANDIDATES_SCANNED = 100`
  - [x] null primary + trusted in-bound active/present variant image => not missing
  - [x] first 100 rejected candidates + trusted candidate #101 => missing
  - [x] trusted media only on inactive/stale variants => missing
  - [x] any DB-side image predicate is parity-tested against `resolveStorefrontProductMedia()` including order/bounds

- [x] **C4 — Expand current-page bulk toolbar**
  - [x] existing editorial bulk behavior preserved
  - [x] add/remove collection UI
  - [x] enable/disable catalog UI
  - [x] prepare/commit confirmation + reconfirmation
  - [x] selection/focus/Axe/VoiceOver regressions

- [x] **C5 — Health indicators and filters UI**
  - [x] `Biến thể: X / N active`
  - [x] stocked-but-inactive warning
  - [x] zero-active / no-collection / catalog-inactive / missing-image filters
  - [x] `missing-image` browser result/count follows storefront resolver semantics
  - [x] browser regression covers trusted candidate #101 remaining missing after 100 rejected candidates
  - [x] facet count/href/query truth stays aligned
  - [x] no synthetic health score

- [ ] **Checkpoint C — V3 implementation complete**
  - [ ] exact-head DB/domain/security/auth/lint/typecheck/build/release/start green
  - [ ] admin browser Axe/VoiceOver green
  - [ ] fresh review 0 Critical / 0 Required
  - [ ] ADR 0005 scope/revertability check
  - [ ] trusted deployed smoke: normal product admin → storefront
  - [ ] trusted deployed smoke: composite product admin → storefront
  - [ ] no Pancake-owned price/stock/media/relation mutation
  - [ ] no schema/dependency/sync behavior change without separate approval

## Slice status

- PR-A — merged via #138.
- PR-B — not started; independent of PR-C.
- PR-C — C1–C5 implemented on `claude/build-pr-c-from-pr136-frpyzu`. Checkpoint C stays open
  until exact-head CI, the macOS admin browser runtime, fresh review and the deployed smokes run.

## Human approval gate

- [x] **Plan approved for `/build` — product owner, 2026-08-27**

PR-A implementation is authorized. Downstream PR-B / PR-C still require their listed checkpoint dependencies and do not inherit completion from this approval.