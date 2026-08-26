# LA Clothing admin product management V2 — bulk status workflow and safer catalog operations

Status: **DRAFT SPEC — review/planning only; no admin implementation in this PR**

## Objective
Improve the existing `/admin` product directory so an administrator can select multiple visible products and update their website-owned editorial publication status in one safe operation.

Primary user: an authenticated `ADMIN` responsible for catalog editorial maintenance.

Primary outcome: reduce repetitive per-product editing while preserving the existing ownership boundary between LA Clothing website content and Pancake operational data.

This V1 intentionally optimizes one high-frequency workflow first: bulk status updates. It establishes a reusable selection UX that later work may extend to other website-owned product operations only after separate specification/review.

## Assumptions locked for this spec
1. Selection applies to the **current paginated result page only**. V1 does not implement cross-page "select all filtered results".
2. The bulk mutation changes only `ProductContent.status` and must never overwrite editorial description, care instructions, size guide, SEO fields, collection membership, source mirror fields, price, inventory, or operational activation.
3. A request contains at most **100 unique product IDs**, matching the existing admin repository upper bound.
4. Bulk status mutation is **all-or-nothing** inside one database transaction.
5. If a selected `ProductMirror` has no `ProductContent` row yet, the operation may create one with the requested status while leaving nullable editorial fields empty and collection slugs at the schema default.
6. Re-applying the current status is valid and idempotent; the final state matters, not whether each row required a physical update.
7. Inactive mirrored products may still receive editorial status updates if they are visible in the current admin directory selection. V1 does not redefine `isActive` authority.
8. No Prisma schema migration and no new runtime dependency are expected for V1.
9. Existing Vietnamese-first admin copy and the current monochrome/stone visual language remain the baseline.

## Verified current-state facts on `main`
- Stack: Next.js 16.2.11 App Router, React 19.2.0, TypeScript 5.9, Prisma 7.9.1, PostgreSQL, pnpm 11.4.0.
- `/admin` already provides search, status filter, collection filter, activity filter, sort, facet counts, pagination, and a product table.
- The current product table has no row checkbox, header checkbox, selection state, or bulk action toolbar.
- Product editorial status is `DRAFT | REVIEWED | PUBLISHED`.
- Existing single-product editorial updates require `ADMIN`, validate browser input before data access, fail closed on missing products/collections, and persist website-owned content through `createProductContentAdminService`.
- Existing single-product editor posts the full editorial snapshot. It is therefore not a safe primitive for a bulk status-only workflow because reusing it would require resubmitting unrelated editable fields.
- `ProductContent` owns `status`, editorial description, care instructions, size guide, SEO title/description, and collection slugs.
- `ProductMirror` owns mirrored product identity/activity fields; price/stock live in mirrored variant/warehouse data. The admin product page explicitly states that operational price/stock remain Pancake-owned.
- The repository already has domain tests for admin product directory/product content, database tests, CI lint/typecheck/build, an authenticated admin HTTP authorization smoke test, and browser accessibility/VoiceOver runtime coverage under `tests/a11y-runtime`.

## User workflow

### Selection
1. Administrator opens `/admin` with any existing search/filter/sort/pagination state.
2. Each visible product row exposes a native checkbox with an accessible name tied to the product name.
3. The table header exposes a native "select current page" checkbox.
4. Header checkbox states:
   - unchecked when no visible rows are selected;
   - checked when all visible rows are selected;
   - indeterminate when some but not all visible rows are selected.
5. Selection count is visible as `Đã chọn N sản phẩm`.
6. Administrator can clear selection explicitly.
7. Changing route-level query state (filter/sort/search/page navigation) starts a new rendered directory state; V1 does not promise selection persistence across navigation.

### Bulk action toolbar
When `selectedCount > 0`, render a compact action bar adjacent to the table workflow, preferably sticky while the product table scrolls if this can be done without introducing layout regressions.

Required controls:
- selected count;
- target status select: `Nháp`, `Đã duyệt`, `Đã xuất bản`;
- primary action: `Cập nhật N sản phẩm`;
- clear selection action.

No bulk controls are shown when nothing is selected.

### Confirmation
Before submitting a mutation, the UI must present the selected count and target status in a confirmation step. Native browser confirmation is acceptable only if it satisfies keyboard/accessibility/runtime expectations; otherwise use the smallest project-consistent accessible confirmation UI.

The confirmation must not imply that price, stock, collection, or other product fields will change.

