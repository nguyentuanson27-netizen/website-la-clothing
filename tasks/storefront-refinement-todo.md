# Storefront refinement V3 — task checklist

Status: **DRAFT — planning/review only**

## Execution order
- [ ] U1 completes first and locks shared buyer terminology/copy boundaries across the full buyer flow
- [ ] U2, U3, U4, U5 may proceed independently after U1
- [ ] U5 owns `/size-guide` route + PDP link atomically
- [ ] U6 starts only after U2–U5 are accepted and integrated
- [ ] U6 owns support-route canonical + allowlist + sitemap atomically
- [ ] U6 must not bypass ADR 0004 permanent-domain + explicit human indexing approval

## U1 — Language + buyer-copy cleanup
- [ ] define Vietnamese-first buyer terminology
- [ ] lock `Túi hàng` as the only cart term across Cart + Checkout
- [ ] update header utility labels consistently
- [ ] update footer labels/copy consistently
- [ ] include Search and New arrivals in the language pass
- [ ] include Cart and Checkout in the language pass
- [ ] remove public catalog-mirror/server implementation explanations where buyer value is absent
- [ ] preserve factual COD/shipping/stock semantics
- [ ] focused RED/GREEN content/integration tests
- [ ] browser/a11y regression across shell → product → cart → checkout + search/footer

## U2 — Homepage collection merchandising
- [ ] published collection rail(s)
- [ ] crawlable `/collections/{slug}` links
- [ ] remove **all** `/shop?category=...` homepage links
- [ ] replace an inert category link only when a reviewed published collection mapping exists; otherwise remove it
- [ ] homepage link guard explicitly rejects `/shop?category=`
- [ ] website-owned editorial hero asset boundary
- [ ] trusted catalog media remains intentional fallback
- [ ] published-only eligibility test
- [ ] mobile/desktop/Axe/overflow regression

## U3 — Collection PLP filters
- [ ] Sort control reuses `STOREFRONT_DISCOVERY_SORTS`
- [ ] Size options come from existing discovery facets; do not invent a static size enum
- [ ] raw URL size remains bounded/normalized by the existing parser contract
- [ ] route slug is the only collection identity authority
- [ ] `/collections/a?collection=b` cannot render collection `b` products under route `a`
- [ ] construct discovery input from explicit supported keys; do not spread arbitrary raw search params
- [ ] collection filter URLs remain under `/collections/{slug}`
- [ ] do not call Shop-specific `buildStorefrontDiscoveryHref` directly unless intentionally generalized with Shop + Collection regression tests
- [ ] pagination retains supported Size/Sort state and route slug correctly
- [ ] changing filters resets pagination appropriately
- [ ] faceted/sorted states remain noindex/non-canonical
- [ ] base and pure pagination retain current canonical policy only when global indexing is approved/enabled
- [ ] keyboard/Axe/browser coverage

## U4 — PDP related products
- [ ] deterministic shared-published-collection selection
- [ ] current product excluded
- [ ] only visible/active storefront products
- [ ] result hard-capped at **4**
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
- [ ] U5 does not add support-route self-canonical metadata before U6 search-exposure slice
- [ ] when indexing is disabled, support-page public canonical metadata is absent
- [ ] `/size-guide` route + PDP link land in the same accepted slice
- [ ] support routes remain fail-closed under current production indexation config
- [ ] hotline/Zalo only after approved contact data exists
- [ ] no duplicated shipping thresholds/constants
- [ ] link guard + metadata + accessibility regression

## U6 — SEO/a11y/final regression
- [ ] U6 is the sole owner of collection BreadcrumbList after U3 is accepted
- [ ] collection BreadcrumbList matches visible breadcrumb
- [ ] canonical origin remains server-owned
- [ ] for each approved/shipped support route, self-canonical metadata + indexable-path allowlist + sitemap path are introduced in the same focused slice
- [ ] no intermediate indexing-enabled state exposes canonical metadata while response policy still noindexes the same support route
- [ ] unimplemented/unapproved support routes remain absent from canonical metadata preparation, index allowlist and sitemap code
- [ ] current temporary production stays `SEARCH_INDEXING_ENABLED=false`
- [ ] current temporary production support pages remain noindex/nofollow
- [ ] current temporary production support pages withhold public canonicals
- [ ] current temporary production sitemap remains empty
- [ ] eligible permanent-origin/indexing-enabled test mode verifies approved support route indexability
- [ ] eligible-enabled test mode verifies approved support-route self-canonicals
- [ ] eligible-enabled sitemap test emits only approved shipped support routes
- [ ] permanent domain + `SEARCH_INDEXING_ENABLED=true` remain separate human/P19 approval gates
- [ ] support routes expose no query/faceted indexable states
- [ ] if support-route preparation exceeds ~5 files, split focused U6a implementation slice(s) before U6b final convergence gate
- [ ] no ItemList JSON-LD required for launch
- [ ] Product/Offer schema unchanged unless fixing a proven defect
- [ ] arbitrary faceted/query states remain out of index
- [ ] support-route indexing-enabled/fail-closed tests
- [ ] sitemap enabled/disabled regression
- [ ] canonical metadata/HTTP checks for shipped support pages
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] relevant tests
- [ ] `pnpm build`
- [ ] representative 390px + desktop browser checks
- [ ] Axe/keyboard/no-horizontal-overflow
- [ ] metadata/robots/sitemap/canonical HTTP regression
- [ ] final review: correctness → security → architecture → simplicity → performance
- [ ] 0 Critical / 0 Required findings
- [ ] human approval before merge

## Explicit non-goals
- [ ] do not rewrite checkout/order/Pancake write semantics
- [ ] do not add mega-menu without evidence of taxonomy need
- [ ] do not add new dependency for this refinement by default
- [ ] do not invent product material/fit/origin/return/review data
- [ ] do not parse free-form size-guide text into measurements
- [ ] do not weaken stable slug/media/search/security boundaries
- [ ] do not enable public search indexing or claim permanent-domain approval as part of V3
