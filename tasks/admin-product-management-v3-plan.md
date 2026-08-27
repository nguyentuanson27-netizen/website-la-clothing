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
- `src/commerce/product-media.ts` owns the reviewed image-trust predicate via `parseTrustedProductImageUrl()`. V3 health classification must use that trust contract across `ProductMirror.primaryImageUrl` plus `VariantMirror.pancakeImageUrls` from present variants; it must not infer `Thiếu ảnh` from `primaryImageUrl` alone.
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

A2 generic variant activation backend
  └─> A4 generic variant editor UI

A1 + A2
  └─> A3 product catalog + quick-action backend
        └─> A5 catalog/quick-action editor UI

A4 + A5
  └─> Checkpoint A / PR-A
        └─> B1 compact editor IA
              └─> B2 collapse source + remove duplicate composite activation UI
                    └─> Checkpoint B / PR-B

C1 bulk collection backend ───────────────┐
A1 + A3 -> C2 bulk catalog backend ──────┼─> C4 bulk toolbar UI
C3 directory health read model ──────────┘       └─> C5 browser/runtime convergence
                                                    └─> Checkpoint C / PR-C
```

C1 and C3 may start in parallel with late PR-A work because they do not depend on the product-editor UI. C2 waits for the shared confirmation/commerce contracts from PR-A. PR-B and PR-C backend work may proceed in parallel, but avoid concurrent edits to the same admin page/component branch.

---

# PR-A — Generic commerce activation

## Task A1 — Implement the catalog confirmation proof primitive

**Description:** Create the server-authenticated prepare/commit proof primitive required by the approved stale-confirmation contract. This task contains no product write logic yet; it establishes the security boundary reused by single-product and bulk catalog enable.

**Acceptance criteria:**
- [ ] proof is bound to actor, operation, exact target(s), warning state, version, and expiry;
- [ ] tampered, malformed, expired, wrong-actor, wrong-operation, and wrong-target proofs fail closed;
- [ ] canonicalization is deterministic, including sorted bulk target/warning sets.

**Verification:**
- [ ] RED/GREEN focused domain tests for sign/verify and every rejection class;
- [ ] `pnpm test:domain`;
- [ ] security review confirms no raw secret/proof payload is logged and comparison is timing-safe.

**Dependencies:** None.

**Files likely touched:**
- `src/commerce/admin-catalog-confirmation.ts`
- `tests/domain/admin-catalog-confirmation.test.ts`
- `src/auth/config.ts` only if a narrow read-only secret accessor is needed; do not change auth semantics.

**Estimated scope:** S–M.

## Task A2 — Add generic variant activation service/repository

**Description:** Add ADMIN-only generic activation for `1..100` unique variants belonging to one route-owned product. Unlike the current composite-specific paths, membership in a composite relation is not required.

**Acceptance criteria:**
- [ ] ordinary, composite-parent, and composite-child present variants can be activated/deactivated through the same service;
- [ ] cross-product, duplicate, malformed, >100, stale, and `isPresent=false` targets produce zero writes;
- [ ] the write changes only `VariantMirror.isActive` and is atomic/idempotent per submitted batch.

**Verification:**
- [ ] RED/GREEN domain parser/auth tests;
- [ ] RED/GREEN PostgreSQL repository tests including mixed-valid/invalid atomic rollback;
- [ ] regression fixture for the reported normal product with stock and inactive XL;
- [ ] `pnpm test:domain` and `pnpm test:db`.

**Dependencies:** None.

**Files likely touched:**
- `src/commerce/product-commerce-admin.ts`
- `src/commerce/product-commerce-repository.ts`
- `tests/domain/product-commerce-admin.test.ts`
- `tests/database/product-commerce-repository.test.ts`

**Estimated scope:** M.

## Task A3 — Add product catalog enable/disable and combined quick-action backend

**Description:** Extend the generic commerce boundary with product catalog state, two-phase single-product enable confirmation, and the combined `Bật sản phẩm + kích hoạt biến thể có hàng` transaction.

**Acceptance criteria:**
- [ ] plain enable/disable mutates only `ProductMirror.isActive`;
- [ ] enable prepare returns current warning state + proof; commit re-reads current state and returns `RECONFIRM_REQUIRED` with zero writes on warning drift;
- [ ] quick action recomputes current positive summed stock, activates product + only eligible present variants atomically, and rejects any current incoming composite membership before writes.

**Verification:**
- [ ] domain tests for ADMIN/auth/input/result contracts;
- [ ] DB stale-confirmation regression: prepare as ordinary/no-warning → add incoming composite edge → old proof commit → zero writes + reconfirm result;
- [ ] DB quick-action regression including zero-stock unchanged and edge-added-after-render failure;
- [ ] `pnpm test:domain` and `pnpm test:db`.

**Dependencies:** A1, A2.

**Files likely touched:**
- `src/commerce/product-commerce-admin.ts`
- `src/commerce/product-commerce-repository.ts`
- `tests/domain/product-commerce-admin.test.ts`
- `tests/database/product-commerce-repository.test.ts`
- existing storefront composite/normal projection DB test only if needed to prove convergence end-to-end.

**Estimated scope:** M.

## Task A4 — Build the unified variant table with bounded selection

**Description:** Add a small client boundary for the product editor's `Biến thể website` table. Keep the page server-rendered and pass route-bound Server Actions into the client component.

**Acceptance criteria:**
- [ ] every present ordinary/composite variant appears with stock, activation state, and context badges;
- [ ] <=100 products support whole-product select-all/select-stocked; >100 products use stable <=100 windows with page-scoped selection, range feedback, and selection reset on page change;
- [ ] single-row and selected-batch activation/deactivation use the generic service and never submit >100 IDs or silently truncate.

**Verification:**
- [ ] component/browser regression for select-all, indeterminate state, select-stocked, page/window behavior, and forged 101-ID server rejection;
- [ ] ordinary product XL can be activated from admin and persists as active;
- [ ] no page-level horizontal overflow and Axe shared tags remain clean.

**Dependencies:** A2.

**Files likely touched:**
- `src/components/admin/admin-product-variant-table.tsx`
- `src/app/admin/products/[productId]/page.tsx`
- `tests/a11y-runtime/admin-editor.spec.ts`
- `tests/a11y-runtime/playwright.config.ts` only if a new spec file is introduced instead of extending the existing one.

**Estimated scope:** M.

## Task A5 — Add catalog controls and quick-action confirmation to the editor

**Description:** Add compact product catalog controls plus the explicit combined quick action using the A1/A3 prepare/commit contracts. Relation-linked child products keep generic variant controls but do not get the combined shortcut.

**Acceptance criteria:**
- [ ] `Bật catalog` uses fresh server confirmation and surfaces `RECONFIRM_REQUIRED` with a new warning when relation/zero-active state changes;
- [ ] `Tắt catalog` requires normal ADMIN/current-target validation but no publication-risk handshake;
- [ ] combined quick action is absent for current composite children and succeeds for ordinary products using server-computed stock.

**Verification:**
- [ ] browser test covers single-product confirmation, stale confirmation, quick-action eligibility, success/failure focus, and VoiceOver announcement;
- [ ] storefront projection includes the newly activated normal variant subject to existing price/stock guards;
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build`.

