# LA Clothing productization plan V2 — product media, content, storefront, Deep SEO/GEO, launch

Status: **FINAL PLAN — awaiting /build execution**

## Objective
Turn the existing technically mature commerce foundation into a launch-quality LA Clothing storefront that uses real product media, trustworthy product content, stable human-readable URLs, strong merchandising, Deep SEO/GEO foundations, and a dedicated canonical brand domain.

`main` is the technical commerce foundation, not a finished ecommerce product. Core catalog/cart/checkout/Pancake/order tracking/CI/VPS infrastructure already exists. The remaining work is buyer-facing productization and search/entity readiness.

## Evidence locked before V2
The supplied Pancake POS OpenAPI is OpenAPI 3.1.0, `Pancake POS Open API` v1.0.0, production server `https://pos.pages.fm/api/v1`.

The following semantics are now treated as verified API contract facts:
- `Product.note` = **Internal note / Ghi chú nội bộ**. It must never be published or used for SEO/GEO.
- `Product.note_product` = **Product note / Ghi chú sản phẩm**. It is an approved source field for website product-description input.
- `Product.image` is a URI and `Variation.images[]` is an array of image URIs.
- the OpenAPI contains no `slug` field; `keyword`, `custom_id`, and `display_id` have different documented meanings and are not SEO slugs.
- `GET /shops/{SHOP_ID}/categories` exists, but current LA Clothing category-tree quality/coverage is not yet verified. Pancake categories are therefore only a candidate source taxonomy, never automatically the SEO taxonomy.

Repository facts carried forward:
- `VariantMirror.pancakeImageUrls` already stores variation image URL strings.
- `ProductContent` already owns `editorialDescription`, `careInstructions`, `sizeGuide`, `seoTitle`, `seoDescription`, and `collectionSlugs`.
- current mirror slugs are generated as opaque `p-<digest>` values and must be replaced by a website-owned SEO slug lifecycle before public indexing.
- current CSP allows only local/blob/data images, so remote product media is not yet renderable.

## Locked product/content/search decisions
1. **Pancake remains operational source of truth** for product identity, price, inventory, variants, source note, and source media.
2. **`note` is private forever.** Parser/tests must make accidental publication difficult.
3. **`note_product` becomes `sourceDescription`.** It is read-only website input and may change on Pancake sync.
4. **Website editorial content wins.** Pancake sync never overwrites `editorialDescription`, SEO fields, care, size guide, collection choices, or other website-owned copy.
5. **No AI auto-publish.** If AI drafting is added later, it consumes only verified facts, produces DRAFT content, and requires review before publish.
6. **Product images are untrusted external URLs.** No wildcard image proxy/origin. Live LA Clothing image origins must be audited before `next/image`/CSP allowlisting.
7. **Slug is website-owned and stable.** Product-name/Pancake changes do not silently change a published URL. Explicit slug changes create 301 history.
8. **SEO taxonomy is website-owned.** Pancake categories may seed/match collections only after live evidence and explicit mapping; an empty/poor POS taxonomy does not block launch.
9. **`la.lanadesign.vn` is temporary production with indexing disabled.** (ADR 0004) Under human approval, it serves real buyer traffic while keeping `SEARCH_INDEXING_ENABLED=false`. Public search indexing remains blocked until permanent domain configuration and explicit human launch approval.
10. **Utility/faceted URLs are not SEO landing pages by default.** Stable homepage, collection/editorial pages, and public PDPs are the canonical indexable surfaces.
11. **Deep SEO is factual, not keyword stuffing.** Titles, descriptions, headings, alt text, filenames for website-owned assets, schema, internal links, and copy must describe real content.
12. **GEO uses the same public factual HTML and structured data as users/search engines.** No hidden AI-only copy and no special AI text file is required for launch.

