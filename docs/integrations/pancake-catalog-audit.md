# Pancake catalog live audit (P0)

Status: **trusted-local implementation available; full live aggregate evidence must be captured before P0 is complete.**

This audit is the read-only discovery gate for FINAL PLAN V2 P0. It does not authorize P1+ mappings and does not mutate Pancake.

## Command

Use an ignored local `.env.local` containing the existing server-only `PANCAKE_API_KEY` and `PANCAKE_SHOP_ID`, then run:

```bash
pnpm pancake:catalog:audit
```

The command deliberately refuses execution when `CI` or `GITHUB_ACTIONS` is enabled. Do not copy raw Pancake API payloads into GitHub issues, PR comments, logs, artifacts, or commits.

## Network boundary

The audit makes only bounded `GET` requests to:

- `/shops/{SHOP_ID}/products/variations`, paginated at 100 rows per page;
- `/shops/{SHOP_ID}/categories`.

It does **not**:

- create/update/cancel orders;
- update products, stock, categories, or any other Pancake state;
- download or fetch any product image URL;
- introduce a remote-image proxy;
- expose the Pancake API key to browser code.

Catalog traversal is capped at 500 pages / 50,000 raw source entries. Category traversal is capped at 10,000 nodes and depth 32. Image-reference inspection is capped at 100,000 references. External identifiers, category text, `note_product`, and image URLs also have explicit processing bounds before hashing or parsing.

## Sanitized output

The JSON between `PANCAKE_CATALOG_AUDIT_BEGIN` and `PANCAKE_CATALOG_AUDIT_END` contains aggregate evidence only:

- unique product count, deduplicated by top-level `variation.product_id`;
- `note_product` present / absent / malformed counts and coverage percentage;
- `source.rawVariationEntries`, meaning the number of rows returned by Pancake's `/products/variations` source traversal;
- image-reference counts and unique `scheme + hostname` origins;
- conservative path shapes where only generic infrastructure path tokens are retained; unknown segments become `:segment`, dynamic-looking segments become `:id`, and image filenames become `:file.<ext>`;
- malformed, credential-bearing, and non-default-port image reference counts;
- category count, root count, maximum depth, normalized-text duplicate count, duplicate-ID count;
- product-category assignment coverage and known/unknown assignment-reference counts;
- observed structural assignment locations (`product.categories` and/or `variation.categories`) without promoting either location into the production source contract;
- mechanical source-taxonomy classification: `usable`, `partial`, `empty`, or `unusable`.

`source.rawVariationEntries` is deliberately **not** named or presented as the number of storefront-active variants. The Pancake source endpoint may contain historical/internal rows, while storefront publication is controlled by website mirror policy (`isPresent`/`isActive`). This P0 probe does not invent a Pancake-side publication filter.

The audit treats top-level `variation.product_id` as the canonical product identity for this endpoint and does not require a nested `product.id`. The category tree uses Pancake's observed `text` field as its display label for duplicate-shape analysis; category text is never emitted in the report.

The classification is **not** an SEO taxonomy decision. A flat tree is not automatically considered defective: depth is evidence only. `unusable` is reserved for duplicate category IDs or assignment references that do not resolve to the returned category tree; `partial` covers duplicate normalized text or incomplete product assignment coverage. Pancake categories remain candidate/source taxonomy only; website collections remain website-owned.

If both observed assignment locations exist on one variation and disagree, the audit fails closed rather than guessing which source is authoritative. Numeric category IDs and their equivalent numeric-string representation are normalized only for equality checks in the audit report.

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

Product identifiers, category identifiers, `note_product`, and repeated product-source facts are compared using in-memory SHA-256 fingerprints where equality is needed. Raw Pancake payloads are not persisted by the audit.

## P0 evidence gate

P0 remains incomplete until a trusted local run establishes the current LA Clothing values for:

1. `note_product` coverage;
2. actual image schemes/hostnames/path shapes and invalid-reference counts;
3. category depth/count/duplicate state, observed assignment source location(s), and product-assignment coverage.

Only the sanitized aggregate block should be retained for review. P1 must not infer missing source facts before this gate is closed.
