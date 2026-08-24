# Storefront refinement V3 — task checklist

Status: **DRAFT — planning/review only**

## Execution order
- [ ] U1a + U1b + U1c complete before U2/U3/U4/U5
- [ ] U2, U3, U4, U5 may proceed independently after all U1 slices
- [ ] U5 owns `/size-guide` route + PDP link atomically
- [ ] U2 + U3 + U4 + U5 complete before U6a/U6b
- [ ] U6a owns collection BreadcrumbList + support-route canonical/allowlist/sitemap atomically
- [ ] U6b owns nested-main/duplicate-`main-content` accessibility debt
- [ ] U6c starts only after U6a + U6b are accepted
- [ ] no U6 slice may bypass ADR 0004 permanent-domain + explicit human indexing approval

## U1 — Language + buyer-copy cleanup
- [ ] implement U1a shell/search slice
- [ ] implement U1b merchandising-page copy slice
- [ ] implement U1c transactional copy/error-state slice
- [ ] lock exact labels: `Cửa hàng`, `Hàng mới`, `Bộ sưu tập`, `Lookbook`, `Tìm kiếm`, `Tài khoản`, `Túi hàng`
- [ ] desktop + mobile header match the locked labels
- [ ] footer/Search/New arrivals match the locked labels
- [ ] Cart + Checkout use `Túi hàng` consistently
- [ ] `checkout-submit-feedback.ts` CART_CHANGED/CART_UNAVAILABLE messages use `Túi hàng`
- [ ] guest checkout recovery link uses `Túi hàng`
- [ ] remove public catalog-mirror/server implementation explanations where buyer value is absent
- [ ] preserve factual COD/shipping/stock semantics
- [ ] RED/GREEN content tests include checkout error paths, not only happy path
- [ ] browser/a11y regression across shell → product → cart → checkout + search/new-arrivals/footer

## U2 — Homepage collection merchandising
- [ ] published collection rail(s)
- [ ] crawlable `/collections/{slug}` links
- [ ] remove **all** `/shop?category=...` homepage links
- [ ] replace an inert category link only when a reviewed published collection mapping exists; otherwise remove it
- [ ] if no truthful mapping remains, remove the empty category-strip heading/nav container
- [ ] homepage link guard explicitly rejects `/shop?category=`
- [ ] U2 owns/refines the existing homepage factual brand-facts block as the Trust/support strip
- [ ] trust facts remain derived from canonical public-brand/shipping helpers
- [ ] trust strip does not link to unapproved support routes
- [ ] current trusted catalog hero media remains valid fallback
- [ ] absence of approved editorial hero asset does **not** block U2
- [ ] do not widen remote image `remotePatterns` or CSP origins merely for editorial hero media
- [ ] if an editorial asset is supplied/approved, deliver it as a separate focused same-origin content slice
- [ ] published-only eligibility + empty-container + trust-fact tests
- [ ] media-boundary regression
- [ ] mobile/desktop/Axe/overflow regression

## U3 — Collection PLP filters
- [ ] Sort control reuses `STOREFRONT_DISCOVERY_SORTS`
- [ ] Size options come from existing discovery facets; do not invent a static size enum
- [ ] raw URL size remains bounded/normalized by the existing parser contract
- [ ] route slug is the only collection identity authority
- [ ] `/collections/a?collection=b` cannot render collection `b` products under route `a`
- [ ] construct discovery input from explicit supported keys; do not spread arbitrary raw search params
- [ ] use a collection-local href builder
- [ ] do **not** call or generalize Shop-specific `buildStorefrontDiscoveryHref` for collection navigation
- [ ] no generated collection href contains `collection=`
- [ ] base href is `/collections/{slug}`
- [ ] pure pagination href is exactly `/collections/{slug}?page=N`
- [ ] filtered/sorted hrefs stay under `/collections/{slug}` and preserve only supported state
- [ ] changing filters resets pagination appropriately
- [ ] tests assert emitted anchor href strings, not only response behavior after navigation
- [ ] faceted/sorted states remain noindex/non-canonical
- [ ] base and pure pagination retain current canonical policy only when global indexing is approved/enabled
- [ ] keyboard/Axe/browser coverage

