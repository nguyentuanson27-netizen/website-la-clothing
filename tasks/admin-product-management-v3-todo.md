# Admin Product Management V3 — task checklist

Status: **DRAFT TODO — spec approved; plan awaiting human review**

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

- [ ] **C1 — Bulk collection add/remove backend**
  - [ ] strict 1..100 selected products
  - [ ] existing collection validation
  - [ ] add/remove only selected slug
  - [ ] preserve unrelated content/memberships
  - [ ] atomic failure regression

- [ ] **C2 — Bulk catalog enable/disable backend**
  - [ ] exact target/warning sets in prepare proof
  - [ ] relation/zero-active/target drift => `RECONFIRM_REQUIRED`
  - [ ] zero writes for stale whole batch
  - [ ] disable is atomic/idempotent and changes only product state

- [ ] **C3 — Exact directory health read model**
  - [ ] full-catalog DB-side predicates before pagination
  - [ ] exact summed-stock semantics for `stocked-inactive`
  - [ ] active/total variant metrics
  - [ ] health parser/URL/page-reset contract
  - [ ] no N+1 product reads

- [ ] **C4 — Expand current-page bulk toolbar**
  - [ ] existing editorial bulk behavior preserved
  - [ ] add/remove collection UI
  - [ ] enable/disable catalog UI
  - [ ] prepare/commit confirmation + reconfirmation
  - [ ] selection/focus/Axe/VoiceOver regressions

- [ ] **C5 — Health indicators and filters UI**
  - [ ] `Biến thể: X / N active`
  - [ ] stocked-but-inactive warning
  - [ ] zero-active / no-collection / catalog-inactive / missing-image filters
  - [ ] facet count/href/query truth stays aligned
  - [ ] no synthetic health score

- [ ] **Checkpoint C — V3 implementation complete**
  - [ ] exact-head DB/domain/security/auth/lint/typecheck/build/release/start green
  - [ ] admin browser Axe/VoiceOver green
  - [ ] fresh review 0 Critical / 0 Required
  - [ ] ADR 0005 scope/revertability check
  - [ ] trusted deployed smoke: normal product admin → storefront
  - [ ] trusted deployed smoke: composite product admin → storefront
  - [ ] no Pancake-owned price/stock/media/relation mutation
  - [ ] no schema/dependency/sync behavior change without separate approval

## Human approval gate

- [ ] **Plan approved for `/build`**

Do not start implementation only because this checklist exists. The V3 spec is approved; this plan/todo must be reviewed and approved before PR-A build work begins.
