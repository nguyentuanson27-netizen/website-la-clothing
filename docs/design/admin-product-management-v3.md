# LA Clothing Admin Product Management V3

Status: **DRAFT SPEC — docs-only; no implementation in this PR**

This spec extends the narrower bulk-status work documented in `docs/design/admin-product-management-v2.md`. It does not rewrite that document or claim runtime behavior beyond what is already merged on `main`.

## Objective

Improve product operations for authenticated admins so routine catalog work can be completed without opening and editing products one by one.

V3 focuses on four operator problems:

1. normal products can have present variants with stock but no admin control to activate those variants;
2. variant activation is split across composite-specific sections instead of one consistent commerce workflow;
3. `/admin` already supports current-page bulk selection, but bulk operations are limited to editorial status;
4. the single-product editor is long and source-heavy, making common commerce/editorial actions slower to reach.

Success means an admin can safely activate normal/composite variants, perform useful bulk product operations, and edit a product from a compact workflow while Pancake-owned source data remains read-only.

## Current truth and constraints

- `/admin` already supports row selection, current-page select-all, indeterminate state, confirmation, and atomic bulk editorial status updates.
- `ProductContent.status` is website-owned and currently supports `DRAFT | REVIEWED | PUBLISHED`.
- collection membership is stored as `ProductContent.collectionSlugs` and collection definitions already have admin resolution/listing paths.
- `ProductMirror.isActive` and `VariantMirror.isActive` are website-owned commerce state, but they are independent values.
- the product editor currently exposes activation controls for relation-linked composite child variants and composite parent variants; ordinary standalone variants remain read-only in the source table.
- Pancake remains authoritative for mirrored source identity, price, inventory, source description, images, and composite source relations.
- Pancake sync must not auto-activate products or variants.
- storefront commerce still decides purchasability from activation, presence, price, inventory, and composite eligibility; this spec does not weaken those guards.

## Decisions already approved

1. Product activation and variant activation remain independent.
2. Activating a variant must not automatically activate its product.
3. Activating a product must not automatically activate its variants.
4. The editor may offer one explicit convenience action: **Bật sản phẩm + kích hoạt biến thể có hàng**.
5. That combined action requires confirmation and must be atomic.
6. Bulk collection operations use **add** and **remove** semantics, never replace-all in V3.
7. Bulk selection remains scoped to the current `/admin` page; no cross-page persistent selection.
8. Price and inventory remain Pancake-owned and are never mutated by these admin actions.
9. No sync-time auto-activation is introduced.
10. Any UI-derived eligibility or warning count is advisory only; privileged mutation decisions must be recomputed from current database truth immediately before writes.

## Feature A — Unified Website Commerce controls

Every product editor must expose one primary `Website commerce` section before long source/editorial details.

The section shows compact product-level state:

- catalog: active/inactive;
- active variants: `X / N`;
- variants with positive stock;
- total mirrored stock;
- collection count.

It provides an explicit product catalog toggle:

- `Bật catalog` when `ProductMirror.isActive=false`;
- `Tắt catalog` when `ProductMirror.isActive=true`.

### Product activation contract

A product catalog mutation must:

- require `ADMIN`;
- bind product identity to the current editor route/server context;
- require the product to still exist and be present;
- recompute current incoming composite membership before writes when enabling catalog;
- mutate only `ProductMirror.isActive`;
- be idempotent;
- never mutate any variant, price, stock, collection, editorial field, Pancake identifier, or composite edge.

For a product that currently has incoming composite membership, the UI must make standalone-publication risk explicit before enabling the product catalog. Variant activation remains available regardless of whether the child product catalog is enabled.

The single-product catalog toggle may still enable a relation-linked child product, but enabling is a **two-phase server confirmation contract**:

1. **Prepare confirmation:** the server reads current publication-warning state and returns the warning plus an opaque server-authenticated confirmation proof bound to the route-owned product, the `enable` operation, and the warning-relevant state the operator is shown.
2. **Commit confirmation:** after the operator confirms, the server re-reads current database state before any write and validates it against that proof.

The warning-relevant state for single-product enable includes at minimum:

- whether the product currently has any persisted incoming composite membership; and
- whether it currently has zero active present variants.

If the product/operation binding is wrong, the proof is missing/invalid/expired, or either warning-relevant state changed after confirmation was prepared, the server must return `RECONFIRM_REQUIRED` (or an equivalent explicit result), perform **zerrites*, and return/render a fresh current warning summary that requires a new operator confirmation. Raw browser-provided booleans/counts/ID sets are not acceptable as the proof. A signed short-lived token or equivalent server-held confirmation nonce is acceptable; no new schema or dependency is required by this spec.

`Tắt catalog` does not require this publication-risk reconfirmation handshake because it reduces standalone publication exposure, but it still performs normal authorization/current-target validation.

The separate combined quick action defined below is stricter and is never allowed for a current composite child.

## Feature B — Generic variant activation for every product

The product editor must expose a single `Biến thể website` table for all present variants, including:

- ordinary standalone variants;
- composite parent variants;
- relation-linked composite child variants.

Composite membership is context only; it must not be required for generic variant activation.

Each row shows at minimum:

- SKU or fallback variant label;
- color;
- size;
- mirrored stock total;
- activation state;
- context badge: `Thường`, `Set cha`, and/or `Thành phần set` when applicable;
- a single-row `Kích hoạt` / `Tắt` action.

Example:

```text
Biến thể website                         1 / 4 hoạt động

[ ] Chọn tất cả   [Chọn biến thể có hàng]

L      Hết hàng       TẮT
M      Hết hàng       TẮT
XL     1 cái          TẮT
XXL    Hết hàng       TẮT

[ Kích hoạt 4 ]   [ Tắt 4 ]
```

### Bulk variant behavior inside one product

The generic browser-selected variant batch limit is **100 unique variants per submitted mutation**. The repository does not establish a `<=100 variants per product` invariant, so the UI must not imply that an arbitrarily large product can be submitted as one selected batch.

For products with **100 or fewer** present variants, the editor supports:

- select/deselect individual variants;
- `Chọn tất cả biến thể` for the whole product;
- `Chọn biến thể có hàng` for all current variants whose summed mirrored stock is greater than zero;
- activate selected variants;
- deactivate selected variants;
- clear selection;
- accessible selected-count feedback.

For products with **more than 100** present variants, the variant table is divided into deterministic pages/windows of at most 100 variants using the existing stable editor order (`color`, `size`, then `id`). In this mode:
