# Pancake catalog live audit (P0)

Status: **trusted-local implementation available; full live aggregate evidence must be captured and reviewed before P0 is complete.**

This audit is the read-only discovery gate for FINAL PLAN V2 P0. It does not authorize P1+ mappings and does not mutate Pancake.

## Command

Use an ignored local `.env.local` containing the existing server-only `PANCAKE_API_KEY`, `PANCAKE_SHOP_ID`, and `DATABASE_URL`, then run:

```bash
pnpm pancake:catalog:audit
```

The command deliberately refuses execution when `CI` or `GITHUB_ACTIONS` is enabled. Do not copy raw Pancake API payloads into GitHub issues, PR comments, logs, artifacts, or commits.

## Current-catalog scope

P0 needs evidence for the **current LA Clothing storefront catalog**, not every historical/internal row returned by Pancake.

The trusted-local command therefore reads the website mirror database first and builds the current scope from:

- `ProductMirror`: configured `pancakeShopId` + `isPresent = true` + `isActive = true`;
- `VariantMirror`: `isPresent = true` + `isActive = true` whose parent product is also current for that shop.

This is a read-only website-owned publication scope. The audit does **not** invent undocumented Pancake active/sellable semantics from `is_hidden`, `is_locked`, stock, categories, or other source flags.

The Pancake variations endpoint is still traversed in full so raw pagination and identity integrity can be checked. Current evidence is then restricted as follows:

- `note_product`, product primary image, and category assignments count only current products;
- variation image evidence counts only current variants;
- inactive variations belonging to a current product may contribute repeated product-level source facts, but their variation images are excluded;
- historical/non-current products contribute no trusted media/content/category-assignment evidence;
- every current product/variation ID from the mirror must still be present in the Pancake source traversal, otherwise the audit fails closed.

## Network boundary

The audit makes only bounded `GET` requests to:

- `/shops/{SHOP_ID}/products/variations`, paginated at 100 rows per page;
- `/shops/{SHOP_ID}/categories`.

It does **not**:

- create/update/cancel orders;
- update products, stock, categories, or any other Pancake state;
- mutate the website database;
- download or fetch any product image URL;
- introduce a remote-image proxy;
- expose the Pancake API key to browser code.

Catalog traversal is capped at 500 pages / 50,000 raw source entries. Current mirror scope is capped at 50,000 products and 50,000 variations. Category traversal is capped at 10,000 nodes and depth 32. Image-reference inspection is capped at 100,000 references. External identifiers, category text, `note_product`, and image URLs also have explicit processing bounds before hashing or parsing.

The raw traversal rejects duplicate `variation.id` values, including duplicates that appear on different pages. Stable `total_entries` / `total_pages` checks remain separate safeguards and do not replace identity uniqueness.

## Sanitized output

The JSON between `PANCAKE_CATALOG_AUDIT_BEGIN` and `PANCAKE_CATALOG_AUDIT_END` separates raw-source diagnostics from trusted current-catalog evidence:

- `source.rawVariationEntries`: number of rows returned by the complete Pancake `/products/variations` traversal;
- `currentCatalog.products`: current product count plus `note_product` present / absent / malformed counts and coverage percentage;
- `currentCatalog.variations.total`: number of current website-mirror variations;
- `currentCatalog.images`: image-reference counts, unique `scheme + hostname` origins, conservative path shapes, and invalid-reference counts for current catalog media only;
- `currentCatalog.categories`: source-tree shape plus category-assignment coverage measured against current products only.

Conservative media path shapes retain only generic infrastructure path tokens; unknown segments become `:segment`, dynamic-looking segments become `:id`, and image filenames become `:file.<ext>`.

`source.rawVariationEntries` is deliberately **not** the number of storefront-active variants. Raw Pancake rows may include historical/internal entries. Trusted P3 allowlist evidence must come only from `currentCatalog.images`.

The audit treats top-level `variation.product_id` as the canonical product identity for this endpoint and does not require a nested `product.id`. The category tree uses Pancake's observed `text` field as its display label for duplicate-shape analysis; category text is never emitted in the report.

The category classification is **not** an SEO taxonomy decision. A flat tree is not automatically considered defective: depth is evidence only. `unusable` is reserved for duplicate category IDs or current assignment references that do not resolve to the returned category tree; `partial` covers duplicate normalized text or incomplete current-product assignment coverage. Pancake categories remain candidate/source taxonomy only; website collections remain website-owned.

If both observed assignment locations exist on one current product source row and disagree, the audit fails closed rather than guessing which source is authoritative. Numeric category IDs and their equivalent numeric-string representation are normalized only for equality checks in the audit report.

## Data minimization

The report never intentionally emits:

- `Product.note`;
- `Product.note_product` contents;
- product names;
- category text;
- product/category/variation identifiers;
- inventory quantities;
- image query strings, fragments, usernames/passwords, or full image URLs;
- API credentials or raw API failures.

Product identifiers, category identifiers, `note_product`, and repeated current product-source facts are compared in memory only. Raw Pancake payloads are not persisted by the audit.

## P0 evidence gate

P0 remains incomplete until a trusted local run establishes and a reviewer accepts the current LA Clothing values for:

1. `currentCatalog.products` `note_product` coverage;
2. `currentCatalog.images` schemes/hostnames/path shapes and invalid-reference counts;
3. `currentCatalog.categories` tree quality, observed assignment source location(s), and current-product assignment coverage.

Only the sanitized aggregate block should be retained for review. P1/P3 must not infer or trust live content/media/category facts before this gate is closed.
