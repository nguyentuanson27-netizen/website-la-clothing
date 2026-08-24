# LA Clothing storefront refinement V3 — benchmark-informed merchandising, conversion, trust

Status: **DRAFT SPEC — planning/review only; no storefront implementation in this PR**

## Objective
Refine the existing LA Clothing storefront using the strongest product-first merchandising patterns observed in Maison Uniforme while preserving LA Clothing's commerce, search, security, accessibility, and data-authority boundaries.

This is a benchmark, not a clone. Do not copy source code, brand assets, product photography, copywriting, proprietary typography, or exact visual treatments.

## Verified current-state facts on `main`
- Stack: Next.js 16 App Router, React 19, Prisma/PostgreSQL, Pancake catalog mirror.
- Public routes include homepage, Shop, PDP, Collections, `/new-arrivals`, Lookbook, cart/checkout/tracking, `/search`, account, and admin.
- `/new-arrivals` is currently a lightweight placeholder and is outside the indexable-path allowlist.
- `/search` is currently an entry-form placeholder: it renders `name="q"` but does not read `searchParams`; Shop discovery already parses `q` and owns actual query-result behavior.
- Product/Offer/Breadcrumb structured data exists on PDP; Organization/WebSite exists site-wide.
- Search exposure is fail-closed. ADR 0004 keeps temporary production at `la.lanadesign.vn` with `SEARCH_INDEXING_ENABLED=false`; public canonicals are withheld and sitemap output is empty until permanent-domain plus explicit human indexing approval.
- The static sitemap list currently contains `/`, `/shop`, `/collections`, and `/lookbook`.
- Product URLs use website-owned stable slugs. Price, stock, variants, and Add-to-Bag authority remain server-side.
- Product media already resolves through the trusted-media boundary.
- `ProductContent` owns editorial description, care, size-guide prose, SEO fields, and collection slugs.
- Storefront projection resolves `collections` from `ProductContent.collectionSlugs` against published `CollectionDefinition` rows. Projected collection membership is not gated by `ProductContent.status`; editorial fields are.
- A published collection without `description` is not a valid public state: the collection definition contract rejects it and the public collection route fails closed.
- Homepage has four `/shop?category=...` links. `parseStorefrontDiscoverySearchParams` does not parse `category`, so those links do not filter Shop.
- `buildStorefrontDiscoveryHref` is Shop-specific: it always returns `/shop` and can serialize `collection` as a query parameter. Collection navigation must not reuse or generalize it in V3.
- Discovery `sort` is allowlisted; `size` is bounded normalized text; selectable size values come from discovery facets.
- Homepage hero currently reuses trusted product media. There is no required repository-owned editorial hero asset on `main`; V3 must not widen remote image/CSP origins merely for a visual preference.
- Root layout owns `<main id="main-content">`, while existing route pages can nest another `<main>` and `/track-order` repeats `id="main-content"`. That is known accessibility debt, not a baseline to preserve.
- Existing storefront Axe scans use WCAG tag sets; V3 must add a pre-feature best-practice landmark gate so duplicate/nested main landmarks cannot be reintroduced by later routes.

## Direction
Target buyer flow:

```text
Campaign → curated collection → product → verified facts → purchase → related products/support
```

Use Uniforme-style merchandising discipline while keeping LA Clothing's existing editorial identity and stronger technical foundations.

## Locked boundaries
### Preserve
- Pancake operational authority for product identity, price, inventory, and variants.
- Website-owned published editorial content and collections.
- Stable product slugs and historical redirect policy.
- Trusted media resolver and narrow image allowlist.
- Existing Product/Offer/Breadcrumb/Organization/WebSite truth boundaries.
- Fail-closed indexing policy and ADR 0004 approval gate.
- Server-side purchase validation.
- Skip-link intent, visible focus, keyboard coverage, and runtime accessibility testing.

### Do not introduce
- No account rewrite.
- No checkout/order/Pancake write-contract rewrite.
- No wildcard image proxy or broader remote media origin merely for editorial imagery.
- No AI auto-publish or fabricated material/fit/origin/return/review/contact claims.
- No mega-menu without evidence of taxonomy need.
- No generic `ItemList` JSON-LD on the critical path.
- No parsing free-form size-guide prose into invented measurements.
- No second collection-membership truth for related products.
- No search-indexing enablement or permanent-domain approval as part of V3.

## Vietnamese-first language contract
Buyer-functional navigation, utility, discovery, purchase, error, loading, policy, and support copy is Vietnamese-first. Brand names, product names, collection/campaign names, and deliberate editorial titles may remain English.

