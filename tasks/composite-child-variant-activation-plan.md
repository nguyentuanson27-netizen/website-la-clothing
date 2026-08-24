# Composite child-variant activation — implementation plan

Status: **DRAFT — planning/review only. Human approval required before production code.**

Source of truth: `docs/design/composite-child-variant-activation.md`.

After approval, implementation continues on this same branch/PR. Before the first implementation commit, refresh the branch onto the then-current `main` and recheck the affected source because V3 U0 is landing independently.

## Authoritative dependency graph

```text
C0 → C1 → C2 → C3 → C4
```

- C0 locks the failure and safety contract with RED tests.
- C1 adds the smallest authorized mutation boundary.
- C2 exposes the existing global variant state in the correct admin UI ownership location and fixes misleading parent status.
- C3 proves storefront/cart/checkout behavior end-to-end without changing their architecture unless a real defect is discovered.
- C4 is final verification/review/operational readiness.

No task may auto-activate from sync, publish the child product, infer relations, or add per-edge activation persistence.

## Pre-implementation checkpoint — branch refresh

**Description:** Preserve the planning PR now, but start code only from current project truth.

**Acceptance criteria:**
- [ ] human has approved the spec/plan;
- [ ] branch is updated from current `main` after V3 U0's current review unit is resolved;
- [ ] PR diff is re-audited before RED tests so no stale assumption from base `e2a14d6` remains;
- [ ] production implementation still fits the no-schema/no-new-dependency plan.

**Verification:**
- [ ] record exact new base/main SHA in PR body;
- [ ] re-fetch `catalog-mirror-repository.ts`, `storefront-product-detail.ts`, `anonymous-cart.ts`, `guest-checkout-snapshot.ts`, `product-content-repository.ts`, and admin editor;
- [ ] if any activation/commerce contract changed, stop and revise the spec before coding.

**Dependencies:** Human approval.

**Files likely touched:** PR body/docs only.

**Estimated scope:** XS.

---

## C0 — Reproduce inactive-component failure and lock boundaries

**Description:** Add tests first that model the real live state: persisted composite relation exists, stock exists, but the child variant remains locally inactive after sync. Prove the parent cannot offer that child until activation and lock the private-child boundary before writing mutation code.

**Acceptance criteria:**
- [ ] RED fixture has active/present parent product + parent variant, inactive-but-present child product, inactive-but-present child variant, real `CompositeComponentMirror` edge, valid size/price/stock;
- [ ] RED proves the inactive child is omitted/unpurchasable from the parent projection even though the relation and stock exist;
- [ ] regression explicitly proves direct child PDP remains unavailable while child product is inactive.

**Verification:**
- [ ] focused DB test is executed on a test-only RED commit/head and fails for the expected missing activation workflow;
- [ ] existing P17 active-component regression remains green, proving the architecture itself still works when `VariantMirror.isActive=true`;
- [ ] no production file changes in the RED step.

**Dependencies:** Pre-implementation checkpoint.

**Files likely touched:**
- `tests/database/storefront-composite-projection.test.ts`
- optionally one focused new DB test file if keeping activation cases isolated

**Estimated scope:** Small.

---

## C1 — Add authorized relation-linked variant activation service

**Description:** Add a focused admin mutation boundary for the existing global `VariantMirror.isActive` state. The service must authorize the caller and the repository must prove the variant is a present component variant of the child product being edited before writing.

### Proposed module split

Prefer two focused modules rather than expanding editorial-content repositories:

- `src/commerce/composite-component-admin.ts` — input parsing, authorization, result semantics;
- `src/commerce/composite-component-repository.ts` — Prisma relation verification + atomic state update.

Names may change during implementation if an existing current-main pattern is clearly better, but responsibilities must remain separated from editorial content.

**Acceptance criteria:**
- [ ] service requires ADMIN and validates bounded product/variant ids plus boolean target state;
- [ ] repository verifies `componentVariant.productId === childProductId` and at least one current incoming `CompositeComponentMirror` edge before mutation;
- [ ] activation of stale/not-present child product or variant fails closed;
- [ ] mutation changes only `VariantMirror.isActive`; no `ProductMirror`, edge, stock, price, slug, content, or Pancake write;
- [ ] setting the already-current state is idempotent;
- [ ] arbitrary/unlinked/cross-product variant ids cannot be toggled by crafted input.

