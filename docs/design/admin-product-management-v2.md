# LA Clothing Admin Product Bulk Status — V1

Status: **DRAFT SPEC — docs-only; no implementation in this PR**

## Objective
Improve `/admin` so an authenticated admin can select multiple products on the current page and change their website-owned editorial status in one action.

V1 is intentionally small: improve the product table UX and remove repetitive per-product status edits.

## Current context
- Admin products already support search/filter/sort/pagination.
- Editorial status is `DRAFT | REVIEWED | PUBLISHED`.
- `ProductContent.status` is website-owned.
- Price, inventory, product activity and other operational fields remain Pancake-owned.
- Existing single-product save writes a full editorial snapshot, so bulk status must use a dedicated status-only path.

## UI behavior
- Add a checkbox to each visible product row.
- Add a header checkbox to select/deselect all products on the **current page**.
- Header checkbox supports checked / unchecked / indeterminate states.
- When at least one product is selected, show a compact bulk action bar with:
  - selected count;
  - target status: `Nháp`, `Đã duyệt`, `Đã xuất bản`;
  - `Cập nhật N sản phẩm` action;
  - clear-selection action.
- Confirm before applying the bulk change.
- On success, refresh displayed statuses/facets and clear selection.
- On failure, show an error and do not report partial success.

Selection does not persist across filter, sort, search or pagination navigation in V1.

## Bulk update contract
Bulk status update must:
- require an `ADMIN` session server-side;
- accept `1..100` unique product IDs;
- accept only `DRAFT | REVIEWED | PUBLISHED`;
- verify all requested products exist;
- update only `ProductContent.status`;
- create a minimal `ProductContent` row when a selected product has none and the target status requires persisted content;
- run atomically: either the whole batch succeeds or no status changes commit;
- treat setting the current status again as valid/idempotent.

It must never overwrite description, care instructions, size guide, SEO fields, collection membership, mirrored product data, price, inventory, `isActive`, or variant state.

## Accessibility / UX
- Use native checkboxes and native/select-style controls where possible.
- Row checkbox accessible name includes the product name.
- Header checkbox has an accessible label such as `Chọn tất cả sản phẩm trên trang này`.
- Keyboard navigation and visible focus must continue to work.
- Indeterminate state must be programmatic, not visual-only.
- Success/error feedback must be announced accessibly.
- Preserve the existing narrow-screen horizontal table behavior without introducing page-level overflow.

## Tech / structure
Current stack: Next.js 16 App Router, React 19, TypeScript, Prisma/PostgreSQL.

Likely implementation areas:
- `src/app/admin/page.tsx`
- `src/components/admin/`
- `src/commerce/product-content-admin.ts`
- `src/commerce/product-content-repository.ts`
- focused domain/database/admin browser tests

Keep `/admin/page.tsx` server-rendered where possible; use the smallest client boundary needed for selection state.

## Code style
Follow existing explicit parser/service/repository patterns:

```ts
bulkUpdateStatus(session, {
  productIds,
  status,
});
```

Validate browser input before repository writes. Do not add a state-management library or new abstraction unless the implementation proves it is necessary.

## Testing
Implementation follows RED → GREEN for changed behavior.

Minimum coverage:
- non-admin and invalid input rejected before writes;
- empty / duplicate / over-100 selections rejected;
- existing editorial fields survive bulk status updates unchanged;
- missing product causes no partial commit;
- row/header selection and indeterminate state work;
- successful bulk action updates the UI and accessible feedback.

Use existing repository commands during implementation:

```bash
pnpm test:db
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Relevant admin browser/Axe/VoiceOver coverage should also remain green.

## Boundaries
### In V1
- current-page multi-select;
- bulk editorial status update;
- confirmation + success/error feedback;
- focused accessibility and tests.

### Not in V1
- cross-page/select-all-filtered-results;
- bulk collections;
- bulk price/inventory/Pancake activity;
- content-health scoring;
- audit history;
- schema migrations;
- new dependencies;
- unrelated admin redesign/refactor.

## Success criteria
1. Admin can select one, several, or all visible products on the current page.
2. Admin can bulk change selected products to any existing editorial status.
3. Bulk mutation is server-authorized, validated and atomic.
4. Only `ProductContent.status` changes; unrelated website/Pancake data is preserved.
5. Selection controls are keyboard-accessible and correctly expose indeterminate state.
6. Existing admin filters, pagination and product editing continue to work.

## Open questions
None blocking V1. Any expansion beyond this scope requires a separate decision.
