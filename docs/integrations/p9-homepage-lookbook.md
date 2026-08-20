# P9: Homepage & Lookbook Merchandising

## Overview

Task P9 replaces static/abstract placeholders on the Homepage and Lookbook with real merchandise, crawlable links, factual editorial copy, and graceful degradation states.

### 1. Merchandising Architecture

- **Homepage (`src/app/page.tsx`)**:
  - `loadHomepageProductEdit()`: Loads up to 4 real products from the configured storefront catalog mirror with `PancakeConfigError` safety.
  - Featured product cards rendered via `StorefrontProductCard` with trusted primary photography (`media.primary`) and crawlable PDP links (`/shop/${product.slug}`).
  - Semantic empty state `[data-ui-state="empty"]` when no products are present.
  - Category navigation linking to crawlable filtered shop destinations (`/shop?category=*`).

- **Lookbook (`src/app/lookbook/page.tsx`)**:
  - `loadLookbookProducts()`: Queries real products from the catalog mirror.
  - Features real pieces in the `"Featured pieces"` editorial section with `StorefrontProductCard`.
  - Narrative styling chapters ("MORNING / TRANSIT", "LATE / RETURN") with factual copy and crawlable links to `/shop` and PDPs.

### 2. Link Guarding & Trust Boundaries

- All internal links in `page.tsx`, `lookbook/page.tsx`, `site-header.tsx`, and `site-footer.tsx` are strictly guarded by `tests/integrations/homepage-links.test.ts` to ensure every link resolves to an implemented Next.js App Router route.
- No invented product facts, fake claims, or arbitrary external image endpoints.

### 3. Verification Evidence

- `tests/integrations/homepage-links.test.ts`: PASS (100% internal links verified).
- `tests/a11y-runtime/editorial.spec.ts`: PASS (Homepage & Lookbook render real merchandise, crawlable links, responsive layouts, 0 horizontal overflow, 0 Axe WCAG 2.1 AA violations).
