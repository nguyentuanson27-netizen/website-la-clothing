# Storefront media rendering & CSP contract (P4)

Status: **P4 storefront media rendering implemented on branch `build/p4-storefront-media`. Ready for review.**

This document describes the presentation-layer integration of trusted product photography on catalog cards and the PDP gallery, introduced in FINAL PLAN V2 Task P4.

## Architectural Boundary

Task P4 consumes the pure in-memory trusted media resolver established in Task P3 ([`src/commerce/product-media.ts`](file:///d:/weblaclothing/src/commerce/product-media.ts)) and connects it to Next.js image optimization and buyer-facing App Router views.

- **Render Trust Policy**: All image URLs passed to `next/image` originate strictly from `resolveStorefrontProductMedia()`, guaranteeing HTTPS, exact origin `https://content.pancake.vn`, structural path shape `/:segment/:id/:id/:id/:file.jpg` with strict lowercase `.jpg`, no credentials/ports/traversal, candidate scan limits (100), and gallery cardinality caps (12).
- **Network / CSP Boundary**:
  - `next.config.mjs` configures `images.remotePatterns` with minimal allowlist: `protocol: "https"`, `hostname: "content.pancake.vn"`, `port: ""`, and `pathname: "/*/*/*/*/*.jpg"`.
  - P3 resolver and P4 optimizer allowlists maintain 100% contract congruence (strictly lowercase `.jpg`, rejecting uppercase `.JPG`, custom ports, or unreviewed paths).
  - Content Security Policy (CSP) headers declare `img-src 'self' blob: data: https://content.pancake.vn;`.
- **Editorial Separation**: P4 does not introduce admin editing or alter website-owned copy (deferred to Task P5).
- **Slug Policy**: P4 renders existing product URLs (deferred to Task P6).

---

## Component Presentation & Fallbacks

### 1. Catalog Cards ([`StorefrontProductCard`](file:///d:/weblaclothing/src/components/commerce/storefront-product-card.tsx) & [`ProductCard`](file:///d:/weblaclothing/src/components/commerce/product-card.tsx))
- Renders trusted `primaryImage` with responsive `sizes="(min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw"` and semantic alt text.
- Fallback: When no trusted image exists or media fails closed, renders `.garment-silhouette` without broken image frames or layout shifts.

### 2. Product Detail Page Gallery ([`ProductGallery`](file:///d:/weblaclothing/src/components/commerce/product-gallery.tsx))
- **0 Images (Missing / Untrusted)**: Renders intentional placeholder with `.garment-silhouette` and status message: *"Hình ảnh sản phẩm đang được chuẩn hóa cho storefront."*
- **1 Image**: Renders single high-resolution image with `sizes="(min-width: 1024px) 50vw, 100vw"` and `preload`, omitting redundant thumbnail controls or carousel indicators.
- **Multiple Images (>1)**: Renders active hero image plus accessible thumbnail navigation bar (`aria-pressed`, `aria-label`, keyboard focusable, VoiceOver compatible).

---

## Verification Evidence

### Pre-Implementation RED Evidence
```
✖ next.config.mjs includes content.pancake.vn in CSP img-src (4.7776ms)
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /img-src\s+[^;]*https:\/\/content\.pancake\.vn/.

✖ next.config.mjs configures minimal images.remotePatterns for content.pancake.vn (12.635ms)
AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value: assert.ok(nextConfig.images)

✖ next.config.mjs configures minimal images.remotePatterns for content.pancake.vn (1.4077ms)
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: undefined !== ''
```

### Post-Implementation GREEN Evidence
- `tests/domain/storefront-product-media-rendering.test.ts`: Passes all 5 unit tests verifying CSP allowlisting, narrow remotePatterns (port: '', pathname: '/*/*/*/*/*.jpg'), card/PDP media resolution, and P3/P4 contract congruence.
- `tests/domain/product-media.test.ts`: Passes all 11 unit tests verifying lowercase `.jpg` acceptance, uppercase `.JPG` fail-closed rejection, scan limits, and deduplication.
- `tests/a11y-runtime/storefront-media.spec.ts`: Passes all 6 runtime browser scenarios:
  1. Storefront catalog card renders trusted primary photography and fallback on untrusted media.
  2. PDP with single trusted image renders hero image without redundant thumbnail controls.
  3. PDP with multiple images renders interactive gallery, handles click and keyboard thumbnail switching (hero alt transitions deterministically: `Ảnh 1` $\rightarrow$ `Ảnh 2` $\rightarrow$ `Ảnh 3`), and records VoiceOver screen reader output.
  4. PDP with untrusted media renders intentional fallback without broken image.
  5. Desktop viewport (1440x900) renders catalog cards and PDP gallery without horizontal overflow.
  6. Runtime network and CSP headers enforce Pancake media allowlist and reject unreviewed optimizer requests (unreviewed path, custom port, uppercase `.JPG` return HTTP 400).
- `tests/integrations/security-headers.test.ts`: Passes assertion that `img-src` contains `https://content.pancake.vn`.
- Repository test runner: 300 passed / 0 failed.
- TypeScript (`tsc --noEmit`): 0 errors.
- ESLint (`eslint .`): 0 errors.
- Next.js Production Build (`next build`): 18/18 static and dynamic routes compiled successfully.
