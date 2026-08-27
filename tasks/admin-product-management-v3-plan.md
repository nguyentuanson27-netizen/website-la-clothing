# Admin Product Management V3 — implementation plan

Status: **DRAFT PLAN — spec approved 2026-08-27; awaiting plan review before /build**

Source spec: `docs/design/admin-product-management-v3.md` on PR #136.

Baseline: `main@e2855d73ad43c8d644d090bdbb5344093e8980f2` after PR #135. Planning is docs-only; no runtime implementation is performed in PR #136.

## Planning objective

Turn the approved V3 spec into small, ordered, verifiable implementation tasks without mixing unrelated refactors. The implementation remains split into the three approved workstreams:

- **PR-A — Generic commerce activation**
- **PR-B — Compact product editor**
- **PR-C — Bulk product operations and health**

Every task below is intended to finish GREEN in one focused session. TDD RED is observed inside the task; no task is considered complete while the branch is intentionally red.

## Current architecture grounding

The plan is based on current `main` behavior and boundaries:

- `src/app/admin/products/[productId]/page.tsx` is a large Server Component. It owns the route-bound product identity and currently contains inline Server Actions for editorial save plus composite child/parent variant activation.
- `createProductContentRepository().findForEditor()` already reads the product's full variant relation in deterministic `color → size → id` order, including stock and incoming/outgoing composite relations. It has no `take` limit, so V3 must handle products with more than 100 variants in the UI rather than assuming a catalog invariant.
- `src/commerce/composite-component-admin.ts` and `src/commerce/composite-component-repository.ts` currently implement composite-specific activation. V3 adds a generic commerce path first; the old composite-specific UI is removed only in PR-B after generic controls are proven.
- `/admin` already has current-page multi-select in `src/components/admin/admin-product-bulk-table.tsx`, with an atomic bulk editorial-status Server Action in `src/app/admin/actions.ts`.
- `src/commerce/product-content-admin.ts` / `product-content-repository.ts` own website editorial state and collection membership. `CollectionDefinition` validation/resolution already exists in `collection-definition-repository.ts`.
- `ProductMirror.isActive` and `VariantMirror.isActive` are existing website-owned commerce fields. No schema change is needed for V3.
- CI already runs Prisma validation/generation/migrations, DB tests, HTTP/security/auth smokes, lint, typecheck, domain tests, build, release/start smokes, and the macOS admin Axe/VoiceOver runtime.

## Architecture decisions for implementation

### 1. Separate commerce mutation ownership from editorial content ownership

Create a narrow generic commerce boundary rather than expanding composite-specific services or overloading `product-content-admin.ts` with `ProductMirror` / `VariantMirror` activation logic:

- `src/commerce/product-commerce-admin.ts`
- `src/commerce/product-commerce-repository.ts`

These own:

- single/bulk variant activation for one route-owned product;
- product catalog enable/disable;
- current publication-warning state reads;
- the combined product + positive-stock-variants quick action.

`product-content-*` remains the owner for editorial fields and collection membership.

### 2. Keep route-owned identity for single-product mutations

The product editor keeps Server Action closures created from the persisted route product ID. Client components may receive those Server Actions as props, but a hidden/browser product ID never becomes authorization.

### 3. Use one reusable server-authenticated confirmation proof

Add a small helper such as `src/commerce/admin-catalog-confirmation.ts` for single-product and bulk `Bật catalog` prepare/commit flows.

Default implementation direction:

- canonical payload with explicit purpose/version;
- bind admin actor ID, operation, exact target product ID(s), warning-relevant state, issued-at, and expiry;
- sign with a domain-separated HMAC using the already-required server auth secret exposed by `readAuthServerConfig()`;
- verify with constant-time comparison;
- reject malformed/tampered/expired/wrong-actor/wrong-target/wrong-operation proof before writes.

Security checkpoint: if fresh review rejects reuse of the existing server secret even with domain separation, stop before adding a new secret/config and request approval. Do not silently introduce a new secret or persistence table.

### 4. The 100-ID cap applies only to browser-selected generic batches

