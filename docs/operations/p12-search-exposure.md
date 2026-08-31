# P12 search exposure and technical SEO operations

P12 is implemented as a fail-closed search-exposure boundary. P15 extends that boundary with a reviewed catalog-pagination exception. Neither P12 nor P15 chooses or approves the final LA Clothing production domain.

## Locked launch rule

- `la.lanadesign.vn` is approved as the **TEMPORARY production domain** by human owner (ADR 0004) and serves real buyer traffic.
- `staging.lanadesign.vn` is the dedicated staging hostname and indexing-blocked origin (`BLOCKED_INDEXING_HOSTS`).
- `SEARCH_INDEXING_ENABLED=false` is the active production configuration for `la.lanadesign.vn`.
- Runtime policy permits public hostnames (including `la.lanadesign.vn`), but enabling search indexing (`SEARCH_INDEXING_ENABLED=true`) is **NOT** approved by this temporary-domain decision.
- That policy is now also **enforced in code**: `la.lanadesign.vn` is listed in `TEMPORARY_PRODUCTION_HOSTS` in `src/seo/search-exposure.ts`, so `SEARCH_INDEXING_ENABLED=true` on that host resolves to `indexingEnabled: false` at runtime and is rejected by `pnpm release:check`. The host stays a valid public origin; only index enablement fails closed.
- Enabling search indexing requires a separate explicit human approval gate and permanent domain confirmation.
- Moving to the permanent domain is an explicit, reviewable removal of the temporary host from `TEMPORARY_PRODUCTION_HOSTS`. Any other hostname — including the future permanent brand domain — remains governed by the existing `SEARCH_INDEXING_ENABLED` gate and is not hardcoded out of it.
- Until that separate approval: `noindex, nofollow`, no public canonical, and an empty non-advertised sitemap remain expected production behavior.

## Runtime policy

The server-owned `APP_DOMAIN` is the only canonical origin input. The request `Host` header is not canonical authority.

HTML routes that must stay out of search remain crawlable so crawlers can observe their `noindex` directives. `robots.txt` crawl blocking is reserved for non-HTML API surfaces; do not add an HTML route to `Disallow` merely because it is noindex.

When indexing is disabled:

- root metadata emits `noindex, nofollow`;
- response policy emits `X-Robots-Tag: noindex, nofollow` on application pages, including catalog pagination;
- catalog listing metadata withholds canonical links;
- `/robots.txt` allows HTML crawling, disallows `/api`, and does not advertise a sitemap;
- `/sitemap.xml` returns no canonical URLs.

When indexing is explicitly enabled on an eligible public origin:

- canonical public routes without query state may be indexed;
- P15 additionally permits only the exact raw pagination form `?page=N`, where `N` is an integer from 2 through 10000, on `/shop` and published `/collections/<slug>` listing pages;
- each permitted pagination page emits a self-canonical URL including its own `?page=N` query;
- explicit `?page=1`, leading-zero or percent-encoded pagination aliases, duplicate parameters, mixed filter/search/sort/faceted state, PDP query state, and other query-state HTML fail closed with the response-level `noindex` policy;
- catalog canonical metadata is withheld for explicit `?page=1`, leading-zero, duplicate, mixed filter/search/sort/faceted, and staging/indexing-disabled states; percent-encoded aliases are governed by the raw response-level `noindex` boundary because framework-parsed metadata search params may already be decoded;
- `/robots.txt` allows the site, disallows `/api`, and advertises the canonical sitemap;
- `/sitemap.xml` continues to contain only reviewed canonical base public paths, current visible active product slugs for the configured Pancake shop, and published website-owned collections; it does not enumerate pagination URLs;
- historical product slugs, inactive/stale/wrong-shop products, draft collections, and private/query URLs outside the reviewed pagination exception are excluded from the sitemap and indexation targets.

P6 remains the URL identity authority: current product slug returns 200, historical slug returns exact 301 to the current canonical slug, and unknown slug returns 404.

P15 catalog discovery uses normal server-rendered links for products and previous/next pagination. Product cards expose the visible product name inside the PDP anchor, so image-less cards still provide descriptive crawlable link text. Filters may remain useful for visitors without becoming additional indexable crawl targets.

## Verification

The dedicated `Catalog indexation runtime` workflow runs `scripts/catalog-indexation-http-smoke.ts` against a real Next request path and a seeded two-page catalog. It verifies:

- enabled `/shop` and a published collection base page expose visible crawlable links to their page-2 URL;
- enabled page-2 shop and collection listings expose the visible product name inside a canonical PDP anchor, proving a page-1 → page-2 → PDP crawl chain even for products without trusted media;
- enabled `/shop?page=2` is 200, has no `noindex`, and self-canonicalizes to page 2;
- an enabled published `/collections/<slug>?page=2` does the same;
- explicit `?page=1` and a mixed paginated discovery state remain `noindex` without canonical metadata;
- staging/indexing-disabled shop and collection pagination remain `noindex` without canonical metadata.

Domain-level crawl-policy tests additionally verify malformed, leading-zero, percent-encoded, duplicate, over-limit, PDP, and non-catalog pagination states fail closed. Database sitemap tests verify only current visible active products in the configured shop and published website-owned collections are returned, excluding inactive, stale, wrong-shop, historical, and draft targets. These tests complement the existing CI, accessibility, build, release, and VPS gates rather than replacing them.

## Release preflight

`pnpm release:check` requires `SEARCH_INDEXING_ENABLED` to be exactly `true` or `false`. Missing or malformed values fail closed. `true` is rejected for `staging.lanadesign.vn`, `localhost`, and `127.0.0.1` origins, and separately for the temporary production origin `la.lanadesign.vn` with a distinct temporary-host message.

The repository examples and CI/VPS verification use `false`. Do not weaken this validation to make a deployment pass.

Before a real deployment with indexing enabled, verify all of the following:

1. the exact dedicated LA Clothing domain has human approval;
2. `APP_DOMAIN` is that exact approved hostname;
3. TLS/NPM/Caddy/app routing for that hostname is verified;
4. exact-head CI, catalog-indexation runtime, accessibility, and VPS verification are green;
5. `/robots.txt`, `/sitemap.xml`, base canonicals, page-2 self-canonicals, response-level noindex for encoded aliases, and noindex/no-canonical behavior for explicit page-1 and mixed query states are inspected on the approved domain;
6. final human launch approval explicitly includes changing `SEARCH_INDEXING_ENABLED=true`.

If any item is missing, keep `SEARCH_INDEXING_ENABLED=false`.

## Rollback / containment

Search exposure is independently containable: set `SEARCH_INDEXING_ENABLED=false` and redeploy the approved configuration. This restores global HTML `noindex` (including all catalog pagination), withholds catalog canonical links, removes sitemap advertising/URLs, and keeps `/api` crawl-blocked without hiding HTML noindex directives behind `robots.txt`. Product, collection, checkout, and Pancake data are unchanged. Application rollback remains governed by `docs/operations/release-and-rollback.md`.
