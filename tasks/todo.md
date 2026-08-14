# LA Clothing — Productization Task Checklist

Status: **BUILD — storefront productization**

The existing `main` is the technical commerce foundation. Core catalog/cart/checkout/Pancake/order tracking/CI/VPS infrastructure is implemented, but the customer-facing product is **not launch-complete** until media, visual merchandising, SEO/GEO, live catalog acceptance and final operations gates below are complete.

## Carried-forward product rules
- [x] Own-brand menswear store
- [x] Guest COD checkout; account optional/deferred
- [x] Pancake is operational source of truth
- [x] Size required
- [x] Color optional per product; hide Color when absent
- [x] No blind retry for ambiguous Pancake writes
- [ ] Product media, storefront visual quality and search discoverability still require completion

## Current execution path

```text
P1 Trusted image contract
  -> P2 PLP images
  -> P3 PDP gallery

P4 Visual foundation
  -> P5 Homepage/lookbook
  -> P6 Shop/collections
  -> P7 PDP layout
  -> P8 Cart/checkout/tracking polish

P9 Technical SEO
  -> P10 PDP metadata/OG
  -> P11 Product structured data
  -> P12 crawl/indexation/internal links

P13 GEO/content/entity
  -> P14 live catalog/media/content acceptance
  -> P15 final visual/search/E2E gate
  -> P16 production promotion
```

## Media

- [ ] **P1 Trusted product-image contract**
  - [ ] review actual production image host/path patterns
  - [ ] normalize only valid reviewed HTTPS URLs
  - [ ] deterministic primary/gallery selection
  - [ ] RED/GREEN tests for malformed/duplicate/untrusted URLs
  - [ ] security review: no wildcard image host/proxy

- [ ] **P2 Real product images on PLP/cards**
  - [ ] configure narrow Next `images.remotePatterns`
  - [ ] update CSP `img-src` with the same reviewed origins
  - [ ] render real `next/image` product photography
  - [ ] meaningful alt text + stable aspect ratio
  - [ ] intentional fallback for missing/rejected media
  - [ ] mobile/desktop browser evidence

- [ ] **P3 PDP gallery**
  - [ ] primary + additional trusted images
  - [ ] keyboard/screen-reader accessible gallery controls
  - [ ] no selector UI for single-image products
  - [ ] missing-media PDP remains usable
  - [ ] browser/Axe/VoiceOver regression

### Checkpoint A
- [ ] P1–P3 correctness/security review has 0 Critical / 0 Required
- [ ] real production-shaped image host works without CSP/network errors

## Storefront visual productization

- [ ] **P4 Rebaseline visual system**
  - [ ] typography/spacing/grid/media ratios/tokens
  - [ ] header/footer/navigation/promotion shell
  - [ ] responsive + focus states
  - [ ] no commerce semantics changed

- [ ] **P5 Homepage + Lookbook redesign**
  - [ ] real approved imagery instead of silhouettes
  - [ ] real featured products and collection links
  - [ ] factual editorial claims only
  - [ ] media-empty fallback
  - [ ] mobile/desktop/Axe review

- [ ] **P6 Shop + Collections discovery**
  - [ ] every visible collection/category link resolves to implemented behavior
  - [ ] stable crawlable collection landing pages
  - [ ] direct links from collection pages to intended PDPs
  - [ ] preserve same-variant Color/Size/stock/price filtering
  - [ ] browser/filter/pagination regression

### Checkpoint B
- [ ] human visual review with real product media
- [ ] no placeholder silhouettes remain on approved launch surfaces unless explicitly intentional

- [ ] **P7 PDP merchandising redesign**
  - [ ] gallery + title/copy/price/availability hierarchy
  - [ ] Size mandatory
  - [ ] Color hidden when absent
  - [ ] size guide/care presentation
  - [ ] Add to Bag authority unchanged
  - [ ] mobile/desktop purchase regression

- [ ] **P8 Cart + Checkout + Tracking polish**
  - [ ] visual consistency with storefront
  - [ ] loading/empty/error/processing states
  - [ ] cart → checkout → success/tracking browser path
  - [ ] no new client authority over commerce/order facts

## Technical SEO

- [ ] **P9 Technical SEO foundation**
  - [ ] explicit server-owned canonical site origin
  - [ ] root `metadataBase`/canonical policy
  - [ ] `src/app/robots.ts`
  - [ ] `src/app/sitemap.ts`
  - [ ] noindex utility/private routes
  - [ ] release preflight validates canonical origin
  - [ ] OAI-SearchBot remains allowed for public discovery