### Result feedback
On success:
- refresh/revalidate the admin directory so row statuses and status facet counts reflect the committed database state;
- announce a non-urgent success message, e.g. `Đã cập nhật 12 sản phẩm sang Đã duyệt.`;
- clear the completed selection;
- preserve the current directory query state where practical.

On validation/domain failure:
- do not partially commit;
- show an explicit error message;
- do not silently claim success;
- preserve enough UI context for the administrator to retry rather than forcing unrelated navigation.

## Bulk mutation contract
Introduce a status-specific admin domain/service boundary rather than looping through the existing full-snapshot `update()` path.

Conceptual contract:

```ts
bulkUpdateStatus(session, {
  productIds: ["product-1", "product-2"],
  status: "PUBLISHED",
});
```

### Input rules
- Authorization is checked before any repository read/write.
- Input must be a plain object.
- `productIds` must be an array with `1..100` entries.
- Every product ID must be a non-empty trimmed string within the existing product ID length bound.
- Duplicate IDs are invalid input rather than silently deduplicated.
- `status` must exactly match `DRAFT | REVIEWED | PUBLISHED`.
- Unexpected extra fields must never become a path for changing Pancake-owned or unrelated editorial state.

### Repository/transaction rules
- Validate that **all requested product IDs exist** before final mutation success.
- Missing/invalid identity causes the operation to fail closed with no partial status changes.
- Execute writes in one Prisma transaction or an equivalent single atomic repository operation.
- Existing `ProductContent` rows: update `status` only.
- Missing `ProductContent` rows: create a minimal row with `productId` + target `status`, relying only on existing safe schema defaults/nullability for unrelated fields.
- Never reconstruct/save a full content snapshot from stale table data.
- Never change `ProductMirror.isActive`, variant activation, source description, product name/slug/image, prices, stock, or collection slugs as a side effect.
- Return a compact result sufficient for UI feedback; do not expose unnecessary product or auth data.

### Concurrency semantics
V1 does not introduce optimistic locking/version columns.

Required safety property: because the bulk repository writes only the `status` field, a concurrent administrator editing description/SEO/collections must not have those unrelated fields overwritten by the bulk action.

Last committed status write may win for `status` itself. A future audit/versioning feature can strengthen this contract separately.

## UI/UX requirements

### Product table
- Add a dedicated selection column before the image/product columns.
- Keep product name as the primary navigable row label and preserve the existing `Biên tập` action.
- Do not make the entire table row clickable.
- Keep native table semantics (`table`, `thead`, `tbody`, `th scope="col"`).
- Selection visuals must not rely on color alone.
- Avoid turning the entire admin page into a Client Component; use the smallest client-side selection boundary around the rows/toolbar needed for local interaction.
- Do not add a state-management library for this feature.

### Responsive behavior
- Preserve the existing horizontal table overflow strategy on narrow screens unless the implementation plan identifies a simpler accessible mobile representation.
- New selection/action controls must not introduce page-level horizontal overflow.
- Touch targets should remain approximately 44×44 CSS px where practical.

### Keyboard/accessibility
- All checkboxes, status select, confirm/cancel actions, clear selection, and submit action are keyboard reachable.
- Visible focus indicators remain intact.
- Row checkbox accessible name includes the product name.
- Header checkbox has a descriptive accessible name such as `Chọn tất cả sản phẩm trên trang này`.
- Dynamic success/error messages use semantic live/status behavior (`role="status"` for non-urgent success; appropriate alert behavior for blocking errors).
- Indeterminate state is represented programmatically, not only visually.
- Focus after a completed operation should return to a sensible workflow target (bulk/table region) rather than disappearing.
- Existing Axe/VoiceOver admin runtime coverage must remain green and be extended for the new selection/bulk interaction where practical.

## Status behavior
Status labels remain:

| Value | Admin label |
| --- | --- |
| `DRAFT` | `Nháp` |
| `REVIEWED` | `Đã duyệt` |
| `PUBLISHED` | `Đã xuất bản` |

V1 does **not** impose a new state machine. Direct transitions between any existing statuses remain allowed, matching the current domain contract.

V1 also does not add publishing-readiness gates such as "SEO required before PUBLISHED" because the current data model/domain contract allows nullable editorial fields. A content-completeness feature may expose warnings later without silently changing publication semantics.