The generic variant table uses deterministic windows of at most 100 rows. `findForEditor()` may continue to read the full existing admin relation initially; the UI selection/submission boundary is what is capped.

The combined quick action is different: it accepts no browser variant-ID list and computes eligible variants inside the transaction, so it may update more than 100 current positive-stock variants atomically for one route-owned product.

### 5. Preserve current composite source identity

Generic activation mutates only global `isActive` fields. It must not create, delete, infer, or rewrite `CompositeComponentMirror` edges. Composite context is display/eligibility information only.

## Dependency graph

```text
A1 confirmation proof contract

A2 generic variant backend

A1 + A2
  -> A3 product catalog + quick-action backend

A2
  -> A4 unified variant table

A3 + A4
  -> A5 catalog + quick-action editor UX
  -> Checkpoint A

Checkpoint A
  -> B1 compact editor IA
  -> B2 collapsed Pancake source + duplicate activation cleanup
  -> Checkpoint B

Checkpoint A
  -> C1 bulk collection backend
  -> C2 bulk catalog backend  (also depends on A1/A3 confirmation/catalog primitives)
  -> C3 directory health read model

C1 + C2 + C3
  -> C4 bulk toolbar expansion
  -> C5 health indicators/filters UI
  -> Checkpoint C / V3 implementation complete
```

PR-B and the backend-first part of PR-C may be developed in parallel after Checkpoint A if they use separate branches. PR-C UI must integrate all accepted C1–C3 contracts before completion.

---

# PR-A — Generic commerce activation

PR-A closes the P0 operational gap first: ordinary variants must become manageable without weakening the composite relation or storefront boundaries.

## A1 — Implement the catalog confirmation proof primitive

**Description**

Create a pure server-side helper for the two-phase single/bulk catalog-enable confirmation contract. This task does not update products.

The proof payload should carry only bounded, non-secret fields required to detect stale risk acknowledgement:

- purpose/version;
- admin actor ID;
- operation (`enable` only for this contract);
- canonical exact target product IDs;
- canonical warning state:
  - IDs of selected products with zero active present variants;
  - IDs of selected products with incoming composite membership;
- issued-at and expiry.

Use stable canonical serialization before signing. Bulk target/warning ID sets must be sorted and duplicate-free before signing or comparison.

**Acceptance criteria**

- [ ] no database write in proof helper;
- [ ] proof cannot be replayed for a different admin, operation, or product selection;
- [ ] warning-state drift invalidates commit freshness;
- [ ] malformed/tampered/expired proof fails closed;
- [ ] raw browser counts are never accepted as authoritative proof;
- [ ] no new dependency/schema/secret is introduced without approval.

**Verification**

RED/GREEN domain tests for:

- valid prepare/verify round trip;
- payload/signature tampering;
- expired proof;
- wrong actor;
- wrong operation;
- one target added/removed;
- zero-active set changed;
- composite-child set changed;
- different bulk ID order canonicalizes to the same logical state;
- duplicate IDs are rejected before signing/verifying.

Security review confirms domain separation, bounded payloads, non-secret failure messages, and constant-time signature comparison.

**Dependencies:** approved V3 spec.

**Likely files**

- `src/commerce/admin-catalog-confirmation.ts` (new)
- `tests/domain/admin-catalog-confirmation.test.ts` (new)
- `src/auth/config.ts` only if a narrow existing-config accessor is needed; do not broaden auth behavior.

**Estimated scope:** Small–Medium.

---

## A2 — Add the generic variant activation service/repository

**Description**

Introduce generic variant activation for every present variant of one route-owned product. This replaces the *need* for composite-specific activation semantics, but PR-A does not delete the old composite UI yet.

Parser/service contract:

- ADMIN required before repository access;
- `1..100` unique variant IDs;
- strict bounded IDs;
- exact boolean target state;
- product ID comes from server-owned route context.

Repository transaction:

1. read/count all requested `VariantMirror` rows constrained by exact `productId` and `isPresent=true`;
2. if count differs from requested IDs, return fail-closed result before update;
3. update `VariantMirror.isActive` only for that exact set;
4. require update count equals target count or roll back.

