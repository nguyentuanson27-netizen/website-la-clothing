# LA Clothing storefront refinement V3 — benchmark-informed merchandising, conversion, trust

Status: **DRAFT SPEC — planning/review only; no storefront implementation in this PR**

## Objective
Refine the existing LA Clothing storefront using the strongest merchandising patterns observed in Maison Uniforme while preserving LA Clothing's stronger technical, commerce, SEO, security, and accessibility foundations.

This is not a clone. Uniforme is a benchmark for product-first merchandising discipline only. Do not copy source code, brand assets, product photography, copywriting, proprietary typography, or exact visual treatments.

## Verified current-state facts on `main`
- Next.js 16 App Router + Prisma/PostgreSQL + Pancake catalog mirror.
- Public storefront surfaces already include homepage, Shop, PDP, Collections, Lookbook, cart/checkout/tracking, search, and account/admin routes.
- Product/Offer/Breadcrumb structured data exists on PDP; Organization/WebSite exists site-wide.
- Search exposure is fail-closed: arbitrary query/faceted states are not indexable; only reviewed base/pure-pagination catalog states can become canonical/indexable when indexing is enabled.
- The current static sitemap allowlist is `/`, `/shop`, `/collections`, and `/lookbook`; support routes are not yet included.
- ADR 0004 keeps `la.lanadesign.vn` as temporary production with `SEARCH_INDEXING_ENABLED=false`; until a permanent domain and separate human indexing approval exist, HTML remains noindex/nofollow, public canonicals are withheld, and the sitemap is empty.
- Product URLs use website-owned stable slugs; price/stock/Add-to-Bag authority remains server-side.
- Product media is already resolved through the trusted-media boundary.
- `ProductContent` currently owns `editorialDescription`, `careInstructions`, `sizeGuide`, SEO fields, and collection membership.
- The homepage currently contains four `/shop?category=...` links, but `parseStorefrontDiscoverySearchParams` does not parse a `category` parameter. Those links therefore do not filter Shop and their query-state requests are noindex under the current search policy.
- `buildStorefrontDiscoveryHref` is Shop-specific: it always returns `/shop` URLs and serializes collection as a query parameter. Collection PLP navigation must not call it directly unless the helper is deliberately generalized with regression coverage.
- Discovery `sort` values are allowlisted; `size` is bounded normalized text. The current Shop UI derives selectable size values from discovery facets rather than a static size enum.

## Important correction from gap audit
A published collection without `description` is not a valid public state today. The collection definition parser rejects `isPublished=true` when `description` is null, and the public collection route also fails closed when the description is missing. Therefore this is not currently treated as a production SEO bug; retain regression coverage rather than widening the model.

## Direction
Combine:
1. Uniforme-style product-first merchandising discipline;
2. LA Clothing's existing editorial/lookbook identity;
3. LA Clothing's current stable commerce/search/security architecture.

Target buyer flow:

```text
Campaign → curated collection → product → product facts → purchase → cross-sell/support
```

## Locked boundaries
### Preserve
- Pancake operational authority for identity/price/inventory/variants.
- Website-owned published editorial content and collections.
- Stable product slug lifecycle and historical redirects.
- Trusted product-media resolver and narrow image allowlist.
- Existing Product/Offer/Breadcrumb/Organization/WebSite structured-data truth boundaries.
- Fail-closed indexing policy for temporary production, staging/private/faceted/query states.
- ADR 0004's separate permanent-domain + human-approval gate before search indexing can be enabled.
- Server-side Add-to-Bag validation.
- Existing accessibility baseline: skip link, semantic navigation, focus-visible, runtime Axe/keyboard coverage.

### Do not introduce in this refinement
- No account-system rewrite.
- No checkout/order/Pancake write-contract rewrite.
- No wildcard image proxy.
- No AI auto-publish or fabricated material/fit/origin/return/review claims.
- No mega-menu unless taxonomy scale later proves it necessary.
- No generic `ItemList` JSON-LD in the critical path; collection BreadcrumbList is higher-value and lower-risk.
- No parsing free-form size-guide prose into invented measurements.