## Non-goals for this plan
- no redesign of existing Pancake order/write semantics;
- no account feature revival;
- no wildcard remote-image proxy;
- no automatic scraping/copying Pancake images into new storage solely to rename filenames;
- no automatic AI-generated material/fit/care claims;
- no automatic mapping of every POS category/filter into an indexable landing page.

## Dependency graph

```text
P0 live evidence
  -> P1 source contract
  -> P2 source mirror
  -> P3 trusted media contract
  -> P4 real PLP/PDP media

P2 -> P5 website editorial workflow
P2 -> P6 SEO slug lifecycle
P0 -> P7 collection/taxonomy foundation

P4 -> P8 visual foundation
P4 + P8 -> P9 homepage/lookbook
P4 + P5 + P7 + P8 -> P10 shop/collection/PDP merchandising
P8 + P10 -> P11 cart/checkout/tracking polish

P6 + P7 -> P12 search exposure/domain/technical SEO
P4 + P5 + P6 + P12 -> P13 PDP metadata + media SEO
P10 + P13 -> P14 structured data + breadcrumbs
P7 + P12 + P14 -> P15 crawl/indexation/internal links
P5 + P9 + P10 + P13 + P14 + P15 -> P16 GEO/entity/content quality

P16 -> P17 live catalog/content acceptance
P17 -> P18 final visual/search/E2E gate
P18 -> P19 dedicated-domain cutover + ship
```

P8 visual work can start after P3 is specified, but final sign-off must use real media. P12 can be built on temporary production / staging, but indexing remains fail-closed until permanent domain configuration and explicit approval.

## Parallel execution model — two workstreams

This execution model maximizes useful parallelism without changing any task dependency, acceptance criterion, security boundary, checkpoint, or Definition of Done in P0–P19. The dependency graph above remains authoritative whenever a lane description appears to conflict with a task dependency.

### Shared foundation and ownership rules
- P0 → P1 → P2 remains the shared source-foundation path. Full two-lane execution begins only after Checkpoint A is satisfied.
- P7 is the intentional exception: it depends only on P0 and may progress independently before P2, using website-owned taxonomy and only explicit reviewed Pancake category IDs.
- P2 has one owner at a time because it changes mirror persistence/schema behavior used by both lanes. Do not implement P2 concurrently in both lanes.
- Prefer one branch/PR per P-task or smaller vertical slice. Parallel work must not share an unreviewed mutable branch.
- Before a convergence task starts, its owner must integrate the accepted dependency heads and rerun the task's required verification on the combined head.
- Two agents must not concurrently edit the same persistence model, migration, public route resolution, or shared commerce component unless the plan explicitly splits ownership by file/subsystem.

### Workstream A — Product Media & Storefront

Primary responsibility: trusted product media, buyer-facing visual system, merchandising, and purchase-journey presentation.

```text
P3 trusted media contract
  -> P4 real product media
  -> P8 visual foundation
  -> P9 homepage/lookbook
  -> P10 shop/collection/PDP convergence
  -> P11 cart/checkout/tracking polish
```

Lane A rules:
- P3 owns render trust and media selection only; it must not absorb P5 editorial ownership or P6 slug policy.
- P4 and P8 may overlap after the P3 contract is stable enough to keep media trust behavior deterministic, but final P8/P9 sign-off uses real trusted media.
- P10 is a convergence task, not a private Lane A task: it may be owned by Lane A, but it cannot complete until P4 + P5 + P7 + P8 are accepted.
- P11 may continue while the SEO lane advances P13+, because it changes buyer-journey presentation rather than canonical/search authority.

### Workstream B — Content, Information Architecture & SEO

Primary responsibility: website-owned content, collections, stable URLs, canonical/search policy, metadata, schema, crawl architecture, and GEO/entity quality.

```text
P7 collection/taxonomy foundation  (may start after P0)

After P2 / Checkpoint A:
P5 editorial workflow
P6 stable slug lifecycle
  -> P12 technical SEO foundation

P4 + P5 + P6 + P12
  -> P13 PDP metadata/media SEO

P10 + P13
  -> P14 structured data/breadcrumbs
  -> P15 crawl/indexation/internal links
  -> P16 GEO/entity/content quality
```