Composite membership is not an activation precondition.

**Acceptance criteria**

- [ ] ordinary variant can activate/deactivate;
- [ ] composite parent and component variants also work through the same generic service;
- [ ] wrong-product, missing, stale, `isPresent=false`, duplicate, oversized, malformed input produces zero writes;
- [ ] product state, price, stock, source fields, and composite edges remain unchanged;
- [ ] idempotent requested state is success.

**Verification**

TDD with domain + PostgreSQL tests, including the reported regression fixture:

```text
normal product active/present
XL present
stock sum = 1
XL isActive = false
no composite relation
```

GREEN proves generic admin activation sets XL active and current storefront detail/projection may expose XL under existing price/stock guards.

Also cover a mixed batch with one valid and one wrong-product/stale variant => zero writes.

**Dependencies:** none beyond approved spec; can develop in parallel with A1.

**Likely files**

- `src/commerce/product-commerce-admin.ts` (new)
- `src/commerce/product-commerce-repository.ts` (new)
- `tests/domain/product-commerce-admin.test.ts` (new)
- `tests/database/product-commerce-repository.test.ts` (new)
- one storefront convergence DB test only if required to prove the ordinary-product regression.

**Estimated scope:** Medium.

---

## A3 — Add product catalog enable/disable and combined quick-action backend

**Description**

Extend the new generic commerce boundary with two distinct product operations.

### Ordinary catalog toggle

`Tắt catalog`:

- ADMIN;
- route-owned product ID;
- product exists + `isPresent=true`;
- update only `ProductMirror.isActive=false`;
- no confirmation proof required because exposure is reduced.

`Bật catalog`:

- prepare operation reads current warning state and emits server-authenticated confirmation proof from A1;
- commit re-reads current warning state in the same transaction before any write;
- stale/invalid proof => `RECONFIRM_REQUIRED`, zero writes, fresh warning state returned;
- valid/current proof => update only `ProductMirror.isActive=true`.

### Combined quick action

`Bật sản phẩm + kích hoạt biến thể có hàng`:

- no browser variant IDs;
- transaction verifies product present;
- transaction checks current incoming composite membership across its variants; any current incoming edge => fail closed, zero writes;
- server computes present variants whose **summed** `WarehouseStock.quantity > 0`;
- updates product active + those variants active atomically;
- zero-stock variants stay unchanged.

**Acceptance criteria**

- [ ] product toggle never changes variant state;
- [ ] variant activation never changes product state;
- [ ] valid catalog-enable proof is target/actor/state-bound;
- [ ] relation/zero-active warning state change after prepare returns `RECONFIRM_REQUIRED` and product stays unchanged;
- [ ] quick action is impossible for current relation-linked child product;
- [ ] quick action can handle >100 eligible variants because the server computes them inside the transaction;
- [ ] positive stock means summed warehouse quantity `>0`, not merely “a stock row exists”.

**Verification**

Domain/DB tests:

- prepare + current commit success;
- prepare no relation → add incoming edge → old commit => reconfirm, zero write;
- prepare zero-active → activate a variant elsewhere → old commit => reconfirm;
- disable idempotency;
- quick action product inactive + stocked/unstocked variants;
- quick action child relation added before mutation => zero writes;
- multi-warehouse sum around zero/negative/positive;
- all unrelated mirrored fields/edges unchanged.

**Dependencies:** A1, A2 architecture boundary.

**Likely files**

- `src/commerce/product-commerce-admin.ts`
- `src/commerce/product-commerce-repository.ts`
- `src/commerce/admin-catalog-confirmation.ts`
- corresponding domain/database tests.

**Estimated scope:** Medium.

---

## A4 — Build the unified `Biến thể website` editor table

**Description**

Create a focused client interaction boundary for variant selection while keeping the product page Server Component as data/action owner.

Rows show:

- SKU/fallback label;
- color;
- size;
- summed stock;
- active/inactive/presence status;
- context badge (`Thường`, `Set cha`, `Thành phần set`);
- single-row action.

