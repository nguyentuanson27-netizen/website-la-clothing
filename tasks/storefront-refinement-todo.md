# Storefront refinement V3 — task checklist

Status: **DRAFT — planning/review only**

## Execution order
- [ ] U0a fix existing landmark/id debt
- [ ] U0b enable storefront Axe `best-practice` landmark coverage
- [ ] U1a/U1b/U1c may proceed after U0b
- [ ] U1a + U1b + U1c all complete before U2/U3/U4/U5
- [ ] U2/U3/U4/U5 may proceed independently after U1
- [ ] U2 + U3 + U4 + U5 complete before U6a
- [ ] U6b starts only after U6a
- [ ] no task bypasses ADR 0004 indexing approval

## U0a — Landmark/id debt
- [ ] root layout sole owner of `<main id="main-content">`
- [ ] audit all public route wrappers for nested `<main>`
- [ ] remove duplicate `main-content` ids including `/track-order`
- [ ] skip link resolves to exactly one target
- [ ] RED regression first, then route-group fixes
- [ ] split route groups to ≤5 production/test files per focused slice
- [ ] representative runtime layout checks

## U0b — Best-practice accessibility gate
- [ ] add relevant `best-practice` coverage to storefront Axe scans
- [ ] prove duplicate/nested main would fail the gate
- [ ] keep unrelated admin Playwright code out of scope unless deliberately adopting same rule
- [ ] U0b green before any U1–U5 feature/support slice

## U1 — Repo-wide locked terminology inventory
- [ ] inventory locked/old buyer terms across `src/` and tests before editing
- [ ] classify each hit: buyer-functional / editorial exception / test assertion
- [ ] source + directly affected tests update in same slice
- [ ] do not make tests import production label constants merely to avoid independent copy assertions
- [ ] final inventory has no unexplained buyer-functional old terms

### U1a — Shell/home/Search/New arrivals
- [ ] header desktop/mobile: `Cửa hàng`, `Hàng mới`, `Bộ sưu tập`, `Lookbook`, `Tìm kiếm`, `Tài khoản`, `Túi hàng`
- [ ] footer follows locked labels
- [ ] homepage functional strings localized (`Shop the collection`, `View collections`, `Shop edit`, `View all`, trust-nav labels)
- [ ] explicit editorial homepage exemptions remain documented
- [ ] `/search` H1/button/label Vietnamese-first
- [ ] `/search` GET form sends `q` to `/shop`, never dead `/search?q=`
- [ ] `/new-arrivals` H1/body buyer copy Vietnamese-first
- [ ] update affected source + Playwright/integration assertions together
- [ ] exact Search URL handoff test

### U1b — Shop/Collections/PDP + purchase CTA
- [ ] `/collections` H1/functional CTA/empty state Vietnamese-first
- [ ] Shop/Collection/PDP buyer-functional copy localized
- [ ] remove buyer-visible catalog/server architecture explanations where unnecessary
- [ ] `product-purchase-panel.tsx`: `Thêm vào túi`
- [ ] PDP copy contains no stale `Add to Bag`
- [ ] update affected tests in same slice
- [ ] repo-wide `Add to Bag` buyer-source/test inventory clean

### U1c — Cart/Checkout/error/loading
- [ ] Cart empty/populated H1 = `TÚI HÀNG`
- [ ] cart loading/error buyer copy has no stale `Bag`/`YOUR BAG`/`Giỏ hàng`
- [ ] Checkout uses `Túi hàng` consistently
- [ ] `CART_CHANGED` and `CART_UNAVAILABLE` feedback uses `Túi hàng`
- [ ] guest-checkout recovery link uses `Túi hàng`
- [ ] error-path tests, loading/error tests, and affected Playwright assertions update with source
- [ ] transactional locked-term inventory clean

## U2 — Homepage collection merchandising + trust
- [ ] remove all `/shop?category=...` homepage links
- [ ] only reviewed published `/collections/{slug}` replacements
- [ ] 0 mappings → remove category container/heading/nav
- [ ] 1–4 mappings → keep collection region with heading `Mua theo bộ sưu tập`
- [ ] never leave `Shop by category` above collection links
- [ ] U2 owns target collection-navigation region
- [ ] U2 owns/refines existing brand-facts block as trust/support strip
- [ ] trust facts stay canonical-helper driven
- [ ] no unapproved support links
- [ ] current trusted catalog hero media remains valid fallback
- [ ] 0/partial/full mapping tests + link guard + trust fact tests
- [ ] best-practice Axe/keyboard/overflow remains green