Lane B rules:
- P5 and P6 are independent after P2 and may be implemented in parallel if they have separate owners/branches; with only one Lane B owner, prioritize P6 early because P6 → P12 is a long critical path while ensuring P5 completes before P10/P13 convergence.
- P7 should be advanced as early as practical because it gates both P10 and P12, but taxonomy naming still requires the existing human checkpoint before indexable architecture is approved.
- P12 may be fully implemented on staging with indexing fail-closed. It must not enable public indexing until the dedicated canonical domain gate is satisfied.
- P14–P16 are progressively more convergent and should not start before their declared dependencies are accepted.

### Synchronization gates

| Gate | Required state | Unlocks |
|---|---|---|
| **G0 — Foundation** | P1 accepted/merged, P2 complete, Checkpoint A = 0 Critical / 0 Required | full Lane A + Lane B execution |
| **G1 — Product trust/IA** | P3 + P5 + P6 + P7 accepted | safe deep productization and search-foundation convergence |
| **G2 — Storefront convergence** | P4 + P5 + P7 + P8 accepted | P10 completion, then P11 |
| **G3 — Search/schema convergence** | P10 + P13 accepted | P14 → P15 → P16 |
| **G4 — Release sequence** | P16 accepted | P17 → P18 → P19, predominantly sequential |

### Recommended two-agent ownership

When exactly two coding/review agents are available:

- **Agent A — Media/Storefront:** after P1 merge, own P2 as the single foundation owner, then P3 → P4 → P8 → P9; own P10 convergence unless a later plan explicitly reassigns it; then P11.
- **Agent B — Content/SEO:** progress P7 as soon as P0 evidence permits; after P2, own P5 → P6 → P12 → P13; after P10 convergence, own P14 → P15 → P16.
- While Agent A owns P2, Agent B may work only on P7 or other work whose declared dependencies are already satisfied; Agent B must not fork a competing P2 persistence implementation.
- P17 → P19 are release/acceptance gates and should be treated as shared predominantly sequential work rather than independent feature lanes.

---

## Task P0 — Run a safe live Pancake content/media/taxonomy audit
**Description:** Add/use a read-only trusted-local probe that reports only safe aggregate evidence needed by V2: `note_product` population coverage, unique image origins/path shapes, and category-tree/category-assignment coverage. Never emit API keys, full image URLs, product notes, customer data, exact inventory, or raw catalog payloads.

**Acceptance criteria:**
- [ ] know whether `note_product` is materially populated in the LA Clothing catalog;
- [ ] know the exact image origins/path patterns needed for current catalog media;
- [ ] know whether the current Pancake category tree is usable, partial, empty, or unsuitable for SEO mapping.

**Verification:**
- [ ] focused tests prove sanitized output and bounded traversal;
- [ ] trusted-local live run is read-only and emits no secret/raw content;
- [ ] evidence is recorded only as reviewed aggregate shape/coverage.

**Dependencies:** None.

**Files likely touched:** `scripts/`, one Pancake inspection helper, one focused test, `docs/integrations/pancake.md`.

**Estimated scope:** Medium.

## Task P1 — Extend the reviewed Pancake catalog source contract
**Description:** Extend the internal catalog adapter only with documented source fields needed by productization: `product.note_product` and `product.image`. Keep `product.note` explicitly ignored/private. Do not infer taxonomy object semantics from opaque `product.categories` until P0/live evidence supports them.

**Acceptance criteria:**
- [ ] parser returns `sourceDescription` from `note_product` and product primary-image source URI;
- [ ] malformed mapped values fail closed;
- [ ] no internal/public contract exposes `note`.

**Verification:**
- [ ] RED/GREEN parser fixtures/tests;
- [ ] reviewed-key/live contract verifier still passes;
- [ ] security review confirms private note cannot reach storefront projection.