**Dependencies:** A1, A3, A4.

**Files likely touched:**
- `src/components/admin/admin-product-commerce-panel.tsx`
- `src/app/admin/products/[productId]/page.tsx`
- `tests/a11y-runtime/admin-editor.spec.ts`
- one focused DB/storefront regression file if A3 did not already cover public projection.

**Estimated scope:** M.

### Checkpoint A — PR-A quality gate

Before PR-A is merge-ready:

- [ ] exact-head CI `verify` and `admin-a11y-runtime` are green;
- [ ] Catalog indexation and P18 runtime workflows are green when triggered;
- [ ] fresh review has 0 Critical / 0 Required findings;
- [ ] diff remains one coherent commerce-activation concern under ADR 0005; if it exceeds the reviewability threshold, split at the pre-defined backend/UI boundary rather than cutting tests away from behavior;
- [ ] no schema/dependency/sync behavior change was introduced.

---

# PR-B — Compact product editor

## Task B1 — Reorder the editor around operator-critical commerce/editorial state

**Description:** Restructure the product editor information architecture without changing mutation semantics. Put compact summary + Website Commerce first, then editorial/collections/SEO, with slug and source data later.

**Acceptance criteria:**
- [ ] top summary shows catalog, editorial status, active variant coverage, stock, and collection count;
- [ ] Website Commerce and variant actions are reachable before long source content;
- [ ] existing editorial save, collection membership edit, slug edit, and all commerce actions retain behavior.

**Verification:**
- [ ] browser checks heading/order and keyboard focus order;
- [ ] existing admin editor runtime remains green;
- [ ] Axe/VoiceOver and mobile overflow checks remain green.

**Dependencies:** Checkpoint A accepted or A4/A5 contracts stable.

