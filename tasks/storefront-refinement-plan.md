# Storefront refinement V3 — implementation plan

Status: **DRAFT — requires human approval before `/build`**

Basis: `docs/design/storefront-refinement-v3.md` plus current `main` architecture. This plan intentionally does not modify the existing P0–P19 historical plan/checklist.

## Dependency graph

```text
U1 language + buyer-copy cleanup
  ↓
U2 homepage collection merchandising
  ↓
U3 collection PLP filters + buyer copy
  ↓
U4 PDP related products + support hierarchy
  ↓
U5 trust/footer + public support pages
  ↓
U6 SEO/a11y/runtime regression gate
```

U2 and U5 may partially overlap after copy/terminology decisions in U1 are stable. U3 and U4 can be developed independently if they do not change the same shared catalog projection at the same time.

## Task U1 — Normalize buyer language and remove technical copy

**Description:** Establish Vietnamese-first buyer UI terminology and remove implementation-detail copy from public Shop/Collection/PDP/Home surfaces without changing underlying commerce behavior.

**Acceptance criteria:**
- [ ] navigation/utilities/filter/policy microcopy follows the language policy in the spec;
- [ ] public pages no longer explain catalog mirror/server architecture where it adds no buyer value;
- [ ] no factual commerce statement is weakened or invented.

**Verification:**
- [ ] focused integration/content assertions updated first (RED) then production copy (GREEN);
- [ ] existing buyer-flow browser tests still pass;
- [ ] keyboard/focus semantics unchanged.

**Dependencies:** None.

**Files likely touched:** `src/components/layout/site-header.tsx`, `src/app/shop/page.tsx`, `src/app/collections/[slug]/page.tsx`, `src/app/shop/[slug]/page.tsx`, focused tests.

**Estimated scope:** Medium; split header terminology from page-copy cleanup if the diff exceeds ~5 files.

## Task U2 — Make homepage merchandising collection-driven

**Description:** Replace generic/hard-coded category-query merchandising with published website-owned collection rails while preserving the existing Campaign and Lookbook identity.

**Acceptance criteria:**
- [ ] homepage renders curated published collection rail(s) with crawlable `/collections/{slug}` links;
- [ ] hard-coded category query links are no longer the primary collection-navigation surface;
- [ ] hero uses website-owned editorial media when configured, with trusted catalog media as an intentional fallback.

**Verification:**
- [ ] domain/integration test proves only published collections are eligible;
- [ ] homepage link guard covers collection/PDP links;
- [ ] mobile/desktop browser check: no overflow, no broken images, Axe clean.

**Dependencies:** U1 terminology stable.

**Files likely touched:** homepage route, one collection-merchandising helper/repository boundary, product-card reuse, focused integration/browser tests.

**Estimated scope:** Medium.

## Task U3 — Upgrade collection landing to full PLP using existing discovery contract

**Description:** Reuse existing storefront discovery parsing/repository behavior for collection Sort + Size controls (Color optional follow-up) while preserving collection identity and current SEO query-state rules.

**Acceptance criteria:**
- [ ] collection page supports Sort + Size using existing allowlisted discovery values;
- [ ] every collection filter request retains the collection slug and pagination remains correct;
- [ ] faceted/sorted collection states remain noindex/non-canonical while base/pure-pagination states retain current canonical policy.

**Verification:**
- [ ] RED/GREEN domain/integration coverage for collection query parsing/href behavior;
- [ ] metadata/HTTP regression for base, pure pagination, size, sort, and mixed query states;
- [ ] mobile/desktop keyboard/Axe browser coverage for controls.

**Dependencies:** U1.

**Files likely touched:** collection page, existing discovery href helper or a collection-aware wrapper, metadata/search-policy tests, browser spec.

**Estimated scope:** Medium.

## Task U4 — Add bounded deterministic PDP related products

**Description:** Add “Hoàn thiện phối đồ”/related product merchandising using shared published collection membership, excluding the current product and keeping visibility/active-state boundaries.

**Acceptance criteria:**
- [ ] related products are deterministic, current product excluded, and bounded (max 4 unless spec is updated);
- [ ] only current public/active products with trusted storefront projection are rendered;
- [ ] no new recommendation persistence or fabricated “set” relationship is introduced.

**Verification:**
- [ ] repository/domain tests cover shared collection, exclusion, ordering and limit;
- [ ] PDP browser regression covers related-product links and fallback when none exist;
- [ ] no change to Add-to-Bag/price/stock authority.

**Dependencies:** Published collection membership already exists; U1 terminology.

**Files likely touched:** storefront catalog repository/runtime, PDP route/component, focused domain/database/integration/browser tests.

**Estimated scope:** Medium; split repository selection and PDP UI if combined diff exceeds ~5 files.

## Task U5 — Build factual trust/footer/support surfaces

**Description:** Expand footer/support architecture using existing verified COD and shipping facts; create public support pages only for content that is approved and factual.

**Acceptance criteria:**
- [ ] footer exposes COD, shipping promotion and order tracking using existing policy helpers rather than duplicated constants;
- [ ] `/about` and `/size-guide` can ship with approved factual content;
- [ ] `/shipping-returns`, `/faq`, hotline or Zalo content remains blocked until the relevant policy/contact facts are approved.

**Verification:**
- [ ] link-guard tests cover every new footer route;
- [ ] support content tests prove shipping/COD values are derived from canonical helpers;
- [ ] mobile/desktop accessibility regression passes.

**Dependencies:** U1; approved content for each route.

**Files likely touched:** footer, public content helper(s), support page routes, integration/browser tests.

**Estimated scope:** Medium; one route/concern per PR if support content grows.

## Task U6 — SEO, structured-data, accessibility and release-quality regression gate

**Description:** Close the refinement with collection BreadcrumbList structured data plus full regression evidence across metadata/indexing, accessibility and production build.

**Acceptance criteria:**
- [ ] collection BreadcrumbList mirrors the visible breadcrumb and uses canonical server-owned origin;
- [ ] Product/Offer/Organization/WebSite structured data remains unchanged unless required by an explicit defect;
- [ ] all refined public routes satisfy the project Definition of Done with 0 Critical / 0 Required review findings.

**Verification:**
- [ ] focused structured-data tests;
- [ ] `pnpm lint`, `pnpm typecheck`, relevant tests, `pnpm build`;
- [ ] representative 390px + desktop browser/Axe/keyboard/overflow checks;
- [ ] metadata/robots/sitemap/canonical HTTP regression;
- [ ] final correctness → security → architecture → simplicity → performance review.

**Dependencies:** U2–U5 accepted.

**Files likely touched:** structured-data helper/collection route, tests and existing runtime workflows only if coverage genuinely needs expansion.

**Estimated scope:** Medium.

## Human checkpoints
- Approve this V3 spec/plan before implementation.
- Approve collection merchandising names/order before U2 ships.
- Approve any new editorial hero asset.
- Supply/approve actual return/exchange, hotline and Zalo facts before publishing them.
- Approve structured size-table data model separately if free-form size guides are replaced.

## Definition of Done overlay
Every behavior-changing slice must satisfy the repository's standing Definition of Done: task acceptance, focused failing test before implementation, existing regressions green, runtime verification where relevant, no unrelated refactor, security/search boundaries preserved, documentation current, and human review before merge.