**Dependencies:** P0 evidence shape known.

**Files likely touched:** Pancake catalog contract, reviewed fixture, parser tests, integration doc.

**Estimated scope:** Medium.

## Task P2 — Persist source description and product-level media without overwriting editorial content
**Description:** Extend the mirror so Pancake-owned source content/media sync independently from website-owned `ProductContent`. Repeated sync updates source fields but preserves all editorial/SEO fields.

**Acceptance criteria:**
- [ ] `sourceDescription` and source primary-image URI converge idempotently with Pancake sync;
- [ ] website-owned content survives repeated sync and source-note changes unchanged;
- [ ] stale/deactivated products preserve deliberate existing mirror behavior.

**Verification:**
- [ ] migration-from-empty + PostgreSQL integration tests;
- [ ] regression: Pancake source change cannot overwrite `ProductContent`;
- [ ] existing catalog sync tests remain green.

**Dependencies:** P1.

**Files likely touched:** Prisma schema/migration, catalog mirror repository, one DB test file, generated client as required.

**Estimated scope:** Medium.

### Checkpoint A — source trust boundary
Do not begin editorial automation or media rendering until P0–P2 have 0 Critical / 0 Required findings. `note` must remain private and website-owned content must be proven sync-safe.

## Task P3 — Establish the trusted product-image contract
**Description:** Build a pure storefront media resolver over product-level and variation-level image URIs. Validate HTTPS, exact reviewed origins/path patterns from P0, bounded URL length, deterministic dedupe/order, and primary/gallery selection. No arbitrary server-side fetcher.

**Acceptance criteria:**
- [ ] only reviewed HTTPS media patterns become renderable;
- [ ] malformed, duplicate, non-HTTPS, credential-bearing, or unreviewed URLs fail closed;
- [ ] primary/gallery selection is deterministic and uses product image plus variation images without duplication.

**Verification:**
- [ ] RED/GREEN domain tests for trust/dedupe/order/error cases;
- [ ] security review covers SSRF/open-proxy risks;
- [ ] production-shaped origins from P0 are represented narrowly, not by wildcard.

**Dependencies:** P2, P0 image-origin evidence.

**Files likely touched:** new storefront media helper, storefront projection, domain test, integration/security doc.

**Estimated scope:** Medium.

## Task P4 — Render real product media on cards and PDP gallery
**Description:** Replace silhouettes on product cards and PDP with `next/image` driven by P3. Configure minimal `images.remotePatterns` and matching CSP `img-src`. Add accessible responsive gallery and intentional fallback.

**Acceptance criteria:**
- [ ] PLP/home cards render trusted primary photography with meaningful alt text;
- [ ] PDP renders accessible primary/additional images, with no redundant gallery controls for one image;
- [ ] missing/rejected media leaves product browsing/purchase usable and never shows a broken-image surface.