**Files likely touched:**
- `src/app/admin/products/[productId]/page.tsx`
- `src/components/admin/admin-product-commerce-panel.tsx`
- optional `src/components/admin/admin-product-editor-summary.tsx`
- `tests/a11y-runtime/admin-editor.spec.ts`

**Estimated scope:** M.

## Task B2 — Collapse Pancake source context and remove duplicate composite activation UI

**Description:** Move long read-only Pancake/source content into a semantic collapsed `<details>` and remove the old composite-specific activation sections once the generic variant table proves equivalent controls. Preserve composite relation/reference information as read-only context.

**Acceptance criteria:**
- [ ] source description, images, price/stock detail, raw variant data, and non-action composite reference data remain available inside the collapsed disclosure;
- [ ] duplicate `Kích hoạt biến thể set` / `Kích hoạt biến thể bán qua set` control sections are gone;
- [ ] generic table context badges still expose ordinary/set-parent/set-component identity without changing relation persistence.

**Verification:**
- [ ] browser test proves `<details>` is collapsed by default and source data remains accessible after expansion;
- [ ] composite parent/child activation still works from the generic table;
- [ ] no source/Pancake mutation path is introduced.

**Dependencies:** B1, A4.

**Files likely touched:**
- `src/app/admin/products/[productId]/page.tsx`
- `src/components/admin/admin-product-commerce-panel.tsx` or a small source-disclosure component
- `tests/a11y-runtime/admin-editor.spec.ts`

**Estimated scope:** S–M.

### Checkpoint B — PR-B quality gate

- [ ] exact-head CI + admin browser/Axe/VoiceOver green;
- [ ] fresh review has 0 Critical / 0 Required;
- [ ] no business-logic rewrite is hidden inside the layout PR;
- [ ] all editor capabilities present before PR-B remain available.

---

# PR-C — Bulk product operations and health

## Task C1 — Add atomic bulk collection add/remove backend

**Description:** Extend the existing website-owned content boundary with `1..100` selected-product add/remove semantics for one validated collection definition.

**Acceptance criteria:**
- [ ] add preserves existing memberships and creates only minimal missing `ProductContent` rows;
- [ ] remove deletes only the selected slug and preserves all other content/memberships;
- [ ] invalid collection, missing target, duplicate/oversized/malformed IDs, or persistence failure causes zero partial writes.

**Verification:**
- [ ] domain tests for auth/input/canonical collection resolution;
- [ ] DB tests prove add/remove idempotence, preservation, and atomic failure;
- [ ] `pnpm test:domain` + `pnpm test:db`.

**Dependencies:** None after plan approval.

**Files likely touched:**
- `src/commerce/product-content-admin.ts`
- `src/commerce/product-content-repository.ts`
- `tests/domain/product-content-bulk-collection-admin.test.ts`
- `tests/database/product-content-bulk-collection-repository.test.ts`

**Estimated scope:** M.

## Task C2 — Add bulk catalog enable/disable backend with reconfirmation

**Description:** Reuse the generic product-commerce and confirmation contracts for current-page selected products. Bulk enable prepare binds exact selected IDs and the exact warning sets; commit re-reads current state and fails the entire batch on warning drift.

**Acceptance criteria:**
- [ ] enable prepare reports exact zero-active and incoming-composite target sets and returns a proof bound to them;
- [ ] relation/zero-active/target changes after prepare return `RECONFIRM_REQUIRED` with zero writes for the whole batch;
- [ ] disable changes only `ProductMirror.isActive`, validates all selected targets atomically, and never changes variant state.

**Verification:**
- [ ] domain tests for 1..100 input/auth/proof handling;
- [ ] DB stale-confirmation regression where one selected product gains an incoming edge after prepare;
- [ ] missing/stale target causes zero batch writes;
- [ ] `pnpm test:domain` + `pnpm test:db`.

**Dependencies:** A1, A3.

**Files likely touched:**
- `src/commerce/product-commerce-admin.ts`
- `src/commerce/product-commerce-repository.ts`
- `src/app/admin/actions.ts`
- `tests/domain/product-commerce-admin.test.ts`
- `tests/database/product-commerce-repository.test.ts`

**Estimated scope:** M.

## Task C3 — Add exact admin health read model and filters

**Description:** Extend directory query/read logic with actionable health states while preserving correct pagination/count semantics. Implement the exact positive **summed** stock rule; do not substitute “any warehouse row > 0” unless a separately proven invariant makes them equivalent.

**Health contract:**

