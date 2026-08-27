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

The single-product catalog toggle may still enable a relation-linked child product after an explicit warning and confirmation. The separate combined quick action defined below is stricter and is never allowed for a current composite child.

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

The editor must support:

- select/deselect individual variants;
- select/deselect all variants in the current product;
- select variants whose current summed mirrored stock is greater than zero;
- activate selected variants;
- deactivate selected variants;
- clear selection;
- accessible selected-count feedback.

Maximum batch size: **100 unique variants**.

### Generic variant mutation contract

The server-side variant mutation must:

- require `ADMIN`;
- accept `1..100` unique variant IDs;
- reject empty, duplicate, malformed, or oversized input before writes;
- bind `productId` to the current editor route/server context rather than trusting a hidden product ID;
- verify every requested variant belongs to that product;
- verify every requested variant is still `isPresent=true`;
- mutate only `VariantMirror.isActive`;
- apply atomically: all targets update or none update;
- allow idempotent updates;
- never infer ownership or composite relationships from product name, slug, SKU, color, or size.

A mixed valid/invalid batch must result in zero updates.

## Feature C — Combined quick action

For ordinary products, the editor offers:

**Bật sản phẩm + kích hoạt biến thể có hàng**

Before execution, show a confirmation describing the exact current effect, for example:

```text
Sẽ bật catalog sản phẩm và kích hoạt 3 biến thể hiện còn hàng.
Các biến thể hết hàng sẽ giữ nguyên trạng thái.

[Hủy] [Xác nhận]
```

### Eligibility

The convenience action is rendered only when the product has no incoming composite membership according to the editor's current read model.

Relation-linked child products keep generic variant controls but do not receive a one-click standalone publication shortcut.

Render-time eligibility is **not** authorization. The action must re-check this rule against current persisted relation data inside the server-side mutation/transaction.

### Combined mutation contract

Browser-provided stock, product kind, relation state, and eligibility are advisory only.

At mutation time, in one transaction and before any write, the server must:

1. verify the route-owned product exists and is `isPresent=true`;
2. query current persisted incoming composite membership for that exact product through its variants;
3. if any incoming `CompositeComponentMirror` membership currently exists, fail closed with **zero writes**;
4. recompute current eligible variants belonging to that product with `isPresent=true` and summed mirrored warehouse stock `> 0`;
5. set `ProductMirror.isActive=true`;
6. set only those currently positive-stock variants to `VariantMirror.isActive=true`;
7. leave zero-stock variants unchanged.

Any validation/query/write failure must roll back the entire operation.

This explicitly closes the stale-UI/TOCTOU case where the editor rendered an ordinary product, a later sync persisted an incoming composite edge, and the old form is submitted after that relation change.

## Feature D — Bulk product operations on `/admin`

Reuse the current-page multi-select system already present on `/admin`. Do not add a second selection model or persistent cross-page selection.

The bulk toolbar must support these operation families:

1. **Đổi trạng thái biên tập** — keep the existing `DRAFT | REVIEWED | PUBLISHED` behavior.
2. **Thêm vào collection**.
3. **Gỡ khỏi collection**.
4. **Bật catalog**.
5. **Tắt catalog**.

### Bulk collection add

For the selected products and one existing collection:

- add the collection slug when absent;
- preserve all other collection memberships;
- preserve status, editorial fields, SEO fields, and all mirrored/Pancake data;
- create the minimal `ProductContent` row when a selected product has none;
- be atomic across the whole selected batch;
- allow idempotent add.

Example:

```text
Before: [new-arrivals, shirts]
Add: sale
After: [new-arrivals, sale, shirts]
```

### Bulk collection remove

For the selected products and one existing collection:

- remove only that collection slug;
- preserve all other memberships and unrelated fields;
- treat “already absent” as idempotent success;
- be atomic across the whole selected batch.

Example:

```text
Before: [new-arrivals, sale, shirts]
Remove: sale
After: [new-arrivals, shirts]
```

V3 must not provide a bulk `Replace collections` operation.

### Bulk product catalog activation

For selected current-page products, allow explicit `Bật catalog` and `Tắt catalog` operations.

The mutation must:

- require `ADMIN`;
- accept `1..100` unique product IDs;
- validate all targets against current database truth before mutation;
- verify every target still exists and is present;
- recompute each target's current active-variant count and current incoming composite membership before writes;
- mutate only `ProductMirror.isActive`;
- be atomic and idempotent;
- never mutate variant activation.