**Verification:**
- [ ] focused render/fallback tests;
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build`;
- [ ] mobile/desktop browser + network/CSP + Axe/keyboard/VoiceOver evidence.

**Dependencies:** P3.

**Files likely touched:** product card, product gallery/PDP, `next.config.mjs`, one browser spec, one focused test.

**Estimated scope:** Medium; split card and gallery into separate PRs if >5 files.

## Task P5 — Formalize website-owned product editorial workflow
**Description:** Keep `sourceDescription` read-only and show it to admin as source context. Strengthen website-owned content with explicit publication state and concise product-copy fields needed by storefront/SEO. Optional facts such as material/fit remain nullable and manual unless a verified source is added later.

**Acceptance criteria:**
- [ ] admin can see source description but edits only website-owned fields;
- [ ] public storefront consumes only published/approved editorial content, with factual fallbacks;
- [ ] source sync never auto-publishes or replaces editorial/SEO copy.

**Verification:**
- [ ] admin authorization/input tests;
- [ ] DB tests for DRAFT/REVIEWED/PUBLISHED behavior if status is added;
- [ ] browser/admin regression and no source/private note leakage.

**Dependencies:** P2.

**Files likely touched:** ProductContent schema/migration if needed, admin service/repository, admin page/form, tests.

**Estimated scope:** Medium; split schema/service and UI if needed.

## Task P6 — Replace opaque product URLs with a stable website-owned SEO slug lifecycle
**Description:** Keep Pancake product ID as stable identity while making `ProductMirror.slug` human-readable. Generate an initial slug from product name only as a website-owned bootstrap, freeze it after publication, support explicit admin change, and retain old slugs for permanent redirects. Never derive URL identity from `keyword`, `custom_id`, or `display_id`.

**Acceptance criteria:**
- [ ] current `p-<digest>` products receive deterministic readable unique slugs before indexing;
- [ ] future Pancake name changes do not silently change public URLs;
- [ ] explicit slug changes preserve previous slug → canonical slug 301 behavior.

**Verification:**
- [ ] slug normalization/collision/Unicode tests;
- [ ] migration/redirect-history DB tests;
- [ ] HTTP regression for old-slug 301, current-slug 200, unknown 404.

**Dependencies:** P2.

**Files likely touched:** Prisma schema/migration, slug service/repository, PDP route resolution, focused tests.

**Estimated scope:** Medium; split persistence and HTTP redirects if >5 files.

## Task P7 — Establish website-owned collection/taxonomy foundations
**Description:** Create stable collection landing definitions with website-owned slug/title/description/SEO state and product membership. P0 determines whether Pancake categories can be mapped as optional source hints; no automatic `POS category = SEO collection` rule.

**Acceptance criteria:**
- [ ] owner can maintain canonical collections even when Pancake categories are empty/poor;
- [ ] every published collection has stable slug, visible heading/copy, and deterministic product membership;
- [ ] optional Pancake category mapping is explicit by ID and cannot auto-publish a collection.

**Verification:**
- [ ] repository/admin tests for collection definitions/membership;
- [ ] duplicate/invalid slug and stale mapping fail safely;
- [ ] browser route shows products or intentional empty state.

**Dependencies:** P0; can proceed manually if category evidence is unusable.

**Files likely touched:** collection model/config/repository, admin surface, collection route, one DB/domain test.

**Estimated scope:** Medium; split admin and public route if required.

### Checkpoint B — information architecture
Before Deep SEO, human review confirms product slug examples, collection taxonomy, and editorial ownership. No indexable URL architecture should depend on unreviewed POS category names.

## Task P8 — Rebaseline the storefront visual system
**Description:** Finalize LA Clothing's minimal/editorial menswear visual system: typography, spacing, grid, media ratios, navigation, controls, focus states, responsive behavior, loading/empty/error patterns. Do not change commerce authority semantics.

**Acceptance criteria:** coherent mobile/desktop shell; accessible controls/focus; no unrelated commerce/auth/API changes.

**Verification:** lint/typecheck/build; browser 390px + desktop review; Axe/keyboard checks.

**Dependencies:** P3 specified; may run in parallel with P4–P7.

**Files likely touched:** global CSS, layout, header, footer, one browser spec.

**Estimated scope:** Medium.

## Task P9 — Redesign homepage and lookbook with real merchandise
**Description:** Replace abstract placeholders with approved real media, real featured products/collections, crawlable links, and factual brand/editorial copy.

**Acceptance criteria:** real or intentional fallback media; real links to public collections/PDPs; no invented season/material/newness claims.

**Verification:** mobile/desktop visual pass; broken-link/image check; accessibility regression.

**Dependencies:** P4, P7, P8.

**Files likely touched:** homepage, lookbook, shared editorial styles/components, browser spec.

**Estimated scope:** Medium.

## Task P10 — Productize Shop, Collections, and PDP merchandising
**Description:** Polish discovery and PDP hierarchy around real media, published copy, price/availability, mandatory Size, optional Color, size guide/care, breadcrumbs, and meaningful internal links.

**Acceptance criteria:** all visible collection links resolve; size/color purchase rules remain unchanged; missing copy/media degrade intentionally.

**Verification:** existing commerce/domain tests; browser navigation/filter/purchase flow; mobile/desktop/a11y evidence.

**Dependencies:** P4, P5, P7, P8.

**Files likely touched:** shop page, collection page, PDP, purchase panel/styles, browser spec.

**Estimated scope:** split PLP/collections and PDP into separate PRs if >5 files.

## Task P11 — Polish cart, checkout, success, and tracking
**Description:** Apply the launch visual system to the existing safe buyer journey without changing price/stock/shipping/order/Pancake trust boundaries.

**Acceptance criteria:** consistent buyer journey; explicit loading/error/empty states; no new client authority over commerce facts.

**Verification:** existing DB/security/action tests; mobile/desktop full-flow browser regression; console/network error review.

**Dependencies:** P8, P10.

**Files likely touched:** cart/checkout/success/tracking presentation files and one browser spec.

**Estimated scope:** Medium; split if needed.

### Checkpoint C — storefront product quality
Human visual review must use representative real catalog/media and approve homepage → collection → PDP → cart → checkout before search launch work is called ready.

## Task P12 — Add fail-closed domain/search exposure and technical SEO foundation
**Description:** Introduce explicit canonical origin + explicit indexing flag. Under ADR 0004, `la.lanadesign.vn` serves as temporary production with `SEARCH_INDEXING_ENABLED=false`. Add metadata base, robots/sitemap conventions, and utility-route noindex. Indexing can be enabled only when permanent domain configuration and explicit human launch approval are granted.

**Indexable when enabled:** homepage, published collections/editorial pages, public active PDPs, deliberately indexable Shop pages.

**Noindex/excluded:** admin, account, cart, checkout/success, tracking result flows, APIs, search result pages, arbitrary filter/sort combinations.

**Acceptance criteria:**
- [ ] canonical URLs never trust arbitrary request Host headers;
- [ ] staging defaults to `noindex`/non-discovery and cannot accidentally emit final canonicals;
- [ ] final-domain release requires explicit configured origin + indexing enablement and sitemap points only to canonical public URLs.

**Verification:**
- [ ] focused metadata/robots/sitemap/indexing-policy tests;
- [ ] production-start HTTP head/header smoke for indexing disabled/enabled modes;
- [ ] release preflight fails closed on missing/mismatched final-domain configuration.

**Dependencies:** P6, P7. Exact dedicated domain required only before enabling indexing, not before implementing this task.

**Files likely touched:** layout/SEO config, `robots.ts`, `sitemap.ts`, release validation, tests.

**Estimated scope:** Medium.

## Task P13 — Add product-specific metadata and media SEO
**Description:** Generate product-specific title, meta description, canonical, Open Graph/Twitter image and descriptive alt conventions from website-owned SEO/editorial content with factual fallbacks. For remote Pancake images, do not pretend filenames are website-owned. Semantic filenames apply to website-owned assets/OG outputs and any future owned media storage only.

**Acceptance criteria:**
- [ ] every public PDP has unique factual title/description/canonical;
- [ ] trusted product image is used for social preview when available, branded fallback otherwise;
- [ ] title/description/alt text remain readable and do not keyword-stuff or invent product facts.

**Verification:** metadata unit tests; rendered head inspection; social image resolution; representative copy review.

**Dependencies:** P4, P5, P6, P12.

**Files likely touched:** PDP metadata helper/page, OG asset/route, focused tests.

**Estimated scope:** Medium.

## Task P14 — Add truthful ecommerce structured data and breadcrumbs
**Description:** Render XSS-safe JSON-LD using the same server-authoritative facts visible on the page. Use Product/Offer and ProductGroup/variant modeling only where current official search documentation supports the exact visible model. Add BreadcrumbList and Organization/WebSite entity data where factual.

**Acceptance criteria:** schema facts match visible product facts; no invented rating/GTIN/discount/material/return/shipping promises; structured text cannot break out of JSON-LD.

**Verification:** domain tests compare page facts vs schema; malicious-text serialization regression; current official structured-data validation during launch QA.

**Dependencies:** P10, P13.

**Files likely touched:** structured-data helpers, PDP/layout, focused tests.

**Estimated scope:** Medium.

## Task P15 — Control faceted crawling, sitemap coverage, and internal linking
**Description:** Keep arbitrary query/filter/sort/search combinations out of the index while exposing stable collection pages, pagination, breadcrumbs, homepage/collection/PDP links, and only canonical public URLs in sitemap.

**Acceptance criteria:** no faceted URL explosion; intended products are crawlable through normal links; sitemap excludes inactive/private/utility URLs and updates when publish state changes.

**Verification:** URL-policy domain tests; HTTP head/canonical/noindex smoke; crawl-link inspection across homepage → collection → PDP.

**Dependencies:** P7, P12, P14.

**Files likely touched:** discovery URL policy, shop/collection metadata, sitemap/internal-link components, focused tests.

**Estimated scope:** Medium.

### Checkpoint D — Deep SEO technical gate
Before GEO/content scale-up: verify final URL model, canonical/noindex behavior, sitemap, PDP metadata, breadcrumbs, and Product JSON-LD in a production-shaped build. Staging must still be non-indexable.

## Task P16 — Build GEO/entity/content quality surfaces
**Description:** Make LA Clothing and its products understandable from public factual text: brand/about identity, COD/shipping facts already approved, product editorial facts, size/care where known, collection context, and consistent Organization/WebSite/Product relationships. Do not create hidden AI-only pages. Public final domain should not block intended search crawlers including OAI-SearchBot unless a later policy explicitly changes this.

**Acceptance criteria:**
- [ ] key brand/product/commercial facts exist in visible crawlable HTML;
- [ ] public content has clear entity names, headings, internal links, and factual consistency with structured data;
- [ ] unknown material/fit/care/origin/policy claims remain absent rather than generated.

**Verification:** content inventory; rendered HTML/entity/schema consistency review; crawl policy smoke on final-domain configuration.

**Dependencies:** P5, P9, P10, P13–P15.

**Files likely touched:** public brand/content pages, product/collection content, entity helpers, tests/docs.

**Estimated scope:** Medium per slice; content entry is batched separately from code.

## Task P17 — Run live catalog/media/content acceptance
**Description:** Resync the real Pancake catalog and audit every intended public product for sellability, source description, trusted images, readable slug, collection assignment, published editorial/SEO state, and safe variant mapping.

**Acceptance criteria:**
- [ ] every intended sellable product has valid Size mapping and optional Color behavior;
- [ ] every public PDP has either trusted media or an explicitly accepted fallback, readable slug, metadata and collection path;
- [ ] no private `note`, malformed media, unsupported source claim, or inactive product leaks publicly.

**Verification:** safe catalog resync; acceptance report with counts/non-sensitive IDs; representative browser PDP checks and targeted fixes.

**Dependencies:** P16.

**Files likely touched:** preferably none; fixes become narrowly scoped follow-up PRs.

**Estimated scope:** Operational/content QA.

## Task P18 — Final visual, accessibility, SEO and commerce E2E gate
**Description:** Test the complete production candidate across mobile/desktop buyer flows, media, accessibility, metadata/indexation, structured data, performance-critical images, and commerce behavior.

**Acceptance criteria:** 0 Critical/Required review findings; no broken media/links; critical buyer and search surfaces pass release criteria.

**Verification:** full CI; production build/start smoke; browser E2E + Axe/keyboard/VoiceOver; SEO/robots/sitemap/schema HTTP inspection; performance evidence for representative home/PLP/PDP.

**Dependencies:** P17.

**Files likely touched:** tests/docs only unless defects are found.

**Estimated scope:** Verification gate.

## Task P19 — Cut over permanent brand domain and ship
**Description:** Configure the chosen permanent brand domain as the canonical public origin, validate TLS/NPM/Caddy/app routing, enable indexing explicitly after human approval, submit/verify search surfaces, and transition `la.lanadesign.vn` according to the approved hosting policy.

**Acceptance criteria:**
- [ ] dedicated domain serves the exact approved release and is the only public canonical origin;
- [ ] HTTPS, redirects, robots, sitemap, canonical, OG/schema URLs and critical commerce routes are correct through the public edge;
- [ ] rollback target exists and remaining VPS operations gates (backup/restore, SSH hardening, monitoring) are closed before production is called complete.

**Verification:** exact-SHA deploy evidence; public HTTPS/route/search-surface smoke; post-launch health/telemetry/rollback verification.

**Dependencies:** P18 + human choice/configuration of final domain.

**Files likely touched:** environment/deploy docs/config only as required by actual domain.

**Estimated scope:** Shipping/operations gate.

---

## SEO naming conventions
Use meaningful user-facing names, not source-code filenames.

Examples:
```text
Product slug:     ao-so-mi-oxford-trang
Collection slug:  ao-so-mi-nam
H1:               Áo Sơ Mi Oxford Trắng
SEO title:        Áo Sơ Mi Oxford Trắng Nam | LA Clothing
Breadcrumb:       Trang chủ > Áo sơ mi nam > Áo Sơ Mi Oxford Trắng
Owned media name: ao-so-mi-oxford-trang-la-clothing-01.webp
```

Rules:
- source files such as `page.tsx`/component filenames have no SEO value and are not renamed for SEO;
- remote Pancake filenames are not rewritten by inventing an unsafe proxy/storage layer;
- if LA Clothing later owns media storage, semantic lowercase hyphenated filenames may be generated at ingestion while preserving media identity;
- slug/title/alt/meta text must not repeat keywords unnaturally.

## Product-content precedence
```text
Pancake product name/price/stock/variants/media/note_product
                    ↓
        verified source facts (read-only)
                    ↓
          website editorial workspace
                    ↓
      DRAFT → REVIEWED → PUBLISHED
                    ↓
 visible PDP/collection copy + metadata + schema + GEO