Locked buyer labels:
- `Shop` → `Cửa hàng`
- `New arrivals` → `Hàng mới`
- `Collections` → `Bộ sưu tập`
- `Lookbook` → `Lookbook` (explicit editorial-label exception)
- `Search` → `Tìm kiếm`
- `Account` → `Tài khoản`
- `Bag` / `Cart` / `Giỏ hàng` → `Túi hàng`
- `Add to Bag` → `Thêm vào túi`

Known functional homepage/listing strings such as `Shop the collection`, `View collections`, `Shop edit`, `View all`, `Explore collection`, `Shop by category`, transactional headings such as `YOUR BAG`, `SEARCH`, `NEW ARRIVALS`, and buyer error/loading strings are not editorial exemptions and must be localized in their owning slice.

Explicit homepage editorial exemptions include campaign/editorial titles and taxonomy-like eyebrow identifiers such as `QUIET FORM.`, `CITY UNIFORM`, `Collection / 01`, and `Editorial / 02`, unless design review intentionally changes them.

This contract is repository-wide for the affected buyer surfaces: source and test assertions must be inventoried together. A U1 slice cannot pass while a disallowed locked term remains in buyer-facing source or a stale test still asserts the replaced term.

## Accessibility foundation before feature work
Known landmark debt must be fixed before U1–U5 feature slices:
- root layout remains the sole page-level `<main id="main-content">` owner;
- route wrappers must not nest another `<main>` or duplicate `main-content`;
- skip link resolves to exactly one target;
- storefront runtime Axe coverage includes the relevant `best-practice` landmark rules before U5 can add support routes.

## Homepage specification
Target sequence:

```text
Promotion
Header
Editorial/fallback hero
Current/New edit collection rail
Editorial collection statement
Collection rail A
Lookbook
Collection rail B (only when enough published products exist)
Collection navigation region
Trust/support strip
Footer
```

### Homepage rules
- U2 owns collection-driven homepage merchandising, the collection navigation region, and the trust/support strip.
- Merchandising rails are driven by website-owned published collections or another explicitly reviewed deterministic rule.
- All four inert `/shop?category=...` links must disappear in U2.
- When a truthful published collection mapping exists, replace the old category link with `/collections/{slug}`. Do not invent taxonomy mappings.
- If zero truthful mappings exist, remove the category container/heading/navigation entirely.
- If one or more mappings exist, the region remains collection-based and the buyer heading is Vietnamese (`Mua theo bộ sưu tập`); do not leave `Shop by category` above collection links.
- The collection navigation region in the target sequence is not optional orphan copy: U2 either renders a valid published-collection region or removes it when no truthful mapping exists.
- The target trust/support strip is a refinement/repositioning of the existing factual homepage brand-facts block. Facts remain derived from canonical public-brand/shipping helpers and cannot link to unapproved support routes.
- A dedicated editorial hero asset is not a completion gate. Trusted catalog media remains a valid fallback. An approved same-origin editorial asset may ship later as a focused optional content slice.

## Search entry contract
V3 does not create a second search-results implementation.
- `/search` remains a noindex utility entry surface.
- Its search form hands `q` to existing Shop discovery (for example GET `/shop?q=...`) rather than emitting dead `/search?q=...` states.
- Shop remains the result/filter implementation and keeps existing discovery validation/indexing policy.
- V3 does not promote `/search` into sitemap/indexable-path scope.

## Collection PLP specification
Collection pages become full buyer-facing PLPs using existing discovery/facet contracts.

### Required behavior
- Keep visible collection title/description and crawlable product grid.
- Add Sort + Size controls first; Color may follow on the same model.
- Sort values reuse `STOREFRONT_DISCOVERY_SORTS`; Size options come from current discovery facets.
- Route slug is the sole collection identity authority. `/collections/a?collection=b` must never render collection `b` under route `a`.
- Construct discovery input from explicit supported query keys plus route-owned slug; never spread arbitrary raw params.
- U3 uses a **collection-local URL serializer**. It must not call or generalize `buildStorefrontDiscoveryHref`.
- Collection-generated URLs never serialize `collection=`.
- Default-valued utility state is removed before serialization: omit `sort=name-asc` and `page=1`.
- Base URL is exactly `/collections/{slug}`.
- Pure pagination is exactly `/collections/{slug}?page=N` and must remain compatible with the existing `canonicalSearch` contract.
- Filtered/sorted utility URLs may carry only active supported state and remain intentionally noindex/non-canonical.
- **Every navigable URL source** is covered: anchors, filter/sort controls, form actions/submissions if any, pagination, and redirects. Any state intended to be base/pure-pagination canonical must satisfy `canonicalSearch` regardless of source. U3 must not rely on raw browser GET-form serialization that can reintroduce route identity or default-valued params.
- Remove buyer-facing architecture copy such as catalog-mirror/server implementation explanations.

## PDP specification
Keep current gallery, published editorial content, collection links, purchase panel, care/size prose, server validation, and Product/Offer schema.