## Language policy
Use Vietnamese-first buyer UI:
- navigation, utilities, filters, cart/checkout, breadcrumb, policy/support microcopy: Vietnamese;
- brand names, collection names, campaign/editorial titles may remain English when editorially intentional;
- one buyer concept uses one Vietnamese term across the entire purchase flow;
- avoid accidental EN/VI mixing within one transactional flow.

Locked commerce terminology for this refinement:
- `Search` → `Tìm kiếm`
- `Account` → `Tài khoản`
- `Bag` / `Cart` / `Giỏ hàng` → `Túi hàng`
- cart and checkout empty/error/support wording must use the same `Túi hàng` terminology.

## Homepage specification
Current homepage already has campaign hero, editorial blocks, a product grid, Lookbook, brand facts, and category links. Refine hierarchy rather than rebuild it.

Target sequence:

```text
Promotion
Header
Editorial hero
Current/New edit collection rail
Editorial collection statement
Collection rail A
Lookbook
Collection rail B (only when enough published products exist)
Shop by collection
Trust/support strip
Footer
```

### Homepage rules
- Merchandising rails must be driven by website-owned **published collections** or an explicitly reviewed deterministic merchandising rule.
- The four inert `/shop?category=...` links must not remain after U2. Replace each with a valid published `/collections/{slug}` destination when a reviewed mapping exists; otherwise remove the link rather than preserving a dead query URL.
- U2 cannot pass merely by making collection links “primary” while leaving inert category-query links live elsewhere on the homepage.
- Hero should prefer a website-owned editorial/campaign asset. Trusted catalog product media may remain an intentional fallback until such an asset exists.
- Keep existing real-product card/media fallback behavior.
- Do not invent seasonal claims or collection names.

## Collection specification
Collection pages become full buyer-facing PLPs using the existing discovery domain rather than a second filtering implementation.

### Required behavior
- Keep visible collection title/description and crawlable product grid.
- Add Sort and Size controls first; Color may follow using the same discovery/facet model.
- Sort options reuse the existing allowlist. Size UI options come from current discovery facets; raw URL size input remains governed by the existing bounded normalization contract rather than a nonexistent static enum.
- The route slug is the only collection-identity authority. A user-supplied `?collection=` value must never change which collection's products are rendered under `/collections/{slug}`.
- Construct collection discovery input from explicitly selected supported keys; do not spread arbitrary raw search params into the discovery query.
- Collection filter/pagination URLs stay under `/collections/{slug}`. Do not call the current Shop-specific `buildStorefrontDiscoveryHref` directly unless it is generalized with tests that preserve both Shop and Collection behavior.
- Faceted/sorted query states remain utility UX and noindex; base collection and reviewed pure pagination retain canonical/search authority when global indexing is approved and enabled.
- Remove visible architecture copy such as “membership is managed by the website” or “catalog mirror validates price/stock”. Keep those truths in tests/docs, not buyer-facing merchandising.
- Empty state should be buyer-facing and factual.

## PDP specification
Keep current gallery, published editorial description, collection links, purchase panel, size guide/care, server validation, and Product/Offer schema.

Refine hierarchy toward:

```text
Collection / product identity
Product name
Price / availability
Short editorial description
Verified product facts (only fields that exist)
Size / Color
Add to Bag
Size guide / Care / Support links
Complete the look
```

### Related products / “Complete the look”
- Initial implementation is locked to a maximum of **4** products.
- Selection is deterministic and simple: same published collection(s), exclude current product, visible/active products only.
- Do not call a product relationship a “set” unless an explicit curated relationship exists.
- No recommendation engine or new persistence model is required for the first slice.

### Size guide
Current `sizeGuide` is free-form text. U4 may improve the presentation of trusted product-specific size-guide text but must not create a link to a route that does not exist.

The public `/size-guide` route and the PDP support link to it are owned by U5 and must land atomically: the link is added only in the same accepted slice that creates the approved factual `/size-guide` page. A structured per-product measurement table requires a separate data-model/spec decision and must not be inferred from prose.

## Trust/content surfaces
Prepare the following public support routes only when each route's own factual content has been explicitly approved:
- `/about`
- `/size-guide`
- `/shipping-returns`
- `/faq`

