# Storefront refinement V3 — task checklist

Status: **DRAFT — planning/review only**

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
- [ ] `/about` factual page
- [ ] `/size-guide` factual page
- [ ] `/shipping-returns` only after approved policy exists
- [ ] `/faq` only after approved factual answers exist
- [ ] hotline/Zalo only after approved contact data exists
- [ ] no duplicated shipping thresholds/constants
- [ ] link guard + accessibility regression

## U6 — SEO/a11y/final regression
- [ ] collection BreadcrumbList matches visible breadcrumb
- [ ] canonical origin remains server-owned
- [ ] no ItemList JSON-LD required for launch
- [ ] Product/Offer schema unchanged unless fixing a proven defect
- [ ] arbitrary faceted/query states remain out of index
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
