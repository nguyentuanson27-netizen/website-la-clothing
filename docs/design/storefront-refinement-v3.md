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
- Product URLs use website-owned stable slugs; price/stock/Add-to-Bag authority remains server-side.
- Product media is already resolved through the trusted-media boundary.
- `ProductContent` currently owns `editorialDescription`, `careInstructions`, `sizeGuide`, SEO fields, and collection membership.

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
- Fail-closed indexing policy for staging/private/faceted/query states.
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
- navigation, utilities, filters, checkout, breadcrumb, policy/support microcopy: Vietnamese;
- brand names, collection names, campaign titles may remain English when editorially intentional;
- avoid accidental EN/VI mixing within one buyer flow.

Examples:
- `Search` → `Tìm kiếm`
- `Account` → `Tài khoản`
- `Bag` → `Túi hàng`

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
- Replace hard-coded category query links as primary navigation with `/collections/{slug}` when a matching published collection exists.
- Hero should prefer a website-owned editorial/campaign asset. Trusted catalog product media may remain an intentional fallback until such an asset exists.
- Keep existing real-product card/media fallback behavior.
- Do not invent seasonal claims or collection names.

## Collection specification
Collection pages become full buyer-facing PLPs using the existing discovery domain rather than a second filtering implementation.

### Required behavior
- Keep visible collection title/description and crawlable product grid.
- Add Sort and Size controls first; Color may follow using the same existing discovery contract.
- Preserve collection identity in every filter request.
- Faceted/sorted query states remain utility UX and noindex; base collection and reviewed pure pagination retain canonical/search authority.
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
- Initial implementation should be deterministic and simple: same published collection(s), exclude current product, visible/active products only, bounded result (for example max 4).
- Do not call a product relationship a “set” unless an explicit curated relationship exists.
- No recommendation engine or new persistence model is required for the first slice.

### Size guide
Current `sizeGuide` is free-form text. First refinement should improve presentation and link to a public `/size-guide` page. A structured per-product measurement table requires a separate data-model/spec decision and must not be inferred from prose.

## Trust/content surfaces
Add or prepare the following public support pages when approved factual content exists:
- `/about`
- `/size-guide`
- `/shipping-returns`
- `/faq`

Footer should expose verified buyer trust information, not technical implementation details:
- COD / guest-checkout facts already owned by current public brand-facts logic;
- current shipping-promotion facts derived from the existing shipping-policy helper;
- order tracking link;
- hotline/Zalo only when approved contact data exists;
- return/exchange statements only when an approved policy exists.

## Navigation
- Keep the current simple semantic navigation model unless real taxonomy size justifies a mega-menu.
- Native `<details>` mobile navigation is not itself a defect; preserve accessible simplicity unless a tested replacement is materially better.
- Cart count badge is a separate nice-to-have and should not block the merchandising/trust work.

## SEO / structured data
- Keep `/collections/{slug}` as the canonical taxonomy surface, not `/shop?category=...`.
- Preserve current noindex policy for mixed/filter/sort/search query states.
- Preserve stable PDP slug/canonical metadata and Product/Offer JSON-LD.
- Add collection BreadcrumbList JSON-LD when implementing collection refinement and ensure it matches visible breadcrumb content.
- Do not add ratings, GTIN, material, discount, shipping or return schema claims without verified source data.

## Accessibility and performance
- Reuse semantic HTML and existing controls before introducing custom widgets.
- All new filters/actions keyboard reachable with visible focus.
- Preserve no-horizontal-overflow gates at 390px and desktop representative widths.
- Product imagery remains responsive; LCP/editorial hero asset should be deliberately prioritized, below-fold images remain lazy where appropriate.
- No new dependency is expected.

## Acceptance criteria for the refinement program
- Homepage merchandising is collection-driven rather than generic/hard-coded category-query driven.
- Collection PLP supports at least Sort + Size while preserving SEO query-state policy.
- Collection pages no longer expose internal architecture language to buyers.
- PDP presents verified facts near purchase controls and has bounded deterministic related products.
- Vietnamese-first buyer microcopy is consistent across header/PLP/PDP/footer/support flows.
- Footer/support pages expose only approved factual trust information.
- Existing price/stock/order authority, media trust, stable URLs, metadata/indexing/schema and accessibility contracts do not regress.
- Every behavior-changing slice follows RED/GREEN focused tests plus relevant browser/runtime verification.

## Benchmark boundary
Maison Uniforme remains a visual/merchandising reference only. This repository must keep LA Clothing's own brand identity, copy, product assets, data model, accessibility standards, and search architecture.