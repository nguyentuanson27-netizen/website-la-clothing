# Storefront refinement V3 — implementation plan

Status: **DRAFT — requires human approval before `/build`**

Basis: `docs/design/storefront-refinement-v3.md` plus current `main`. This plan does not modify the historical P0–P19 plan/checklist.

## Authoritative dependency graph

```text
U0a → U0b
U0b → U1a
U0b → U1b
U0b → U1c
U1a + U1b + U1c → U2
U1a + U1b + U1c → U3
U1a + U1b + U1c → U4
U1a + U1b + U1c → U5
U2 + U3 + U4 + U5 → U6a
U6a → U6b
```

Rules:
- U0 fixes known landmark debt and enables the runtime best-practice gate **before** any V3 feature/support route work.
- U1 is complete only when U1a/U1b/U1c are accepted. The repo-wide terminology inventory is authoritative; `Files likely touched` are examples, not a completeness boundary.
- Every U1 slice owns both production copy and directly affected test assertions. Do not defer stale test strings to a later cleanup PR.
- U2/U3/U4/U5 may proceed independently only after all U1 slices.
- U6a converges SEO/structured-data/search-exposure behavior after U2–U5; U6b is final DoD/review verification.
- No task may bypass ADR 0004 indexing approval.

## U0a — Remove existing page-landmark/id debt

**Description:** Fix the known nested `<main>`/duplicate `main-content` debt so root layout is the sole page-level main landmark before new storefront/support routes are added.

**Acceptance criteria:**
- [ ] root layout remains sole owner of `<main id="main-content">`;
- [ ] every audited public route uses non-main inner wrappers and does not duplicate `main-content`;
- [ ] skip link resolves to exactly one target;
- [ ] visual layout and commerce behavior are unchanged.

**Verification:**
- [ ] RED markup/runtime regression demonstrates current nested-main/duplicate-id failure first;
- [ ] audit all public route wrappers, not only `/track-order`;
- [ ] representative runtime checks include `/`, Shop, Collection, PDP, Cart, Checkout, Track order.

**Dependencies:** None.

**Files likely touched:** route wrapper files discovered by the audit plus focused accessibility regression. Split into route-group sub-slices of ≤5 production/test files; each merged sub-slice must leave its affected routes valid.

**Estimated scope:** Multiple Small/Medium sub-slices.

## U0b — Enable storefront Axe best-practice landmark coverage

**Description:** After current landmark debt is fixed, extend storefront accessibility runtime scans so landmark uniqueness regressions fail before U1–U5 work can ship.

**Acceptance criteria:**
- [ ] **every** buyer-facing Axe scan includes the relevant `best-practice` coverage in addition to existing WCAG tags — not a filename-glob subset;
- [ ] coverage explicitly includes `tracking.spec.ts` (`/track-order`, the only current duplicate `main-content` id), `checkout.spec.ts`, `collection-landing.spec.ts`, `discovery.spec.ts`, and `editorial.spec.ts` alongside the `storefront-*` specs;
- [ ] landmark uniqueness/duplicate-main regressions are caught by the runtime suite;
- [ ] admin-only coverage is changed only if the same rule is intentionally adopted there.

**Verification:**
- [ ] focused accessibility runtime specs pass after U0a;
- [ ] a controlled duplicate-main fixture or direct markup assertion proves the new gate would fail on regression;
- [ ] an inventory assertion proves no buyer-facing Axe spec still runs the WCAG-only tag set, so a future spec cannot silently opt out.

**Dependencies:** U0a.

**Files likely touched:** the buyer-facing `tests/a11y-runtime/*.spec.ts` scans named above. Prefer extracting the shared `withTags([...])` set into one helper the specs import, so the tag set is changed in a single place; do not mass-refactor unrelated Playwright code.

**Estimated scope:** Small/Medium.

## U1 — Normalize buyer language and close dead search entry behavior

### U1 completion contract
Before editing, create a repo-wide exact-string inventory across `src/` and tests for locked buyer terms and known old English variants. Classify every hit as:
1. buyer-functional → must change in the owning slice;
2. explicit editorial exception → document/retain;
3. test assertion → update in the same slice as the source behavior.