**Verification:**
- [ ] RED/GREEN domain tests for unauthenticated, forbidden, malformed, unrelated, no-edge, stale, valid, and idempotent cases;
- [ ] RED/GREEN DB tests prove persisted state and exact relation guard;
- [ ] query/update stays bounded and transactionally revalidates current relation before write;
- [ ] no Prisma migration generated.

**Dependencies:** C0.

**Files likely touched:**
- `src/commerce/composite-component-admin.ts`
- `src/commerce/composite-component-repository.ts`
- `tests/domain/composite-component-admin.test.ts`
- `tests/database/composite-component-repository.test.ts`

**Estimated scope:** Medium, 4 files.

---

## C2 — Add child-editor activation control and correct parent status semantics

**Description:** Surface the existing global variant activation state where it belongs: on the child product's own variant rows that are actually used as composite components. Keep the parent composite section relationship-oriented and correct its misleading `child.product.isActive` status rule.

### Child editor

Extend the editor projection so each variant can know whether it has incoming persisted composite parent relations.

Only variants with at least one real incoming relation receive the composite-commerce activation control.

Buyer/admin copy must make global semantics explicit:

- activation applies to the variant across all persisted composite relations;
- activating the variant does not publish the child product;
- if the child product is later activated standalone, the same variant active state also applies there.

### Parent composite view

Do not add an edge-specific activation toggle.

Instead:

- link to the child editor as today;
- show factual child variant activation/presence state;
- remove `child.product.isActive=false` as a reason by itself to label the component unavailable;
- show child standalone publication state separately if helpful;
- avoid claiming final purchasability from activation alone.

**Acceptance criteria:**
- [ ] child product editor identifies relation-linked component variants from persisted incoming edges only;
- [ ] authorized admin can activate/deactivate those variants with clear, keyboard-accessible controls;
- [ ] non-component variants do not gain this composite-specific mutation control;
- [ ] successful/error mutation feedback survives redirect and is accessible;
- [ ] child product `isActive` is unchanged by the action;
- [ ] parent composite table reports `Chưa kích hoạt` vs `Đã kích hoạt biến thể` (or equivalent factual wording) without using child product inactivity as the sole failure condition;
- [ ] relation structure remains read-only; no parent/child edge editor is introduced.

**Verification:**
- [ ] source/integration assertions for incoming-edge projection and status semantics;
- [ ] authenticated admin browser test toggles one real relation-linked child variant, reloads, and sees persisted state;
- [ ] same browser test proves child product status remains inactive/non-public;
- [ ] admin Axe/keyboard/overflow checks remain green;
- [ ] crafted request for a non-component variant is rejected by server even if a client-side control is forged.

**Dependencies:** C1.

**Files likely touched:**
- `src/commerce/product-content-repository.ts` or a dedicated admin read projection if current-main review favors it
- `src/app/admin/products/[productId]/page.tsx`
- `tests/database/product-content-repository.test.ts`
- `tests/a11y-runtime/admin-editor.spec.ts`

If server-action plumbing makes this exceed 5 files, split into:
- C2a read projection/status;
- C2b mutation UI/runtime.

**Estimated scope:** Medium.

---

## C3 — Prove parent storefront, cart, and checkout use the activated child

**Description:** Extend the existing P17 composite regressions so the test starts from the real inactive synced state, activates through the new admin/service boundary, and then proves the already-existing purchase architecture behaves correctly.

Do not rewrite storefront projection/cart/checkout merely because this test spans them. Change those modules only if RED/GREEN evidence exposes an independent defect.

**Acceptance criteria:**
- [ ] before activation, real linked child variant is not an enabled parent purchase option;
- [ ] after activation, parent projection contains that exact child `VariantMirror.id` under the real child product label;
- [ ] direct child PDP remains 404/private while child `ProductMirror.isActive=false`;
- [ ] Add to Bag server validation accepts the real child variant only through a currently eligible parent relation;
- [ ] cart retains safe child display facts without a dead/private child-product link;
- [ ] checkout snapshot contains the real Pancake child variation id;
- [ ] deactivation causes subsequent purchase revalidation to reject/disable that child option again;
- [ ] parent Product/Offer structured data remains parent-only as locked by P17.