## Tech stack
- Next.js `16.2.11` App Router
- React / React DOM `19.2.0`
- TypeScript `5.9.x`
- Prisma Client / Prisma `7.9.1`
- PostgreSQL 16 in CI
- Tailwind CSS 4
- Better Auth `1.6.25`
- Node `>=22.14.0`
- pnpm `11.4.0`
- Node built-in test runner for domain/integration/database suites
- Playwright + Axe/Guidepup tooling isolated under `tests/a11y-runtime`

## Commands
Repository verification commands:

```bash
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
pnpm prisma:validate
pnpm prisma:generate
pnpm test:db
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Local development:

```bash
pnpm dev
```

Existing admin browser accessibility runtime setup/invocation follows CI:

```bash
cd tests/a11y-runtime
npm ci --ignore-scripts --no-audit --no-fund
npx playwright install chromium
npx playwright test --config playwright.config.ts
```

Guidepup/VoiceOver setup is macOS-specific and remains part of the CI admin accessibility job; implementation planning must not weaken or remove that gate.

## Project structure
Relevant existing paths:

```text
src/app/admin/page.tsx
  Server-rendered admin product directory, filters, facets, table and pagination.

src/app/admin/products/[productId]/page.tsx
  Single-product editor and existing server actions.

src/commerce/admin-product-directory.ts
  Directory query parsing/serialization and limits.

src/commerce/product-content-admin.ts
  Existing ADMIN-only full editorial snapshot service.

src/commerce/product-content-repository.ts
  Product/content persistence and admin read model.

src/components/admin/
  Existing admin-specific reusable UI components.

prisma/schema.prisma
  ProductMirror/ProductContent ownership and status enum.

tests/domain/product-content-admin.test.ts
tests/domain/admin-product-directory.test.ts
  Existing domain patterns to preserve/extend.

tests/database/
  Repository/database contract coverage.

tests/a11y-runtime/
  Browser/Axe/VoiceOver admin runtime tests.
```

Likely new implementation structure is intentionally not fixed at spec time. `/plan` should choose the smallest set of files, with a preference for:
- one focused status-bulk domain/service boundary;
- repository methods that preserve field-level write isolation;
- one small admin Client Component for selection/action state if required;
- focused domain/database/runtime tests.

## Code style
Use existing explicit parser/service dependency style. Validate browser input before dependency access and keep side effects behind injected/repository boundaries.

Representative target style:

```ts
const PRODUCT_CONTENT_STATUSES = ["DRAFT", "REVIEWED", "PUBLISHED"] as const;

type BulkStatusInput = {
  productIds: string[];
  status: (typeof PRODUCT_CONTENT_STATUSES)[number];
};

export function createBulkProductStatusAdminService(deps: Dependencies) {
  async function update(session: AdminSessionCandidate, input: unknown) {
    requireAdminSession(session);

    const parsed = parseBulkStatusInput(input);
    if (!parsed) return { ok: false, reason: "INVALID_INPUT" } as const;

    return deps.updateStatusesAtomically(parsed);
  }

  return { update };
}
```

Conventions:
- clear domain names over generic helpers;
- no `any` for browser/domain input;
- exact allowlists for enum-like values;
- comments explain ownership/safety rationale, not obvious syntax;
- keep route/server-action orchestration thin;
- no duplicated status label/validation logic if an existing canonical constant can be reused without creating an import cycle;
- no unrelated admin visual refactor bundled into this feature.

## Testing strategy
Every behavior-changing implementation slice follows RED → GREEN → refactor.

### Domain tests
Add focused tests that would fail before the feature exists:
- non-admin is rejected before repository calls;
- malformed object/product IDs/status are rejected before repository calls;
- empty selection, >100 IDs, duplicates, whitespace/overlength IDs are rejected;
- valid input reaches one atomic dependency call with canonical values;
- unexpected browser fields cannot change unrelated product state.

### Repository/database tests
Prove persistence semantics against PostgreSQL/Prisma:
- existing `ProductContent` updates only `status` and preserves all unrelated editorial fields;
- missing `ProductContent` gets a minimal row with target status and safe defaults;
- missing product in a requested batch causes fail-closed/no-partial-write behavior;
- a mixed batch reaches one final consistent target status;
- repeated target status is idempotent.

### UI/runtime tests
Extend representative admin browser coverage to verify:
- row selection and select-current-page behavior;
- header checkbox checked/unchecked/indeterminate behavior;
- selected count and bulk toolbar visibility;
- confirmation + successful status refresh;
- keyboard reachability/focus;
- no serious Axe regressions;
- status feedback announced appropriately;
- existing filters/pagination still work after the table is wrapped by the selection boundary.

### Regression gates
At implementation completion run the repository Definition of Done, including at minimum:

```bash
pnpm test:db
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

