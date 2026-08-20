# LA Clothing — Productization Task Checklist V2

Status: **FINAL PLAN — ready for /build**

`main` remains the technical commerce foundation. The customer-facing website is not launch-complete until real media, trusted content, readable URL architecture, visual merchandising, Deep SEO/GEO, live catalog acceptance and dedicated-domain launch gates are complete.

## Locked decisions
- [x] Own-brand menswear store
- [x] Guest COD checkout; account optional/deferred
- [x] Pancake remains operational source of truth for commerce/source facts
- [x] Size required
- [x] Color optional per product; hide Color when absent
- [x] `Product.note` = internal/private; never public/SEO/GEO
- [x] `Product.note_product` = approved source-description field
- [x] Website editorial/SEO copy is website-owned and must survive Pancake sync
- [x] Pancake API has no SEO slug field; slug is website-owned
- [x] Remote image origins require live allowlist evidence; no wildcard proxy/origin
- [x] Pancake categories are candidate source taxonomy only; SEO collections remain website-owned
- [x] `la.lanadesign.vn` is staging/temporary and should remain non-indexable
- [x] Public SEO launch will use a dedicated LA Clothing domain; exact domain can be chosen later
- [x] No AI auto-publish; missing facts stay missing
- [x] No blind retry for ambiguous Pancake order writes

## Execution path

```text
P0 Live evidence
  ↓
P1 Source contract
  ↓
P2 Source mirror
  ↓
P3 Trusted media contract
  ↓
P4 Real product media

P2 → P5 Editorial workflow
P2 → P6 SEO slug lifecycle
P0 → P7 Collection/taxonomy foundation

P4 → P8 Visual foundation
P4 + P8 → P9 Homepage/lookbook
P4 + P5 + P7 + P8 → P10 Shop/collection/PDP
P8 + P10 → P11 Cart/checkout/tracking

P6 + P7 → P12 Domain/search exposure + technical SEO
P4 + P5 + P6 + P12 → P13 PDP metadata/media SEO
P10 + P13 → P14 Structured data/breadcrumbs
P7 + P12 + P14 → P15 Crawl/indexation/internal links
P5 + P9 + P10 + P13-P15 → P16 GEO/entity/content

P16 → P17 Live acceptance → P18 Final QA → P19 Dedicated-domain ship
```

## P0 — Safe live Pancake audit
- [ ] add/use bounded read-only trusted-local audit
- [ ] measure `note_product` population coverage without emitting note contents
- [ ] collect unique current LA Clothing image origins/path shapes without full URLs
- [ ] inspect category tree/assignment coverage and classify usable/partial/empty/unusable
- [ ] prove no secret/raw catalog/customer/inventory leakage
- [ ] record only reviewed aggregate evidence

## P1 — Extend reviewed Pancake source contract
- [ ] map `product.note_product` → internal `sourceDescription`
- [ ] map documented product primary-image URI
- [ ] keep `product.note` intentionally unconsumed/private
- [ ] fail closed on malformed mapped values
- [ ] RED/GREEN parser fixtures/tests
- [ ] reviewed live contract verifier remains green

## P2 — Persist Pancake source content/media safely
- [x] add mirror persistence for source description and product primary-image URI
- [x] migration-from-empty passes
- [x] repeated sync converges idempotently
- [x] source changes do not overwrite `ProductContent`
- [x] stale/deactivated mirror semantics remain unchanged
- [x] DB/catalog sync regression passes

### Checkpoint A — source trust boundary
- [x] P0-P2 review: 0 Critical / 0 Required
- [x] private `note` cannot reach storefront/admin public output
- [x] website-owned content proven sync-safe

## P3 — Trusted product-image contract
- [x] validate HTTPS only
- [x] allow only exact reviewed origin/path patterns from P0
- [x] reject credential-bearing/malformed/unreviewed URLs
- [x] deterministic primary/gallery selection from product + variation media
- [x] deterministic dedupe/order
- [x] no arbitrary server-side image proxy/fetcher
- [x] RED/GREEN security/domain tests

## P4 — Real PLP/PDP media
- [x] narrow Next `images.remotePatterns`
- [x] matching CSP `img-src`
- [x] real product photography on cards
- [x] accessible responsive PDP gallery
- [x] meaningful alt text
- [x] intentional missing/rejected-media fallback
- [x] mobile/desktop network/CSP/browser evidence
- [x] Axe/keyboard/VoiceOver regression

