# Admin Product Management V3 — task checklist

Status: **IMPLEMENTATION MERGED — PR-A (#138), PR-C (#140), PR-B (#139); final production acceptance pending trusted deployed smokes**

Verified runtime baseline: `main@8c4922623f22ddf4f723379ad58aa013c7bdf728` after PR #139.

Spec: `docs/design/admin-product-management-v3.md`
Plan: `tasks/admin-product-management-v3-plan.md`

## PR-A — Generic commerce activation

- [x] **A1 — Catalog confirmation proof primitive**
  - [x] actor/operation/target/warning-state/expiry binding
  - [x] deterministic canonicalization for bulk sets
  - [x] tamper/expiry/wrong-binding domain regressions
  - [x] security review of secret use/domain separation

- [x] **A2 — Generic variant activation backend**
  - [x] ADMIN + strict 1..100 unique IDs
  - [x] ordinary/composite parent/composite child all supported
  - [x] cross-product/stale/not-present/mixed invalid => zero writes
  - [x] normal-product inactive XL regression

- [x] **A3 — Product catalog + combined quick-action backend**
  - [x] product enable/disable changes only `ProductMirror.isActive`
  - [x] single-product prepare/commit freshness + `RECONFIRM_REQUIRED`
  - [x] quick action recomputes summed positive stock server-side
  - [x] current incoming composite edge blocks quick action with zero writes

- [x] **A4 — Unified variant editor table**
  - [x] single-row + bulk activate/deactivate
  - [x] select all / select stocked / indeterminate
  - [x] >100 variants => <=100 deterministic page/window selection
  - [x] page change clears selection; no silent truncation
  - [x] Axe/overflow regression

- [x] **A5 — Product catalog + quick-action editor UX**
  - [x] two-phase enable confirmation
  - [x] stale warning state => accessible reconfirmation, zero write
  - [x] composite child has no combined shortcut
  - [x] normal product quick action + storefront convergence
  - [x] status/error focus coverage; duplicated per-variant VoiceOver assertions were explicitly waived at #138 and removed in #141 while activation VoiceOver coverage remains in the generic quick-action flow

- [x] **Checkpoint A — accepted and merged via #138**
  - [x] exact-head CI verify green
  - [x] browser/Axe coverage accepted; the explicit duplicated VoiceOver waiver is recorded above and the final integrated VoiceOver gate is tracked again under Checkpoint C
  - [x] P18/Catalog runtime green when triggered
  - [x] required review findings remediated before merge; the remaining duplicated VoiceOver assertion received explicit product-owner waiver
  - [x] ADR 0005 scope check recorded in PR #138

## PR-B — Compact product editor

- [x] **B1 — Compact editor information architecture**
  - [x] summary metrics first
  - [x] Website Commerce before long source content
  - [x] editorial/collections/SEO/slug remain functional
  - [x] keyboard/heading/order regression

- [x] **B2 — Collapse Pancake source + remove duplicate activation UI**
  - [x] semantic `<details>` collapsed by default
  - [x] source/read-only data preserved
  - [x] old composite-specific activation sections removed
  - [x] generic table still activates parent/component variants

- [x] **Checkpoint B — accepted and merged via #139**
  - [x] exact-head CI + admin browser gates green before merge
  - [x] final self-review 0 Critical / 0 Required
  - [x] no business-logic expansion hidden in layout PR
  - [x] ADR 0005 scope/reviewability rationale recorded; admin 390px optimization is explicitly non-blocking per product-owner acceptance and ADR 0006

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
  - [x] exact-main DB/domain/security/auth/lint/typecheck/build/release/start green on `8c4922623f22ddf4f723379ad58aa013c7bdf728`
  - [ ] admin browser Axe/VoiceOver green on final `main` — first post-merge attempt was 44/45 with one VoiceOver timing failure; exact-SHA rerun is in progress
  - [x] fresh integrated review on final runtime tree: 0 Critical / 0 Required
  - [x] ADR 0005 scope/revertability checked across PR-A / PR-B / PR-C; no additional runtime change is being added for closure
  - [ ] trusted deployed smoke: normal product admin → storefront
  - [ ] trusted deployed smoke: composite product admin → storefront
  - [x] no Pancake-owned price/stock/media/relation mutation in V3 commerce/content write paths
  - [x] no schema/dependency/sync behavior change introduced by the V3 implementation without separate approval

## Slice status

- PR-A — A1–A5 merged via #138; the duplicated per-variant VoiceOver assertion waiver was later normalized by #141 without removing generic activation coverage.
- PR-B — B1–B2 merged via #139; compact editor and collapsed read-only Pancake source are on `main`.
- PR-C — C1–C5 merged via #140; bulk operations and exact health read model are on `main`.
- Automated final verification is complete except for the in-progress exact-main VoiceOver rerun.
- Production acceptance remains open until both trusted real-catalog admin → storefront smokes are observed on the deployed exact release.

## Human approval gate

- [x] **Plan approved for `/build` — product owner, 2026-08-27**
- [x] PR-A / PR-B / PR-C implementation accepted and merged.
- [ ] Final V3 completion claim — blocked only by the remaining exact-main VoiceOver result and trusted deployed normal/composite smokes.