Selection behavior:

- <=100 present variants: whole-product `Chọn tất cả biến thể`, `Chọn biến thể có hàng`;
- >100 present variants: deterministic <=100 windows in existing `color,size,id` order;
- page-scoped labels explicitly say `trên trang này`;
- page/window change clears selection;
- no more than 100 browser IDs can be selected/submitted;
- no silent truncation;
- single-row activation remains available on every page.

Do not remove the existing composite activation sections in this task; that cleanup waits for PR-B.

**Acceptance criteria**

- [ ] ordinary product now exposes activation controls;
- [ ] single and bulk activation use A2;
- [ ] >100 product cannot generate a >100-ID request through UI;
- [ ] indeterminate/select-all semantics are programmatic and keyboard accessible;
- [ ] selection does not survive variant-page change;
- [ ] stock is display-only and not submitted as authority.

**Verification**

Browser/Axe test fixture covers:

- normal product inactive XL activation;
- select one / indeterminate / select all;
- select stocked;
- bulk activate/deactivate;
- 245-variant fixture: `1–100 / 245`, first page exactly 100 selected/submitted, page change resets, final page remainder;
- no page-level horizontal overflow;
- shared `BUYER_AXE_TAGS`.

Domain/DB tests continue to prove forged 101 IDs are rejected even if UI is bypassed.

**Dependencies:** A2.

**Likely files**

- `src/components/admin/product-variant-commerce-table.tsx` (new)
- `src/app/admin/products/[productId]/page.tsx`
- `tests/a11y-runtime/admin-editor.spec.ts` or a focused new admin variant spec
- Playwright allowlist only if a new spec file is created.

**Estimated scope:** Medium; keep UI/client state out of repository/service files.

---

## A5 — Wire product catalog and combined quick-action UX

**Description**

Add the product-level Website Commerce controls to the editor and use A3 for mutations.

Catalog enable uses the two-phase contract:

1. request server-prepared current summary/proof;
2. render explicit confirmation;
3. submit proof to commit;
4. if commit returns `RECONFIRM_REQUIRED`, do not write; render the fresh summary and require another confirmation.

Combined quick action:

- show only when current read model says there is no incoming composite membership;
- confirmation states how many current positive-stock variants are expected to activate;
- server still revalidates everything;
- current composite child rejection is handled clearly/accessibly if state changed after render.

Revalidate:

- current editor;
- `/admin`;
- `/shop`;
- current `/shop/[slug]` after successful commerce mutation.

**Acceptance criteria**

- [ ] product toggle and quick action are visually distinct;
- [ ] quick action is absent for relation-linked child product;
- [ ] catalog enable warning explicitly names standalone publication risk for child products;
- [ ] stale single-product confirmation receives focused/announced reconfirmation, not silent mutation;
- [ ] success/failure/reconfirmation has accessible feedback;
- [ ] storefront reflects successful product/variant activation without changing Pancake-owned fields.

**Verification**

Browser + DB assertions cover:

- enable ordinary product with no warning drift;
- child catalog enable with explicit publication warning;
- stale relation warning → `RECONFIRM_REQUIRED`, zero write, fresh warning;
- quick action ordinary product;
- quick action becomes child after render → fail closed;
- VoiceOver announcement + focus;
- Axe + overflow.

**Dependencies:** A3, A4.

**Likely files**

- `src/app/admin/products/[productId]/page.tsx`
- one small client confirmation component if interaction complexity warrants it
- product commerce service/repository only for behavior bugs exposed by tests
- admin browser spec.

**Estimated scope:** Medium.

---

## Checkpoint A — Generic commerce activation accepted

Before PR-A is considered implementation-complete:

- [ ] exact-head DB/domain/security/auth/lint/typecheck/build/release/start checks green;
- [ ] admin Axe/VoiceOver exact-head green;
- [ ] normal-product reported regression is proven end-to-end;
- [ ] composite parent/component activation still works through generic controls;
- [ ] confirmation proof gets focused security review;
- [ ] fresh review has **0 Critical / 0 Required**;
- [ ] ADR 0005 effective changed-line scope reviewed; split further if independent concerns or >800 changed lines without atomic justification.