## P5 — Website editorial workflow
- [x] show `sourceDescription` to admin as read-only source context
- [x] public copy remains website-owned
- [x] add explicit publish workflow/status if required by implementation
- [x] optional material/fit facts remain nullable/manual only
- [x] Pancake sync cannot auto-publish/overwrite editorial copy
- [x] admin auth/input/DB tests

## P6 — Stable readable product slug lifecycle
- [ ] replace existing `p-<digest>` public slugs before indexing
- [ ] deterministic Vietnamese-friendly slug normalization
- [ ] deterministic collision handling
- [ ] freeze published slug across Pancake name changes
- [ ] explicit slug change creates old-slug history
- [ ] old slug → 301 canonical slug
- [ ] unknown slug → 404
- [ ] migration + HTTP redirect tests

## P7 — Website-owned collections/taxonomy
- [ ] define stable collection slug/title/visible copy/SEO state
- [ ] deterministic product membership
- [ ] support manual taxonomy even if Pancake categories are unusable
- [ ] optional POS category mapping only by explicit reviewed ID
- [ ] no POS category can auto-publish an SEO landing page
- [ ] admin/repository/public-route tests

### Checkpoint B — information architecture
- [ ] approve representative product slugs
- [ ] approve collection/taxonomy naming
- [ ] approve editorial ownership rules
- [ ] no indexable architecture depends on unreviewed POS category names

## P8 — Visual foundation
- [x] typography/spacing/grid/media ratios/tokens
- [x] header/footer/navigation/promotion shell
- [x] responsive states
- [x] focus/error/loading/empty patterns
- [x] no commerce/auth semantics changed
- [x] mobile/desktop/a11y shell evidence

## P9 — Homepage + Lookbook
- [ ] remove fake silhouettes/placeholders where real media is available
- [ ] approved real imagery or deliberate fallback
- [ ] real featured products
- [ ] real collection/PDP crawlable links
- [ ] factual campaign/editorial copy only
- [ ] visual/a11y regression

## P10 — Shop + Collections + PDP productization
- [ ] polished product discovery
- [ ] collection landing routes work
- [ ] PDP hierarchy uses real media + published content
- [ ] Size mandatory
- [ ] Color hidden when product has no color dimension
- [ ] price/availability remain server-authoritative
- [ ] breadcrumbs/internal links
- [ ] mobile/desktop/a11y/purchase-flow evidence

## P11 — Cart + Checkout + Tracking polish
- [ ] consistent launch visual system
- [ ] explicit empty/error/loading/processing states
- [ ] no browser authority over price/stock/shipping/order/Pancake IDs
- [ ] full mobile/desktop buyer-flow regression
- [ ] existing security/DB/action tests remain green

### Checkpoint C — storefront product quality
- [ ] human review with representative real products/media
- [ ] approve homepage → collection → PDP → cart → checkout journey
- [ ] no placeholder-only visual sign-off

## P12 — Fail-closed domain/search exposure + technical SEO
- [ ] explicit canonical site origin
- [ ] explicit `SEARCH_INDEXING_ENABLED`-style gate or equivalent
- [ ] `la.lanadesign.vn` defaults non-indexable
- [ ] dedicated domain required before indexing=true
- [ ] `metadataBase`/canonical policy
- [ ] `robots.ts`
- [ ] `sitemap.ts`
- [ ] noindex utility/private/search/faceted surfaces
- [ ] sitemap contains canonical public URLs only
- [ ] release preflight fails closed on bad domain/index config
- [ ] HTTP disabled/enabled indexing smoke

## P13 — PDP metadata + media SEO
- [ ] dynamic SEO title
- [ ] dynamic meta description
- [ ] canonical URL
- [ ] Open Graph/Twitter metadata
- [ ] trusted product social image + branded fallback
- [ ] descriptive non-stuffed alt conventions
- [ ] semantic filenames only for website-owned assets/media
- [ ] do not rewrite remote Pancake filenames through unsafe proxy/storage
- [ ] metadata/head tests

## P14 — Structured data + breadcrumbs
- [ ] Product/Offer facts match visible server-authoritative data
- [ ] ProductGroup/variants only if current official docs support exact model
- [ ] BreadcrumbList
- [ ] Organization/WebSite factual entity data
- [ ] XSS-safe JSON-LD serialization
- [ ] no invented ratings/GTIN/discount/material/return/shipping promises
- [ ] schema/domain regression