U1 cannot pass while a buyer-functional old term remains or an affected test still asserts the old contract. Do **not** make tests import the same production label constant merely to avoid updating assertions; tests should independently assert the locked copy contract.

### U1a — Shell, homepage functional copy, Search entry, New arrivals

**Description:** Apply locked Vietnamese labels to navigation/shell and homepage functional CTAs while keeping explicit editorial titles intact. Make `/search` a truthful entry surface by handing `q` to existing Shop discovery instead of emitting dead `/search?q=` states.

**Acceptance criteria:**
- [ ] desktop/mobile header and footer use `Cửa hàng`, `Hàng mới`, `Bộ sưu tập`, `Lookbook`, `Tìm kiếm`, `Tài khoản`, `Túi hàng`;
- [ ] homepage functional strings such as `Shop the collection`, `View collections`, `Shop edit`, `View all`, and trust-nav `Shop`/`Collections` are localized; campaign/editorial titles listed as explicit exemptions remain allowed;
- [ ] `/search` H1/button/label are Vietnamese and its GET form hands `q` to `/shop`, not `/search`; no dead `/search?q=` URL is generated;
- [ ] `/new-arrivals` functional H1/body copy is Vietnamese-first; editorial eyebrow may remain intentional;
- [ ] affected source and Playwright/integration assertions are updated together.

**Verification:**
- [ ] RED/GREEN content tests for desktop + mobile shell, homepage functional CTA copy, Search form action/name, and New arrivals H1;
- [ ] exact URL assertion proves Search submit targets `/shop?q=<term>` and `/search` remains outside index/sitemap promotion;
- [ ] post-change repo-wide locked-term inventory has no unexplained buyer-functional hits in this slice.

**Dependencies:** U0b.

**Files likely touched:** `src/components/layout/site-header.tsx`, `src/components/layout/site-footer.tsx`, `src/app/page.tsx`, `src/app/search/page.tsx`, `src/app/new-arrivals/page.tsx`, plus directly affected tests. Split U1a further if the inventory exceeds ~5 production/test files in one diff.

**Estimated scope:** Medium, possibly two focused sub-slices.

### U1b — Shop/Collections/PDP functional copy and purchase CTA

**Description:** Localize buyer-functional listing/PDP copy while preserving product/collection/editorial names. Lock purchase CTA to `Thêm vào túi`.

**Acceptance criteria:**
- [ ] `/collections` H1 and functional `Explore collection`/empty-state copy are Vietnamese-first;
- [ ] Shop/Collection/PDP buyer-functional architecture/CTA copy is localized and technical mirror/server explanations are removed where they add no buyer value;
- [ ] no factual commerce statement is weakened or invented: a disclosure that states how availability is actually decided (for example the server-side re-check disclosure on the PDP) may be reworded into buyer language, but may not be deleted as "architecture copy" without an equally factual replacement;
- [ ] `product-purchase-panel.tsx` uses `Thêm vào túi`; PDP explanatory text does not reintroduce `Add to Bag`;
- [ ] affected tests are updated in the same slice.

**Verification:**
- [ ] RED/GREEN assertions for Collections H1/CTA, PDP purchase CTA, and relevant Shop/Collection/PDP strings;
- [ ] an assertion proves the PDP still discloses server-side availability verification after the copy change;
- [ ] repo-wide inventory confirms `Add to Bag` is absent from buyer-facing source/tests except historical docs not under this task.

**Dependencies:** U0b.

**Files likely touched:** `src/app/collections/page.tsx`, `src/app/shop/page.tsx`, `src/app/collections/[slug]/page.tsx`, `src/app/shop/[slug]/page.tsx`, `src/components/commerce/product-purchase-panel.tsx`, plus directly affected tests. Split by surface to keep each implementation diff focused.

**Estimated scope:** Medium sub-slices.

### U1c — Cart/Checkout/loading/error/submit-feedback terminology

**Description:** Make `Túi hàng` the single transactional cart term across normal, loading, error, checkout-submit, and recovery states.

