# W15a — SEO runtime coverage inventory

Owning source: `docs/audits/seo-geo-audit.md` finding **W15**, planning step **P2/W15a**.
Master-plan unit: **U5**. Consumer: **U13 / W15b**.

This is an audit, not an implementation. It maps each signal the five dedicated SEO HTTP smoke
scripts prove to the gate that actually runs it, so U13 can wire only what is genuinely missing
instead of duplicating existing CI work.

## Correction to the W15 premise

W15 records that "0/5 dedicated SEO HTTP smoke được wire trực tiếp" — no workflow or npm script
calls any of the five scripts directly. That is still literally true, and it is why the gap looked
larger than it is.

**All five are nevertheless executed on every pull request.**
`tests/integrations/product-slug-http.test.ts` imports each script as a subtest, and
`pnpm test` covers `tests/integrations/*.test.ts`, which the `CI / verify` job runs as its
"Domain tests" step. Each import boots a real Next server, seeds PostgreSQL, and asserts against
real HTTP responses.

| Script | Imported by | Reached by |
|---|---|---|
| `scripts/product-slug-http-smoke.ts` | `tests/integrations/product-slug-http.test.ts` | `pnpm test` → `CI / verify` |
| `scripts/search-exposure-http-smoke.ts` | same | same |
| `scripts/product-metadata-http-smoke.ts` | same | same |
| `scripts/structured-data-http-smoke.ts` | same | same |
| `scripts/oai-robots-http-smoke.ts` | same | same |

So the real question is not "are these five contracts ungated" — they are gated — but **which
individual signals still have no runtime or HTTP gate at all**. That is the table below.

## Gates referenced

| Gate | Where | Trigger |
|---|---|---|
| `pnpm test` | `CI / verify` → "Domain tests" | every PR and push to `main` |
| `pnpm test:db` | `CI / verify` → "Database smoke tests" | every PR and push to `main` |
| `pnpm release:check` | `CI / verify` → "Release environment preflight" | every PR and push to `main` |
| Catalog indexation runtime | `.github/workflows/catalog-indexation-runtime.yml` → `scripts/catalog-indexation-http-smoke.ts` | every PR and push to `main` |
| P18 final QA runtime | `.github/workflows/p18-final-qa.yml` (Playwright, production build) | every PR and `workflow_dispatch` |

## Coverage map