- `stocked-inactive` — at least one present inactive variant whose summed warehouse stock is >0;
- `zero-active` — no present active variants;
- `no-collection` — reuse existing uncategorized semantics;
- `catalog-inactive` — reuse existing activity=false semantics;
- `missing-image` — there is no image candidate accepted by the existing `parseTrustedProductImageUrl()` contract across `ProductMirror.primaryImageUrl` and `VariantMirror.pancakeImageUrls` belonging to variants with `isPresent=true`. A trusted present-variant image clears this health state even when the product primary image is absent; media found only on stale `isPresent=false` variants does not. Variant `isActive` is intentionally irrelevant because this health state measures mirrored media readiness, not commerce activation.

Use one explicit `health` query dimension for V3 rather than stacking multiple health predicates in one URL. Existing search/status/collection/activity/sort state remains composable. The `missing-image` list/count predicate must be evaluated before pagination. If the repository implements a DB-side equivalent instead of invoking the pure parser directly, its accepted/rejected URL semantics must be proven against `parseTrustedProductImageUrl()` fixtures; do not replace the rule with `primaryImageUrl IS NULL` and do not post-filter only the current page.

**Acceptance criteria:**
- [ ] each health filter is parsed/serialized deterministically and resets page to 1 when changed;
- [ ] counts/list results use the same predicate so chips never advertise a different result set than their links;
- [ ] `stocked-inactive` uses DB-side aggregate truth compatible with pagination rather than post-filtering the current page;
- [ ] `missing-image` follows the approved source fields/trust rule exactly: null primary + trusted image on a present variant is **not** missing; only absent/blank/rejected candidates (or images only on stale variants) are missing.

**Verification:**
- [ ] domain tests for parser/href behavior;
- [ ] DB tests for every health predicate, especially multi-warehouse positive-sum/zero-sum cases;
- [ ] DB image-health fixtures cover trusted primary, trusted variant-only media with null primary, untrusted/malformed URLs, and stale-variant-only media;
- [ ] any DB-side image predicate is parity-tested against `parseTrustedProductImageUrl()` for the same URL fixtures;
- [ ] pagination/facet count regression remains correct.

**Dependencies:** None for read-model work; coordinate with C4 UI.

**Files likely touched:**
- `src/commerce/admin-product-directory.ts`
- `src/commerce/product-content-repository.ts`
- `tests/domain/admin-product-directory.test.ts`
- one existing/new DB admin-directory test file.

**Estimated scope:** M; this is the highest query-complexity task in PR-C and should fail fast before UI work.

## Task C4 — Extend the bulk toolbar for collection and catalog operations

**Description:** Reuse the existing current-page selection boundary. Add operation choice, collection selector, prepare/confirm/reconfirm state for catalog enable, and explicit catalog disable confirmation without creating a second selection model.

**Acceptance criteria:**
- [ ] selected products can add/remove one existing collection and enable/disable catalog;
- [ ] catalog enable confirmation exposes zero-active + composite-publication warnings and `RECONFIRM_REQUIRED` refreshes the summary without losing selected IDs;
- [ ] success clears selection; recoverable error/reconfirm preserves selection; all feedback is accessible.

**Verification:**
- [ ] browser runtime covers add/remove, enable/disable, stale bulk confirmation, cancel/reconfirm, current-page select-all/indeterminate state;
- [ ] no operation changes unrelated editorial fields or variants;
- [ ] Axe shared tags + VoiceOver + overflow checks pass.

**Dependencies:** C1, C2.

**Files likely touched:**
- `src/components/admin/admin-product-bulk-table.tsx`
- `src/app/admin/actions.ts`
- `src/app/admin/page.tsx`
- `tests/a11y-runtime/admin-bulk-status.spec.ts` or a renamed/split bulk-operations spec
- `tests/a11y-runtime/playwright.config.ts` only if adding a new spec file.

**Estimated scope:** M.

## Task C5 — Surface health metrics/filters in the directory

**Description:** Wire the C3 read model into `/admin` rows and controls. Show activation coverage and stocked-inactive warning counts without duplicating business rules in the client.

**Acceptance criteria:**
- [ ] each row shows `active / total present` variant coverage and a stocked-inactive warning count when applicable;
- [ ] health filters open the exact server-filtered result set and compose with current query dimensions;
- [ ] current-page selection resets on directory navigation exactly as it does today.

