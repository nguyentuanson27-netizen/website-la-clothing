# ADR 0004: Temporary production domain and non-indexable search exposure policy

- **Status:** Accepted
- **Date:** 2026-08-23
- **Amends:** ADR 0002 (Self-managed VPS production infrastructure), ADR 0003 (Shared-host nginx-proxy-manager edge)
- **Clarifies:** `docs/operations/p12-search-exposure.md`

## Context

Historically, development and operational documentation referenced `la.lanadesign.vn` as a temporary staging domain where search indexing was forbidden by hardcoded runtime validation (`BLOCKED_INDEXING_HOSTS`).

The human owner and domain authority has made the explicit operational decision to approve `la.lanadesign.vn` as the **TEMPORARY production domain** for LA Clothing to serve real production traffic.

However, because `la.lanadesign.vn` is a temporary domain and not the final permanent brand domain:
- Public search engines must not index the storefront on this temporary hostname.
- `SEARCH_INDEXING_ENABLED` must strictly remain `false` in production.
- Public canonical URLs and sitemap listings must not be advertised to search crawlers until a permanent domain is selected, configured, and explicitly approved for indexing.

## Decision

1. **Temporary production domain:** `la.lanadesign.vn` is recognized and approved as the temporary production origin (`APP_DOMAIN=la.lanadesign.vn`, `BETTER_AUTH_URL=https://la.lanadesign.vn`). It serves real buyer traffic behind the approved reverse-proxy stack.
2. **Dedicated staging origin:** `staging.lanadesign.vn` (along with `localhost` and `127.0.0.1`) remains in `BLOCKED_INDEXING_HOSTS` as an indexing-blocked origin.
3. **Search indexing gate:** `SEARCH_INDEXING_ENABLED=false` remains the active production configuration on `la.lanadesign.vn`.
4. **Permissibility vs. Approval:** Although the runtime policy in `src/seo/search-exposure.ts` no longer hard-blocks `la.lanadesign.vn` (allowing it to serve as a valid public origin), enabling search indexing (`SEARCH_INDEXING_ENABLED=true`) is **NOT** approved under this temporary domain decision.
5. **Separate approval required:** Setting `SEARCH_INDEXING_ENABLED=true` requires a separate explicit human approval gate and a permanent domain confirmation.
6. **Expected production behavior:** Until such approval is granted:
   - Responses emit `X-Robots-Tag: noindex, nofollow` on HTML routes;
   - Storefront HTML emits `<meta name="robots" content="noindex, nofollow">`;
   - Public canonical `<link rel="canonical">` tags are withheld;
   - `/sitemap.xml` returns an empty `<urlset>` without advertising URLs;
   - `/robots.txt` disallows `/api` while maintaining the crawl boundary.

## Consequences

- Real customers can browse and purchase on `https://la.lanadesign.vn`.
- Search engines will not index the temporary domain or create canonical confusion for the future permanent brand domain.
- When the permanent domain is ready, cutover involves configuring the new domain, updating `APP_DOMAIN`, and obtaining explicit human approval before setting `SEARCH_INDEXING_ENABLED=true`.
