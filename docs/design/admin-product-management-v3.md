# LA Clothing Admin Product Management V3

Status: **DRAFT SPEC — docs-only; no implementation in this PR**

This spec extends `docs/design/admin-product-management-v2.md`. It defines the next admin-product-management scope without changing Pancake source ownership or claiming runtime behavior that is not already implemented.

## Objective

Improve product operations for authenticated admins so common catalog work does not require repetitive one-by-one editing.

V3 addresses four problems:

1. ordinary products can have present variants with stock but no admin control to activate those variants;
2. activation controls are split across composite-specific sections instead of one consistent workflow;
3. `/admin` bulk selection exists, but bulk operations are limited to editorial status;
4. the single-product editor is long and source-heavy, so common commerce/editorial actions are hard to reach.

## Current truth and constraints

- `/admin` already supports current-page row selection, select-all, indeterminate state, confirmation, and atomic bulk editorial status updates.
- `ProductContent.status` is website-owned: `DRAFT | REVIEWED | PUBLISHED`.
- collection membership is stored in `ProductContent.collectionSlugs`.
- `ProductMirror.isActive` and `VariantMirror.isActive` are website-owned but independent.
- the editor currently has activation controls for composite parent/child variants; ordinary variants remain read-only.
- Pancake remains authoritative for mirrored identity, price, inventory, source description/images, and composite source relations.
- sync must not auto-activate products or variants.
- storefront purchasability continues to depend on existing activation, presence, price, stock, and composite guards.

## Approved decisions

1. Product activation and variant activation remain independent.
2. Activating a variant must not automatically activate its product.
3. Activating a product must not automatically activate variants.
4. The editor may offer **Bật sản phẩm + kích hoạt biến thể có hàng** as an explicit combined convenience action.
5. The combined action is confirmed and atomic.
6. Bulk collection uses add/remove semantics, never replace-all.
7. Bulk selection stays current-page scoped; no persistent cross-page selection.
8. Price/inventory remain Pancake-owned and are never edited by these admin actions.
9. No sync-time auto-activation.
10. Browser-rendered counts, relation state, stock, eligibility, and confirmation summaries are advisory only; privileged writes use current server/database truth.

## Feature A — Unified Website Commerce controls

Every product editor exposes one primary `Website commerce` section before long source details.

Show a compact summary:

- catalog active/inactive;
- active variants `X / N`;
- positive-stock variant count;
- total mirrored stock;
- collection count.

Provide explicit product actions:

- `Bật catalog` when inactive;
- `Tắt catalog` when active.

### Product catalog mutation contract

A catalog mutation must:

- require `ADMIN`;
- bind product identity to the current editor route/server context;
- verify the product still exists and is present;
- mutate only `ProductMirror.isActive`;
- be idempotent;
- never mutate variants, price, stock, collections, editorial fields, Pancake identifiers, or composite edges.

A relation-linked child product may still be enabled as a standalone product, but the publication risk must be explicitly confirmed.

### Publication-risk confirmation freshness

`Bật catalog` is a **two-phase server confirmation contract**.

**Prepare confirmation**

The server reads current warning-relevant state and returns:

- the operator-visible warning summary; and
- an opaque server-authenticated confirmation proof bound to the route-owned product, the `enable` operation, and the exact warning-relevant state shown.

For a single product, warning-relevant state includes at minimum:

- whether any persisted incoming composite membership currently exists; and
- whether the product currently has zero active present variants.

**Commit confirmation**

After the operator confirms, the server re-reads current state before any write and validates it against the confirmation proof.

If the proof is missing, invalid, expired, bound to the wrong target/operation, or warning-relevant state changed after prepare, the server must:

- return `RECONFIRM_REQUIRED` or an equivalent explicit result;
- perform **zero writes**;
- return/render a fresh current warning summary;
- require a new operator confirmation.

Raw browser-provided booleans, counts, or ID sets are not acceptable proof. A signed short-lived token or equivalent server-held confirmation nonce is acceptable. This spec does not require a new schema or dependency.

`Tắt catalog` does not need this publication-risk reconfirmation handshake because it reduces standalone exposure, but normal auth/current-target validation still applies.

## Feature B — Generic variant activation for every product

Expose one `Biến thể website` table covering:

- ordinary variants;
- composite parent variants;
- relation-linked composite child variants.

Composite membership is context, not a prerequisite for generic activation.

Each row shows at minimum:

- SKU/fallback label;
- color;
- size;
- mirrored stock;
- activation state;
- context badge: `Thường`, `Set cha`, and/or `Thành phần set`;
- single-row `Kích hoạt` / `Tắt` action.