**Acceptance criteria:**
- [ ] Cart H1 is Vietnamese-first (`TÚI HÀNG`) in empty and populated states;
- [ ] cart loading/error states contain no buyer-facing `Bag`, `YOUR BAG`, or `Giỏ hàng` drift;
- [ ] Checkout page, `checkout-submit-feedback.ts`, and guest-checkout recovery link use `Túi hàng` consistently, including `CART_CHANGED` and `CART_UNAVAILABLE`;
- [ ] affected Playwright/integration assertions update with source in the same slice.

**Verification:**
- [ ] RED/GREEN error-path tests cover `CART_CHANGED`, `CART_UNAVAILABLE`, empty cart, loading/error copy, and recovery-link text;
- [ ] do not verify only checkout happy path;
- [ ] repo-wide inventory has zero unexplained transactional `Bag`/`Cart`/`Giỏ hàng` buyer terms.

**Dependencies:** U0b.

**Files likely touched:** `src/app/cart/page.tsx`, `src/app/cart/loading.tsx`, `src/app/cart/error.tsx`, `src/app/checkout/page.tsx`, `src/commerce/checkout-submit-feedback.ts`, `src/components/commerce/guest-checkout-form.tsx`, plus directly affected tests. Split into cart-state and checkout-feedback sub-slices to stay ≤5 files where practical.

**Estimated scope:** Two Medium-or-smaller sub-slices.

## U2 — Homepage collection merchandising + trust

**Description:** Replace inert category-query navigation with truthful published-collection merchandising, own the target collection-navigation region, and refine the existing factual brand-facts block into the trust/support strip.

**Acceptance criteria:**
- [ ] no `/shop?category=...` homepage link remains;
- [ ] replacement links target reviewed published `/collections/{slug}` mappings only;
- [ ] zero mappings → remove category container/heading/nav entirely;
- [ ] one or more mappings → render collection navigation with Vietnamese heading `Mua theo bộ sưu tập`; never retain `Shop by category`;
- [ ] U2 explicitly owns the target “collection navigation region”; it is not an orphan sequence item;
- [ ] trust/support strip reuses canonical public-brand/shipping facts and links only to implemented/approved routes;
- [ ] current trusted catalog hero media remains valid fallback; optional editorial asset cannot block U2, and U2 does not widen `remotePatterns` or the CSP `img-src` allowlist merely for editorial imagery.

**Verification:**
- [ ] media-boundary regression proves `next.config.mjs` `remotePatterns` and the CSP `img-src` allowlist are byte-for-byte unchanged by U2;
- [ ] regression proves `category=` links are inert on current main and are absent after U2;
- [ ] tests cover 0, partial (1–3), and full mapping cases including heading/container behavior;
- [ ] homepage link guard rejects dead category queries and unimplemented support routes;
- [ ] trust-fact assertions prove canonical-helper sourcing;
- [ ] mobile/desktop/Axe/overflow checks remain green under U0b best-practice gate.

**Dependencies:** U1a + U1b + U1c; merchandising mapping/order approval.

**Files likely touched:** homepage route, focused collection-merchandising helper/repository if needed, homepage tests. Optional asset slice is separate and approval-gated.

**Estimated scope:** Medium.

## U3 — Collection PLP Sort + Size with canonical URL generation

**Description:** Add Sort + Size using existing discovery/facets while keeping route slug authoritative and guaranteeing that every generated/navigation URL source obeys collection canonical-search semantics.

**Acceptance criteria:**
- [ ] Sort uses existing allowlist; Size options come from `facets.sizes` and raw URL size stays bounded/normalized;
- [ ] route slug is the only collection identity; `/collections/a?collection=b` cannot switch rendered products to `b`;
- [ ] U3 uses a collection-local serializer and does **not** call or generalize `buildStorefrontDiscoveryHref`;
- [ ] serializer strips default-valued state before output: omit `sort=name-asc` and `page=1`;
- [ ] changing Sort or Size resets pagination to page 1; pagination preserves active Size/Sort state without adding `collection=`. No control may carry a stale `page` into a newly filtered result set, because `src/app/collections/[slug]/page.tsx` calls `notFound()` for a page beyond `totalPages`;
- [ ] no generated collection URL contains `collection=`;
- [ ] base is exactly `/collections/{slug}` and pure pagination exactly `/collections/{slug}?page=N`; canonical-intended output from **every source** must satisfy the existing `canonicalSearch` contract;
- [ ] filtered/sorted URLs contain only active supported state and remain intentionally noindex/non-canonical;
- [ ] **all URL sources** use the same normalization contract: anchors, filter/sort controls, pagination, redirects, and any form submission. Do not ship raw GET-form serialization that can emit route-owned `collection` or default `sort`/`page` values.

