# P13 — PDP metadata and media SEO

Status: implemented in PR #82; human merge approval pending.

## Scope

P13 adds product-detail metadata without changing PDP commerce/UI behavior:

- dynamic title and meta description;
- canonical URL when P12 search exposure is enabled;
- Open Graph + Twitter card metadata;
- trusted product primary media used directly when available;
- website-owned branded fallback social PNG when trusted product media is absent;
- rendered-head/runtime regression coverage.

P13 does **not** implement JSON-LD/breadcrumb schema (P14), crawl architecture (P15), a dedicated production domain, or indexing enablement. `la.lanadesign.vn` remains staging/non-indexable under the P12 gate.

## Metadata ownership and fallback contract

Published website-owned `ProductContent.seoTitle` and `ProductContent.seoDescription` remain the preferred public SEO fields. Draft/reviewed editorial content is not exposed by the storefront projection.

When either published SEO field is absent, the fallback stays factual and deterministic:

- title: `<product name> — <website-owned canonical slug>`;
- description: `Thông tin sản phẩm <product name> tại LA Clothing — /shop/<slug>.`;

The canonical slug is the discriminator because `ProductMirror.name` is not unique. This keeps same-name products distinct without inventing material, fit, origin, ratings, discounts, or other unverified product facts.

## Canonical and staging behavior

P13 reuses P12 `readSearchExposure()` as the sole site-origin/indexing authority.

- enabled public origin: emit exact canonical `/shop/<current-slug>`;
- staging/local or disabled indexing: withhold the canonical tag;
- Open Graph URL still describes the browsed product URL using the server-owned origin;
- P12 root meta/X-Robots noindex remains authoritative on staging;
- unknown/historical/current slug HTTP behavior remains owned by P6 Proxy resolution.

Request `Host` is never used to construct canonical/social URLs.

## Social media contract

`StorefrontProductMedia.primary` is already downstream of the strict trusted Pancake media resolver. P13 consumes that trusted projection only; it does not accept raw Pancake image fields and does not introduce an image proxy/storage rewrite.

If trusted primary media exists:

- `og:image` and `twitter:image` use the exact trusted HTTPS Pancake URL;
- alt text comes from the trusted storefront media projection.

If no trusted primary exists:

- metadata points to `/la-clothing-modern-menswear-social-card.png` on the validated website origin;
- that route is website-owned and generates a branded 1200×630 PNG with Next.js `ImageResponse`;
- the fallback route is forced static because its output is invariant.

## TDD / review evidence

- RED CI #972 on `caefd187e2a8a5140843d2eb9543ffb76bb1e52e`: typecheck failed because `src/seo/product-metadata.ts` did not exist.
- Review ID **4989394945**: Request changes — 0 Critical / 3 Required / 0 Optional.
  - fallback title/description were not unique for same-name products;
  - branded fallback path had no resolving image/runtime proof;
  - exact-head CI #974 failed typecheck because the test read `.url` from the Next.js image union without narrowing.
- Review fixes add a same-name/different-slug regression, complete-image-value assertions, a website-owned fallback PNG route, and real rendered-head/image-resolution HTTP coverage.
- Candidate CI #984 on `b480d978293c7aa264e5e8eea16ca61b61892e51` passed typecheck, Domain HTTP regression, build, shipping policy, and release preflight; VPS #213 passed the full container gate. A later docs/performance commit changes the final SHA, so these runs are supporting evidence only, not the final exact-head authority.

## Runtime regression coverage

The P13 HTTP smoke seeds real storefront rows and verifies through a real Next dev server:

- published SEO title/description render in `<head>`;
- canonical, `og:url`, `og:image`, and `twitter:image` use the server-owned public origin/trusted image;
- trusted Pancake image URLs are not rewritten;
- two products sharing the same name but different slugs render distinct fallback title/description and slug-specific canonicals;
- fallback social PNG returns HTTP 200 with `image/png`;
- unknown product slug remains exact 404 with no canonical;
- staging PDP remains browseable with noindex and no canonical.

## Rollback

P13 introduces no database migration and no new external dependency. Rollback is the code revert of the metadata layout/helper/social-image route. P12 search exposure remains independently fail-closed throughout rollback.
