# Storefront refinement V3 — implementation plan

Status: **DRAFT — requires human approval before `/build`**

Basis: `docs/design/storefront-refinement-v3.md` plus current `main` architecture. This plan intentionally does not modify the existing P0–P19 historical plan/checklist.

## Dependency graph

Authoritative dependency edges:

```text
U1 → U2
U1 → U3
U1 → U4
U1 → U5
U2 + U3 + U4 + U5 → U6
```

Rules:
- U1 establishes shared buyer terminology and copy boundaries across the whole buyer flow.
- U2, U3, U4, and U5 may proceed independently after U1, subject to their own content/merchandising approval gates.
- U3 and U4 must coordinate only if both need to change the same shared catalog projection/repository contract.
- U5 owns creation of the public `/size-guide` route and the PDP link to it so that route + link land atomically.
- U6 begins only after the accepted heads of U2–U5 are integrated; it is the convergence/release-quality gate.
- U6 owns support-route search exposure as one atomic concern: conditional self-canonical metadata, indexable-path allowlist, and sitemap inclusion move together for each approved route.
- U6 may prepare approved support paths for future indexation, but it cannot bypass ADR 0004's permanent-domain + explicit human indexing approval.

## Task U1 — Normalize buyer language and remove technical copy

**Description:** Establish Vietnamese-first buyer UI terminology and remove implementation-detail copy from all major buyer-facing flows without changing underlying commerce behavior. Lock `Túi hàng` as the single cart term across Cart/Checkout.

**Acceptance criteria:**
- [ ] navigation/utilities/filter/cart/checkout/policy microcopy follows the language policy in the spec;
- [ ] `Túi hàng` is used consistently for the cart concept; existing `Giỏ hàng`/English transactional variants are removed from buyer microcopy unless an explicitly editorial heading is retained by design review;
- [ ] public pages no longer explain catalog mirror/server architecture where it adds no buyer value;
- [ ] Search, New arrivals, footer, Cart and Checkout are included in the language pass rather than being left outside the checkpoint;
- [ ] no factual commerce statement is weakened or invented.

**Verification:**
- [ ] focused integration/content assertions updated first (RED) then production copy (GREEN);
- [ ] buyer-flow browser tests cover header → Shop/Collection/PDP → Cart → Checkout plus Search/New arrivals/footer navigation;
- [ ] keyboard/focus semantics unchanged.

**Dependencies:** None.

**Mandatory implementation slices:**
- **U1a — shell/discovery copy:** header, footer, Search, New arrivals, focused tests.
- **U1b — commerce-flow copy:** Shop, Collection, PDP, Cart, Checkout, focused tests.

U1 is not complete until both U1a and U1b satisfy the shared terminology checkpoint.

**Files likely touched:** `src/components/layout/site-header.tsx`, `src/components/layout/site-footer.tsx`, `src/app/search/page.tsx`, `src/app/new-arrivals/page.tsx`, `src/app/shop/page.tsx`, `src/app/collections/[slug]/page.tsx`, `src/app/shop/[slug]/page.tsx`, `src/app/cart/page.tsx`, `src/app/checkout/page.tsx`, focused tests.

**Estimated scope:** Two Medium slices; do not implement the entire file list as one oversized diff.

## Task U2 — Make homepage merchandising collection-driven

**Description:** Replace the currently inert `/shop?category=...` homepage links with valid published website-owned collection navigation while preserving the existing Campaign and Lookbook identity. Editorial hero asset work is optional and content-gated, not required for U2 completion.

**Acceptance criteria:**
- [ ] homepage renders curated published collection rail(s) with crawlable `/collections/{slug}` links;
- [ ] **no** `/shop?category=...` link remains on the homepage after U2;
- [ ] each old category-query destination is either replaced by an explicitly reviewed published collection mapping or removed when no truthful mapping exists;
- [ ] current trusted catalog hero media remains a valid fallback; U2 does not invent a remote editorial-media origin, widen `remotePatterns`, or widen CSP merely to satisfy the visual benchmark;
- [ ] absence of an approved editorial hero asset does **not** block U2.