**Verification:**
- [ ] RED/GREEN tests assert emitted href/navigation strings, not only response behavior;
- [ ] explicit tests: default sort + page 2 emits only `?page=2`; page 1 emits no page param; no source emits `collection=`;
- [ ] explicit test: changing Sort or Size while on page N emits a URL with no `page` param, and a collection with fewer results after filtering never renders a 404 from a carried-over page number;
- [ ] if a form/control implementation is used, test its actual submitted/navigation URL in the browser;
- [ ] metadata/HTTP tests cover base, pure pagination, size, non-default sort, malicious `collection`, default-valued params, and mixed states;
- [ ] keyboard/Axe/overflow checks.

**Dependencies:** U1a + U1b + U1c.

**Files likely touched:** `src/app/collections/[slug]/page.tsx`, a focused collection URL helper/test, metadata/search-policy tests, browser spec. Do not modify `src/commerce/storefront-discovery.ts` merely to generalize the Shop href helper.

**Estimated scope:** Medium, ~3–5 files per slice.

## U4 — Deterministic related products

**Description:** Add “Hoàn thiện phối đồ” using the current product's projected published collection memberships without creating another membership rule.

**Acceptance criteria:**
- [ ] seed only from current product `collections` projection;
- [ ] do not independently gate collection membership on `ProductContent.status` or read raw `collectionSlugs` in PDP/UI;
- [ ] fetch candidates via existing storefront catalog/discovery boundaries, visible/active only;
- [ ] exclude current product, deduplicate, deterministic order, max 4;
- [ ] no recommendation persistence or fabricated set relationship;
- [ ] U4 does not add `/size-guide` link before U5 route+link atomic slice.

**Verification:**
- [ ] tests cover projection semantics, non-PUBLISHED editorial content, exclusion, dedupe, ordering, visibility, max 4;
- [ ] PDP browser fallback when no related products;
- [ ] Add-to-Bag/price/stock authority unchanged.

**Dependencies:** U1a + U1b + U1c.

**Files likely touched:** storefront catalog/related helper, PDP, focused tests.

**Estimated scope:** Medium; split selection and rendering if >5 files.

## U5 — Factual footer/support surfaces

**Description:** Add approved support pages and footer trust links using existing factual helpers. U0b best-practice accessibility coverage is already active before this task.

**Acceptance criteria:**
- [ ] footer derives COD/shipping/order-tracking facts from canonical helpers;
- [ ] `/about`, `/size-guide`, `/shipping-returns`, `/faq` each require independent content approval;
- [ ] `/shipping-returns` additionally requires approved return/exchange policy; `/faq` requires approved answers;
- [ ] every shipped route has factual title/description but no public canonical while indexing is disabled;
- [ ] `/size-guide` route + PDP link land atomically;
- [ ] support route implementation does not add nested `<main>`/duplicate `main-content` under the active U0b gate;
- [ ] no duplicated shipping thresholds, fake contact data, or unapproved policy links.

**Verification:**
- [ ] link guards cover footer/support/PDP support links;
- [ ] factual helper assertions;
- [ ] metadata no-canonical assertion in disabled mode;
- [ ] best-practice Axe/keyboard checks on every newly shipped support route.

**Dependencies:** U1a + U1b + U1c; explicit content approval per route.

**Files likely touched:** footer, approved route, relevant content helper only if needed, PDP for atomic size-guide link, focused tests. One route/concern per focused slice.

**Estimated scope:** Medium per route slice.

## U6a — SEO, BreadcrumbList, support search exposure convergence

**Description:** After U2–U5, add collection BreadcrumbList and atomically prepare only approved support exact-base paths for eventual indexing.

