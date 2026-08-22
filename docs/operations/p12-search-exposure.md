# P12 search exposure and technical SEO operations

P12 is implemented as a fail-closed search-exposure boundary. P15 extends that boundary with a reviewed catalog-pagination exception. Neither P12 nor P15 chooses or approves the final LA Clothing production domain.

## Locked launch rule

- `la.lanadesign.vn` is temporary staging and remains non-indexable.
- `SEARCH_INDEXING_ENABLED=false` is the safe default for local, staging, CI, and VPS verification.
- P12 may be deployed while staging after P6 + P7.
- A dedicated LA Clothing domain must be explicitly selected and approved before `SEARCH_INDEXING_ENABLED=true` is used for a real deployment.
- Enabling indexing is a later launch/configuration decision; merging P12 or P15 does not enable indexing by itself.

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

P15 catalog discovery uses normal server-rendered links for products and previous/next pagination. Filters may remain useful for visitors without becoming additional indexable crawl targets.

## Verification

The dedicated `Catalog indexation runtime` workflow runs `scripts/catalog-indexation-http-smoke.ts` against a real Next request path and a seeded two-page catalog. It verifies:

- enabled `/shop?page=2` is 200, has no `noindex`, and self-canonicalizes to page 2;
- an enabled published `/collections/<slug>?page=2` does the same;
- explicit `?page=1` and a mixed paginated discovery state remain `noindex` without canonical metadata;
- staging/indexing-disabled shop and collection pagination remain `noindex` without canonical metadata.

Domain-level crawl-policy tests additionally verify malformed, leading-zero, percent-encoded, duplicate, over-limit, PDP, and non-catalog pagination states fail closed. This runtime smoke complements domain-level policy/metadata tests; neither replaces the existing CI, accessibility, build, release, or VPS gates.

## Release preflight

`pnpm release:check` requires `SEARCH_INDEXING_ENABLED` to be exactly `true` or `false`. Missing or malformed values fail closed. `true` is rejected for `la.lanadesign.vn`, `localhost`, and `127.0.0.1` origins.

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