## P15 — Crawl/indexation/internal-link architecture
- [ ] arbitrary filters/sort/search combinations stay out of index
- [ ] stable collection landing pages are crawlable
- [ ] intended products reachable through normal links
- [ ] pagination exposes intended catalog pages
- [ ] sitemap reacts to public/publish state
- [ ] inactive/private/utility URLs excluded
- [ ] canonical/noindex HTTP regression

### Checkpoint D — Deep SEO technical gate
- [ ] canonical/noindex verified
- [ ] sitemap verified
- [ ] PDP metadata verified
- [ ] breadcrumbs verified
- [ ] Product JSON-LD verified
- [ ] staging remains non-indexable

## P16 — GEO/entity/content quality
- [ ] visible factual brand/about identity
- [ ] visible approved COD/shipping facts
- [ ] product copy grounded in verified/manual facts
- [ ] collection context readable in HTML
- [ ] size/care only where known
- [ ] entity/heading/internal-link consistency
- [ ] no hidden AI-only content
- [ ] no fabricated material/fit/origin/policy facts
- [ ] intended final-domain crawler policy does not block public search crawlers/OAI-SearchBot unless later policy says otherwise

## P17 — Live catalog/media/content acceptance
- [ ] safe real catalog resync
- [ ] every intended sellable product has valid Size mapping
- [ ] optional Color behavior correct
- [ ] trusted media or explicitly accepted fallback
- [ ] readable stable slug
- [ ] collection assignment
- [ ] published editorial/SEO state
- [ ] no private `note` leak
- [ ] no malformed/unreviewed media leak
- [ ] acceptance report with non-sensitive counts/IDs

## P18 — Final visual/search/E2E gate
- [ ] full CI green
- [ ] production build/start smoke
- [ ] mobile + desktop buyer E2E
- [ ] Axe/keyboard/VoiceOver
- [ ] metadata/robots/sitemap/schema HTTP inspection
- [ ] representative home/PLP/PDP performance evidence
- [ ] 0 Critical / 0 Required review findings

## P19 — Dedicated-domain cutover + ship
- [ ] choose dedicated LA Clothing domain
- [ ] configure it as sole canonical public origin
- [ ] TLS/NPM/Caddy/app routing verified
- [ ] exact approved release SHA deployed
- [ ] indexing explicitly enabled only after all checks
- [ ] canonical/OG/schema/sitemap URLs use final domain
- [ ] `la.lanadesign.vn` remains non-canonical staging or approved redirect
- [ ] public commerce-route smoke
- [ ] backup/restore gate closed
- [ ] SSH hardening gate closed
- [ ] uptime/backup monitoring gate closed
- [ ] rollback target verified
- [ ] final human launch approval

## SEO naming rules
- [x] Source-code filenames (`page.tsx`, component names) are not renamed for SEO
- [ ] Product slug format: meaningful lowercase hyphenated Vietnamese-friendly slug
- [ ] Collection slug format: meaningful canonical category/collection slug
- [ ] H1/title/meta/alt use natural factual language, not keyword stuffing
- [ ] Website-owned media/OG filenames may use semantic names
- [ ] Remote Pancake filenames are not faked/rewritten solely for SEO

## Product-content precedence
```text
Pancake source facts
  → sourceDescription/media/commerce facts (read-only)
  → website editorial workspace
  → DRAFT / REVIEWED / PUBLISHED
  → visible PDP/collection copy + SEO metadata + schema + GEO
```

- [x] commerce facts remain server-authoritative
- [x] published website editorial copy wins for public content
- [x] `sourceDescription` is read-only input context, never public fallback or overwrite authority
- [x] private `note` is never a fallback
- [x] missing facts remain missing

## Standing verification / Definition of Done
For every behavior-changing slice:
- [ ] focused RED evidence
- [ ] minimal GREEN implementation
- [ ] relevant `pnpm test` / `pnpm test:db`
- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm build`
- [ ] runtime/browser evidence where relevant
- [ ] correctness → security → architecture → simplicity → performance review
- [ ] no unrelated refactor
- [ ] docs/current truth updated
- [ ] migration/config/rollback accounted for
- [ ] human review before merge

## Human checkpoints remaining
- [ ] visual approval after real media
- [ ] taxonomy/collection naming approval
- [ ] editorial publish approval
- [ ] final dedicated domain choice
- [ ] final launch approval

**Next `/build` entry point after P5 merge approval: P6 — stable readable product slug lifecycle. P12 may begin after P6 + P7 while staging remains non-indexable; indexing=true and final-domain canonicals stay blocked until the dedicated-domain gate is satisfied.**
