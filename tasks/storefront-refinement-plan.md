# Storefront refinement V3 — implementation plan

Status: **DRAFT — requires human approval before `/build`**

Basis: `docs/design/storefront-refinement-v3.md` plus current `main` architecture. This plan intentionally does not modify the existing P0–P19 historical plan/checklist.

## Dependency graph

Authoritative dependency edges:

```text
U1a + U1b + U1c → U2
U1a + U1b + U1c → U3
U1a + U1b + U1c → U4
U1a + U1b + U1c → U5
U2 + U3 + U4 + U5 → U6a
U2 + U3 + U4 + U5 → U6b
U6a + U6b → U6c
```

Rules:
- U1 is complete only when U1a, U1b, and U1c are accepted; together they establish shared buyer terminology and remove technical buyer copy.
- U2, U3, U4, and U5 may proceed independently after all U1 slices, subject to their own content/merchandising approval gates.
- U3 and U4 must coordinate only if both need the same storefront catalog contract; neither may invent a second collection-membership rule.
- U5 owns creation of the public `/size-guide` route and the PDP link to it so route + link land atomically.
- U6a owns SEO/structured-data convergence; U6b owns known landmark/id accessibility debt; U6c is the final release-quality gate.
- U6a owns support-route search exposure as one atomic concern: conditional self-canonical metadata, indexable-path allowlist, and sitemap inclusion move together for each approved route.
- No U6 slice may bypass ADR 0004's permanent-domain + explicit human indexing approval.

## Task U1 — Normalize buyer language and remove technical copy

**Description:** Establish the exact Vietnamese-first label map from the spec across shell, discovery, merchandising, Cart/Checkout, and checkout error states without changing commerce behavior. Lock `Túi hàng` as the single cart concept everywhere, including submit-feedback banners and recovery links.

**Acceptance criteria:**
- [ ] desktop/mobile header and footer use the locked navigation labels: `Cửa hàng`, `Hàng mới`, `Bộ sưu tập`, `Lookbook`, `Tìm kiếm`, `Tài khoản`, `Túi hàng`;
- [ ] all Cart/Checkout empty/error/recovery copy uses `Túi hàng`; `Giỏ hàng` does not remain in buyer-facing checkout submit feedback or recovery links;
- [ ] public Shop/Collection/PDP copy no longer exposes catalog-mirror/server implementation details where buyer value is absent;
- [ ] no factual commerce statement is weakened or invented.

**Verification:**
- [ ] focused content assertions are updated first (RED), then copy changes make them GREEN;
- [ ] header tests cover desktop + mobile exact labels; footer/Search/New arrivals assertions cover the same locked terminology;
- [ ] checkout feedback tests explicitly cover `CART_CHANGED` and `CART_UNAVAILABLE`, and the guest-checkout error-state link text; do not verify only the happy path;
- [ ] buyer-flow browser checks cover header → Shop/Collection/PDP → Cart → Checkout plus Search/New arrivals/footer navigation.

**Dependencies:** None.

**Mandatory implementation slices:**
- **U1a — shell/search copy:** `src/components/layout/site-header.tsx`, `src/components/layout/site-footer.tsx`, `src/app/search/page.tsx`, `src/app/new-arrivals/page.tsx`, focused tests.
- **U1b — merchandising-page copy:** `src/app/shop/page.tsx`, `src/app/collections/[slug]/page.tsx`, `src/app/shop/[slug]/page.tsx`, focused tests.
- **U1c — transactional copy/error states:** `src/app/cart/page.tsx`, `src/app/checkout/page.tsx`, `src/commerce/checkout-submit-feedback.ts`, `src/components/commerce/guest-checkout-form.tsx`, focused tests.

U1 is not complete until U1a, U1b, and U1c all satisfy the same terminology map.

**Estimated scope:** Three Medium-or-smaller slices; keep each implementation diff at roughly ≤5 production/test files where practical.

## Task U2 — Make homepage merchandising collection-driven

**Description:** Replace the currently inert `/shop?category=...` homepage links with valid published website-owned collection navigation while preserving the existing Campaign/Lookbook identity and the existing factual brand-facts/trust block. Editorial hero asset work is optional and content-gated, not required for U2 completion.