Only then remove duplicated old composite UI in PR-B or reuse A-primitives in PR-C.

---

# PR-B — Compact product editor

PR-B is presentation/convergence work after commerce behavior is accepted. It must not silently introduce new mutation semantics.

## B1 — Reorder editor around a compact operational summary

**Description**

Refactor the product editor information architecture without changing accepted service/repository behavior.

Target top area:

- product name + slug/back link;
- catalog state;
- editorial state;
- active variants `X/N`;
- positive-stock variant count / total stock;
- collection count;
- Website Commerce actions/table.

Then:

- editorial content;
- collections;
- SEO;
- slug management;
- source disclosure last.

Prefer small extracted Server/Client components only when they reduce page complexity; do not introduce a new state-management layer.

**Acceptance criteria**

- [ ] commerce/edit actions are reachable before long source data;
- [ ] all existing editorial, collection, SEO, slug, and commerce behavior remains functional;
- [ ] no source data or controls disappear;
- [ ] semantic heading order remains logical;
- [ ] narrow layout has no page-level horizontal overflow.

**Verification**

Focused browser regression for information order, keyboard focus, existing save flows, variant actions and responsive layout; typecheck/build.

**Dependencies:** Checkpoint A.

**Likely files**

- `src/app/admin/products/[productId]/page.tsx`
- optional small `src/components/admin/product-editor-*.tsx` components
- `tests/a11y-runtime/admin-editor.spec.ts`.

**Estimated scope:** Medium.

---

## B2 — Collapse read-only Pancake source and remove duplicate activation sections

**Description**

Move current source-heavy content into semantic `<details>` collapsed by default:

- source description;
- source images;
- raw price/stock context;
- raw variant/source table;
- composite source/reference details not required for immediate activation.

Now that A4 is accepted, remove duplicate composite-specific activation sections from the page. Keep composite relation/reference data read-only in the disclosure; generic variant table remains the only activation control model.

Do **not** delete the old composite activation backend in the same change unless it is proven unreachable and removing it is independently small/reviewable. Dead backend cleanup can be a separate follow-up if necessary.

**Acceptance criteria**

- [ ] source disclosure collapsed by default and keyboard accessible;
- [ ] no Pancake-owned source data becomes editable;
- [ ] parent/component context still visible;
- [ ] no duplicate activation controls remain;
- [ ] generic table still activates normal, parent and component variants.

**Verification**

Browser/Axe/VoiceOver regression verifies `<details>`, source preservation, no duplicate action names, composite activation through generic table, focus/overflow.

**Dependencies:** B1, Checkpoint A.

**Likely files**

- `src/app/admin/products/[productId]/page.tsx`
- extracted admin editor components if already introduced in B1
- admin browser test.

**Estimated scope:** Small–Medium.

---

## Checkpoint B — Compact editor accepted

- [ ] exact-head CI + admin browser gates green;
- [ ] fresh review has 0 Critical / 0 Required;
- [ ] no business-logic changes hidden in the layout PR;
- [ ] source/editorial/slug/composite data remains present;
- [ ] ADR 0005 scope reviewed.

---

# PR-C — Bulk product operations and health

PR-C extends the already-existing `/admin` current-page selection model. It does not add persistent or cross-page selection.

## C1 — Add atomic bulk collection add/remove backend

**Description**

Extend the editorial/content boundary with explicit bulk membership operations rather than reusing full snapshot save.

Input:

- ADMIN;
- `1..100` unique product IDs;
- one collection slug;
- operation `add | remove`.

Server validates the collection via existing definitions before persistence.

Repository transaction:

- verify every product exists/present per spec contract;
- add: create minimal `ProductContent` for missing rows when needed, append only requested slug if absent;
- remove: remove only requested slug; missing content/already absent is idempotent;
- preserve all other memberships and editorial fields;
- any invalid/missing target => zero batch writes.