| Signal | Existing coverage | Dedicated smoke | Missing runtime/HTTP gate | Owner |
|---|---|---|---|---|
| `robots.txt` allows HTML and disallows `/api` while indexing is disabled | `tests/domain/robots-policy.test.ts`; P18 final QA | `search-exposure-http-smoke.ts`, `oai-robots-http-smoke.ts` | — covered at HTTP level | #152 W15 |
| `robots.txt` advertises the canonical sitemap only when indexing is enabled | — (no domain-only equivalent) | `search-exposure-http-smoke.ts`, `oai-robots-http-smoke.ts` | — covered at HTTP level | #152 W15 |
| `OAI-SearchBot` stays on the reviewed crawl boundary | `tests/domain/robots-policy.test.ts`; P18 final QA | `oai-robots-http-smoke.ts` | — covered at HTTP level | #152 W15 |
| `/sitemap.xml` is empty while indexing is disabled | P18 final QA | `search-exposure-http-smoke.ts` | — covered at HTTP level | #152 W15 |
| `/sitemap.xml` lists only current visible in-shop products and published collections | `tests/database/search-sitemap-repository.test.ts` | `search-exposure-http-smoke.ts` | — covered at HTTP level | #152 W15 |
| `X-Robots-Tag` and `<meta robots>` noindex on HTML while indexing is disabled | `tests/domain/search-exposure.test.ts`; P18 final QA | `search-exposure-http-smoke.ts` | — covered at HTTP level | #152 W15 |
| Query-state, utility and cart HTML stay noindex when indexing is enabled | `tests/domain/search-exposure.test.ts` | `search-exposure-http-smoke.ts` | — covered at HTTP level | #152 W15 |
| Rollback to indexing-disabled restores noindex without stranding URLs behind `robots.txt` | — | `search-exposure-http-smoke.ts` | — covered at HTTP level | #152 W15 |
| Catalog pagination canonical / noindex states | `tests/domain/crawl-indexation.test.ts`, `tests/domain/catalog-listing-metadata.test.ts` | — | — covered by the catalog indexation runtime workflow | #152 P15 |
| PDP title/description/canonical/OG/Twitter from published copy | `tests/domain/product-metadata.test.ts` | `product-metadata-http-smoke.ts` | — covered at HTTP level | #152 W2 |
| PDP metadata stays unique for duplicate published copy and duplicate names | `tests/domain/product-metadata.test.ts` (U4 adds database-level collision evidence) | `product-metadata-http-smoke.ts` | — covered at HTTP level | #152 W2a / U4 |
| Branded fallback social image resolves as a real PNG | — | `product-metadata-http-smoke.ts` | — covered at HTTP level | #152 W2 |
| Canonical withheld and OG origin correct on the noindex temporary host | `tests/domain/product-metadata.test.ts` | `product-metadata-http-smoke.ts` | — covered at HTTP level | ADR 0004 |
| Product / Offer / BreadcrumbList / Organization / WebSite JSON-LD | `tests/domain/structured-data.test.ts`; P18 final QA | `structured-data-http-smoke.ts` | — covered at HTTP level | #152 W4 |
| `ProductGroup` + per-variant `Product`/`Offer`, exact U12 variant URL, exact price and availability | `tests/domain/storefront-structured-data-boundary.test.ts` | `structured-data-http-smoke.ts` | — covered at HTTP level, including reopening each published variant URL | #152 W4d (U27) |
| JSON-LD refuses invented facts and `AggregateOffer`, and refuses `ProductGroup` without a publishable addressable variant family | `tests/domain/structured-data.test.ts`, `tests/domain/storefront-structured-data-boundary.test.ts` | `structured-data-http-smoke.ts` | — covered at HTTP level | #152 W4 / W4d |
| Current slug 200 / historical slug exact 301 / unknown slug 404 | `tests/domain/product-slug.test.ts`, `tests/database/product-slug-repository.test.ts` | `product-slug-http-smoke.ts` | — covered at HTTP level | #152 P6 |
| Security headers survive the slug redirect and 404 paths | `tests/integrations/security-headers.test.ts` | `product-slug-http-smoke.ts` | — covered at HTTP level | #152 P6 |
| **Temporary production host cannot enable indexing** | Domain-level only, in `tests/domain/search-exposure.test.ts` once U1 lands | — | **Missing either way.** No CI step asserts `pnpm release:check` *fails* for `APP_DOMAIN=la.lanadesign.vn` with `SEARCH_INDEXING_ENABLED=true`; the preflight step only exercises the passing configuration. | **U13 / W15b** |
| **Indexing-enabled HTML on the temporary host** | Domain-level only, in `tests/domain/search-exposure.test.ts` once U1 lands | — | **Missing either way.** The enabled phase of `search-exposure-http-smoke.ts` runs against `shop.example.com`; no HTTP gate proves the temporary host still emits noindex when a deployment mistakenly sets `SEARCH_INDEXING_ENABLED=true`. | **U13 / W15b** |
| **Unknown product slug returns branded HTML 404, not `text/plain`** | — | `product-slug-http-smoke.ts` asserts status 404 only | **Missing.** No gate asserts the response is navigable HTML. This is finding W14b's contract; the gate belongs with it. | **U30 / W14b** |
| **Root OG/Twitter fallback tags** | — | — | **Missing** — the tags do not exist yet. Finding W8. | **U30 / W8** |
| **Self-canonical for `/`, `/collections`, `/lookbook` when indexing is enabled** | — | — | **Missing** — the behaviour does not exist yet. Finding W10. | **U30 / W10** |

## What U13 / W15b should and should not do

Wire, because the signal has no runtime gate at all:

1. a negative `release:check` case proving the temporary-host indexing block fails closed;
2. an HTTP case proving the temporary host stays noindex even when a deployment requests indexing.

Both are cheap: the first is an environment-only assertion, and the second is one additional server
restart phase inside the existing `search-exposure-http-smoke.ts` rather than a new script.

Do **not** wire:

- a dedicated npm script or workflow step per smoke. All five already run once per PR through
  `pnpm test`; adding a second invocation would double the slowest part of CI and prove nothing new.
- a consolidated "SEO runtime" command that re-runs those same five scripts. W15 permits one only if
  it reduces duplication and clarifies ownership. It would currently do neither.

The three signals owned by U30 (W8, W10, W14b) get their gates with the behaviour they describe, not
here — there is nothing to assert until those behaviours exist.

## Note on the P18 final QA workflow

P18 runs a production build under Playwright and inspects noindex metadata, canonical absence,
parent `Product` JSON-LD, `OAI-SearchBot` in `robots.txt` and the empty sitemap. It overlaps the
smokes deliberately: it is the only gate that observes those signals on a **production** build
rather than a dev server. Its triggers are `pull_request` and `workflow_dispatch`, so it is not a
push gate on `main`.
