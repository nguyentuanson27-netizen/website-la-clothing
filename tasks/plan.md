# LA Clothing productization plan — media, storefront, SEO/GEO, launch

## Objective
Turn the existing technically complete commerce foundation into a launch-quality menswear storefront that is visually credible, media-complete, crawlable, understandable by search/AI systems, and safe to operate in production.

The current `main` is treated as the **technical commerce foundation**, not a finished ecommerce product. Core cart/checkout/Pancake/order tracking/release infrastructure already exists, but the buyer-facing site is still incomplete: product images are not rendered, several editorial surfaces are placeholders, metadata is shallow, and the repository has no complete robots/sitemap/product structured-data/indexation strategy.

## Current product state

### Already established
- Next.js 16.2.11 + React 19.2.0 + PostgreSQL/Prisma commerce foundation.
- Pancake catalog mirror, stock, price, checkout, one-shot order creation, order-status reconciliation and guest order tracking.
- Size is required; Color is optional at the product level.
- Product editorial fields already exist for description, care, size guide, SEO title/description and collection slugs.
- `VariantMirror.pancakeImageUrls` already stores reviewed external image URL strings.
- CI, browser/a11y runtime tests, Docker/VPS release tooling and rollback runbooks exist.

### Product blockers
- PLP/PDP still render generated silhouettes instead of product photography.
- CSP currently allows only local/blob/data images; there is no reviewed remote-image allowlist in Next config.
- PDP has no per-product dynamic metadata or merchant product JSON-LD.
- No repository-level `robots.ts` or `sitemap.ts` exists.
- Search/filter URLs can create many crawlable parameter combinations without an explicit indexation policy.
- Homepage/lookbook/collections are visual/editorial shells rather than a complete merchandise experience.
- Product content and merchandising completeness have not been validated product-by-product against the live catalog.

## Product decisions carried forward
- Own-brand menswear store.
- Guest COD checkout is primary; account remains optional/deferred.
- Pancake remains operational source of truth for catalog/order facts.
- Size is mandatory; Color is optional. A size-only product must not render an empty Color control.
- Do not infer unverified product facts such as material, fit, promotion, chronology, or return policy from arbitrary Pancake fields.
- Do not expose exact stock counts to the browser.
- Do not blind-retry ambiguous Pancake writes.

## Search/GEO principles
- Use standard crawlable HTML, internal links, metadata and structured data as the foundation; do not make a special AI-only content path.
- Allow public search crawlers, including OAI-SearchBot, unless an explicit product decision later changes this.
- Structured data must match visible, server-authoritative content. Never invent reviews, ratings, discounts, GTINs, shipping/return promises or variant facts.
- Product/search metadata is generated from website-owned content plus verified commerce facts.
- Faceted/search utility URLs are not treated as landing pages by default. Stable editorial collection/category URLs are the intended indexable discovery pages.

## Image security principles
- External image URLs are untrusted input even though they originate from Pancake.
- Do not add a generic image proxy or wildcard remote image host.
- Review the actual production image host/path patterns first, then allow the smallest HTTPS `remotePatterns` and matching CSP `img-src` entries.
- Invalid, non-HTTPS, unreviewed-host, duplicate or malformed image URLs fail closed to the existing non-image fallback.
- Rendering a remote image must not introduce arbitrary server-side URL fetching outside Next.js' reviewed image boundary.

## Dependency graph

```text
P1 image contract/origin evidence
  -> P2 PLP product images
  -> P3 PDP gallery

P4 storefront visual foundation
  -> P5 homepage/lookbook
  -> P6 shop/collections discovery
  -> P7 PDP merchandising layout
  -> P8 cart/checkout/tracking polish

P1 + P3
  -> P9 technical SEO foundation
  -> P10 PDP metadata/social cards
  -> P11 Product/ProductGroup structured data

P6 + P9
  -> P12 crawl/indexation + internal-link architecture

P5 + P6 + P7 + P10 + P11 + P12
  -> P13 GEO/content/entity pass
  -> P14 live catalog/media/content acceptance
  -> P15 final visual/search/E2E quality gate
  -> P16 production promotion + operations gate
```