**Acceptance criteria:**
- [ ] collection BreadcrumbList mirrors visible breadcrumb and server-owned origin;
- [ ] per approved support route, conditional self-canonical + exact indexable-path allowlist + sitemap path land atomically;
- [ ] unapproved/unimplemented support routes remain absent from all three;
- [ ] support **query-string states are never indexable/canonical**, even when the exact base path is eligible; no sitemap query variant exists;
- [ ] temporary production remains `SEARCH_INDEXING_ENABLED=false`, noindex/nofollow, no public canonical, empty sitemap under ADR 0004;
- [ ] `/new-arrivals` and `/search` remain outside V3 index/sitemap promotion unless separately approved;
- [ ] Product/Offer/Organization/WebSite schema remains unchanged absent a proven defect.

**Verification:**
- [ ] BreadcrumbList tests;
- [ ] search-exposure tests for exact base route and query variants in indexing-disabled and eligible indexing-enabled modes;
- [ ] disabled sitemap/canonical regression;
- [ ] eligible-enabled regression proves exact base is indexable+self-canonical+in sitemap while `?x=...` remains noindex/non-canonical and absent from sitemap;
- [ ] ADR 0004 release gate explicitly checked; V3 does not enable indexing.

**Dependencies:** U2 + U3 + U4 + U5.

**Files likely touched:** `src/seo/search-exposure.ts`, `src/app/sitemap.ts`, approved support metadata, structured-data helper/collection route, focused tests. Split per support route if needed; keep canonical+allowlist+sitemap atomic for each route.

**Estimated scope:** Medium slices.

## U6b — Final release-quality gate

**Description:** Converge accepted V3 slices and close with project Definition-of-Done evidence.

**Acceptance criteria:**
- [ ] all spec acceptance criteria satisfied;
- [ ] 0 Critical / 0 Required review findings;
- [ ] temporary production still obeys ADR 0004 unless separate approval occurred outside V3.

**Verification:**
- [ ] `pnpm lint`;
- [ ] `pnpm typecheck`;
- [ ] relevant focused/full tests;
- [ ] `pnpm build`;
- [ ] representative 390px + desktop browser checks;
- [ ] Axe including active best-practice landmark gate, keyboard, skip-link, no-horizontal-overflow;
- [ ] metadata/robots/sitemap/canonical HTTP regression;
- [ ] final review order: correctness → security → architecture → simplicity → performance.

**Dependencies:** U6a.

**Files likely touched:** verification/docs only unless a proven regression requires a focused fix.

**Estimated scope:** Small/Medium.

## Checkpoints

### V3-0 — accessibility foundation
- U0a landmark debt fixed;
- U0b best-practice landmark coverage active and green;
- no V3 feature/support route starts before this checkpoint.

### V3-A — after U1
- repo-wide locked-term inventory reconciled;
- all functional old labels either replaced or explicitly editorial-exempt;
- source + affected tests agree on locked labels;
- Search submits `q` to Shop discovery, not dead `/search?q=`;
- U2–U5 may start independently.

### V3-B — before U6a
- no inert category links;
- 0/partial/full homepage mapping behavior verified;
- collection navigation region and trust strip have U2 ownership;
- every collection URL source obeys collection-local canonical serialization and strips defaults;
- U4 uses projected collection membership;
- only approved support content is public and best-practice landmark gate remains green;
- no broken PDP → `/size-guide` link.

### V3-C — final
- U6a exact-base support exposure/query-state regression accepted;
- U6b full DoD verification accepted;
- 0 Critical / 0 Required;
- human approval before merge/ship.

## Human checkpoints
- Approve this V3 spec/plan before `/build`.
- Approve collection merchandising mappings/order before U2.
- Optional only: supply/approve editorial hero asset.
- Approve factual content of each support page independently.
- Supply/approve return/exchange, hotline, Zalo facts before publishing them.
- Approve structured size-table model separately if free-form size guides are replaced.
- Permanent domain and `SEARCH_INDEXING_ENABLED=true` remain separate ADR 0004/P19 approvals.

## Definition of Done overlay
Every behavior-changing slice must meet task AC **and** repository Definition of Done: RED/GREEN tests, runtime verification where relevant, existing regressions green, no unrelated refactor, security/search boundaries preserved, docs current, and human review before merge.