**Acceptance criteria:**
- [ ] homepage renders curated published collection rail(s) with crawlable `/collections/{slug}` links;
- [ ] **no** `/shop?category=...` link remains on the homepage after U2;
- [ ] each old category-query destination is either replaced by an explicitly reviewed published collection mapping or removed when no truthful mapping exists;
- [ ] if all category links are removed, the empty `category-strip`/heading/navigation container is removed too;
- [ ] the target Trust/support strip is satisfied by refining/repositioning the existing factual homepage brand-facts block, with values still derived from canonical public-brand/shipping helpers and no links to unapproved support routes;
- [ ] current trusted catalog hero media remains a valid fallback; absence of an approved editorial hero asset does not block U2, and U2 does not widen `remotePatterns` or CSP merely for editorial imagery.

**Optional editorial-asset slice:**
If the human supplies and approves a repository-owned editorial asset, add it as a separate focused same-origin content slice. No remote-origin expansion is part of V3 by default.

**Verification:**
- [ ] RED regression proves current `category=` links do not produce category filtering and therefore must not survive the slice;
- [ ] published-only collection eligibility test;
- [ ] homepage link guard explicitly rejects `/shop?category=` and rejects links to unimplemented support routes;
- [ ] empty-container regression proves no “Shop by category” heading/nav remains when no truthful mapping exists;
- [ ] trust-fact assertions prove COD/shipping/order-confirmation copy still derives from canonical helpers;
- [ ] media-boundary regression proves U2 does not broaden remote media origins;
- [ ] mobile/desktop browser check: no overflow, no broken images, Axe clean.

**Dependencies:** U1a + U1b + U1c; collection merchandising names/order approved. Optional editorial asset slice additionally requires explicit asset approval/supply.

**Files likely touched:** homepage route, one collection-merchandising/helper boundary if needed, existing public brand-facts/shipping helper only if presentation API genuinely requires it, focused tests.

**Estimated scope:** Medium. Keep optional asset delivery out of the core U2 diff unless an approved asset actually exists.

## Task U3 — Upgrade collection landing to full PLP using existing discovery/facet contracts

**Description:** Reuse the existing discovery parser, discovery facets, and catalog repository behavior for collection Sort + Size controls while keeping the path slug as the only collection identity authority. Collection navigation uses a collection-local URL builder; the Shop href helper is out of scope for U3.

**Acceptance criteria:**
- [ ] Sort uses the existing `STOREFRONT_DISCOVERY_SORTS` allowlist;
- [ ] Size UI options come from existing `facets.sizes`; raw URL size remains governed by the current bounded normalized-text parser contract;
- [ ] `/collections/a?collection=b` never renders collection `b` products under route `a` content/canonical;
- [ ] collection discovery input is constructed from explicit supported query keys plus the route-owned slug; arbitrary raw params are not spread into discovery input;
- [ ] U3 does **not** call or generalize `buildStorefrontDiscoveryHref`; collection href generation is collection-local and never serializes `collection=`;
- [ ] pure pagination anchors are emitted exactly as `/collections/{slug}?page=N`; base page is `/collections/{slug}`; filtered/sorted utility anchors remain under that path and carry only supported filter/sort/page state;
- [ ] changing a filter resets page appropriately; pagination preserves active Size/Sort state without adding `collection=`;
- [ ] faceted/sorted states remain noindex/non-canonical, while base/pure-pagination states retain the existing canonical policy when global indexing is approved and enabled.

**Verification:**
- [ ] RED/GREEN unit/integration tests for the **emitted href strings**, not only responses after navigation;
- [ ] exact href regression asserts no collection-page anchor contains `collection=` and pure pagination contains only `?page=N`;
- [ ] `/collections/a?collection=b` regression proves route-slug authority and no cross-collection leakage;
- [ ] metadata/HTTP regression for base, pure pagination, size, sort, user-supplied collection query, and mixed states;
- [ ] mobile/desktop keyboard/Axe browser coverage for controls and pagination.

**Dependencies:** U1a + U1b + U1c.

**Files likely touched:** `src/app/collections/[slug]/page.tsx`, focused collection href/route tests, metadata/search-policy tests, browser spec. Do not modify `src/commerce/storefront-discovery.ts` merely to make its Shop-specific href helper generic.

**Estimated scope:** Medium, ~3–5 files.

## Task U4 — Add bounded deterministic PDP related products

**Description:** Add “Hoàn thiện phối đồ”/related product merchandising using the current product's existing storefront-projected published collection memberships, excluding the current product and preserving visibility/active-state boundaries. Do not create a second collection-membership interpretation.