## U4 — PDP related products
- [ ] seed membership only from the current product's projected `collections` array
- [ ] do not invent a `ProductContent.status` gate for collection membership
- [ ] do not independently read raw `collectionSlugs` in the PDP/UI path
- [ ] fetch candidates through existing storefront catalog/discovery boundary for projected published collection slugs
- [ ] current product excluded
- [ ] only visible/active storefront products
- [ ] candidates deduplicated + deterministically ordered
- [ ] result hard-capped at **4**
- [ ] regression covers non-PUBLISHED editorial content while retaining current projected collection semantics
- [ ] no recommendation-engine persistence
- [ ] no fabricated “set” relationship
- [ ] PDP fallback when no related products
- [ ] preserve trusted product-specific size-guide/care presentation
- [ ] U4 does not add `/size-guide` link before U5 owns route + link atomically
- [ ] Add-to-Bag/price/stock regressions remain green

## U5 — Trust/footer/support
- [ ] footer derives COD facts from canonical public brand-facts logic
- [ ] footer derives shipping promotion from existing shipping-policy helper
- [ ] order tracking link remains prominent
- [ ] `/about` only after explicit factual-content approval
- [ ] `/size-guide` only after explicit factual-content approval
- [ ] `/shipping-returns` only after explicit return/exchange-policy approval
- [ ] `/faq` only after explicit factual-answer approval
- [ ] no support route is presumed approved by this plan
- [ ] each shipped support page has unique factual title + description
- [ ] U5 does not add support-route self-canonical metadata before U6a search-exposure slice
- [ ] when indexing is disabled, support-page public canonical metadata is absent
- [ ] `/size-guide` route + PDP link land in the same accepted slice
- [ ] support routes remain fail-closed under current production indexation config
- [ ] hotline/Zalo only after approved contact data exists
- [ ] no duplicated shipping thresholds/constants
- [ ] link guard + metadata + accessibility regression

## U6a — SEO + structured-data convergence
- [ ] collection BreadcrumbList matches visible breadcrumb
- [ ] canonical origin remains server-owned
- [ ] for each approved/shipped support route, self-canonical metadata + indexable-path allowlist + sitemap path are introduced in the same focused slice
- [ ] no intermediate indexing-enabled state exposes canonical metadata while response policy still noindexes the same support route
- [ ] unimplemented/unapproved support routes remain absent from canonical metadata preparation, index allowlist and sitemap code
- [ ] current temporary production stays `SEARCH_INDEXING_ENABLED=false`
- [ ] current temporary production support pages remain noindex/nofollow
- [ ] current temporary production support pages withhold public canonicals
- [ ] current temporary production sitemap remains empty
- [ ] eligible permanent-origin/indexing-enabled test mode verifies approved support route indexability + self-canonical + sitemap inclusion atomically
- [ ] `/new-arrivals` remains outside V3 index/sitemap promotion unless separately reviewed/approved
- [ ] permanent domain + `SEARCH_INDEXING_ENABLED=true` remain separate human/P19 approval gates
- [ ] no ItemList JSON-LD required for launch
- [ ] Product/Offer schema unchanged unless fixing a proven defect

## U6b — Landmark/id accessibility hardening
- [ ] root layout remains sole owner of page-level `<main id="main-content">`
- [ ] audit public route wrappers for nested `<main>` elements
- [ ] replace every nested route-level `<main>` with a non-main semantic wrapper without visual/commerce behavior change
- [ ] `/track-order` no longer duplicates `id="main-content"`
- [ ] rendered public pages contain exactly one `main` landmark and exactly one `main-content` id
- [ ] skip link resolves to exactly one target
- [ ] add regression that fails on nested main/duplicate id
- [ ] if audit touches >5 files, split U6b into route-group sub-slices of ≤5 production/test files
- [ ] Axe + keyboard skip-link checks on representative routes
- [ ] no layout/CSS regression from wrapper changes

## U6c — Final regression gate
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] relevant focused/full tests
- [ ] `pnpm build`
- [ ] representative 390px + desktop browser checks
- [ ] Axe/keyboard/no-horizontal-overflow
- [ ] metadata/robots/sitemap/canonical HTTP regression
- [ ] final review: correctness → security → architecture → simplicity → performance
- [ ] 0 Critical / 0 Required findings
- [ ] current production still obeys ADR 0004 unless separately approved outside V3
- [ ] human approval before merge

## Explicit non-goals
- [ ] do not rewrite checkout/order/Pancake write semantics
- [ ] do not add mega-menu without evidence of taxonomy need
- [ ] do not add new dependency for this refinement by default
- [ ] do not invent product material/fit/origin/return/review data
- [ ] do not parse free-form size-guide text into measurements
- [ ] do not create a second collection-membership truth for related products
- [ ] do not weaken stable slug/media/search/security boundaries
- [ ] do not widen remote image/CSP allowlists merely to add editorial hero media
- [ ] do not enable public search indexing or claim permanent-domain approval as part of V3