P4 may begin after P1 is specified, but final visual sign-off must use real product images from P2/P3 rather than silhouettes.

---

## Task P1 — Establish the trusted product-image contract

**Description:** Convert persisted Pancake image strings into a narrow storefront image contract. Review real production URL host/path patterns, normalize only valid HTTPS URLs, remove duplicates deterministically and expose product-level primary/gallery image facts without fetching the remote resource.

**Acceptance criteria:**
- [ ] only reviewed HTTPS origin/path patterns become renderable storefront images;
- [ ] malformed, duplicate, non-HTTPS and unreviewed URLs fail closed without breaking the product page;
- [ ] product primary/gallery selection is deterministic across repeated catalog reads.

**Verification:**
- [ ] RED/GREEN domain tests for URL validation/deduplication/selection;
- [ ] existing catalog/domain suites remain green;
- [ ] trusted production evidence records only host/path shape, not secrets or customer data.

**Dependencies:** None.

**Files likely touched:**
- `src/commerce/storefront-product-images.ts`
- `src/commerce/storefront-catalog.ts` or existing projection module
- `tests/domain/storefront-product-images.test.ts`
- `docs/integrations/pancake.md`

**Estimated scope:** Medium.

## Task P2 — Render real product photography on PLP/cards

**Description:** Replace product-card silhouettes with `next/image` using P1's safe primary image contract. Add the minimum reviewed `images.remotePatterns` and CSP `img-src` configuration. Keep a deliberate non-image fallback for products whose media is missing or rejected.

**Acceptance criteria:**
- [ ] cards with a trusted image render real photography with descriptive alt text and stable aspect ratio;
- [ ] missing/rejected media renders an intentional fallback without broken-image UI;
- [ ] Next image allowlist and CSP contain only reviewed origins/patterns, never broad wildcards.

