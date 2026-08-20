# Pancake product source mirror persistence

Status: **P2 source mirror foundation implemented on branch `build/p2-source-mirror`. Ready for Checkpoint A review.**

This document defines the persistence and synchronization boundary for Pancake product-level source fields (`sourceDescription` and `primaryImageUrl`) introduced in FINAL PLAN V2 Task P2.

## Persistence Model

`ProductMirror` persists Pancake-owned source attributes alongside core catalog identity:

- `ProductMirror.sourceDescription`: `TEXT` (nullable), populated from Pancake `note_product`.
- `ProductMirror.primaryImageUrl`: `TEXT` (nullable), populated from Pancake `product.image`.

### Database Schema

Added via migration `20260820030000_add_product_mirror_source_content`:

```sql
-- AlterTable
ALTER TABLE "ProductMirror"
  ADD COLUMN "sourceDescription" TEXT,
  ADD COLUMN "primaryImageUrl" TEXT;
```

## Synchronization & Isolation Semantics

1. **Strict parsed contract required at persistence boundary**:
   - `CatalogMirrorWriter.syncSnapshot()`, `validateCatalogSnapshot()`, and `syncSnapshot()` strictly require `PancakeParsedCatalogVariation[]` where `sourceDescription: string | null` and `primaryImageUrl: string | null` are required properties.
   - Omission (`undefined`) is not permitted at the persistence boundary. Explicit `null` is the only valid signal that Pancake has cleared a source attribute.

2. **Pancake is operational source of truth for source facts**:
   - Every catalog sync idempotently converges `ProductMirror.name`, `ProductMirror.sourceDescription`, and `ProductMirror.primaryImageUrl` with the latest Pancake payload.
   - When Pancake updates or clears (`null`) these fields, the changes are written directly to `ProductMirror`.

3. **Website-owned `ProductContent` is strictly isolated and preserved**:
   - `ProductContent` stores website-owned editorial copy and search metadata: `editorialDescription`, `careInstructions`, `sizeGuide`, `seoTitle`, `seoDescription`, and `collectionSlugs`.
   - Repeated catalog syncs update only `ProductMirror` and **NEVER** touch, mutate, or overwrite `ProductContent`.
   - Admin and storefront layers treat `ProductMirror.sourceDescription` purely as read-only source input/context, not website editorial authority.

4. **Stale and deactivated product semantics**:
   - Products omitted from subsequent Pancake syncs transition to `isPresent = false` and `isActive = false`, along with all their variants.
   - Both the source fields (`sourceDescription`, `primaryImageUrl`) on `ProductMirror` and the associated `ProductContent` row are preserved intact across stale transitions.

5. **Multi-variant consistency in snapshots**:
   - `validateCatalogSnapshot` ensures that all variations for a given `pancakeProductId` share identical product presentation (`name`, `sourceDescription`, `primaryImageUrl`). Inconsistent payloads reject before any database transaction runs.

6. **Private internal notes boundary**:
   - `Product.note` remains private forever and is neither parsed nor stored in `ProductMirror`.

## Verification Evidence

### Pre-Implementation RED Evidence (observed on base `b26b257d91d5c44c153c721fed4bd02ec9b1355b`)

1. **Domain Test Failure (`tests/domain/catalog-mirror-snapshot-validation.test.ts`)**:
   ```
   file:///D:/weblaclothing/tests/domain/catalog-mirror-snapshot-validation.test.ts:4
   import { validateCatalogSnapshot } from "../../src/commerce/catalog-mirror-repository.ts";
            ^^^^^^^^^^^^^^^^^^^^^^^
   SyntaxError: The requested module '../../src/commerce/catalog-mirror-repository.ts' does not provide an export named 'validateCatalogSnapshot'
   ✖ tests/domain/catalog-mirror-snapshot-validation.test.ts (failed)
   ```

2. **TypeScript Compiler Rejection (`tsc --noEmit`)**:
   ```
   tests/database/catalog-mirror-repository.test.ts(264,29): error TS2339: Property 'sourceDescription' does not exist on type '{ ... }'.
   tests/database/catalog-mirror-repository.test.ts(265,29): error TS2339: Property 'primaryImageUrl' does not exist on type '{ ... }'.
   tests/domain/catalog-mirror-snapshot-validation.test.ts(4,10): error TS2305: Module '"../../src/commerce/catalog-mirror-repository.ts"' has no exported member 'validateCatalogSnapshot'.
   ```

3. **Database Schema Smoke Failure (`tests/database/schema-smoke.test.ts`)**:
   - `information_schema.columns` query failed to find `sourceDescription` and `primaryImageUrl` columns on unmigrated `ProductMirror` table.

### Post-Implementation GREEN Evidence (current HEAD `build/p2-source-mirror`)

- `tests/domain/catalog-mirror-snapshot-validation.test.ts`: Passes all 4 tests (multi-variant grouping, presentation consistency enforcement, and explicit null handling).
- `tests/database/catalog-mirror-repository.test.ts`: Passes idempotent persistence of source fields, isolation of `ProductContent` during Pancake source updates, snapshot consistency rejections, explicit null clearing, and whole-product stale deactivation preservation.
- `tests/database/schema-smoke.test.ts`: Passes migration deployment verification of `sourceDescription` and `primaryImageUrl` nullable text columns on `ProductMirror`.
- Full repository test runner: 273 passed / 0 failed.
- TypeScript (`tsc --noEmit`): 0 errors.
- ESLint (`eslint .`): 0 errors.
- Next.js Production Build (`next build`): 18/18 static and dynamic routes compiled successfully.


