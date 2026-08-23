# Storefront refinement V3 — task checklist

Status: **DRAFT — planning/review only**

## Execution order
- [ ] U1 completes first and locks shared buyer terminology/copy boundaries
- [ ] U2, U3, U4, U5 may proceed independently after U1
- [ ] U6 starts only after U2–U5 are accepted and integrated

## U1 — Language + buyer-copy cleanup
- [ ] define Vietnamese-first buyer terminology
- [ ] update header utility labels consistently
- [ ] remove public catalog-mirror/server implementation explanations where buyer value is absent
- [ ] preserve factual COD/shipping/stock semantics
- [ ] focused RED/GREEN content/integration tests
- [ ] browser/a11y regression

## U2 — Homepage collection merchandising
- [ ] published collection rail(s)
- [ ] crawlable `/collections/{slug}` links
- [ ] retire hard-coded category query links as primary merchandising navigation
- [ ] website-owned editorial hero asset boundary
- [ ] trusted catalog media remains intentional fallback
- [ ] published-only eligibility test
- [ ] mobile/desktop/Axe/overflow regression

## U3 — Collection PLP filters
- [ ] Sort control reuses existing discovery sort allowlist
- [ ] Size control reuses existing discovery size contract
- [ ] collection slug retained through filter requests
- [ ] pagination retains allowed collection/query state correctly
- [ ] faceted/sorted states remain noindex/non-canonical
- [ ] base and pure pagination retain current canonical policy
- [ ] keyboard/Axe/browser coverage

## U4 — PDP related products
- [ ] deterministic shared-published-collection selection
- [ ] current product excluded
- [ ] only visible/active storefront products
- [ ] result bounded to max 4 unless spec changes
- [ ] no recommendation-engine persistence
- [ ] no fabricated “set” relationship
- [ ] PDP fallback when no related products
- [ ] Add-to-Bag/price/stock regressions remain green

## U5 — Trust/footer/support
- [ ] footer derives COD facts from canonical public brand-facts logic
- [ ] footer derives shipping promotion from existing shipping-policy helper
- [ ] order tracking link remains prominent
- [ ] `/about` only with approved factual content
- [ ] `/size-guide` only with approved factual content
- [ ] `/shipping-returns` only after approved policy exists
- [ ] `/faq` only after approved factual answers exist
- [ ] each shipped support page has unique factual title + description
- [ ] each shipped support page has explicit self-canonical from server-owned storefront origin
- [ ] support routes remain fail-closed under current index allowlist until U6
- [ ] hotline/Zalo only after approved contact data exists
- [ ] no duplicated shipping thresholds/constants
- [ ] link guard + metadata + accessibility regression

## U6 — SEO/a11y/final regression
- [ ] collection BreadcrumbList matches visible breadcrumb
- [ ] canonical origin remains server-owned
- [ ] every shipped/approved support route is explicitly added to the indexable-path allowlist
- [ ] every shipped/approved support route is explicitly added to the static canonical sitemap list
- [ ] unimplemented/unapproved support routes remain absent from index allowlist and sitemap
- [ ] support routes remain noindex when global indexing is disabled
- [ ] support routes expose only self-canonical base URLs; no new query/faceted indexable states
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