Buyer hierarchy:

```text
Collection / product identity
Product name
Price / availability
Short editorial description
Verified product facts
Size / Color
Thêm vào túi
Size guide / Care / Support
Hoàn thiện phối đồ
```

### Related products
- Hard cap: maximum **4**.
- Seed membership only from the current product's projected `collections` array.
- Do not independently reinterpret raw `collectionSlugs` or add a `ProductContent.status` membership gate.
- Fetch candidates through existing storefront catalog/discovery boundaries for projected published collection slugs.
- Exclude current product, require visible/active candidates, deduplicate, then apply deterministic ordering and cap.
- No recommendation engine, new persistence model, or fabricated “set” relationship.

### Size guide
Current `sizeGuide` is free-form trusted text. U4 may improve its presentation but must not invent measurements.

U5 owns the public `/size-guide` route and the PDP link atomically. The link is added only in the same accepted slice that creates an approved factual route.

## Trust/content surfaces
Candidate support routes:
- `/about`
- `/size-guide`
- `/shipping-returns`
- `/faq`

Each route requires its own factual-content approval. Listing a route here does not approve it. `/shipping-returns` additionally requires approved return/exchange policy; `/faq` requires approved answers; hotline/Zalo require approved contact data.

Footer/support facts must reuse canonical sources for COD/guest-checkout/shipping/order-tracking and must not duplicate thresholds or invent policy.

### Support publication/search contract
Content approval and indexing approval are separate.

For every shipped approved support route:
- normal public HTML and unique factual title/description;
- no public canonical while `indexingEnabled=false`;
- U6a introduces conditional self-canonical + exact indexable-path allowlist + sitemap path atomically for that route;
- actual public indexation still requires ADR 0004 permanent-domain + explicit human approval + `SEARCH_INDEXING_ENABLED=true`;
- the **exact base path only** may become indexable; any query-string state remains noindex/non-canonical and never receives a sitemap variant;
- unapproved/unimplemented routes remain absent from canonical preparation, allowlist, and sitemap.

## Navigation
- Keep the simple semantic navigation model unless taxonomy scale proves a mega-menu necessary.
- Native `<details>` mobile navigation is acceptable; apply the locked Vietnamese labels.
- Cart-count badge is optional and non-blocking.

## SEO / structured data
- `/collections/{slug}` remains canonical taxonomy; never use `/shop?category=...` as taxonomy.
- Preserve noindex for mixed/filter/sort/search utility query states.
- Preserve stable PDP canonical + Product/Offer JSON-LD.
- U6a owns collection BreadcrumbList after U3; it must mirror visible breadcrumb content.
- `/new-arrivals` and `/search` remain outside V3 index/sitemap promotion unless separately specified and approved.
- Support exact-base-path exposure follows the atomic contract above.
- Do not add ratings, GTIN, material, discount, shipping, or return schema claims without verified source data.

## Accessibility and performance
- Reuse semantic HTML/native controls before custom widgets.
- Known nested-main/duplicate-id debt is fixed in U0 before feature slices; later slices must keep the best-practice landmark gate green.
- All new filters/actions are keyboard reachable with visible focus.
- Preserve 390px and representative desktop no-horizontal-overflow gates.
- Product imagery remains responsive; below-fold media remains lazy where appropriate.
- No new dependency is expected.

## Program acceptance criteria
- Accessibility foundation is green before feature slices: one page-level `main`, one `main-content`, working skip target, best-practice landmark coverage active.
- Repository-wide buyer copy on affected surfaces follows the locked terminology contract; functional English is either translated or explicitly documented as an editorial exception.
- `/search` no longer emits dead `/search?q=` behavior; it hands query input to existing Shop discovery and remains noindex.
- Homepage is collection-driven, has no inert category links, has no misleading/empty category container, owns its collection navigation region, and keeps trust facts canonical-helper driven.
- Collection PLP supports Sort + Size; every emitted/navigation URL source follows the collection-local serializer contract, never contains `collection=`, strips default `sort`/`page`, and preserves base/pagination canonical behavior.
- PDP purchase CTA uses the locked Vietnamese term and related products use projected collection membership with max 4.
- PDP never links to `/size-guide` before the approved route exists.
- Footer/support pages expose only approved factual trust information.
- Support query-string states remain noindex/non-canonical even when the exact base route is eligible for future indexation.
- Existing price/stock/order authority, media trust, stable URLs, schema, search, keyboard/focus, and security boundaries do not regress.
- Every behavior-changing slice follows RED/GREEN focused tests plus relevant runtime/browser verification.

## Benchmark boundary
Maison Uniforme remains a visual/merchandising reference only. LA Clothing keeps its own brand identity, assets, copy, data model, accessibility standards, and search architecture.
