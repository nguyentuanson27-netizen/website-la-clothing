# P12 search exposure and technical SEO operations

P12 is implemented as a fail-closed search-exposure boundary. It does **not** choose or approve the final LA Clothing production domain.

## Locked launch rule

- `la.lanadesign.vn` is temporary staging and remains non-indexable.
- `SEARCH_INDEXING_ENABLED=false` is the safe default for local, staging, CI, and VPS verification.
- P12 may be deployed while staging after P6 + P7.
- A dedicated LA Clothing domain must be explicitly selected and approved before `SEARCH_INDEXING_ENABLED=true` is used for a real deployment.
- Enabling indexing is a later launch/configuration decision; merging P12 does not enable indexing by itself.

## Runtime policy

The server-owned `APP_DOMAIN` is the only canonical origin input. The request `Host` header is not canonical authority.

HTML routes that must stay out of search remain crawlable so crawlers can observe their `noindex` directives. `robots.txt` crawl blocking is reserved for non-HTML API surfaces; do not add an HTML route to `Disallow` merely because it is noindex.

When indexing is disabled:

- root metadata emits `noindex, nofollow`;
- response policy emits `X-Robots-Tag: noindex, nofollow` on application pages;
- `/robots.txt` allows HTML crawling, disallows `/api`, and does not advertise a sitemap;
- `/sitemap.xml` returns no canonical URLs.

When indexing is explicitly enabled on an eligible public origin:

- canonical public routes can be indexed only without query state;
- utility/private/search/faceted/query-state HTML routes remain crawlable with `noindex` response policy;
- `/robots.txt` allows the site, disallows `/api`, and advertises the canonical sitemap;
- `/sitemap.xml` contains only reviewed static public paths, current visible active product slugs for the configured Pancake shop, and published website-owned collections;
- historical product slugs, inactive/stale/wrong-shop products, draft collections, and private/query URLs are excluded.

P6 remains the URL identity authority: current product slug returns 200, historical slug returns exact 301 to the current canonical slug, and unknown slug returns 404.

## Release preflight

`pnpm release:check` requires `SEARCH_INDEXING_ENABLED` to be exactly `true` or `false`. Missing or malformed values fail closed. `true` is rejected for `la.lanadesign.vn`, `localhost`, and `127.0.0.1` origins.

The repository examples and CI/VPS verification use `false`. Do not weaken this validation to make a deployment pass.

Before a real deployment with indexing enabled, verify all of the following:

1. the exact dedicated LA Clothing domain has human approval;
2. `APP_DOMAIN` is that exact approved hostname;
3. TLS/NPM/Caddy/app routing for that hostname is verified;
4. exact-head CI/VPS verification is green;
5. `/robots.txt`, `/sitemap.xml`, canonical metadata, and noindex behavior are inspected on the approved domain;
6. final human launch approval explicitly includes changing `SEARCH_INDEXING_ENABLED=true`.

If any item is missing, keep `SEARCH_INDEXING_ENABLED=false`.

## Rollback / containment

Search exposure is independently containable: set `SEARCH_INDEXING_ENABLED=false` and redeploy the approved configuration. This restores global HTML `noindex`, removes sitemap advertising/URLs, and keeps `/api` crawl-blocked without hiding HTML noindex directives behind `robots.txt`. Product, collection, checkout, and Pancake data are unchanged. Application rollback remains governed by `docs/operations/release-and-rollback.md`.