## U3 — Collection PLP URL contract
- [ ] Sort uses existing allowlist
- [ ] Size options from `facets.sizes`; raw size bounded/normalized
- [ ] route slug sole collection identity
- [ ] `/collections/a?collection=b` cannot switch products to b
- [ ] explicit supported query keys only
- [ ] collection-local URL serializer
- [ ] do not call or generalize `buildStorefrontDiscoveryHref`
- [ ] no generated URL source contains `collection=`
- [ ] strip default `sort=name-asc`
- [ ] strip `page=1`
- [ ] base exactly `/collections/{slug}`
- [ ] pure pagination exactly `/collections/{slug}?page=N` and canonical-intended outputs satisfy `canonicalSearch` from every source
- [ ] filtered/sorted utility states only active supported params and remain intentionally noindex/non-canonical
- [ ] all URL sources covered: anchors, controls, pagination, form submissions if any, redirects
- [ ] do not rely on raw GET-form serialization that leaks defaults/route identity
- [ ] tests assert emitted/submitted URLs, including default sort + page 2 → only `?page=2`
- [ ] metadata/HTTP tests for base/pagination/filter/sort/malicious/default/mixed states
- [ ] keyboard/Axe/browser coverage

## U4 — Related products
- [ ] seed from current product projected `collections` only
- [ ] no `ProductContent.status` membership gate
- [ ] no independent raw `collectionSlugs` interpretation in PDP/UI
- [ ] candidate fetch through existing storefront boundary
- [ ] visible/active only
- [ ] current product excluded
- [ ] deduplicate + deterministic order
- [ ] hard cap 4
- [ ] non-PUBLISHED editorial-content regression keeps current projection semantics
- [ ] no recommendation persistence/fabricated set
- [ ] no `/size-guide` link before U5 atomic route+link
- [ ] Add-to-Bag/price/stock authority unchanged

## U5 — Footer/support
- [ ] footer derives COD/shipping/order tracking from canonical helpers
- [ ] each support route independently content-approved
- [ ] `/shipping-returns` requires approved return/exchange policy
- [ ] `/faq` requires approved answers
- [ ] unique factual title/description per shipped route
- [ ] no canonical while indexing disabled
- [ ] `/size-guide` route + PDP link atomic
- [ ] no duplicated thresholds/fake contact/policy data
- [ ] active U0b best-practice gate passes on every new support route
- [ ] link guard + metadata + accessibility tests

## U6a — SEO/structured data/support exposure
- [ ] collection BreadcrumbList matches visible breadcrumb
- [ ] server-owned canonical origin
- [ ] approved support exact base: self-canonical + allowlist + sitemap atomic
- [ ] unapproved/unimplemented routes absent from all three
- [ ] support query-string states remain noindex/non-canonical even when base is eligible
- [ ] no sitemap query variants
- [ ] temporary production stays `SEARCH_INDEXING_ENABLED=false`
- [ ] temporary production noindex/nofollow, no public canonical, empty sitemap
- [ ] eligible-enabled test proves base indexable+self-canonical+sitemap
- [ ] eligible-enabled test proves `?query` state noindex/non-canonical/not in sitemap
- [ ] `/new-arrivals` and `/search` remain outside V3 index/sitemap promotion
- [ ] permanent-domain/indexing approval remains separate human gate
- [ ] Product/Offer/Organization/WebSite schema unchanged unless proven defect

## U6b — Final DoD gate
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] relevant focused/full tests
- [ ] `pnpm build`
- [ ] representative 390px + desktop browser checks
- [ ] Axe incl. best-practice landmark gate
- [ ] keyboard + unique skip-link target
- [ ] no-horizontal-overflow
- [ ] metadata/robots/sitemap/canonical HTTP regression
- [ ] final review: correctness → security → architecture → simplicity → performance
- [ ] 0 Critical / 0 Required
- [ ] current production still follows ADR 0004 unless separately approved
- [ ] human approval before merge

## Explicit non-goals
- [ ] no checkout/order/Pancake write rewrite
- [ ] no mega-menu without taxonomy evidence
- [ ] no new dependency by default
- [ ] no fabricated material/fit/origin/return/review/contact data
- [ ] no free-form size-guide → invented measurements
- [ ] no second related-product collection truth
- [ ] no broad remote image/CSP allowlist for editorial media
- [ ] no separate search-results implementation; `/search` hands off to Shop discovery
- [ ] no public search-indexing enablement/permanent-domain approval in V3