**Verification:**
- [ ] component/domain regression proves image/fallback choice;
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build`;
- [ ] browser check at mobile + desktop: no CLS-inducing layout jump, no failed image/CSP requests, no horizontal overflow.

**Dependencies:** P1.

**Files likely touched:**
- `src/components/commerce/storefront-product-card.tsx`
- `next.config.mjs`
- relevant storefront projection/test file
- `tests/a11y-runtime/editorial.spec.ts` or dedicated storefront media spec

**Estimated scope:** Medium.

### Checkpoint A
Do not continue to the PDP gallery until P1/P2 are reviewed for correctness + security and browser evidence proves the configured production-shaped image origin works.

## Task P3 — Build a real PDP image gallery

**Description:** Replace the PDP silhouette with a product gallery driven by P1. Support primary image plus additional unique gallery images, keyboard-accessible selection, responsive presentation and safe fallback when only one/no image exists.

**Acceptance criteria:**
- [ ] PDP renders one or more trusted product images without exposing raw external URL internals as UI;
- [ ] gallery controls are keyboard/screen-reader usable and do not exist when there is nothing to select;
- [ ] product without trusted images remains usable and purchasable when all other commerce rules pass.

**Verification:**
- [ ] focused gallery behavior tests;
- [ ] browser mobile/desktop + keyboard + Axe/VoiceOver regression;
- [ ] image network failures do not break variant selection/Add to Bag.

**Dependencies:** P1, P2.

**Files likely touched:**
- `src/app/shop/[slug]/page.tsx`
- `src/components/commerce/product-gallery.tsx`
- `tests/a11y-runtime/storefront-commerce.spec.ts`
- one focused domain/component test file if needed

**Estimated scope:** Medium.

## Task P4 — Rebaseline the storefront visual system

**Description:** Define the launch visual language for LA Clothing using the already approved minimal menswear direction: typography scale, spacing, grid, surfaces, buttons, media ratios, focus states and responsive rules. Update shared header/footer/layout primitives without changing commerce behavior.

**Acceptance criteria:**
- [ ] shared visual tokens and primitives produce a coherent mobile/desktop shell;
- [ ] navigation, promotion bar, header/footer and focus treatment are consistent and accessible;
- [ ] no commerce/auth/API semantics change in this slice.

**Verification:**
- [ ] lint/typecheck/build;
- [ ] browser 390px and >=1280px shell review;
- [ ] keyboard focus order + selected Axe checks.

**Dependencies:** P1 specified; may run in parallel with P2/P3.

**Files likely touched:**
- `src/app/globals.css`
- `src/app/layout.tsx`
- `src/components/layout/site-header.tsx`
- `src/components/layout/site-footer.tsx`
- one browser regression file

**Estimated scope:** Medium.

## Task P5 — Redesign homepage and lookbook around real merchandise

**Description:** Replace abstract campaign silhouettes with real approved brand/product imagery and rebuild the homepage/lookbook hierarchy around collection story, featured products and crawlable links to real merchandise. Keep editorial claims factual and website-owned.

**Acceptance criteria:**
- [ ] hero/editorial sections use real approved imagery or a deliberate media-empty state, not fake garment silhouettes;
- [ ] featured products link through real anchor URLs to live PDPs/collections;
- [ ] no unsupported “new”, season, material or campaign claim is generated from Pancake data.

**Verification:**
- [ ] browser visual pass mobile/desktop;
- [ ] no broken links/images, overflow or Axe A/AA regression;
- [ ] homepage remains useful when featured catalog/media is temporarily unavailable.

**Dependencies:** P2, P4.

**Files likely touched:**
- `src/app/page.tsx`
- `src/app/lookbook/page.tsx`
- `src/app/globals.css`
- `tests/a11y-runtime/editorial.spec.ts`

**Estimated scope:** Medium.

## Task P6 — Turn Shop and Collections into merchandise discovery surfaces

**Description:** Polish PLP discovery and replace static collection shells with real collection landing/browse behavior backed by website-owned `collectionSlugs`. Fix or remove links whose query parameters do not map to an implemented discovery contract.

**Acceptance criteria:**
- [ ] every visible category/collection link resolves to a real browse state with products or an intentional empty state;
- [ ] collection pages are reachable through normal `<a href>` links and can lead crawlers/users to all intended product pages;
- [ ] filter controls remain server-authoritative and do not create contradictory variant combinations.

**Verification:**
- [ ] DB/domain tests for collection discovery and same-variant filters;
- [ ] browser navigation/filter/pagination regression;
- [ ] mobile/desktop visual + accessibility pass.

**Dependencies:** P2, P4.

**Files likely touched:**
- `src/app/shop/page.tsx`
- `src/app/collections/page.tsx` and/or `src/app/collections/[slug]/page.tsx`
- existing storefront discovery runtime/repository file
- one DB/domain test file
- one browser regression file

**Estimated scope:** Medium; split into collection route and PLP polish if more than five files are required.

### Checkpoint B
After P3–P6, run a human visual review using real production-shaped products/images. Do not approve a later SEO/GEO launch plan against placeholder visuals.

## Task P7 — Redesign PDP merchandising/content hierarchy

**Description:** Recompose the product page around gallery, product title, factual editorial description, price, availability, mandatory Size, optional Color, Add to Bag, size guide and care. Preserve server-side purchase authorization.

**Acceptance criteria:**
- [ ] Size is always required for purchase; Color is rendered only when the product has a color dimension;
- [ ] gallery, product copy, price/availability and purchase controls form a coherent mobile/desktop hierarchy;
- [ ] missing editorial fields degrade gracefully without invented text.

**Verification:**
- [ ] existing size-only and Color×Size regressions stay green;
- [ ] browser purchase flow with real media at 390px and desktop;
- [ ] keyboard/VoiceOver/Axe checks for gallery + purchase controls.

**Dependencies:** P3, P4.

**Files likely touched:**
- `src/app/shop/[slug]/page.tsx`
- `src/components/commerce/product-purchase-panel.tsx`
- `src/app/globals.css`
- `tests/a11y-runtime/storefront-commerce.spec.ts`

**Estimated scope:** Medium.

## Task P8 — Polish cart, checkout and tracking as one buyer journey

**Description:** Apply the launch visual system to cart, guest COD checkout, success and tracking while keeping the already-reviewed server trust boundaries unchanged.

**Acceptance criteria:**
- [ ] cart → checkout → success/tracking feels visually consistent with PLP/PDP;
- [ ] error/loading/empty/processing states remain explicit and safe;
- [ ] no new browser authority over price, stock, shipping, order state or Pancake identifiers.

**Verification:**
- [ ] existing DB/security/action tests remain green;
- [ ] browser full purchase-path regression mobile + desktop;
- [ ] no console/network >=400 regressions except deliberately tested error paths.

**Dependencies:** P4, P7.

**Files likely touched:**
- `src/app/cart/page.tsx`
- `src/app/checkout/page.tsx`
- checkout success/tracking presentation file
- `src/app/globals.css`
- `tests/a11y-runtime/storefront-commerce.spec.ts`

**Estimated scope:** Medium; split if visual changes exceed five files.

## Task P9 — Add technical SEO foundation

**Description:** Establish one server-owned canonical site origin and Next.js metadata-file conventions. Add `metadataBase`, canonical defaults, `robots.ts`, `sitemap.ts`, and route-level `noindex` for utility/private surfaces. Do not expose secrets or couple canonical URLs to request-supplied Host headers.

**Index policy:**
- Index: homepage, Shop root, stable collection landing pages, Lookbook/editorial pages intended for discovery, sellable/public PDPs.
- Noindex: account, admin, cart, checkout/success, track-order result flow, internal API routes, search result pages and arbitrary faceted/sort query combinations by default.

**Acceptance criteria:**
- [ ] canonical URLs are generated from an explicit configured production origin;
- [ ] `robots.txt` references the sitemap and does not block intended public PDP/collection crawling or OAI-SearchBot;
- [ ] sitemap contains only intended canonical public URLs and excludes utility/private/faceted URLs.

**Verification:**
- [ ] metadata/robots/sitemap focused tests or production-start HTTP smoke;
- [ ] build output and live HTML/head inspection;
- [ ] malformed/missing canonical-origin production configuration fails closed in release preflight.

**Dependencies:** P6; can begin earlier after public route policy is agreed.

**Files likely touched:**
- `src/app/layout.tsx`
- `src/app/robots.ts`
- `src/app/sitemap.ts`
- release/environment validation module + test
- relevant metadata test file

**Estimated scope:** Medium.

## Task P10 — Add dynamic PDP metadata and social sharing

**Description:** Use `generateMetadata()` on `/shop/[slug]` to produce product-specific title, description, canonical, Open Graph/Twitter metadata and trusted product image. Prefer website-owned `seoTitle`/`seoDescription`, then factual fallback to product name/editorial description.

**Acceptance criteria:**
- [ ] every public PDP has unique factual title/description/canonical based on the configured site origin;
- [ ] trusted primary product image is used for social metadata when available; otherwise a branded fallback is used;
- [ ] nonexistent/non-public product metadata does not leak hidden catalog data.

**Verification:**
- [ ] focused metadata tests for custom/fallback/missing product states;
- [ ] rendered HTML head inspection on representative PDPs;
- [ ] social image URLs resolve successfully in production-shaped runtime.

**Dependencies:** P3, P9.

**Files likely touched:**
- `src/app/shop/[slug]/page.tsx`
- shared SEO/product metadata helper
- optional `src/app/opengraph-image.tsx` or branded static OG asset
- one focused test file

**Estimated scope:** Medium.

## Task P11 — Add truthful ecommerce structured data

**Description:** Render sanitized JSON-LD for sellable PDPs using `Product`/`Offer`, and use `ProductGroup`/variants only where the visible Size/optional-Color model can be represented truthfully. Structured data consumes the same resolved price/availability/image facts as the page.

**Acceptance criteria:**
- [ ] JSON-LD never publishes a price/availability/variant that the page cannot support;
- [ ] dynamic strings are serialized with an XSS-safe JSON-LD boundary;
- [ ] no review/rating/GTIN/discount/return/shipping promise is invented when the source is absent or unverified.

**Verification:**
- [ ] domain tests compare structured-data facts with storefront facts;
- [ ] malformed/external text regression covers JSON-LD escaping;
- [ ] validate representative rendered markup with current Google Rich Results / schema validation during launch QA.

**Dependencies:** P3, P7, P10.

**Files likely touched:**
- shared product structured-data helper
- `src/app/shop/[slug]/page.tsx`
- one domain test file
- browser/HTTP metadata smoke if needed

**Estimated scope:** Medium.

### Checkpoint C
SEO foundation is not “done” until a production-shaped build proves canonical, robots, sitemap, PDP metadata and JSON-LD from the same real product data used by the UI.

## Task P12 — Control faceted crawling and strengthen internal linking

**Description:** Define which discovery URLs are indexable. Keep arbitrary query/filter/sort/search combinations out of the index while providing stable crawlable collection pages and pagination links that expose intended products.

**Acceptance criteria:**
- [ ] search/facet/sort utility combinations emit the agreed noindex/canonical policy rather than becoming thousands of index candidates;
- [ ] indexable collection pages have unique title/description/H1 and direct links to member PDPs;
- [ ] sitemap/canonical/internal links consistently point to the same preferred URLs.

**Verification:**
- [ ] URL-matrix tests cover root shop, pagination, collection landing, search and combined facets;
- [ ] rendered head/canonical checks for each matrix class;
- [ ] crawl-style link inspection proves intended PDPs are reachable without submitting a search form.

**Dependencies:** P6, P9.

**Files likely touched:**
- storefront discovery metadata helper
- `src/app/shop/page.tsx`
- collection route/page
- `src/app/sitemap.ts`
- one focused test file

**Estimated scope:** Medium.

## Task P13 — GEO/content/entity pass

**Description:** Make LA Clothing and its products easy for search and generative systems to understand using factual visible content, not AI-only text. Add consistent brand/entity facts, breadcrumb/organization markup where supported, and complete existing product editorial fields for launch products.

**Acceptance criteria:**
- [ ] brand name, site identity, contact/policy facts that are actually approved are consistently visible and machine-readable where appropriate;
- [ ] launch PDPs contain meaningful factual descriptions plus available size-guide/care information instead of generic placeholders;
- [ ] content is reachable in server-rendered HTML and internal links; no required fact exists only inside an image or client interaction.

**Verification:**
- [ ] content completeness report for launch products/collections;
- [ ] server-rendered HTML inspection without relying on client-only execution;
- [ ] robots/WAF check confirms intended Google/Bing/OAI search crawlers can access public content.

**Dependencies:** P5, P6, P7, P9–P12.

**Files likely touched:**
- website-owned editorial/admin content paths as needed
- shared Organization/Breadcrumb JSON-LD helper if approved
- relevant public content page(s)
- focused structured-data/content tests

**Estimated scope:** Medium per slice. Product-copy entry is operational content work and must be batched separately from code.

## Task P14 — Run live catalog/media/content acceptance

**Description:** On a production-like environment, sync the real Pancake catalog with the Size-required/Color-optional mapper, then produce an explicit launch readiness report per product rather than silently publishing incomplete inventory.

**Launch product checks:**
- trusted primary image exists;
- Size mapping exists for every sellable variant;
- Color mapping is either consistently present as a dimension or consistently absent for the product;
- current price is resolvable;
- stock/availability is valid;
- product name/slug is acceptable;
- PDP metadata has a factual title/description;
- editorial description is present for products selected for launch.

**Acceptance criteria:**
- [ ] no `MAPPING_REQUIRED` product is accidentally presented as purchasable;
- [ ] launch set has no missing required image/size/price/content gate;
- [ ] incomplete products are explicitly unpublished/held back rather than filled with invented data.

**Verification:**
- [ ] controlled catalog sync/reconciliation evidence;
- [ ] generated non-secret completeness report/counts;
- [ ] manual spot-check of representative size-only and Color×Size products.

**Dependencies:** P1–P13.

**Files likely touched:**
- preferably no production-code change; use existing admin/sync paths;
- optional bounded launch-audit script + test if manual reporting is too error-prone;
- operations documentation.

**Estimated scope:** Small/Medium depending on whether an audit command is needed.

## Task P15 — Final visual, accessibility, performance and search QA

**Description:** Run the release candidate through representative real-product buyer journeys and search-surface verification. Fix evidence-backed issues only; avoid unrelated redesign after the candidate is frozen.

**Acceptance criteria:**
- [ ] mobile and desktop homepage → collection/shop → PDP → cart → checkout → success/tracking flows are visually approved with real images/data;
- [ ] accessibility, console/network, image loading and security checks pass;
- [ ] SEO URL matrix, sitemap, robots, canonical, product metadata and structured data are correct on the exact release SHA.

**Verification:**
- [ ] repository CI + browser/VoiceOver/Axe on exact head;
- [ ] performance measurements with real images (LCP/CLS/INP or current project-approved CWV checks) and no obvious image payload regression;
- [ ] external Rich Results/Search inspection where applicable;
- [ ] manual visual approval is a required human gate.

**Dependencies:** P14.

**Files likely touched:** only evidence-driven fixes discovered by QA; each fix remains its own small PR/slice.

**Estimated scope:** Checkpoint, not a single implementation PR.

## Task P16 — Promote the approved productized release

**Description:** Only after P15 approval, promote the exact approved SHA through the existing VPS/NPM release path and close the remaining production operations gates.

**Acceptance criteria:**
- [ ] exact-SHA deploy succeeds through NPM → Caddy → app;
- [ ] off-site backup + restore drill, SSH hardening and external uptime/backup monitoring are complete;
- [ ] public smoke includes real media, crawl metadata and commerce flow without creating an unnecessary live order.

**Verification:**
- [ ] post-merge CI + VPS container verification on exact release SHA;
- [ ] host deploy/runbook evidence;
- [ ] public external HTTP/HTTPS, image, robots, sitemap and representative PDP checks;
- [ ] rollback image/SHA retained and documented.

**Dependencies:** P15 + human approval.

**Files likely touched:** operations docs only if the real host procedure reveals stale documentation.

**Estimated scope:** Operations checkpoint.

---

## Parallelization

Safe after P1 contract is agreed:
- P2/P3 media implementation and P4 visual foundation can proceed in parallel if they do not modify the same card/PDP files concurrently.
- P5 homepage/lookbook and P8 cart/checkout polish can proceed separately after P4.
- P9 technical SEO can proceed while P5–P8 visual work continues, but P10/P11 must wait for the final product media/data contract.

Must stay sequential:
- P1 → P2/P3 for remote image trust.
- P9 → P10 → P11 for canonical/metadata/structured data.
- P14 → P15 → P16 for launch acceptance.

Needs coordination:
- P6/P12 share collection/discovery URL contracts.
- P7/P10/P11 share PDP product facts.

## PR strategy
Prefer one focused PR per task (or smaller when a task crosses five files). Each PR follows:
1. focused RED where behavior changes;
2. minimal GREEN implementation;
3. relevant full CI/browser runtime;
4. self-review correctness → security → architecture → simplicity → performance;
5. human review before merge for externally visible/product/security-sensitive slices.

Do not stack large visual + SEO + catalog changes into one PR.

## Final Definition of Done
The website is not launch-complete merely because CI is green. P16 may be called complete only when:
- every task acceptance criterion above is satisfied;
- real product images and launch product content are present;
- current storefront UI has human visual approval on mobile + desktop;
- technical SEO/GEO surfaces are runtime-verified on the exact release SHA;
- security/accessibility/performance checks pass with real media;
- production backup/restore/monitoring/rollback gates are closed;
- docs describe current production truth.

## Explicitly deferred / not required for this launch plan
- optional customer account/order history unless product owner reactivates it;
- unverified Pancake webhook/idempotency semantics;
- fabricated review/rating system;
- speculative promotion logic from raw Pancake price fields;
- AI-only hidden content or a special `llms.txt` dependency for launch;
- broad wildcard remote-image proxying/hosts.