Use a DB-safe mutation strategy that does not reconstruct entire `ProductContent` rows from stale browser/current-page data.

**Acceptance criteria**

- [ ] add/remove exactly one validated collection;
- [ ] existing other collections preserved;
- [ ] editorial/SEO/mirrored fields preserved;
- [ ] missing ProductContent handled only as specified;
- [ ] atomic batch failure;
- [ ] no replace-all bulk operation.

**Verification**

Domain + PostgreSQL tests for add, remove, idempotency, missing content, invalid collection, missing/stale product, mixed batch, preservation of unrelated fields.

**Dependencies:** Checkpoint A for scheduling only; behavior is otherwise independent.

**Likely files**

- `src/commerce/product-content-admin.ts`
- `src/commerce/product-content-repository.ts`
- `src/app/admin/actions.ts`
- focused domain/database bulk collection tests.

**Estimated scope:** Medium.

---

## C2 — Add bulk catalog enable/disable with freshness proof

**Description**

Reuse A1/A3 primitives for exact current-page selected product IDs.

Prepare `Bật catalog`:

- validate `1..100` unique product IDs;
- verify current targets exist/present;
- compute exact current set with zero active present variants;
- compute exact current set with incoming composite membership;
- return operator summary + proof bound to actor, `enable`, exact selected IDs, exact warning sets, expiry.

Commit:

- revalidate all targets and warning sets inside one transaction before write;
- proof mismatch/drift => `RECONFIRM_REQUIRED`, zero batch writes, fresh summary;
- current proof => update only selected `ProductMirror.isActive=true` atomically.

Bulk disable:

- no publication-risk proof;
- current target validation + atomic update only `ProductMirror.isActive=false`.

**Acceptance criteria**

- [ ] bulk catalog never changes variant state;
- [ ] old confirmation cannot publish a product after warning-relevant relation/zero-active state changes;
- [ ] one stale/missing target => zero writes;
- [ ] exact target set is proof-bound;
- [ ] browser counts are not authoritative.

**Verification**

Domain/DB tests:

- valid prepare/commit;
- relation added/removed after prepare;
- active-variant warning changes after prepare;
- selected target changed/missing;
- proof for different selection/actor rejected;
- whole-batch zero writes on reconfirm;
- disable atomic/idempotent.

**Dependencies:** A1, A3 confirmation/catalog primitives, Checkpoint A.

**Likely files**

- `src/commerce/product-commerce-admin.ts`
- `src/commerce/product-commerce-repository.ts`
- `src/commerce/admin-catalog-confirmation.ts`
- `src/app/admin/actions.ts`
- focused domain/database tests.

**Estimated scope:** Medium.

---

## C3 — Add exact directory health read model and filters

**Description**

Extend the server-owned directory query/read model so health filters are real database predicates, not post-filtering of the current 40 rows.

Add one bounded `health` dimension to `AdminProductDirectoryQuery` with values equivalent to:

- `stocked-inactive` — at least one present inactive variant whose **summed** warehouse stock is `>0`;
- `zero-active` — zero present active variants;
- `no-collection` — current uncategorized semantics;
- `catalog-inactive` — `ProductMirror.isActive=false`;
- `missing-image` — `primaryImageUrl` absent in the current admin read model.

The existing `activity`/`uncategorized` dimensions remain compatible. If a health chip is a semantic alias of an existing filter, serialize to one canonical URL representation rather than creating two competing meanings.

Directory row projection must return server-derived metrics needed by UI:

- total present variants;
- active present variants;
- count of present inactive variants with summed stock `>0`;
- collection count / image presence already available as needed.

For `stocked-inactive`, use an exact DB-side aggregate/correlated query or a proven equivalent. Do not implement `warehouseStocks: { some: { quantity: { gt: 0 }}}` because multiple warehouses can sum to zero or negative.

**Acceptance criteria**

- [ ] filter applies to full catalog before pagination;
- [ ] counts and own filter URL describe the same result set;
- [ ] health can compose with query/status/collection/activity where semantically valid;
- [ ] filter changes reset page to 1;
- [ ] no N+1 per-product DB reads;
- [ ] row reports `active / total` accurately for present variants.