**Verification:**
- [ ] browser tests for each health filter URL/result and row metrics;
- [ ] `missing-image` browser fixture includes a product with null primary + trusted present-variant media and proves it is excluded, plus a product with only rejected/stale media and proves it is included;
- [ ] no stale page carry-over when a health filter shortens result count;
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm build` and admin browser runtime green.

**Dependencies:** C3, C4 UI structure stable.

**Files likely touched:**
- `src/app/admin/page.tsx`
- `src/components/admin/admin-product-bulk-table.tsx`
- `src/commerce/product-content-repository.ts`
- `tests/a11y-runtime/admin-bulk-status.spec.ts` or bulk-operations equivalent.

**Estimated scope:** M.

### Checkpoint C — PR-C / V3 implementation quality gate

Before V3 implementation is considered complete:

- [ ] exact-head CI `verify` and `admin-a11y-runtime` green;
- [ ] Catalog indexation / P18 runtime checks green when triggered;
- [ ] fresh review has 0 Critical / 0 Required;
- [ ] current production/staging deployment then receives trusted real-catalog acceptance for:
  - normal product single + bulk variant activation;
  - composite parent/component activation through the generic table;
  - product catalog enable/disable and quick action;
  - bulk collection add/remove;
  - bulk catalog warnings/reconfirmation;
  - health filters/metrics;
- [ ] Pancake-owned price, inventory, source identity, images, and composite relations remain unchanged by every new mutation;
- [ ] no schema/dependency/sync behavior change was introduced without a separate approved decision.

## Verification commands

Focused tests should be run while developing each task, followed by the repository gates appropriate to the slice.

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm prisma:validate
pnpm prisma:generate
pnpm prisma:migrate:deploy
pnpm test:db
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

CI also runs the existing HTTP/security/auth smokes, shipping/release/start checks, and on macOS:

```bash
cd tests/a11y-runtime
npm ci --ignore-scripts --no-audit --no-fund
npx playwright install chromium
./node_modules/.bin/guidepup setup
./node_modules/.bin/guidepup install
npx playwright test --config playwright.config.ts
```

Do not claim local/browser/live verification unless the exact command/run was actually observed.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| stale operator confirmation publishes a newly-linked composite child | server-authenticated two-phase proof + current-state comparison + `RECONFIRM_REQUIRED` zero-write path |
| >100 variants creates impossible select-all contract | deterministic <=100 selection windows; no silent truncation; quick action remains server-computed |
| generic activation weakens composite guards | mutate only `VariantMirror.isActive`; composite edges remain read-only source identity |
| product editor PR becomes an unrelated redesign | behavior first in PR-A, layout-only convergence in PR-B |
| bulk operations overwrite stale editorial data | narrow repository patch operations; never reconstruct whole `ProductContent` from table state |
| health filter breaks pagination/count truth | exact DB-side predicate shared by list/count; dedicated DB regression before UI |
| `missing-image` drifts from the existing media trust contract | source fields are explicit; present variant media counts; DB predicate must prove parity with `parseTrustedProductImageUrl()` instead of checking primary-image nullability only |
| confirmation proof introduces secret/key risk | reuse existing validated server config only with domain separation; stop for approval if a new secret/config is required |
| PR scope becomes too large | use ADR 0005 effective-line reviewability; split at pre-defined vertical boundaries, never by separating directly affected tests from behavior |

## Parallelization

Safe after plan approval:

- A1 confirmation helper and A2 generic variant backend can be developed in parallel if they do not edit the same new service file.
- C1 bulk collection backend can proceed independently of PR-A.
- C3 health read-model work can proceed independently of PR-A UI.
- PR-B UI cleanup can overlap with C1/C2 backend work after A4/A5 contracts are stable.

Must be sequential:

- A3 waits for A1/A2.
- A5 waits for A3/A4.
- B2 waits for generic variant controls before deleting composite-specific controls.
- C2 waits for the shared proof/commerce contracts.
- C4 waits for C1/C2 backend contracts.

## Definition of Done overlay

Per-task acceptance criteria are necessary but not sufficient. Before any implementation PR is called complete, also apply the repository standing DoD:

- runtime correctness where relevant, not only typecheck;
- RED/GREEN tests for changed behavior plus existing tests green;
- no unrelated refactor/dead/debug code;
- authorization/input validation on every admin mutation;
- integration with storefront/admin paths verified;
- accessibility/browser coverage for changed operator flows;
- docs/current-truth updated if implementation decisions change;
- rollback/revert remains straightforward because each PR is a coherent vertical slice.

## Human gate

The V3 spec is approved. This plan is **not yet an implementation authorization** until the human reviews/approves this plan. After approval, `/build` should begin with Task A1/A2 (or one of the explicitly safe parallel backend tasks) and follow TDD + incremental implementation.