Before **enabling** products, the confirmation UI must summarize both:

1. how many selected products currently have zero active variants; and
2. how many selected products currently have incoming composite membership and would therefore become separately public if catalog is enabled.

Example:

```text
7/12 sản phẩm hiện không có biến thể hoạt động.
2/12 sản phẩm đang là thành phần của set/composite và sẽ được mở catalog riêng nếu tiếp tục.
Bật catalog không tự kích hoạt biến thể.

[Hủy] [Xác nhận bật catalog]
```

The composite-child standalone-publication warning is required for the bulk entry point for the same reason it is required in the single-product editor.

Counts rendered in the browser are UX only. The server must re-read current target state after submit and before writes. If targets become missing/stale/invalid, the atomic batch fails closed. A relation change after render must never be silently treated as proof that the old confirmation summary is still current.

Bulk `Tắt catalog` does not need the standalone-publication warning because it reduces publication exposure, but it must still validate all current targets atomically.

## Feature E — Compact product editor

The single-product editor should prioritize the tasks an operator performs most often.

Target information order:

```text
← Sản phẩm

TÊN SẢN PHẨM

CATALOG       EDITORIAL      VARIANTS       STOCK
Đang tắt      Nháp           0 / 4 active   1

[ Bật catalog ]
[ Bật sản phẩm + variant có hàng ]

------------------------------------------------

Website commerce
  Biến thể website
  Collection

Nội dung
  Trạng thái
  Mô tả
  Chăm sóc
  Size guide

SEO
  Title
  Description

Slug
  ...

▸ Dữ liệu Pancake · chỉ đọc
```

### Pancake source disclosure

Move the long read-only source context into a semantic `<details>` section that is collapsed by default.

The disclosure contains the existing read-only data rather than deleting it:

- source description;
- source images;
- price summary;
- stock summary/detail;
- raw source variant table;
- composite source/reference data that is not an immediate activation control.

Important commerce summary values may remain visible above the disclosure.

## Feature F — Operational health indicators and filters

The admin directory should make common catalog blockers visible without opening each product.

Add actionable indicators/filters for at least:

- `Có hàng nhưng variant đang tắt`;
- `0 variant hoạt động`;
- `Không có collection`;
- `Catalog đang tắt`;
- `Thiếu ảnh`.

Each directory row should show activation coverage instead of only raw variant count:

```text
Biến thể: 1 / 4 active
```

When applicable, expose a warning such as:

```text
3 variant có hàng nhưng đang tắt
```

Do not introduce a synthetic numeric “health score” in V3.

## Accessibility and UX requirements

Use the repository's existing native-control-first admin patterns.

- row and header selection use native checkboxes;
- select-all exposes checked/unchecked/indeterminate state programmatically;
- product and variant controls have descriptive accessible names;
- confirmation UI is keyboard reachable and cancellable;
- visible focus is preserved;
- success uses `role="status"` or equivalent polite announcement;
- failure uses `role="alert"` or equivalent assertive announcement;
- data tables use real table semantics and scoped headers;
- narrow layouts may horizontally scroll their table region but must not create page-level horizontal overflow;
- relevant Axe checks use the shared admin/buyer tag set including `best-practice`;
- critical activation and bulk flows retain VoiceOver/browser runtime coverage.

For bulk catalog enable, the confirmation must expose the zero-active-variant summary and composite-child standalone-publication warning to assistive technology, not only visually.

## Security and hardening

All product/variant/collection mutations cross an authenticated admin boundary and must be treated as untrusted browser input.

Always:

- require authenticated `ADMIN` server-side;
- validate shape, count, uniqueness, and bounded IDs before repository writes;
- use route-owned product identity for product-editor mutations;
- verify record ownership and current presence immediately before writes;
- re-check current incoming composite membership at mutation time when it affects publication safety;
- validate collection slugs against existing definitions;
- use atomic transactions for batch operations;
- fail closed when any requested record is missing/stale/invalid;
- return generic operator-safe errors rather than database internals;
- revalidate affected admin and storefront paths after successful commerce changes.

Never:

- trust a hidden product ID as authorization;
- trust stale browser-rendered stock/relation state as mutation eligibility;
- infer variant/product/composite identity from display fields;
- partially report success for an atomic batch;
- mutate Pancake price, stock, source identity, images, or composite source edges;
- publish a product implicitly as a side effect of ordinary variant activation;
- activate variants implicitly as a side effect of ordinary product activation.

