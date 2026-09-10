# P12 search exposure and technical SEO operations

P12 is implemented as a fail-closed search-exposure boundary. P15 extends that boundary with a reviewed catalog-pagination exception. ADR 0009 now supplies the permanent-domain authority that earlier revisions of this runbook deliberately left unresolved.

## Current domain authority

- **Official permanent storefront:** `www.lafashion.asia` (ADR 0009).
- **Legacy temporary production host:** `la.lanadesign.vn` (ADR 0004). It remains a valid rollback/buyer-traffic origin only while explicitly configured and remains in `TEMPORARY_PRODUCTION_HOSTS`, so it cannot become indexable.
- **Dedicated staging origin:** `staging.lanadesign.vn`, plus local loopback hosts, remain indexing-blocked.
- **Canonical origin authority:** server-owned `APP_DOMAIN`; request `Host`, forwarded-host headers, query state and client-visible values are not authority.
- **Initial permanent-domain posture:** `APP_DOMAIN=www.lafashion.asia`, matching `BETTER_AUTH_URL`, and `SEARCH_INDEXING_ENABLED=false`.
- Selecting the permanent domain does **not** approve organic indexing. Gate S still requires external domain verification, activation-time checks and separate explicit human approval.
- The bare apex `lafashion.asia` is not the canonical application hostname. Any redirect to `www.lafashion.asia` is external edge behavior and must be observed before it is treated as active.

Runtime search exposure now permits `SEARCH_INDEXING_ENABLED=true` only when the server-owned origin is exactly the approved permanent host `www.lafashion.asia`. A syntactically valid but unapproved public hostname remains non-indexable and release preflight refuses an indexing request for it. This prevents a configuration mistake from creating a second canonical/indexable production origin.

Until Gate S is explicitly approved, expected production behavior remains `noindex, nofollow`, no public canonical, and no advertised canonical sitemap.

## U37 sitemap-capacity gate

The U37/W21 capacity contract remains closed and unchanged by the domain decision.

- Named owner: `@nguyentuanson27-netizen`.
- Cadence: per release, with a fresh activation-time rerun immediately before indexing enablement.
- Single-sitemap hard budget: **49,991 dynamic URLs** plus the current 9 reviewed static paths, bounded by the 50,000-URL document limit.
- Warning: **40,000 dynamic URLs** → `ALLOW_WITH_ACK`; initiate the sharding plan and record owner acknowledgement.
- Act: **45,000 dynamic URLs** or projected time to the hard bound shorter than one sharding cycle → `BLOCK`; implement U37b sharding first.
- Above the hard dynamic budget → `BLOCK`; never publish a partial sitemap or raise the per-document bound as a workaround.

Immediately before indexing enablement, run the production capacity audit on the **exact activation head** and record SHA, environment, timestamp, reported counts, and catalog mirror freshness. Any sitemap-eligible catalog change after that measurement invalidates the audit and requires a rerun.

Evaluation order is:

1. over hard budget → block and shard;
2. Act threshold met → block and shard;
3. Warning threshold met → owner acknowledgement plus all other Gate S checks;
4. below Warning → capacity condition satisfied, continue with remaining Gate S checks.

## Runtime policy

HTML routes that must stay out of search remain crawlable so crawlers can observe `noindex`. `robots.txt` crawl blocking is reserved for non-HTML API surfaces; do not hide noindex HTML behind a blanket robots disallow.

When indexing is disabled:

- root/application metadata emits `noindex, nofollow`;
- response policy emits `X-Robots-Tag: noindex, nofollow` on application pages;
- catalog/static metadata withholds canonical links;
- `/robots.txt` preserves the reviewed crawl boundary, disallows `/api`, and does not advertise a sitemap;
- `/sitemap.xml` returns no canonical storefront URLs.

When indexing is explicitly enabled on the approved permanent host after Gate S approval:

- only reviewed public routes without unsafe query state are indexable;
- P15 permits only exact raw pagination `?page=N`, with `N` from 2 through 10000, on `/shop` and published `/collections/<slug>` listing pages;
- permitted pagination pages self-canonicalize including their own `?page=N`;
- `?page=1`, leading-zero/encoded aliases, duplicates, mixed filter/search/sort/faceted state, PDP query state, private/account/admin/cart/checkout/search surfaces, and other unapproved query-state HTML fail closed to noindex;
- `/robots.txt` may advertise the canonical sitemap while preserving `/api` blocking;
- `/sitemap.xml` contains only reviewed canonical public paths, current visible active product slugs for the configured shop, and published website-owned collections; pagination URLs are not enumerated;
- historical slugs, inactive/stale/wrong-shop products, draft collections and private/query URLs remain excluded.

P6 remains URL identity authority: current product slug returns 200, historical slug returns exact 301 to the current canonical slug, and unknown slug returns branded HTML 404.

## Verification

The dedicated `Catalog indexation runtime` workflow and domain tests continue to verify the search boundary, including:

- crawlable page-1 → page-2 → PDP discovery chains;
- correct page-2 self-canonical behavior when indexing is enabled in the approved test context;
- explicit page 1, malformed/encoded/duplicate/over-limit/mixed query states remain noindex;
- staging/indexing-disabled behavior remains noindex without canonical metadata;
- sitemap membership excludes inactive, stale, wrong-shop, historical and draft targets;
- the legacy temporary host refuses indexing;
- `www.lafashion.asia` is the only permanent public hostname eligible for the indexing-origin gate;
- request-controlled host data cannot substitute for `APP_DOMAIN`.

## Permanent-domain cutover

Use `docs/operations/permanent-domain-cutover.md` for DNS/TLS/edge/VPS cutover. Repository configuration is not evidence that the external cutover succeeded.

Before calling `www.lafashion.asia` live, observe at minimum:

1. DNS and valid HTTPS for the exact `www` hostname;
2. nginx-proxy-manager/Caddy/application routing;
3. matching `APP_DOMAIN` and `BETTER_AUTH_URL` on the deployed environment;
4. `SEARCH_INDEXING_ENABLED=false` through the verification phase;
5. homepage, shop, representative PDP, policy pages and buyer-critical paths;
6. Merchant feed plus representative feed landing/image URLs using the new origin;
7. noindex/canonical/sitemap/robots behavior under the disabled-indexing posture;
8. legacy-host containment and, if configured, apex → `www` redirect behavior.

## Release preflight and Gate S

`pnpm release:check` requires `SEARCH_INDEXING_ENABLED` to be exactly `true` or `false`.

- `true` is rejected for staging/local origins.
- `true` is rejected for the legacy temporary origin `la.lanadesign.vn`.
- `true` is rejected for any public hostname other than `www.lafashion.asia`.
- `www.lafashion.asia` is technically eligible for the gate, but this repository rule is **not** human activation approval.
- deployment examples remain `SEARCH_INDEXING_ENABLED=false`.

Before a real deployment with indexing enabled, verify all Gate S requirements on the exact activation head: permanent-domain external verification, exact origin configuration, TLS/edge/application routing, exact-head CI/runtime/browser/VPS checks, canonical/noindex/robots/sitemap behavior, fresh U37 capacity evidence, and explicit human approval of the indexing change.

If any required item is missing, keep `SEARCH_INDEXING_ENABLED=false`.

## Rollback / containment

Search exposure remains independently containable: set `SEARCH_INDEXING_ENABLED=false` and redeploy the approved configuration. If the permanent-domain cutover itself fails, the legacy host may be restored temporarily with matching `APP_DOMAIN` and `BETTER_AUTH_URL`, but it remains non-indexable. Product, collection, checkout and Pancake data are unchanged by this containment action. Application rollback remains governed by `docs/operations/release-and-rollback.md`.