and the relevant admin browser accessibility runtime command in the supported environment.

## Boundaries

### Always do
- Require/verify `ADMIN` before any bulk read/write dependency is invoked.
- Treat form/client data as untrusted; validate IDs, count, duplicates, and status server-side.
- Update only website-owned `ProductContent.status`.
- Keep the batch atomic.
- Preserve existing filter/sort/pagination semantics.
- Use native accessible controls before custom widgets.
- Add tests that fail without the new behavior.
- Revalidate the affected admin directory state after successful mutation.
- Keep scope limited to the reviewed V1 feature.

### Ask first
- Prisma schema changes or migrations.
- New dependencies or state-management libraries.
- New status values or a status transition state machine.
- Cross-page/all-filtered-results selection.
- Bulk collection assignment/removal.
- Bulk mutation of any Pancake-owned field, price, stock, product activity, or variant activation.
- Audit-log persistence or new admin roles/permissions.
- CI workflow changes beyond tests strictly necessary for this feature.

### Never do
- Trust hidden/browser-supplied product fields as authorization or ownership proof.
- Reuse the existing full editorial snapshot save path by filling unrelated fields from stale table data.
- Partially commit a batch after validation/missing-product failure.
- Change price, inventory, Pancake product/source data, `ProductMirror.isActive`, variant activation, slug, name, or image as a side effect.
- Add a client-only authorization check in place of server authorization.
- Remove/skip failing tests to make the change green.
- Commit secrets, production credentials, or private data.
- Refactor unrelated storefront/admin code under this feature.

## Success criteria
1. `/admin` exposes an accessible checkbox per visible product plus a select-current-page checkbox.
2. Header selection correctly represents unchecked, checked, and indeterminate states.
3. Selecting products reveals a bulk action UI with exact selected count, target status, clear action, and explicit submit/confirmation path.
4. A valid admin can bulk set `DRAFT`, `REVIEWED`, or `PUBLISHED` for `1..100` unique selected products.
5. Invalid/non-admin requests fail before unauthorized writes; all input is server-side validated.
6. Bulk persistence is atomic: either every requested existing product reaches the target status or none of the batch's status changes commit.
7. Existing content rows retain editorial description, care, size guide, SEO and collection slugs byte-for-byte/equivalent after a status-only bulk update.
8. Products without `ProductContent` can receive the target status without fabricated editorial data.
9. No Pancake-owned operational field is changed by the feature.
10. After success, admin row badges and status facet counts reflect committed state and the completed selection is cleared.
11. Error paths do not silently clear context or report success.
12. Existing search/filter/sort/pagination behavior does not regress.
13. Keyboard/focus semantics remain usable; relevant Axe/VoiceOver admin runtime gates remain green.
14. New domain/database/runtime tests fail without the implementation and pass with it.
15. `pnpm test:db`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass on the implementation head.
16. No schema migration or new runtime dependency is introduced unless this spec is amended and reviewed first.

## Out of scope for V1
The following are explicitly deferred, not silently included:
- cross-page "select all filtered results";
- bulk collection add/remove;
- content completeness/health score and missing-content quick views;
- saved filter views;
- audit history / actor timeline;
- bulk price, inventory, Pancake activity, or variant activation;
- publication readiness rules requiring description/SEO/collection before `PUBLISHED`;
- new admin roles/permissions;
- broad redesign of `/admin/collections` or the single-product editor.

## Follow-up candidates after V1
These are roadmap candidates only and require separate spec/plan approval:
1. **Content health**: surface missing description/SEO/collection/image/size-guide signals directly in the directory.
2. **Bulk collection membership**: reuse the selection model to add/remove website-owned collection slugs safely.
3. **Quick workflow views**: `Cần biên tập`, `Thiếu SEO`, `Chưa phân loại`, `Không có ảnh`, `Đã xuất bản`.
4. **Storefront preview shortcut** from an admin row/editor when a valid public product URL exists.
5. **Audit history** for who changed publication status and when.
6. **Cross-page filtered selection** only with explicit scope preview and stronger confirmation semantics.

## Open questions
No blocking requirement question remains for the V1 spec based on the approved scope above.

Human review should specifically confirm these locked decisions before `/plan`:
- current-page-only selection;
- max 100 unique IDs;
- all-or-nothing transaction;
- direct transitions among the existing three statuses;
- minimal `ProductContent` creation for products without an existing content row;
- no completeness gate before `PUBLISHED`.