### Generic variant mutation contract

The server-side mutation must:

- require `ADMIN`;
- accept `1..100` unique variant IDs;
- reject empty, duplicate, malformed, or oversized input before writes;
- bind `productId` to current route/server context;
- verify every variant belongs to that product;
- verify every variant is still `isPresent=true`;
- mutate only `VariantMirror.isActive`;
- be atomic per submitted batch;
- allow idempotent updates;
- never infer ownership/relation from names, slugs, SKUs, color, or size.

Any mixed valid/invalid batch performs zero updates.

### Deterministic behavior above the 100-variant batch cap

The repository does not establish an invariant that one product has at most 100 variants. Therefore V3 must not expose a UI action that can silently create an oversized batch.

For products with **100 or fewer** present variants:

- `Chọn tất cả biến thể` selects the whole product;
- `Chọn biến thể có hàng` selects all current positive-stock variants.

For products with **more than 100** present variants:

- render deterministic pages/windows of at most 100 variants using stable editor order (`color`, `size`, then `id`);
- label actions `Chọn tất cả biến thể trên trang này` and `Chọn biến thể có hàng trên trang này`;
- scope selection to the current variant page/window;
- clear selection when moving to another variant page;
- show range/total, e.g. `1–100 / 245 biến thể`;
- never accumulate or submit more than 100 browser-selected IDs across pages;
- require multiple explicit submissions to process a product with >100 variants;
- guarantee atomicity per submitted batch, not across the operator's sequence of multiple pages.

A forged 101-ID request is rejected before writes. Selection is never silently truncated.

The Feature C quick action is separate: it accepts no browser variant-ID list and may atomically update all currently eligible positive-stock variants of the one route-owned product even if that server-computed count exceeds 100.

## Feature C — Combined quick action

For an ordinary product, offer:

**Bật sản phẩm + kích hoạt biến thể có hàng**

The UI confirms the current expected effect. Browser stock/relation state is advisory only.

### Eligibility and mutation contract

The action is rendered only when the editor's current read model has no incoming composite membership.

At mutation time, in one transaction and before any write, the server must:

1. verify the route-owned product exists and is present;
2. re-read current incoming composite membership through its variants;
3. if any incoming `CompositeComponentMirror` exists, fail closed with zero writes;
4. recompute current product variants with `isPresent=true` and summed mirrored stock `> 0`;
5. set `ProductMirror.isActive=true`;
6. set only those current positive-stock variants to `VariantMirror.isActive=true`;
7. leave zero-stock variants unchanged.

Any validation/query/write failure rolls back the whole operation.

This explicitly covers stale UI: if the product was ordinary at render time but a later sync adds an incoming composite edge before submit, the action fails with zero writes.

## Feature D — Bulk product operations on `/admin`

Reuse the existing current-page selection system. Do not add a second or cross-page selection model.

Support:

1. existing bulk editorial status;
2. `Thêm vào collection`;
3. `Gỡ khỏi collection`;
4. `Bật catalog`;
5. `Tắt catalog`.

### Bulk collection add/remove

For `1..100` selected products and one existing collection:

- add only the selected collection when absent, or remove only that collection when present;
- preserve all other collection membership;
- preserve status, editorial text, SEO, and mirrored/Pancake fields;
- create minimal `ProductContent` only when add requires it;
- treat already-added/already-absent state as idempotent success;
- validate the collection against existing definitions;
- perform the selected batch atomically.

V3 has no bulk `Replace collections` action.

### Bulk catalog enable/disable

The mutation must:

- require `ADMIN`;
- accept `1..100` unique selected product IDs;
- validate all targets against current database truth;
- verify every target exists and is present;
- mutate only `ProductMirror.isActive`;
- never mutate variant activation;
- be atomic and idempotent.

Before **enabling**, the warning summary includes at minimum:

- selected products with zero active present variants; and
- selected products with current incoming composite membership that would become separately public.

Example:

```text
7/12 sản phẩm hiện không có biến thể hoạt động.
2/12 sản phẩm đang là thành phần set/composite và sẽ được mở catalog riêng.
Bật catalog không tự kích hoạt biến thể.
```

### Bulk publication-risk confirmation freshness

Bulk `Bật catalog` uses the same two-phase principle as single-product enable.

**Prepare** validates the exact selected IDs, computes current warning state, and returns an opaque server-authenticated proof bound to:

- exact selected product IDs;
- the `enable` operation;
- the exact set of selected products with zero active present variants;
- the exact set of selected products with incoming composite membership.

**Commit** re-reads all selected targets and warning-relevant state before any write and validates against the proof.