```

Precedence rules:
1. server-authoritative commerce facts always come from the verified commerce path;
2. public editorial/SEO copy comes from published website content;
3. `sourceDescription` is fallback/input context, not an overwrite authority;
4. `note` is never a fallback;
5. missing facts stay missing.

## Verification commands available in repository
Use focused RED/GREEN first, then relevant standing gates such as:
- `pnpm test`
- `pnpm test:db`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm release:check`

Browser-facing slices additionally require actual runtime browser evidence using the repository's existing accessibility/browser workflow when available.

## PR strategy
Prefer one focused PR per task or smaller. Any task that would touch >5 files or two independent subsystems must be split before implementation. Each behavior-changing PR follows:
1. focused RED evidence;
2. minimal GREEN implementation;
3. relevant full gates;
4. self-review: correctness → security → architecture → simplicity → performance;
5. human review before merge.

Security-and-hardening is mandatory for Pancake input, remote image URLs, admin content, slug redirects, metadata/JSON-LD, and domain/indexing configuration.

## Final Definition of Done
No phase is complete from code alone. Task acceptance criteria plus the project-wide Definition of Done apply. In particular:
- runtime/browser evidence is required for buyer-facing behavior;
- new behavior must have tests that fail without it;
- migrations/config/backward compatibility must be accounted for;
- docs must describe current truth;
- security, observability, rollback and human review gates must pass before launch.

## Human checkpoints still required
Only these decisions remain intentionally human-owned:
1. visual approval after real media is present;
2. collection/taxonomy naming approval;
3. editorial content approval/publish;
4. final dedicated LA Clothing domain choice;
5. final launch approval.

Everything else in V2 is sufficiently specified to begin `/build` from P0.