**Optional editorial-asset slice:**
If the human supplies and approves a repository-owned editorial asset, add it as a separate focused same-origin content slice. The simplest acceptable mechanism is a local static asset path; no remote-origin expansion is part of V3 by default.

**Verification:**
- [ ] RED regression proves current category-query links do not produce category filtering and therefore must not survive the slice;
- [ ] domain/integration test proves only published collections are eligible for replacement navigation;
- [ ] homepage link guard covers every collection/PDP link and explicitly rejects `/shop?category=` destinations;
- [ ] media-boundary regression proves U2 does not broaden remote media origins;
- [ ] mobile/desktop browser check: no overflow, no broken images, Axe clean.

**Dependencies:** U1 terminology stable; collection merchandising names/order approved. Optional editorial asset slice additionally requires explicit asset approval/supply.

**Files likely touched:** homepage route, one collection-merchandising helper/repository boundary if needed, product-card reuse, focused integration/browser tests. Optional approved local asset may add a repository static-asset path.

**Estimated scope:** Medium. Keep optional asset delivery out of the core U2 diff unless an approved asset actually exists.

## Task U3 — Upgrade collection landing to full PLP using existing discovery/facet contracts

**Description:** Reuse the existing discovery parser, discovery facets, and catalog repository behavior for collection Sort + Size controls (Color optional follow-up) while keeping the path slug as the only collection identity authority.

**Acceptance criteria:**
- [ ] Sort uses the existing `STOREFRONT_DISCOVERY_SORTS` allowlist;
- [ ] Size UI options come from the existing discovery facet source (`facets.sizes`); do not invent a static size enum that the domain does not have;
- [ ] raw URL size input remains governed by the existing bounded normalized-text parser contract;
- [ ] the collection path slug is authoritative: `/collections/a?collection=b` must never render collection `b` products under collection `a` content/canonical;
- [ ] collection discovery input is constructed from explicit supported query keys and the route-owned collection slug; do not spread arbitrary raw search params into it;
- [ ] every filter/pagination URL remains under `/collections/{slug}` and preserves supported state such as Size/Sort while resetting page appropriately when filters change;
- [ ] the current Shop-specific `buildStorefrontDiscoveryHref` is **not** called directly for collection navigation unless it is intentionally generalized and both Shop + Collection behavior have regression tests;
- [ ] faceted/sorted collection states remain noindex/non-canonical while base/pure-pagination states retain the existing canonical policy when global indexing is approved and enabled.

**Verification:**
- [ ] RED/GREEN tests for Sort, facet-derived Size, collection-aware href generation, and page reset/preservation behavior;
- [ ] regression for `/collections/a?collection=b` proves route slug authority and no cross-collection product leakage;
- [ ] metadata/HTTP regression for base, pure pagination, size, sort, user-supplied collection query, and mixed query states;
- [ ] mobile/desktop keyboard/Axe browser coverage for controls.

**Dependencies:** U1.

**Files likely touched:** `src/app/collections/[slug]/page.tsx`, `src/commerce/storefront-discovery.ts` only if a generic base-path-safe href builder is justified, existing discovery facet/runtime boundary, metadata/search-policy tests, browser spec.

**Estimated scope:** Medium. Prefer a collection-local URL builder if that is simpler than generalizing the existing Shop helper.

## Task U4 — Add bounded deterministic PDP related products

**Description:** Add “Hoàn thiện phối đồ”/related product merchandising using shared published collection membership, excluding the current product and keeping visibility/active-state boundaries. Preserve trusted product-specific size-guide/care presentation without introducing a support-route link owned elsewhere.

**Acceptance criteria:**
- [ ] related products are deterministic, current product excluded, and capped at **4**;
- [ ] only current public/active products with trusted storefront projection are rendered;
- [ ] no new recommendation persistence or fabricated “set” relationship is introduced;
- [ ] trusted product-specific `sizeGuide`/care content remains usable;
- [ ] U4 does not add a `/size-guide` link before U5 creates the approved route atomically with that link.