No route above is presumed approved merely because it is listed in this spec. `/shipping-returns` additionally requires an approved return/exchange policy; `/faq` requires approved answers; hotline/Zalo require approved contact data.

Footer should expose verified buyer trust information, not technical implementation details:
- COD / guest-checkout facts already owned by current public brand-facts logic;
- current shipping-promotion facts derived from the existing shipping-policy helper;
- order tracking link;
- hotline/Zalo only when approved contact data exists;
- return/exchange statements only when an approved policy exists.

### Support-page publication and search contract
Content approval and search-indexing approval are separate gates.

For each support route that actually ships with approved factual content:
- render a normal public HTML page reachable through crawlable internal links;
- provide a unique factual title and description;
- derive canonical origin only from the server-owned storefront origin;
- when `indexingEnabled=false`, withhold public canonical metadata and keep the route noindex/nofollow under the existing response/root policy;
- only after the route content is approved may its exact path be prepared in the indexable-path allowlist and static sitemap list;
- actual public indexation/canonical/sitemap advertising still requires the separate ADR 0004 permanent-domain + explicit human indexing approval and `SEARCH_INDEXING_ENABLED=true`;
- keep staging/local behavior governed by the existing fail-closed search-exposure boundary;
- do not create faceted/query variants for support pages.

A route that lacks approved content must not be added to the indexable allowlist or sitemap. It may remain unimplemented; do not publish placeholder SEO copy merely to occupy the URL. Creating a route component alone is never sufficient to make it indexable.

## Navigation
- Keep the current simple semantic navigation model unless real taxonomy size justifies a mega-menu.
- Native `<details>` mobile navigation is not itself a defect; preserve accessible simplicity unless a tested replacement is materially better.
- Cart count badge is a separate nice-to-have and should not block the merchandising/trust work.

## SEO / structured data
- Keep `/collections/{slug}` as the canonical taxonomy surface, not `/shop?category=...`.
- Preserve current noindex policy for mixed/filter/sort/search query states.
- Preserve stable PDP slug/canonical metadata and Product/Offer JSON-LD.
- Collection BreadcrumbList JSON-LD is owned by U6 after U3's visible collection behavior is accepted; it must mirror the visible breadcrumb content.
- Apply the support-page publication/search contract above; support routes are not implicitly indexable merely because a page component exists.
- Do not add ratings, GTIN, material, discount, shipping or return schema claims without verified source data.

## Accessibility and performance
- Reuse semantic HTML and existing controls before introducing custom widgets.
- All new filters/actions keyboard reachable with visible focus.
- Preserve no-horizontal-overflow gates at 390px and desktop representative widths.
- Product imagery remains responsive; LCP/editorial hero asset should be deliberately prioritized, below-fold images remain lazy where appropriate.
- No new dependency is expected.

## Acceptance criteria for the refinement program
- Homepage merchandising is collection-driven and no inert `/shop?category=...` links remain.
- Collection PLP supports at least Sort + Size while preserving route-slug authority and SEO query-state policy.
- Collection pages no longer expose internal architecture language to buyers.
- PDP presents verified facts near purchase controls and has deterministic related products capped at 4.
- PDP never links to `/size-guide` before that approved route exists.
- Vietnamese-first buyer microcopy is consistent across header/search/new-arrivals/Shop/Collection/PDP/cart/checkout/footer/support flows, with `Túi hàng` as the single cart term.
- Footer/support pages expose only approved factual trust information.
- Every shipped support route has an explicit metadata/indexability/sitemap decision; runtime canonical/indexing exposure remains blocked until ADR 0004's permanent-domain and human-approval gate is satisfied.
- Existing price/stock/order authority, media trust, stable URLs, metadata/indexing/schema and accessibility contracts do not regress.
- Every behavior-changing slice follows RED/GREEN focused tests plus relevant browser/runtime verification.

## Benchmark boundary
Maison Uniforme remains a visual/merchandising reference only. This repository must keep LA Clothing's own brand identity, copy, product assets, data model, accessibility standards, and search architecture.
