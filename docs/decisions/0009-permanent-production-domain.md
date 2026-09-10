# ADR 0009: Permanent production domain `www.lafashion.asia`

- **Status:** Accepted
- **Date:** 2026-09-10
- **Amends:** ADR 0002, ADR 0003, ADR 0004
- **Owner decision:** `www.lafashion.asia` is the official permanent LA Clothing storefront hostname.

## Context

ADR 0004 approved `la.lanadesign.vn` as a temporary production origin and deliberately withheld organic indexing until a permanent brand domain was selected and separately approved for search exposure.

The repository owner has now selected **`www.lafashion.asia`** as the permanent production storefront hostname. Domain selection is a repository/operations authority decision; it is not evidence that DNS, TLS, nginx-proxy-manager, Caddy, the VPS environment, Search Console, Bing, or Merchant Center have already been configured for the new hostname.

## Decision

1. **Official permanent hostname:** `www.lafashion.asia` is the canonical production hostname for the planned cutover.
2. **Server-owned origin:** the target production configuration is:
   - `APP_DOMAIN=www.lafashion.asia`
   - `BETTER_AUTH_URL=https://www.lafashion.asia`
3. **`www` is canonical:** the bare apex `lafashion.asia` is not canonical authority. A redirect from the apex may be configured at the public edge, but it must not be claimed until DNS/TLS/edge behavior is actually observed.
4. **Legacy temporary hostname stays fail-closed:** `la.lanadesign.vn` remains in the temporary-production/noindex guard during and after cutover unless a later reviewed decision explicitly changes that containment. It must never become an alternate indexable canonical origin merely because rollback traffic reaches it.
5. **Permanent-domain selection does not enable indexing:** `SEARCH_INDEXING_ENABLED=false` remains the deployment default. Gate S still requires production verification and a separate explicit human approval before changing it to `true`.
6. **Only the approved permanent hostname may pass the indexing-origin gate:** a syntactically valid but unapproved public hostname must resolve to non-indexable runtime exposure and must fail release preflight when it requests `SEARCH_INDEXING_ENABLED=true`.
7. **Request data is not authority:** `Host`, forwarded-host headers, query parameters, and client-visible configuration cannot substitute for server-owned `APP_DOMAIN`.
8. **External cutover is operational work:** this ADR and its code/config changes do not claim the new hostname is live. DNS, TLS, public edge routing, VPS environment changes, health checks, Merchant/Search verification, and redirect behavior require observed evidence.

## Search exposure consequence

The permanent hostname becomes **eligible** for the existing search-indexing gate; it is not automatically indexable. The expected initial permanent-domain posture remains:

- `APP_DOMAIN=www.lafashion.asia`
- `BETTER_AUTH_URL=https://www.lafashion.asia`
- `SEARCH_INDEXING_ENABLED=false`
- HTML remains `noindex, nofollow`
- canonical links remain withheld under the existing search-exposure policy
- the canonical sitemap remains unadvertised/empty under the existing policy

A later Gate S operation may set `SEARCH_INDEXING_ENABLED=true` only after the exact permanent hostname and all activation-time verification requirements are satisfied and the owner explicitly approves indexing.

## Cutover and rollback

The executable checklist is `docs/operations/permanent-domain-cutover.md`.

If the new-domain cutover fails before search indexing is enabled:

1. keep `SEARCH_INDEXING_ENABLED=false`;
2. restore the last reviewed working edge/VPS routing and, if necessary, temporarily restore `APP_DOMAIN=la.lanadesign.vn` and the matching `BETTER_AUTH_URL`;
3. verify buyer-critical paths before reopening traffic;
4. do not enable indexing on the legacy hostname;
5. resolve the cutover defect and repeat the permanent-domain verification.

Rollback is containment, not a reversal of the owner decision that `www.lafashion.asia` is the permanent target.

## Superseded statements

ADR 0004 remains a historical record for the temporary-domain decision. Where ADR 0004 or `docs/operations/p12-search-exposure.md` describes the permanent domain as not yet selected or says every non-temporary public hostname is eligible for indexing, this ADR supersedes that wording. Current runtime policy recognizes only `www.lafashion.asia` as the approved permanent production hostname for indexing eligibility.