**Acceptance criteria:**
- [ ] the current product's projected `collections` array is the sole seed for related-product collection membership;
- [ ] U4 does not gate collection membership on `ProductContent.status` and does not independently read raw `collectionSlugs` in the PDP/UI path; current projection semantics remain authoritative;
- [ ] candidate products are fetched through the existing storefront catalog/discovery boundary for those projected collection slugs, remain visible/active, exclude the current product, are deduplicated, deterministically ordered, and hard-capped at **4**;
- [ ] no recommendation persistence or fabricated “set” relationship is introduced;
- [ ] trusted product-specific `sizeGuide`/care content remains usable, and U4 does not add a `/size-guide` link before U5 creates route + link atomically.

**Verification:**
- [ ] repository/domain tests cover projected published-collection seeding, exclusion, deduplication, deterministic ordering, visibility/active filtering, and limit 4;
- [ ] regression fixture with non-PUBLISHED editorial content proves U4 follows existing projected collection-membership semantics rather than inventing a status gate;
- [ ] PDP browser regression covers related-product links and fallback when none exist;
- [ ] no change to Add-to-Bag/price/stock authority.

**Dependencies:** U1a + U1b + U1c; existing storefront product projection and published collection definitions.

**Files likely touched:** storefront catalog repository/runtime or a focused related-selection helper, PDP route/component, focused domain/database/integration/browser tests.

**Estimated scope:** Medium; split selection logic and PDP rendering if the combined diff exceeds ~5 files.

## Task U5 — Build factual trust/footer/support surfaces

**Description:** Expand footer/support architecture using existing verified COD and shipping facts. Create each support page only after its own factual content is explicitly approved. Route existence alone does not grant search exposure.

**Acceptance criteria:**
- [ ] footer exposes COD, shipping promotion and order tracking using existing policy helpers rather than duplicated constants;
- [ ] `/about`, `/size-guide`, `/shipping-returns`, and `/faq` each require explicit content approval before shipping; none is presumed approved by this plan;
- [ ] `/shipping-returns` additionally requires an approved return/exchange policy and `/faq` requires approved factual answers;
- [ ] every shipped support page exports a unique factual title/description;
- [ ] U5 does **not** add a public self-canonical merely because a support route exists; search-exposure metadata remains fail-closed until U6a owns canonical + allowlist + sitemap atomically;
- [ ] when `indexingEnabled=false`, public canonical metadata is absent;
- [ ] `/size-guide` route creation and the PDP link to `/size-guide` land in the same accepted slice so the link cannot 404;
- [ ] support pages remain fail-closed under current search/indexing configuration until U6a prepares eligible approved routes and the separate ADR 0004 launch gate is satisfied.

**Verification:**
- [ ] link-guard tests cover every new footer/support/PDP support link;
- [ ] support content tests prove shipping/COD values are derived from canonical helpers;
- [ ] metadata assertions cover title/description and absence of public canonical under current indexing-disabled mode;
- [ ] `/size-guide` link test proves route + PDP link ship atomically;
- [ ] mobile/desktop accessibility regression passes.

**Dependencies:** U1a + U1b + U1c; explicit approved content for each route.

**Files likely touched:** footer, public content helper(s), approved support page route, PDP route only when adding the atomic `/size-guide` link, focused metadata/content tests.

**Estimated scope:** Medium; ship one support route/concern per focused slice if approvals arrive independently.

## Task U6a — SEO and structured-data convergence

**Description:** After U2–U5 are integrated, add collection BreadcrumbList and atomically prepare only approved support routes for eventual search exposure behind the existing global gate.

**Acceptance criteria:**
- [ ] collection BreadcrumbList mirrors the visible breadcrumb and uses the server-owned origin;
- [ ] for each shipped/approved support route, conditional self-canonical metadata, exact indexable-path allowlist entry, and static sitemap-path inclusion are introduced in the same focused search-exposure slice;
- [ ] no intermediate merged state advertises a support canonical while an otherwise indexing-enabled eligible origin still noindexes that route;
- [ ] current temporary production remains `SEARCH_INDEXING_ENABLED=false`, noindex/nofollow, without public canonicals, and with an empty sitemap under ADR 0004;
- [ ] `/new-arrivals` remains outside V3 search-exposure promotion unless separately specified/approved;
- [ ] Product/Offer/Organization/WebSite structured data remains unchanged unless required by a proven defect.