**Verification:**
- [ ] repository/domain tests cover shared collection, exclusion, deterministic ordering and hard limit of 4;
- [ ] PDP browser regression covers related-product links and fallback when none exist;
- [ ] PDP link assertions prove no broken `/size-guide` link is introduced by U4;
- [ ] no change to Add-to-Bag/price/stock authority.

**Dependencies:** U1; existing published collection membership.

**Files likely touched:** storefront catalog repository/runtime, PDP route/component, focused domain/database/integration/browser tests.

**Estimated scope:** Medium; split repository selection and PDP UI if combined diff exceeds ~5 files.

## Task U5 — Build factual trust/footer/support surfaces

**Description:** Expand footer/support architecture using existing verified COD and shipping facts. Create each support page only after its own factual content is explicitly approved. Route existence alone does not grant search exposure.

**Acceptance criteria:**
- [ ] footer exposes COD, shipping promotion and order tracking using existing policy helpers rather than duplicated constants;
- [ ] `/about`, `/size-guide`, `/shipping-returns`, and `/faq` each require explicit content approval before shipping; none is presumed approved by this plan;
- [ ] `/shipping-returns` additionally requires an approved return/exchange policy and `/faq` requires approved factual answers;
- [ ] every shipped support page exports a unique factual title/description;
- [ ] U5 does **not** add a public self-canonical merely because a support route exists; search-exposure metadata remains fail-closed until U6 owns canonical + allowlist + sitemap atomically;
- [ ] when `indexingEnabled=false`, public canonical metadata is absent;
- [ ] `/size-guide` route creation and the PDP link to `/size-guide` land in the same accepted slice so the link cannot 404;
- [ ] support pages remain fail-closed under the current search/indexing configuration until U6 prepares eligible approved routes and the separate ADR 0004 launch gate is satisfied.

**Verification:**
- [ ] link-guard tests cover every new footer/support/PDP support link;
- [ ] support content tests prove shipping/COD values are derived from canonical helpers;
- [ ] metadata assertions cover title/description and absence of public canonical under the current indexing-disabled mode;
- [ ] `/size-guide` link test proves route + PDP link ship atomically;
- [ ] mobile/desktop accessibility regression passes.

**Dependencies:** U1; explicit approved content for each route.

**Files likely touched:** footer, public content helper(s), approved support page routes, PDP route only when adding the atomic `/size-guide` link, metadata/content integration tests.

**Estimated scope:** Medium; ship one support route/concern per focused slice if approvals arrive independently.

## Task U6 — SEO, structured-data, accessibility and release-quality regression gate

**Description:** Integrate U2–U5, add collection BreadcrumbList structured data, atomically prepare only approved support routes for eventual search exposure behind the existing global gate, and close the refinement with full metadata/indexing/accessibility/build evidence.

**Acceptance criteria:**
- [ ] collection BreadcrumbList mirrors the visible breadcrumb and uses the server-owned origin; U6 is the single owner of this structured-data change after U3 is accepted;
- [ ] for each shipped/approved support route, conditional self-canonical metadata, exact indexable-path allowlist entry, and static sitemap-path inclusion are introduced in the same focused search-exposure slice; unimplemented/unapproved routes remain absent from all three;
- [ ] no intermediate merged state exists where a support page advertises canonical metadata while the response policy still treats that route as non-indexable under an otherwise indexing-enabled eligible origin;
- [ ] adding an approved support path to code does **not** enable public indexing by itself: current temporary production remains `SEARCH_INDEXING_ENABLED=false`, noindex/nofollow, without public canonicals, and with an empty sitemap under ADR 0004;
- [ ] actual support-route indexability/canonical/sitemap advertising is verified only in a test configuration representing an eligible permanent public origin with `indexingEnabled=true`; production enablement still requires separate permanent-domain confirmation and explicit human approval;
- [ ] `/new-arrivals` remains outside V3 search-exposure promotion unless separately specified/approved;
- [ ] support pages introduce no query/faceted indexable states;
- [ ] Product/Offer/Organization/WebSite structured data remains unchanged unless required by an explicit defect;
- [ ] all refined public routes satisfy the project Definition of Done with 0 Critical / 0 Required review findings.

