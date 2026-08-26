# Storefront Refinement V3 — U6b final verification record

This document is the current execution/closeout record for Storefront Refinement V3.

The original design, plan, and todo files remain the acceptance-definition and planning history for the workstream. Their original `DRAFT` status text describes the state in which those files were authored; it is not the current runtime status after the implementation PRs listed below.

## Closeout scope

U6b is a verification/documentation-only closeout unless a concrete regression is proven by the final gates.

It does **not**:
- enable public search indexing;
- select or approve a permanent production domain;
- invent or publish support-page content;
- add support routes solely to satisfy an indexation test;
- change checkout, order, Pancake, auth, catalog, media, or persistence behavior;
- change Product/Offer/Organization/WebSite structured-data contracts without a proven defect.

## Accepted implementation chain

The V3 implementation was split into reviewable slices and merged into `main` before this closeout:

- planning/spec: PR #96;
- accessibility foundation: PRs #100, #101, #102, #103, #104;
- buyer-language inventory and U1 slices/prerequisites: PRs #111–#125 as applicable;
- PR reviewability policy: PR #126 / ADR 0005;
- U2 homepage collection merchandising + trust: PR #127;
- U3 collection Sort + Size canonical URL contract: PR #128;
- U4 deterministic related products: PR #129;
- U5 factual footer trust: PR #130;
- U6a collection BreadcrumbList convergence: PR #131.

U6a was squash-merged to `main` at:

`3edc4be81dbf851b9338bcf37aeb9a8d9dd0bd80`

## Current U6a search-exposure truth

Content approval and indexing approval remain separate gates.

At this closeout there are **zero independently content-approved V3 support routes** among the planned candidates:

- `/about`;
- `/size-guide`;
- `/shipping-returns`;
- `/faq`.

Therefore the correct U6a state is **zero support-route promotion**:

- none of those paths is in the enabled indexable-path allowlist;
- none is present in the sitemap static path set;
- none has a V3 support self-canonical preparation;
- their exact base paths remain noindex even under the synthetic `indexingEnabled=true` policy test;
- their query-string states remain noindex;
- the storefront does not link to them as implemented support destinations.

This is intentional fail-closed behavior, not an incomplete attempt to fabricate an “eligible-enabled” support route. The per-route atomic canonical + allowlist + sitemap contract activates only after that route receives independent content approval.

## ADR 0004 remains authoritative

V3 does not grant permanent-domain or indexing approval.

Temporary production must continue to obey ADR 0004:

- `SEARCH_INDEXING_ENABLED=false`;
- page-level noindex/nofollow behavior for public HTML;
- no public canonical while indexing is disabled;
- empty sitemap while indexing is disabled.

`/search` and `/new-arrivals` remain outside V3 index/sitemap promotion.

Any future `SEARCH_INDEXING_ENABLED=true` rollout or permanent-domain change is a separate human-approved operation.

## U6a structured-data truth

Published collection pages emit `BreadcrumbList` JSON-LD matching the visible breadcrumb:

`Trang chủ → Bộ sưu tập → collection title`

The breadcrumb URLs use the server-owned storefront origin and JSON-LD continues through the existing escaping serializer.

Product/Offer/Organization/WebSite structured-data behavior is unchanged by U6a.

## Final U6b quality gate

The closeout PR must be evaluated on one exact head. Before it can be considered merge-ready, evidence must show:

- lint passes;
- typecheck passes;
- domain/integration/database tests pass;
- production build passes;
- release/preflight/production-start checks pass;
- representative mobile and desktop browser checks pass;
- buyer Axe coverage including the active `best-practice` landmark gate passes;
- keyboard, skip-link, and horizontal-overflow coverage remains green through the existing runtime suites;
- metadata/robots/sitemap/canonical HTTP regressions remain green;
- P18 final QA runtime passes;
- Catalog indexation runtime passes;
- VPS container verification passes;
- fresh review reports 0 Critical / 0 Required findings.

Exact-head workflow IDs and the final review verdict belong in the closeout PR description/review so they cannot become misleading after a later head change.

## Deferred human gates

The following are **not** completed by V3 closeout and must not be inferred from this document:

- independent factual-content approval for `/about`;
- independent factual-content approval for `/size-guide`;
- approved return/exchange policy before `/shipping-returns`;
- approved factual answers before `/faq`;
- approved hotline or Zalo facts before publication;
- separate approval if a structured size-table model replaces free-form size guidance;
- permanent-domain approval;
- `SEARCH_INDEXING_ENABLED=true` approval.

When a support route is later approved, its route content and U6a exposure work must remain atomic according to the V3 plan: exact base only, self-canonical only when indexing is eligible, allowlist entry, sitemap entry, and query-state noindex/non-canonical regression in the same reviewed slice.

## Rollback

This U6b closeout slice is documentation/verification only. If reverted, application runtime behavior is unchanged. Runtime rollback for previously merged V3 slices remains the normal per-PR revert path; no new feature flag, migration, external write, or background process is introduced here.
