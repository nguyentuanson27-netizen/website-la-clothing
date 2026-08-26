# LA Clothing Admin Product Bulk Status — V1

Status: **DRAFT SPEC — docs-only; no implementation in this PR**

## Objective
Improve `/admin` so an authenticated admin can select multiple visible products and change their editorial publication status in one action.

V1 solves one job only: reduce repetitive per-product status edits.

## Context
- `/admin` already has search, filters, sort and pagination.
- Status is `DRAFT | REVIEWED | PUBLISHED`.
- `ProductContent.status` is website-owned.
- Price, inventory and operational product state remain Pancake-owned.
- Bulk status must use a status-only write path; do not reuse the full editorial snapshot save.

## UI behavior
- Add a checkbox to each visible product row.
- Add a header checkbox for select/deselect **current page**.
- Header checkbox supports unchecked / checked / indeterminate.
- When selection is non-empty, show:
  - `Đã chọn N sản phẩm`;
  - target status: `Nháp`, `Đã duyệt`, `Đã xuất bản`;
  - `Cập nhật N sản phẩm`;
  - clear selection.
- Confirm before applying the change.
- Success: refresh status/facets and clear selection.
- Failure: show an error; do not report partial success.
- Selection does not persist across search/filter/sort/page navigation.

## Bulk update contract
Server-side bulk update must:
- require `ADMIN`;
- accept `1..100` unique product IDs;
- accept only `DRAFT | REVIEWED | PUBLISHED`;
- verify every requested product exists;
- update only `ProductContent.status`;
- create minimal `ProductContent` when needed;
- be atomic: all succeed or none commit;
- allow idempotent updates to the current status.

Never overwrite description, care, size guide, SEO, collections, mirrored product fields, price, inventory, `isActive`, or variant state.

## Accessibility / UX
- Prefer native checkboxes/select controls.
- Row checkbox accessible name includes the product name.
- Header checkbox has an accessible label such as `Chọn tất cả sản phẩm trên trang này`.
- Indeterminate state is exposed programmatically.
- Keyboard navigation and visible focus must remain usable.
- Success/error feedback is announced accessibly.
- Preserve existing narrow-screen table scrolling without page-level overflow.

## Structure / style
Current stack: Next.js 16 App Router, React 19, TypeScript, Prisma/PostgreSQL.

Keep the existing server-rendered admin page and use the smallest client boundary needed for selection state. Follow existing parser → service → repository patterns; validate browser input before repository writes. No new state library or abstraction unless required.

Likely touched areas: `src/app/admin/page.tsx`, `src/components/admin/`, product-content service/repository, and focused tests.

## Testing
Use RED → GREEN for changed behavior. Cover at minimum:
- non-admin and malformed input rejected before writes;
- empty, duplicate and over-100 selections rejected;
- unrelated editorial fields survive status changes;
- missing product causes no partial commit;
- row/header selection + indeterminate state;
- successful bulk action updates UI and accessible feedback.

Implementation verification uses existing gates:

```bash
pnpm test:db
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Relevant admin browser/Axe/VoiceOver coverage must remain green.

## Boundaries
**In V1:** current-page multi-select, bulk editorial status, confirmation/feedback, accessibility, focused tests.

**Not in V1:** cross-page selection, bulk collections, price/inventory/Pancake mutations, content-health scoring, audit history, schema changes, new dependencies, unrelated admin redesign.

## Success criteria
1. Admin can select one, several, or all products on the current page.
2. Admin can bulk change selected products to any existing editorial status.
3. Mutation is server-authorized, validated and atomic.
4. Only `ProductContent.status` changes; unrelated data is preserved.
5. Selection controls are keyboard-accessible and expose indeterminate state correctly.
6. Existing filters, pagination and single-product editing still work.

## Open questions
None blocking V1. Scope expansion requires a separate decision.