**Verification**

Domain URL parser/serializer tests and PostgreSQL directory tests covering:

- multi-warehouse summed-stock edge cases;
- inactive stocked variant;
- no active variants;
- catalog inactive;
- missing image;
- composition with search/status/collection;
- page reset/canonical serialization;
- metrics match filter truth.

**Dependencies:** can start after Checkpoint A; independent of C1/C2.

**Likely files**

- `src/commerce/admin-product-directory.ts`
- `src/commerce/product-content-repository.ts` or a dedicated admin-directory repository helper if SQL complexity warrants separation
- `src/app/admin/page.tsx`
- directory domain/database tests.

**Estimated scope:** Medium.

---

## C4 — Expand the existing bulk toolbar

**Description**

Extend `AdminProductBulkTable` instead of building a second selection system.

Operation families:

- existing editorial status;
- add collection;
- remove collection;
- enable catalog;
- disable catalog.

Pass bounded collection choices from server. Keep current-page selection only.

For bulk catalog enable:

1. request current server-prepared warning/proof;
2. show zero-active + composite-publication summaries;
3. operator confirms;
4. commit;
5. stale state => accessible `RECONFIRM_REQUIRED` + fresh summary, keep selection, require another confirmation.

Collection/catalog actions should use a clear operation selector rather than exposing many always-visible destructive buttons.

**Acceptance criteria**

- [ ] existing bulk status still works;
- [ ] add/remove collection uses C1;
- [ ] enable/disable catalog uses C2;
- [ ] selection stays current-page only and resets on directory navigation as it does today;
- [ ] success clears selection; recoverable error/reconfirmation keeps useful selection;
- [ ] confirmations are cancellable and keyboard accessible.

**Verification**

Browser/Axe/VoiceOver covers each operation, selection/indeterminate, reconfirm freshness, focus/announcements, no horizontal overflow, and preserved existing bulk-status behavior.

**Dependencies:** C1, C2, accepted current bulk selection behavior.

**Likely files**

- `src/components/admin/admin-product-bulk-table.tsx`
- `src/app/admin/actions.ts`
- `src/app/admin/page.tsx`
- `tests/a11y-runtime/admin-bulk-status.spec.ts` (rename/split only if it improves scope clarity)
- Playwright config if test file names change/add.

**Estimated scope:** Medium–Large. Split collection and catalog UI into separate PR-C sub-slices if effective diff exceeds ADR 0005 reviewability guidance or review surface becomes mixed.

---

## C5 — Surface health metrics and operational filters

**Description**

Render C3 server-owned metrics in the directory:

- `Biến thể: X / N active`;
- warning count `N variant có hàng nhưng đang tắt` when >0;
- health filter/chip controls for the approved blockers.

Use the same query-target/count source of truth pattern already used by status/collection facets so chip labels, counts, and links cannot drift.

Do not add a numeric synthetic health score.

**Acceptance criteria**

- [ ] operator can find stocked-but-inactive products without opening editors;
- [ ] `0 active`, no collection, catalog inactive, missing image filters work against full catalog;
- [ ] row health matches DB truth and editor state;
- [ ] filters preserve compatible search/status/etc and reset pagination;
- [ ] existing URL parsing remains fail-closed for malformed/duplicate values.

**Verification**

Domain/DB/browser regressions for filters, row metrics, links/counts, current-page selection reset after navigation, Axe/keyboard/overflow.

**Dependencies:** C3; integrate after C4 if same branch or independently before final PR-C convergence.

**Likely files**

- `src/commerce/admin-product-directory.ts`
- repository directory query
- `src/app/admin/page.tsx`
- `src/components/admin/admin-product-bulk-table.tsx`
- domain/database/a11y runtime tests.

**Estimated scope:** Medium.

---

## Checkpoint C — Admin Product Management V3 implementation complete

