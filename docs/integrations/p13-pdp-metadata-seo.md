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

P13 does **not** implement JSON-LD/breadcrumb schema (P14), crawl architecture (P15), or permanent-domain indexing enablement. Under ADR 0004, `la.lanadesign.vn` serves as temporary production with `SEARCH_INDEXING_ENABLED=false` under the P12 gate.

## Metadata ownership and uniqueness contract

Published website-owned `ProductContent.seoTitle` and `ProductContent.seoDescription` remain the preferred editorial SEO copy. Draft/reviewed editorial content is not exposed by the storefront projection.

`ProductContent` does not enforce cross-product uniqueness for those optional fields. Therefore the final public metadata keeps the published copy as its base and always adds a deterministic website-owned canonical discriminator:

- published title: `<published seoTitle> — <website-owned canonical slug>`;
- published description: `<published seoDescription> — /shop/<slug>.`;
- fallback title: `<product name> — <website-owned canonical slug>`;
- fallback description: `Thông tin sản phẩm <product name> tại LA Clothing — /shop/<slug>.`.

This guarantees distinct current product slugs produce distinct title/description metadata without inventing material, fit, origin, ratings, discounts, or other unverified product facts. P13 deliberately does not add a database uniqueness constraint or publication transaction because that would widen the website-owned editorial persistence model beyond this metadata slice.

## Canonical and indexing-disabled behavior

P13 reuses P12 `readSearchExposure()` as the sole site-origin/indexing authority.

- enabled public origin: emit exact canonical `/shop/<current-slug>`;
- staging/local or disabled indexing (including temporary production on `la.lanadesign.vn`): withhold the canonical tag;
- Open Graph URL still describes the browsed product URL using the server-owned origin;
- P12 root meta/X-Robots noindex remains authoritative while indexing is disabled;
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
- Those fixes added same-name/different-slug regression coverage, complete image-value assertions, a website-owned fallback PNG route, and real rendered-head/image-resolution HTTP coverage.
- Review ID **4990244046**: Request changes — 0 Critical / 1 Required / 0 Optional.
  - published `seoTitle` / `seoDescription` could still collide across distinct products because the metadata builder used them verbatim and persistence does not prove uniqueness.
- RED CI #989 on `05ae5293347ade2f28eb23ad3d7ae3d2d5f084fc` proved the new contract before the production fix:
  - unit regression expected `Áo Oxford Relaxed nam — ao-oxford-relaxed-den` but received the undiscriminated published title;
  - real Next head smoke likewise failed because the published title lacked its canonical slug discriminator;
  - P6 and P12 HTTP regressions remained green.
- GREEN candidate CI #992 on `85f8cd0d33d28da708f34c2038cc8000f1164fc8` passed the full verify job through Domain/runtime regression, build, release preflight, and production start; VPS #221 passed the full container gate. These are supporting behavior evidence because this documentation commit changes the final SHA.

## Runtime regression coverage

The P13 HTTP smoke seeds real storefront rows and verifies through a real Next dev server:

- two distinct PUBLISHED products sharing the same provided SEO title/description render unique slug-discriminated title/description metadata and slug-specific canonicals;
- published website-owned SEO copy remains the base of title/description metadata;
- canonical, `og:url`, `og:image`, and `twitter:image` use the server-owned public origin/trusted image;
- trusted Pancake image URLs are not rewritten;
- two products sharing the same name but different slugs render distinct fallback title/description and slug-specific canonicals;
- fallback social PNG returns HTTP 200 with `image/png`;
- unknown product slug remains exact 404 with no canonical;
- staging PDP remains browseable with noindex and no canonical.

## Rollback

P13 introduces no database migration and no new external dependency. Rollback is the code revert of the metadata layout/helper/social-image route and its uniqueness discriminator. P12 search exposure remains independently fail-closed throughout rollback.
