# P9: Homepage & Lookbook Merchandising

## Overview

Task P9 replaces static/abstract placeholders on the Homepage and Lookbook with real merchandise, trusted photography, crawlable links, factual editorial copy, and intentional graceful degradation states.

### 1. Merchandising Architecture

- **Homepage (`src/app/page.tsx`)**:
  - `loadHomepageProductEdit()`: Loads up to 4 real products from the configured storefront catalog mirror with `PancakeConfigError` safety.
  - Hero campaign visual: Renders real trusted photography (`featuredProducts[0]?.media?.primary`) with responsive Next.js `<Image>` sizes (`(min-width: 900px) 60vw, 100vw`). Degrades to intentional text fallback when no trusted media exists (no abstract `.campaign-figure` silhouettes).
  - Featured product cards rendered via `StorefrontProductCard` with trusted primary photography (`media.primary`) and crawlable PDP links (`/shop/${product.slug}`).
  - Lookbook grid preview: Renders real product photography (`featuredProducts[1]`, `featuredProducts[2]`) with crawlable link to `/lookbook`.
  - Collection intro: Factual editorial description with crawlable link to `/collections`.
  - Semantic empty state `[data-ui-state="empty"]` when no products are present.
  - Category navigation linking to crawlable filtered shop destinations (`/shop?category=*`).

- **Lookbook (`src/app/lookbook/page.tsx`)**:
  - `loadLookbookProducts()`: Queries real products from the catalog mirror.
  - Chapter visual panels: Renders real trusted photography from featured products (`featuredProducts[0]`, `featuredProducts[1]`) with Next.js `<Image>`. Degrades to intentional fallback when missing (no `.lookbook-figure` shapes).
  - Features real pieces in the `"Featured pieces"` editorial section with `StorefrontProductCard`.
  - Narrative styling chapters ("MORNING / TRANSIT", "LATE / RETURN") with factual copy and crawlable links to `/shop` and PDPs.

### 2. Link Guarding & Trust Boundaries

- All internal links in `page.tsx`, `lookbook/page.tsx`, `site-header.tsx`, and `site-footer.tsx` are strictly guarded by `tests/integrations/homepage-links.test.ts` to ensure every link resolves to an implemented Next.js App Router route.
- No invented season/material claims (removed `"Fall / Winter 2026"` and unsupported tailoring claims); all copy is factual and grounded in brand identity.
- No arbitrary external image endpoints; all images adhere strictly to the P3/P4 trusted media allowlist.

### 3. Verification Evidence

- `tests/integrations/homepage-links.test.ts`: PASS (100% internal links verified).
- `tests/a11y-runtime/editorial.spec.ts`: PASS (Homepage & Lookbook render real merchandise, trusted photography, collection links, crawlable PDP links, responsive layouts, 0 horizontal overflow, 0 Axe WCAG 2.1 AA violations).