- [ ] **P10 Dynamic PDP metadata + social cards**
  - [ ] `generateMetadata()` by product slug
  - [ ] `seoTitle` / `seoDescription` preferred when present
  - [ ] factual product-name/editorial fallback
  - [ ] canonical PDP URL
  - [ ] OG/Twitter product image or branded fallback
  - [ ] hidden/non-public catalog data never leaks

- [ ] **P11 Product structured data**
  - [ ] truthful `Product` + `Offer`
  - [ ] `ProductGroup`/variant markup only where Size/optional-Color facts are representable truthfully
  - [ ] structured price/availability comes from same server-authoritative storefront facts
  - [ ] XSS-safe JSON-LD serialization
  - [ ] no invented ratings/reviews/GTIN/discount/return/shipping promises

### Checkpoint C
- [ ] production-shaped HTML proves canonical + robots + sitemap + metadata + JSON-LD on real product data

- [ ] **P12 Faceted crawl control + internal linking**
  - [ ] arbitrary search/filter/sort URL combinations follow explicit noindex/canonical policy
  - [ ] stable collection pages have unique title/description/H1
  - [ ] pagination/internal links expose all intended launch products
  - [ ] sitemap/canonical/internal links agree on preferred URLs
  - [ ] URL matrix regression tests

## GEO / content / entity quality

- [ ] **P13 GEO/content/entity pass**
  - [ ] consistent LA Clothing brand/entity facts
  - [ ] approved contact/policy facts visible where applicable
  - [ ] meaningful product editorial description for launch products
  - [ ] size guide/care content populated where available
  - [ ] Breadcrumb/Organization structured data where truthful and useful
  - [ ] important facts exist in server-rendered text, not only images/client interaction
  - [ ] intended Google/Bing/OAI search crawlers can access public content
  - [ ] no AI-only hidden text or fabricated facts

## Live merchandise acceptance

- [ ] **P14 Production catalog/media/content gate**
  - [ ] deploy/use current Size-required/Color-optional mapping implementation in staging/production-like environment
  - [ ] run controlled full catalog sync/reconciliation
  - [ ] every launch product has trusted primary image
  - [ ] every sellable variant has Size mapping
  - [ ] product Color dimension is internally consistent when present
  - [ ] current price resolvable
  - [ ] availability valid
  - [ ] acceptable name/slug
  - [ ] SEO title/description factual
  - [ ] editorial description present for selected launch products
  - [ ] incomplete products are held back/unpublished, never filled with invented data

## Final QA and launch

- [ ] **P15 Final visual/search/E2E quality gate**
  - [ ] exact-head CI green
  - [ ] mobile + desktop human visual approval
  - [ ] homepage → collection/shop → PDP → cart → checkout → success/tracking E2E
  - [ ] Axe/VoiceOver/keyboard checks
  - [ ] no unexpected console/network errors
  - [ ] real-image performance measurements; LCP/CLS/INP reviewed
  - [ ] robots/sitemap/canonical/metadata/JSON-LD verified on exact release SHA
  - [ ] representative rich-result/schema validation

- [ ] **P16 Production promotion + operations closure**
  - [ ] exact approved SHA deployed through NPM → Caddy → app
  - [ ] public real-media smoke
  - [ ] public robots/sitemap/PDP metadata smoke
  - [ ] off-site backup configured
  - [ ] successful isolated restore drill recorded
  - [ ] SSH hardening complete
  - [ ] external uptime + backup freshness monitoring complete
  - [ ] previous known-good image/SHA retained for rollback
  - [ ] docs describe current production truth

## Deferred / not launch blockers unless reactivated
- [ ] Optional customer account + protected order history
- [ ] Pancake webhook receiver until auth/replay semantics are verified
- [ ] Native create-order retry/idempotency behavior until verified
- [ ] Product reviews/ratings system
- [ ] Promotion inference from unverified Pancake price-field differences
- [ ] `llms.txt` or AI-specific hidden content

## Definition of Done
A task is complete only when its acceptance criteria pass **and** the project standing DoD passes: correctness, runtime verification, regression tests, quality, integration, current-truth documentation, security, observability/rollback where relevant, and required human review.
