# Storefront refinement V3 — implementation plan

Status: **DRAFT — requires human approval before `/build`**

Basis: `docs/design/storefront-refinement-v3.md` plus current `main` architecture. This plan intentionally does not modify the existing P0–P19 historical plan/checklist.

## Dependency graph

```text
                     ┌─→ U2 homepage collection merchandising ─┐
U1 language/copy ────┼─→ U3 collection PLP filters ────────────┼─→ U6 SEO/a11y/runtime regression gate
                     ├─→ U4 PDP related products ───────────────┤
                     └─→ U5 trust/footer + support pages ───────┘
```

The graph is authoritative:
- U1 establishes shared buyer terminology and copy boundaries.
- U2, U3, U4, and U5 may proceed independently after U1, subject to their own content/merchandising approval gates.
- U3 and U4 must coordinate only if both need to change the same shared catalog projection/repository contract.
- U6 begins only after the accepted heads of U2–U5 are integrated; it is the convergence/release-quality gate.

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

**Dependencies:** U1 terminology stable; collection merchandising names/order approved.

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

**Dependencies:** U1; existing published collection membership.

**Files likely touched:** storefront catalog repository/runtime, PDP route/component, focused domain/database/integration/browser tests.

**Estimated scope:** Medium; split repository selection and PDP UI if combined diff exceeds ~5 files.

## Task U5 — Build factual trust/footer/support surfaces

**Description:** Expand footer/support architecture using existing verified COD and shipping facts. Create only support pages whose factual content is approved; route existence alone does not grant search exposure.

**Acceptance criteria:**
- [ ] footer exposes COD, shipping promotion and order tracking using existing policy helpers rather than duplicated constants;
- [ ] `/about` and `/size-guide` ship only with approved factual content; `/shipping-returns` and `/faq` remain blocked until their policy/answer content is approved;
- [ ] every shipped support page exports a unique factual title/description and an explicit self-canonical derived from the server-owned storefront origin;
- [ ] support pages remain fail-closed under the current search allowlist until U6 intentionally exposes each approved route.

**Verification:**
- [ ] link-guard tests cover every new footer route;
- [ ] support content tests prove shipping/COD values are derived from canonical helpers;
- [ ] metadata assertions cover title/description/self-canonical for every shipped support route;
- [ ] mobile/desktop accessibility regression passes.

**Dependencies:** U1; approved content for each route.

**Files likely touched:** footer, public content helper(s), support page routes, metadata/content integration tests.

**Estimated scope:** Medium; one route/concern per PR if support content grows.

## Task U6 — SEO, structured-data, accessibility and release-quality regression gate

**Description:** Integrate U2–U5, add collection BreadcrumbList structured data, explicitly expose approved support routes to search, and close the refinement with full metadata/indexing/accessibility/build evidence.

**Acceptance criteria:**
- [ ] collection BreadcrumbList mirrors the visible breadcrumb and uses canonical server-owned origin;
- [ ] each support route that actually shipped with approved content is added to the exact indexable-path allowlist and static sitemap canonical list; unimplemented/unapproved support routes remain absent from both;
- [ ] support-route base requests are indexable only when the global `indexingEnabled` gate permits it, use self-canonicals, and do not introduce query/faceted indexable states;
- [ ] Product/Offer/Organization/WebSite structured data remains unchanged unless required by an explicit defect;
- [ ] all refined public routes satisfy the project Definition of Done with 0 Critical / 0 Required review findings.

**Verification:**
- [ ] focused collection structured-data tests;
- [ ] search-policy tests for each shipped support route in indexing-enabled and fail-closed staging/local configurations;
- [ ] sitemap regression proves only shipped/approved support routes are emitted when indexing is enabled and sitemap stays empty when indexing is disabled;
- [ ] canonical metadata/HTTP checks for every shipped support route;
- [ ] `pnpm lint`, `pnpm typecheck`, relevant tests, `pnpm build`;
- [ ] representative 390px + desktop browser/Axe/keyboard/overflow checks;
- [ ] metadata/robots/sitemap/canonical HTTP regression;
- [ ] final correctness → security → architecture → simplicity → performance review.

**Dependencies:** U2, U3, U4, and U5 accepted and integrated.

**Files likely touched:** `src/seo/search-exposure.ts`, `src/app/sitemap.ts`, structured-data helper/collection route, support-route metadata/tests, existing runtime workflows only if coverage genuinely needs expansion.

**Estimated scope:** Medium for the convergence check itself. If support-route search exposure requires more than ~5 files, implement that as one or more focused U6a slices first, then run a docs/test-only U6b final convergence gate. U6 remains after U2–U5 either way.

## Checkpoints

### Checkpoint V3-A — after U1
- buyer terminology approved;
- technical public copy removed without weakening factual commerce statements;
- U2–U5 may start independently.

### Checkpoint V3-B — before U6 convergence
- U2–U5 accepted independently;
- only approved support content is public;
- no support route has been silently made indexable by route creation alone.

### Checkpoint V3-C — final gate
- integrated head passes U6 verification;
- 0 Critical / 0 Required findings;
- human approval before merge/ship.

## Human checkpoints
- Approve this V3 spec/plan before implementation.
- Approve collection merchandising names/order before U2 ships.
- Approve any new editorial hero asset.
- Supply/approve actual return/exchange, hotline and Zalo facts before publishing them.
- Approve structured size-table data model separately if free-form size guides are replaced.
- Approve each support page's factual content before that route becomes eligible for search exposure/sitemap inclusion.

## Definition of Done overlay
Every behavior-changing slice must satisfy the repository's standing Definition of Done: task acceptance, focused failing test before implementation, existing regressions green, runtime verification where relevant, no unrelated refactor, security/search boundaries preserved, documentation current, and human review before merge.