## Tech stack

Current repository stack at the time of this spec:

- Node.js `>=22.14.0`;
- pnpm `11.4.0`;
- Next.js `16.2.11` App Router;
- React `19.2.0`;
- TypeScript `^5.9.0`;
- Prisma / `@prisma/client` `7.9.1`;
- PostgreSQL;
- Tailwind CSS `^4.0.0`;
- Better Auth `1.6.25`.

No new dependency is required by this spec.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm prisma:validate
pnpm prisma:generate
pnpm prisma:migrate:deploy
pnpm test:domain
pnpm test:db
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Browser-facing slices must also run the existing admin accessibility/VoiceOver CI coverage relevant to the changed routes.

## Project structure

Prefer existing boundaries and patterns rather than introducing a new admin architecture.

Likely areas:

```text
src/app/admin/
  actions.ts
  page.tsx
  products/[productId]/page.tsx

src/components/admin/
  admin-product-bulk-table.tsx
  [small product-editor/variant-bulk client boundaries]

src/commerce/
  product-content-admin.ts
  product-content-repository.ts
  [generic product/variant activation service and repository paths]

src/db/
  prisma.ts

tests/domain/
tests/database/
tests/a11y-runtime/

docs/design/
```

Keep server-rendered pages as the default. Introduce client state only where selection, confirmation, or immediate interaction requires it.

## Code style and interface conventions

Follow the existing parser/service/repository shape: validate untrusted input before dependency access, keep authorization at the service/server boundary, and make repositories perform narrow writes.

Representative shape:

```ts
const result = await service.update(adminSession, {
  productId: routeOwnedProductId,
  variantIds: formData.getAll("variantId"),
  isActive: true,
});

if (!result.ok) {
  return { kind: "error", message: genericAdminError };
}
```

Repository methods should name the exact field/business operation they mutate rather than reusing broad snapshot-save methods.

For publication-sensitive operations, service/repository boundaries must expose the current relation-state check explicitly rather than assuming the render-time read model is still valid.

## Testing strategy

Use RED → GREEN for changed behavior.

### Domain coverage

At minimum:

- unauthenticated/non-admin rejected before dependency access;
- malformed/empty/duplicate/over-limit product and variant batches rejected;
- route-owned product identity is not replaceable by browser input;
- collection add/remove parser/service contracts preserve add/remove semantics;
- stale/unavailable targets fail closed;
- quick action rejects current incoming composite membership before dependency writes;
- bulk catalog enable requires current composite-membership data for warning/validation behavior rather than trusting browser-submitted counts.

### Database coverage

At minimum:

- generic activation works for a normal present variant with stock and no composite relation;
- generic activation also works for composite parent/child variants without weakening relation guards elsewhere;
- cross-product variant IDs are rejected with zero writes;
- stale or `isPresent=false` variants are rejected with zero writes;
- mixed valid/invalid batch performs zero updates;
- product activation changes only `ProductMirror.isActive`;
- variant activation changes only `VariantMirror.isActive`;
- quick action activates product plus only current positive-stock variants in one transaction;
- zero-stock variants stay unchanged during the quick action;
- **stale quick-action regression:** render/prepare the action while product has no incoming composite membership, then persist an incoming composite edge before submit; mutation must fail with product and all variants unchanged;
- bulk catalog enable re-reads current incoming composite membership for every selected product before writes;
- bulk catalog batch with a stale/missing/invalid target performs zero writes;
- collection add/remove preserves status, editorial text, SEO, other collections, and mirrored product fields;
- missing selected product causes no partial batch commit.

### Regression for the reported normal-product gap

Create a fixture equivalent to:

```text
normal product
product isPresent = true
product isActive = true
variant XL isPresent = true
variant XL stock = 1
variant XL isActive = false
no composite relation
```

The fixed behavior must prove:

```text
admin activates XL
→ VariantMirror.isActive = true
→ storefront product projection can include XL subject to existing price/stock guards
```

### Browser/accessibility coverage

At minimum verify:

- normal product displays variant activation controls;
- select-all and indeterminate state;
- select-positive-stock shortcut;
- bulk variant activation/deactivation;
- combined quick-action confirmation and result;
- quick action is absent for a current relation-linked child product;
- stale quick-action server rejection is surfaced accessibly if relation membership changes after render;
- bulk add/remove collection;
- bulk product catalog enable warning when variants are inactive;
- bulk product catalog enable warning summarizes relation-linked/composite-child publication exposure;
- bulk confirmation counts may come from the current page UX, but submit-time behavior is reconciled against server/database truth;
- compact editor order and collapsed Pancake disclosure;
- no page-level horizontal overflow;
- success/error focus and announcements;
- Axe shared tags and VoiceOver for critical flows.

