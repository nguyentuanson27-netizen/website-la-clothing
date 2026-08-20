# P10: Shop, Collections, and PDP Merchandising

## Overview

Task P10 productizes the storefront discovery, collections landing pages, and product detail pages (PDP) around real product media, published editorial copy, server-authoritative price and availability, mandatory Size, optional Color, and semantic breadcrumbs.

### 1. Merchandising Architecture

- **Shop Discovery (`src/app/shop/page.tsx`)**:
  - Full server-filtered catalog discovery with query, collection, color, size, price range, availability, and sort options.
  - Renders real product cards using `StorefrontProductCard` with trusted primary media and crawlable PDP links.
  - Explicit empty/no-match states with reset filter action.

- **Collections Landings (`src/app/collections/[slug]/page.tsx`)**:
  - Resolves published collection definitions via `findPublishedBySlug(slug)`.
  - Semantic breadcrumb navigation (`Trang chủ` → `Collections` → `{collection.title}`).
  - Product grid with real media passed via `media={product.media}` to `StorefrontProductCard`.
  - Deliberate empty state when no products belong to the collection.

- **Product Detail Page (`src/app/shop/[slug]/page.tsx`)**:
  - Semantic breadcrumb navigation (`Trang chủ` → `Shop` → `{product.name}`).
  - Real media gallery via `ProductGallery` with primary and thumbnail carousel.
  - Published editorial copy, size guide, and care instructions (or intentional fallback).
  - Collection tags linking to public collections (`/collections/${collectionSlug}`).
  - Server-authoritative purchase panel with mandatory Size and optional Color when multi-color variants exist.

### 2. Trust Boundaries & Rules

- **Price & Stock**: Server-authoritative calculation; no client trust for retail price or exact stock quantities.
- **Purchase Rules**: Mandatory Size selection before "Add to Bag" enables; server re-verifies inventory during mutation.
- **Publication Boundary for Collections**:
  - PDP collection badges only resolve and render published `CollectionDefinition` rows (`isPublished: true`) with website-owned authentic titles; draft/unpublished collections are omitted to prevent 404 links.
  - Shop discovery facets only expose collection slugs that belong to published `CollectionDefinition` records and published `ProductContent`.
  - Shop collection filter (`/shop?collection=...`) requires `pc.status = 'PUBLISHED'` and an existing published `CollectionDefinition` (`isPublished = TRUE`), guaranteeing draft memberships never affect public storefront discovery.
- **Links**: All internal links strictly guarded by `tests/integrations/homepage-links.test.ts`.

### 3. Verification Evidence

- `tests/database/storefront-catalog.test.ts`: PASS (verifies only published collection definitions are exposed on product detail and facets).
- `tests/database/storefront-discovery.test.ts`: PASS (verifies discovery search, same-variant filters, and publication-aware collection filtering).
- `tests/integrations/homepage-links.test.ts`: PASS (100% internal links verified).
- `tests/a11y-runtime/editorial.spec.ts`: PASS (Full flow: Homepage → Lookbook → Collections → Collection Landing → PDP → Add to Bag verified on 390px mobile and desktop with 0 Axe violations and 0 horizontal overflow).