**Verification:**
- [ ] focused collection BreadcrumbList structured-data tests;
- [ ] search-policy tests for each shipped support route in both indexing-disabled current-production mode and eligible indexing-enabled mode;
- [ ] current-production/disabled sitemap regression proves sitemap remains empty and canonicals are withheld;
- [ ] eligible-enabled HTTP/metadata regression proves each approved support route is simultaneously indexable, self-canonical, and present in sitemap while unapproved routes remain absent/noindex;
- [ ] ADR 0004 release gate is explicitly checked/documented; this V3 refinement must not set `SEARCH_INDEXING_ENABLED=true` or claim final-domain approval;
- [ ] `pnpm lint`, `pnpm typecheck`, relevant tests, `pnpm build`;
- [ ] representative 390px + desktop browser/Axe/keyboard/overflow checks;
- [ ] metadata/robots/sitemap/canonical HTTP regression;
- [ ] final correctness → security → architecture → simplicity → performance review.

**Dependencies:** U2, U3, U4, and U5 accepted and integrated.

**Files likely touched:** `src/seo/search-exposure.ts`, `src/app/sitemap.ts`, approved support-route metadata, structured-data helper/collection route, search/metadata tests, existing runtime workflows only if coverage genuinely needs expansion. `src/proxy.ts` should remain the centralized response noindex gate unless a proven defect requires changing it.

**Estimated scope:** Medium for the convergence check itself. If support-route search preparation requires more than ~5 files, implement focused U6a slice(s) first, then run a docs/test-only U6b final convergence gate. U6 remains after U2–U5 either way.

## Checkpoints

### Checkpoint V3-A — after U1
- buyer terminology approved across shell, discovery, Cart/Checkout, Search/New arrivals and footer;
- `Túi hàng` is the single transactional cart term;
- technical public copy removed without weakening factual commerce statements;
- U2–U5 may start independently.

### Checkpoint V3-B — before U6 convergence
- U2–U5 accepted independently;
- no inert `/shop?category=...` homepage links remain;
- collection route slug cannot be overridden by query state;
- only approved support content is public;
- no broken PDP → `/size-guide` link exists;
- U2 did not widen remote media/CSP origins merely to add editorial imagery;
- no support route has been silently made indexable by route creation alone.

### Checkpoint V3-C — final gate
- integrated head passes U6 verification;
- temporary production still satisfies ADR 0004 (`SEARCH_INDEXING_ENABLED=false`, no public canonical, empty sitemap) unless a separate permanent-domain/indexing approval has happened outside this plan;
- 0 Critical / 0 Required findings;
- human approval before merge/ship.

## Human checkpoints
- Approve this V3 spec/plan before implementation.
- Approve collection merchandising names/order before U2 ships.
- **Optional only:** supply/approve a dedicated editorial hero asset if the catalog-media fallback should be replaced. Absence of this asset does not block U2.
- Approve the factual content of **each** support page independently before that page ships.
- Supply/approve actual return/exchange, hotline and Zalo facts before publishing them.
- Approve structured size-table data model separately if free-form size guides are replaced.
- Permanent domain selection and `SEARCH_INDEXING_ENABLED=true` require the separate ADR 0004/P19 human approval and are **not** granted by approval of this V3 plan.

## Definition of Done overlay
Every behavior-changing slice must satisfy the repository's standing Definition of Done: task acceptance, focused failing test before implementation, existing regressions green, runtime verification where relevant, no unrelated refactor, security/search boundaries preserved, documentation current, and human review before merge.