**Verification:**
- [ ] focused DB composite projection/cart/checkout regression;
- [ ] storefront-composite Playwright regression exercises disabled → activate fixture → enabled purchase path where practical;
- [ ] existing P17 composite tests stay green;
- [ ] no child Product JSON-LD/public PDP is introduced.

**Dependencies:** C2.

**Files likely touched:**
- `tests/database/storefront-composite-projection.test.ts`
- `tests/a11y-runtime/storefront-composite.spec.ts`
- focused service/repository test fixture helpers only if needed

**Estimated scope:** Small/Medium, tests-first. Production storefront files should be zero unless a proven separate defect exists.

---

## C4 — Final verification, review, and rollout readiness

**Description:** Close the bugfix with project Definition of Done evidence and a safe operational check for the real catalog.

**Acceptance criteria:**
- [ ] all task acceptance criteria pass;
- [ ] 0 Critical / 0 Required review findings;
- [ ] no schema migration, new dependency, sync auto-activation, product auto-publication, or relation inference slipped into the diff;
- [ ] V3 U0/a11y baseline remains green;
- [ ] PR body accurately distinguishes automated fixture proof from any real-shop operational proof.

**Verification:**
- [ ] `pnpm lint`;
- [ ] `pnpm typecheck`;
- [ ] `pnpm test`;
- [ ] `pnpm test:db` with Postgres;
- [ ] `pnpm build`;
- [ ] admin a11y runtime;
- [ ] storefront composite runtime;
- [ ] available CI: CI, Catalog indexation runtime, P18 final QA runtime;
- [ ] final review order: correctness → security → architecture → simplicity → performance.

### Trusted real-catalog acceptance

On an authorized environment, using sanitized evidence only:

1. choose a known parent set with persisted child edges;
2. confirm child product remains non-public;
3. activate one relation-linked child variant through admin;
4. refresh parent PDP and confirm its child kind/size is offered when other purchase facts are valid;
5. add it to cart and reach checkout;
6. verify admin reflects persisted activation after reload;
7. optionally deactivate and confirm the option closes again.

Do not log Pancake credentials or private raw payload.

**Dependencies:** C3.

**Files likely touched:** verification/docs only unless a proven regression requires a focused fix.

**Estimated scope:** Small.

---

## Checkpoints

### Composite-A — failure contract
After C0:
- live-shaped inactive component failure is reproduced;
- current P17 active-component behavior remains green;
- no production implementation yet.

### Composite-B — mutation safety
After C1:
- admin auth/input/relation guards are green;
- only `VariantMirror.isActive` is mutable;
- no schema/sync/product-publication change.

### Composite-C — admin ownership
After C2:
- child editor owns global variant activation;
- parent view is factual/readiness-only;
- child product inactivity is no longer mislabeled as component failure.

### Composite-D — commerce proof
After C3:
- activation unlocks the real child option through parent;
- deactivation closes it;
- cart/checkout identity stays real;
- child PDP remains private.

### Composite-E — final
After C4:
- full DoD evidence;
- 0 Critical / 0 Required;
- human approval before merge.

## Explicit non-goals

- Product-level catalog activation UI.
- Auto-activating parent products or parent variants.
- Auto-activating any variant during Pancake sync.
- Per-parent or per-edge activation persistence.
- Composite relationship editing.
- Changing how Pancake identity/price/stock/composite edges are mirrored.
- Making child products publicly discoverable.
- Reworking the purchase selector UI beyond what is necessary to prove existing projection.
- Folding this work into V3 U1/U4.

## Review questions

Approval should explicitly answer:

1. Reuse global `VariantMirror.isActive` rather than add per-edge state? **Recommended: yes.**
2. Put mutation control on the child variant owner page rather than parent edge row? **Recommended: yes.**
3. Keep parent product/parent variant activation outside this fix? **Recommended: yes; show readiness blockers but do not auto-activate.**

If any answer is no, update the spec/plan first.

## Definition of Done overlay

Every behavior-changing task must satisfy both its AC and the repository-wide DoD:

- new behavior has RED/GREEN regression evidence;
- relevant runtime behavior is exercised, not only typechecked;
- existing regressions remain green;
- auth/untrusted input is reviewed;
- no unrelated refactor;
- lint/format/build pass;
- docs describe current truth;
- rollback/disable path exists through the same admin state control;
- human review/approval before merge.