Automated exact-head gate for the final implementation slice:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm prisma:validate
pnpm prisma:generate
pnpm prisma:migrate:deploy
pnpm test:db
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Also require existing CI HTTP/security/admin auth smokes, release/start smokes, and admin browser runtime:

```bash
cd tests/a11y-runtime
npm ci --ignore-scripts --no-audit --no-fund
npx playwright install chromium
npx playwright test --config playwright.config.ts
```

CI remains the canonical evidence for steps requiring its PostgreSQL/macOS/VoiceOver environment.

Final behavioral acceptance:

- [ ] ordinary product variants can be activated singly/in bulk;
- [ ] composite parent/component variants use the same generic table;
- [ ] product and variant activation remain independent;
- [ ] combined quick action activates current positive-stock variants only and cannot publish current composite children;
- [ ] single and bulk catalog enable are confirmation-fresh at commit time;
- [ ] >100 variant UI never creates an oversized generic batch;
- [ ] bulk collection add/remove preserves unrelated membership/content;
- [ ] bulk catalog enable/disable never changes variant state;
- [ ] compact editor prioritizes operational controls and source disclosure is collapsed;
- [ ] health filters/metrics reflect full-catalog DB truth;
- [ ] Pancake-owned price, stock, media/source identity, and composite edges remain unchanged;
- [ ] no schema/dependency/sync behavior change occurred without separate approval;
- [ ] fresh final review: 0 Critical / 0 Required;
- [ ] trusted real-catalog smoke after deployment verifies at least one normal product and one composite product through admin → storefront.

## Risk register and stop conditions

| Risk | Mitigation / stop condition |
|---|---|
| Catalog confirmation proof can be forged/replayed | A1 domain separation + actor/target/state/expiry binding + security review. Stop before adding new secret/schema if existing-secret reuse is rejected. |
| Stale confirmation publishes an unacknowledged composite child | prepare/commit reread + exact warning-state proof + `RECONFIRM_REQUIRED` zero-write path. |
| >100 variants break selection semantics | page/window <=100; page-scoped selection; forged oversized input rejects server-side. |
| Generic activation weakens composite safety | activation changes only `VariantMirror.isActive`; relation edges stay source-owned/read-only; cart/storefront guards unchanged. |
| Bulk collection update overwrites editorial content | narrow add/remove repository operation; never reconstruct full content snapshot from browser data. |
| Health filter lies due to current-page computation | DB-side full-catalog predicate before pagination; exact aggregate stock semantics. |
| PR becomes hard to review | apply ADR 0005 after each slice; split independent UI/backend work rather than crossing >800 changed lines by default. |
| Editor refactor hides behavior changes | PR-B must reuse accepted A services/actions and carry browser regressions; no new business rule in layout-only task. |

## Parallelization and ownership

Safe after Checkpoint A:

```text
Lane 1: B1 -> B2
Lane 2: C1 + C3, then C2/C4/C5 convergence
```

Rules:

- A1 confirmation helper has one owner; C2 reuses it rather than forking a second proof format.
- `src/app/admin/products/[productId]/page.tsx` should not be concurrently modified by PR-A and PR-B branches without rebasing after A acceptance.
- `src/components/admin/admin-product-bulk-table.tsx` is PR-C-owned once C4 starts.
- `product-content-repository.ts` changes from C1 and C3 must be coordinated; if both become non-trivial, extract directory/commerce helpers rather than merge conflicting broad repository edits.

## Definition of Done overlay

In addition to each task's acceptance criteria, every implementation PR must satisfy the repository Definition of Done:

- spec/plan scope traceable;
- security boundary explicit;
- no unrelated refactor;
- test evidence discriminates the changed behavior;
- exact-head CI green before completion claim;
- browser-facing changes have relevant Axe/VoiceOver evidence;
- PR scope/reviewability checked against ADR 0005;
- fresh review has no Critical/Required finding;
- no deployment/live-catalog claim without actual runtime evidence.

## Human gate

This plan is intentionally **not approved by its own creation**. The spec is approved; the plan requires human review/approval before `/build` begins.

No runtime code, migration, dependency, sync behavior, or deployment is authorized by adding this planning document alone.
