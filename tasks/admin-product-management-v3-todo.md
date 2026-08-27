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
  - [ ] disable changes product state only

- [ ] **C3 — Health read model and filters**
  - [ ] `stocked-inactive` uses summed stock >0 DB truth
  - [ ] `zero-active`
  - [ ] `no-collection`
  - [ ] `catalog-inactive`
  - [ ] `missing-image` uses `ProductMirror.primaryImageUrl` + present variants' `pancakeImageUrls` and existing `parseTrustedProductImageUrl()` trust semantics
  - [ ] null primary + trusted present-variant image => not missing
  - [ ] only rejected/absent media or stale-variant-only media => missing
  - [ ] DB predicate parity-tested against the trusted image parser
  - [ ] list/count/pagination predicates stay aligned

- [ ] **C4 — Bulk toolbar UX**
  - [ ] editorial status remains working
  - [ ] add/remove collection
  - [ ] enable/disable catalog
  - [ ] zero-active + composite-publication warning summary
  - [ ] stale confirmation preserves selection and requires reconfirm
  - [ ] success/error/Axe/VoiceOver coverage

- [ ] **C5 — Directory health metrics/filters UI**
  - [ ] row shows active/total present variants
  - [ ] stocked inactive warning count
  - [ ] health filter URLs compose with existing filters
  - [ ] `missing-image` browser result/count matches the approved variant-fallback rule
  - [ ] filter navigation resets stale page/selection

- [ ] **Checkpoint C / V3 implementation closeout**
  - [ ] exact-head CI verify green
  - [ ] admin Axe/VoiceOver green
  - [ ] P18/Catalog runtime green when triggered
  - [ ] 0 Critical / 0 Required fresh review
  - [ ] trusted deployed catalog acceptance completed
  - [ ] Pancake-owned price/stock/source/image/relation data unchanged by new writes
  - [ ] no unapproved schema/dependency/sync change

## Human gate

- [ ] Human approves this plan before `/build` starts.