If selected targets differ, the proof is missing/invalid/expired, or either warning-relevant set changed after prepare, the server returns `RECONFIRM_REQUIRED`, performs **zero writes for the whole batch**, and returns a fresh summary for a new confirmation.

This no-write rule applies even if every product still exists/is present and enabling would otherwise be valid.

Example stale confirmation:

```text
prepare: 0/12 composite children
sync adds an incoming edge to 1 selected product
submit old confirmation
→ RECONFIRM_REQUIRED
→ 0 products updated
→ fresh summary: 1/12 composite children
```

Browser-rendered counts/sets are UX only and cannot serve as confirmation proof.

Bulk `Tắt catalog` does not need the publication-risk reconfirmation handshake, but still validates every target atomically.

## Feature E — Compact product editor

Target order:

```text
← Sản phẩm

TÊN SẢN PHẨM

CATALOG       EDITORIAL      VARIANTS       STOCK
Đang tắt      Nháp           0 / 4 active   1

[ Bật catalog ]
[ Bật sản phẩm + variant có hàng ]

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

▸ Dữ liệu Pancake · chỉ đọc
```

Move long read-only Pancake context into a semantic `<details>` collapsed by default. Preserve, rather than delete:

- source description;
- source images;
- price/stock summary/detail;
- raw source variant table;
- composite source/reference data not needed for immediate activation controls.

## Feature F — Operational health indicators and filters

Add actionable directory indicators/filters for at least:

- `Có hàng nhưng variant đang tắt`;
- `0 variant hoạt động`;
- `Không có collection`;
- `Catalog đang tắt`;
- `Thiếu ảnh`.

Each row shows activation coverage such as `1 / 4 active`, plus a warning when positive-stock variants are inactive.

Do not add a synthetic numeric health score.

## Security and hardening

Always:

- require authenticated `ADMIN` server-side;
- validate shapes, counts, uniqueness, bounded IDs, ownership, and presence before writes;
- use route-owned product identity for product-editor mutations;
- validate collections against current definitions;
- re-read current relation state when publication safety depends on it;
- require server-authenticated confirmation freshness for catalog-enable writes;
- return `RECONFIRM_REQUIRED` with zero writes when warning-relevant state changed;
- use atomic transactions for multi-record operations;
- return operator-safe errors without database internals.

Never:

- trust hidden product IDs for authorization;
- trust stale browser stock/relation state as mutation eligibility;
- trust raw browser confirmation counts/sets as proof that risk was acknowledged;
- commit catalog enable after warning-relevant state changed since the shown confirmation;
- let generic browser-selected variant batches exceed 100 IDs or silently truncate them;
- mutate Pancake price, stock, source identity, images, or relation edges;
- auto-publish a product because a variant was activated;
- auto-activate variants because a product was activated.

## Accessibility and UX

- use native buttons, checkboxes, selects, tables, and `<details>` where possible;
- expose select-all checked/unchecked/indeterminate state programmatically;
- keep descriptive accessible names and visible focus;
- success uses `role="status"`; failures/reconfirmation use `role="alert"` or equivalent;
- confirmation/reconfirmation is keyboard reachable and cancellable;
- variant pagination/window range and selected count are announced accessibly;
- no page-level horizontal overflow;
- relevant Axe checks use the shared tag set including `best-practice`;
- critical activation/bulk flows retain browser + VoiceOver coverage.

## Testing strategy

Use RED → GREEN for changed behavior.

### Domain/database coverage

At minimum prove:

- non-admin rejected before writes;
- malformed/duplicate/oversized product/variant batches rejected;
- route-owned product identity cannot be replaced by browser input;
- generic activation works for ordinary and composite variants;
- cross-product/stale/not-present/mixed-invalid variant batches produce zero writes;
- product activation changes only `ProductMirror.isActive`;
- variant activation changes only `VariantMirror.isActive`;
- quick action activates only current positive-stock variants and rejects current incoming composite membership;
- stale quick-action case: edge added after render → zero writes;
- single-product catalog prepare → relation/warning state changes → old proof returns `RECONFIRM_REQUIRED`, product unchanged;
- bulk catalog prepare → one selected product's warning-relevant relation state changes → old proof returns `RECONFIRM_REQUIRED`, zero batch writes;
- missing/stale bulk target causes zero batch writes;
- collection add/remove preserves unrelated memberships/content/mirrored fields;
- >100-variant product: first page select-all submits exactly 100 IDs, later page submits the remainder, forged 101-ID request is rejected before writes.

### Reported ordinary-product regression

Fixture:

```text
normal product
product isPresent = true
product isActive = true
variant XL isPresent = true
variant XL stock = 1
variant XL isActive = false
no composite relation
```

Expected:

```text
admin activates XL
→ VariantMirror.isActive = true
→ storefront may include XL subject to existing price/stock guards
```

### Browser/accessibility coverage

Verify at minimum:

- ordinary product displays variant controls;
- select-all + indeterminate state;
- >100 variant page/window labels, range feedback, page-scoped selection, reset on page change;
- select-positive-stock is page-scoped when >100;
- bulk variant activate/deactivate;
- quick-action confirmation and stale-relation rejection;
- single-product stale catalog confirmation → accessible `RECONFIRM_REQUIRED` + fresh warning + zero write;
- bulk catalog warning includes zero-active and composite-publication exposure;
- bulk stale confirmation → accessible `RECONFIRM_REQUIRED` + fresh summary + zero batch writes;
- bulk add/remove collection;
- compact editor + collapsed Pancake disclosure;
- Axe + VoiceOver + no page-level overflow.

## Implementation slicing

### PR-A — Generic commerce activation

- product catalog toggle;
- two-phase single-product catalog enable confirmation freshness;
- generic single/bulk variant activation;
- deterministic <=100 variant page/window contract;
- select-positive-stock convenience;
- combined quick action;
- ordinary-variant and stale-relation regressions.

### PR-B — Compact editor

- unified Website Commerce presentation;
- compact summary metrics;
- collapsed Pancake source disclosure;
- remove duplicate composite activation UI after generic controls cover it;
- preserve editorial/slug/source behavior.

### PR-C — Bulk product operations and health

- add/remove collection;
- bulk catalog enable/disable;
- zero-active + composite-publication warnings;
- two-phase server-authenticated bulk confirmation freshness;
- `RECONFIRM_REQUIRED` zero-write stale-confirmation behavior;
- activation coverage and health filters.

Each PR must leave the application working and pass focused verification before the next slice.

## Boundaries

### Always

- TDD for changed behavior;
- server-side authorization and input validation;
- preserve Pancake ownership;
- product/variant activation remain independent except the explicit combined action;
- current persisted relation state is authoritative;
- catalog-enable confirmation must be fresh at commit time;
- multi-record writes are atomic;
- reuse existing parser/service/repository patterns;
- revalidate affected admin/storefront routes after successful writes;
- preserve accessibility gates.

### Ask first

- schema migration;
- new dependency;
- CI workflow changes;
- sync behavior changes;
- auto-activation during sync;
- persistent/cross-page selection;
- audit-history schema;
- price/inventory ownership changes;
- composite identity/persistence changes.

### Never

- auto-publish because one variant was activated;
- auto-activate variants because product catalog was enabled;
- run the combined quick action when current incoming composite membership exists;
- trust render-time eligibility as mutation-time authorization;
- commit catalog enable after warning-relevant state changed since confirmation prepare;
- submit/truncate >100 generic browser-selected variant IDs;
- mutate Pancake-owned price/stock/relation/source data;
- silently accept partial success in an atomic batch.

## Success criteria

V3 is complete only when:

1. ordinary present variants can be activated/deactivated from their editor;
2. multiple variants can be activated/deactivated atomically per submitted batch;
3. ordinary/composite-parent/composite-child variants use one consistent control model;
4. product and variant activation remain independent;
5. combined quick action activates the product plus only current positive-stock variants and fails closed for current composite children;
6. stale quick-action forms fail closed after relation changes;
7. single-product `Bật catalog` uses server-authenticated prepare/commit confirmation; stale warning state returns `RECONFIRM_REQUIRED` with zero writes;
8. products with >100 variants use deterministic <=100 page/window selection and never create oversized generic submissions;
9. `/admin` can bulk add/remove one collection without disturbing unrelated membership;
10. `/admin` can bulk enable/disable catalog without changing variant state;
11. bulk enable warns about zero-active variants and standalone publication of current composite children;
12. bulk enable uses server-authenticated prepare/commit confirmation; warning-state changes return `RECONFIRM_REQUIRED` with zero batch writes;
13. compact editor prioritizes commerce/editorial controls and collapses long Pancake context;
14. directory exposes activation coverage and actionable health filters;
15. no flow mutates Pancake-owned price, inventory, source identity, images, or composite relations;
16. focused regressions fail without the new behavior;
17. existing tests, lint, typecheck, build, security smokes, and relevant Axe/VoiceOver checks are green for each implementation slice;
18. no schema/dependency/sync change is introduced without a separate approved decision.

## Open questions

None blocking specification approval. Scope expansion beyond these boundaries requires a separate decision before implementation.