## Implementation slicing

Do not implement this spec as one large PR.

### PR-A — Generic commerce activation

- product catalog toggle in single-product editor;
- generic single-variant activation for ordinary/composite variants;
- bulk variant activation/deactivation inside one product;
- select-positive-stock convenience;
- combined `Bật sản phẩm + kích hoạt biến thể có hàng` action;
- server-side current incoming-composite eligibility guard for the quick action;
- stale-render/edge-added-after-render regression;
- regression for ordinary variants currently stuck `TẮT`.

### PR-B — Compact editor

- unified Website Commerce presentation;
- compact summary metrics;
- move read-only Pancake source content into collapsed disclosure;
- remove duplicate composite activation UI after generic controls cover it;
- preserve all current editorial/slug/source functionality.

### PR-C — Bulk product operations and health

- add/remove collection on selected current-page products;
- bulk product catalog enable/disable;
- bulk catalog confirmation includes zero-active-variant and current composite-child publication warnings;
- submit-time current database reconciliation for bulk catalog targets;
- activation coverage and operational warnings in rows;
- actionable health filters;
- reuse the existing selection and confirmation boundary.

Each PR must leave the application in a working state and pass focused verification before the next slice begins.

## Boundaries

### Always

- follow TDD for new/changed behavior;
- require server-side authorization for every mutation;
- preserve Pancake source ownership;
- keep product and variant activation independent except for the explicit confirmed quick action;
- re-check publication-sensitive composite membership from current persisted data at mutation time;
- use atomic writes for multi-record operations;
- reuse current admin/service/repository patterns;
- revalidate affected admin/storefront routes after successful commerce mutations;
- preserve accessibility gates.

### Ask first

- database schema migration;
- new dependency;
- CI workflow changes;
- changing Pancake synchronization behavior;
- automatic activation during sync;
- persistent/cross-page selection;
- audit-history schema;
- changing price/inventory ownership;
- changing composite relation persistence or identity rules.

### Never

- auto-publish a product because one variant was activated;
- auto-activate variants because a product was activated;
- allow the combined quick action when current persisted incoming composite membership exists;
- trust render-time eligibility as mutation-time authorization;
- mutate price or stock from these admin flows;
- infer composite relations from names/SKUs/categories;
- provide bulk replace-all collection membership in V3;
- silently accept partial success in an atomic bulk operation;
- remove existing safety checks merely to make a product appear on storefront.

## Success criteria

V3 is complete only when all of the following are true:

1. A normal product with a present inactive variant can activate/deactivate that variant from its editor.
2. An admin can activate/deactivate multiple variants of one product in one atomic action.
3. Variant controls cover ordinary, composite-parent, and composite-child variants through one consistent UI.
4. Product catalog activation remains independent from variant activation.
5. The explicit quick action can atomically activate the product and only variants with positive current stock.
6. Relation-linked child products do not receive or successfully execute the one-click standalone publication shortcut; current incoming composite membership is re-checked server-side before any quick-action write.
7. A stale quick-action form fails closed if an incoming composite relation is persisted after render and before submit.
8. `/admin` current-page selection can add selected products to an existing collection.
9. `/admin` current-page selection can remove one collection without disturbing other memberships.
10. `/admin` current-page selection can enable/disable product catalog state without changing variant state.
11. Bulk catalog enable explicitly warns about selected products with current incoming composite membership and standalone-publication exposure, in addition to zero-active-variant warnings.
12. Bulk catalog mutations validate current target/relation state server-side rather than trusting browser-rendered counts.
13. The editor prioritizes commerce/editorial controls and collapses long Pancake source context by default.
14. The directory surfaces activation coverage and actionable catalog-health filters.
15. No new flow mutates Pancake-owned price, inventory, source identity, images, or relation data.
16. Focused domain/database regressions would fail without the new behavior.
17. Existing tests, lint, typecheck, build, security smokes, and relevant admin Axe/VoiceOver runtime checks are green for each implementation slice.
18. No schema/dependency/sync behavior change is introduced without a separate approved decision.

## Open questions

None blocking specification approval. Any scope expansion beyond the boundaries above requires a separate decision before implementation.