**Verification:**
- [ ] collection BreadcrumbList tests;
- [ ] search-policy tests for each shipped support route in indexing-disabled current-production mode and eligible indexing-enabled mode;
- [ ] disabled sitemap/canonical regression and enabled eligible-origin HTTP/metadata/sitemap regression;
- [ ] ADR 0004 release gate explicitly checked/documented; V3 does not set `SEARCH_INDEXING_ENABLED=true` or claim permanent-domain approval.

**Dependencies:** U2 + U3 + U4 + U5.

**Files likely touched:** `src/seo/search-exposure.ts`, `src/app/sitemap.ts`, approved support-route metadata, structured-data helper/collection route, focused search/metadata tests.

**Estimated scope:** Medium per focused search-exposure slice. If multiple support routes would exceed ~5 files together, expose them in separate U6a sub-slices; keep canonical + allowlist + sitemap atomic per route.

## Task U6b — Fix page landmark/id accessibility debt

**Description:** Correct the existing nested-main/duplicate-id defect instead of treating it as a baseline. Keep the root layout as the sole owner of the page-level `<main id="main-content">` and make route wrappers non-main semantic containers.

**Acceptance criteria:**
- [ ] every public route renders under exactly one page-level `main` landmark supplied by root layout;
- [ ] `id="main-content"` occurs exactly once in a rendered page and the existing skip link resolves to that single target;
- [ ] `/track-order` no longer duplicates `main-content`, and all other route-level nested `<main>` wrappers discovered in the audit are removed/replaced without changing visual layout or commerce behavior.

**Verification:**
- [ ] add a route/markup regression that fails on nested `<main>` or duplicate `main-content` ids;
- [ ] Axe + keyboard skip-link verification on representative public routes including `/track-order`, Cart, Checkout, Collection, and PDP;
- [ ] no CSS/layout regression from wrapper-element replacement.

**Dependencies:** U2 + U3 + U4 + U5.

**Files likely touched:** `src/app/layout.tsx` only if the root ownership contract needs an assertion, plus route page wrappers that currently render nested `<main>`, and focused accessibility tests.

**Estimated scope:** The audit may span more than five route files. Before implementation, split U6b into route-group sub-slices of ≤5 production/test files each; each sub-slice must leave the affected routes with valid landmark structure.

## Task U6c — Final release-quality regression gate

**Description:** Converge accepted U6a/U6b heads and close V3 with full project Definition-of-Done evidence.

**Acceptance criteria:**
- [ ] all refined public routes satisfy the spec and project Definition of Done;
- [ ] 0 Critical / 0 Required review findings remain;
- [ ] no indexing/domain approval is inferred from this plan; temporary production still follows ADR 0004 unless a separate approval happened outside V3.

**Verification:**
- [ ] `pnpm lint`;
- [ ] `pnpm typecheck`;
- [ ] relevant focused/full tests;
- [ ] `pnpm build`;
- [ ] representative 390px + desktop browser/Axe/keyboard/overflow checks;
- [ ] metadata/robots/sitemap/canonical HTTP regression;
- [ ] final correctness → security → architecture → simplicity → performance review.

**Dependencies:** U6a + U6b.

**Files likely touched:** tests/docs/runtime workflows only if a proven coverage gap requires it; avoid production refactor in this final gate.

**Estimated scope:** Small/Medium verification-focused slice.

## Checkpoints

### Checkpoint V3-A — after U1a/U1b/U1c
- exact locked buyer labels approved across desktop/mobile shell, discovery, Search/New arrivals, Cart/Checkout, checkout submit feedback, and footer;
- `Túi hàng` is the single transactional cart term, including error banners/recovery links;
- technical public copy removed without weakening factual commerce statements;
- U2–U5 may start independently.

### Checkpoint V3-B — before U6 convergence
- U2–U5 accepted independently;
- no inert `/shop?category=...` homepage links or empty category container remain;
- homepage trust facts remain canonical-helper driven;
- collection route slug cannot be overridden by query state;
- no collection href contains `collection=`; pure pagination href is exact `?page=N`;
- U4 related products use projected published collection membership as the single seed source;
- only approved support content is public;
- no broken PDP → `/size-guide` link exists;
- U2 did not widen remote media/CSP origins merely to add editorial imagery;
- no support route has been silently made indexable by route creation alone.

### Checkpoint V3-C — final gate
- U6a search/schema convergence accepted;
- U6b landmark debt fixed with one `main`/one `main-content` target per page;
- integrated head passes U6c verification;
- temporary production still satisfies ADR 0004 unless a separate permanent-domain/indexing approval happened outside this plan;
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
