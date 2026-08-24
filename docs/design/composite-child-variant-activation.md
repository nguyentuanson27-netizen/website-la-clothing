# Composite child-variant activation — admin-controlled commerce readiness

Status: **DRAFT SPEC — planning/review only. No production implementation until explicit human approval.**

This document defines the focused fix for the live composite-product gap discovered after PR #97 made persisted Pancake parent → child relationships visible in admin.

After this spec/plan is approved, implementation will continue **on this same PR/branch**. Before the first production-code commit, the branch must be refreshed onto the then-current `main` so the completed V3 U0 accessibility work is included.

## Objective

Allow an administrator to intentionally activate real Pancake-mirrored child variants that are already linked to a composite parent, so those child variants can appear as purchasable choices on the public parent PDP while the child product itself may remain non-public.

Success means an operator can move the real current state:

```text
Composite edge exists
+ child product/variant present
+ stock exists
+ child VariantMirror.isActive = false
→ admin shows relation but parent PDP cannot offer the child
```

to:

```text
same persisted edge
+ child VariantMirror.isActive = true
+ active/present parent storefront context
→ parent PDP projects the real child variant
→ Add to Bag uses the real child VariantMirror/Pancake variation identity
→ cart/checkout continue to accept it through the parent relationship
→ direct child PDP remains unavailable while child ProductMirror.isActive = false
```

## Verified current-state facts on `main`

Base inspected for this planning PR: `e2a14d625f6fa765f4059bb80de6bcc9c55d1993`.

### Mirror and activation semantics

- Pancake catalog sync creates a new `VariantMirror` with `isActive: false`.
- Subsequent sync updates operational facts but intentionally preserves local `VariantMirror.isActive`.
- Composite edges are persisted in `CompositeComponentMirror(parentVariantId, componentVariantId, quantity)`.
- Sync never infers a composite relation from name, SKU, category, size, or display text.

Therefore the current architecture already treats variant activation as **website-owned local state**, distinct from Pancake presence/stock facts.

### Storefront projection

`createStorefrontProductDetailRepository().getProductBySlug()`:

- loads outgoing persisted composite edges from the public parent variants;
- ignores a component if its product is not present;
- ignores a component variant if it is not present or not active;
- intentionally **does not require the child ProductMirror itself to be active**;
- groups surviving child variants by real child product identity;
- projects them into the parent purchase selector.

Existing P17 tests already lock the intended architecture:

- an inactive child product can remain without a public PDP;
- an active, relation-linked child variant can still be purchased through an active public parent;
- the cart and checkout preserve the real child variation identity.

### Cart and checkout authority

Commerce validation is relation-aware:

- a variant must itself be `isPresent=true` and `isActive=true`;
- it is eligible if either its own product is active/present **or** it has a real composite parent whose variant and product are active/present;
- cart and checkout do not invent a public child slug for a non-public component product.

Therefore the missing child option is not a cart/checkout feature gap. It is blocked earlier by the inactive local variant state.

### Admin after PR #97

The product editor now reads and renders persisted parent → child composite relationships, quantity, child stock, and child product links.

However:

1. the relation view is read-only;
2. there is no admin mutation path for relation-linked child `VariantMirror.isActive`;
3. the child's own variant table shows `Tắt`, but also has no activation control;
4. the parent composite status currently treats `child.product.isActive=false` as `Không khả dụng`, even though storefront composite semantics intentionally allow an inactive child product to be sold through an active parent.

That last point is a status/semantics bug in admin, independent of the missing activation workflow.

## Root cause

The P17 runtime contract was implemented assuming a component variant can already be locally active, and tests create it that way.

The real synced catalog starts new variants inactive and preserves that value.

No repository/admin workflow currently bridges those two states.

So the missing path is:

```text
Pancake sync
  → VariantMirror present, isActive=false
  → CompositeComponentMirror edge present
  → Admin can inspect relation
  ✗ no website-owned action to activate the child variant
  → storefront composite repository filters it out
```

## Proposed ownership model for review

### Activation belongs to the child variant, not to one parent edge

This fix will reuse the existing `VariantMirror.isActive` state.

It will **not** add an edge-specific activation column to `CompositeComponentMirror`.

Reason:

- current storefront/cart/checkout code already defines eligibility around `VariantMirror.isActive`;
- adding a second activation truth would require a schema migration and coordinated changes across projection, cart, checkout, acceptance, and sync behavior;
- the current defect is the absence of a safe admin path to manage the already-established state.

Important consequence:

> `VariantMirror.isActive` is global to that variant. If the same child variant is linked to several real composite parents, its activation state applies to every one of those relationships. If the child product is later made public separately, the same active variant can also become eligible on that standalone product.

The UI must state this truth. It must not present activation as a property owned only by one parent row.

### UI ownership

The mutation control belongs on the **child product's own variant table**, where the global `VariantMirror.isActive` state is already displayed.

For a variant that has at least one incoming persisted `CompositeComponentMirror` edge:

- show that it is used by composite parent(s);
- show an explicit activation control;
- allow the admin to set that variant active/inactive;
- explain that the state is shared across all real parent relations;
- explain that this action does **not** make the child product itself public.

The parent composite table remains a relationship/readiness view:

- it continues to link to the child product editor;
- it reports variant activation/presence truth without incorrectly treating child `ProductMirror.isActive=false` as a blocker by itself;
- it can tell the operator that a child variant is `Chưa kích hoạt` and direct them to its product editor.

This keeps state ownership aligned with the data model and avoids a misleading per-edge toggle.

## Parent/product publication boundary

This PR does **not** introduce product-level activation/publication controls.

For a child to be offered from a parent PDP, the existing parent-side requirements still apply:

- parent `ProductMirror` present/active;
- parent `VariantMirror` present/active;
- real `CompositeComponentMirror` edge;
- child product present;
- child variant present/active;
- mapped selection facts resolve;
- usable price;
- positive stock for a purchasable option.

If the real parent product or parent variants are themselves inactive, this fix will expose that as a separate readiness blocker rather than silently auto-activating them.

## Admin mutation contract

A new focused admin service/repository boundary should manage child-variant activation.

The server mutation must:

1. require an authenticated ADMIN session;
2. accept only bounded, trimmed identifiers and a boolean target state;
3. use the server-owned child product id from the current editor context;
4. verify the target variant belongs to that child product;
5. verify the target variant currently has at least one incoming persisted composite edge;
6. refuse stale/missing variants rather than creating or inferring relationships;
7. refuse activation for a variant/product no longer present in the Pancake mirror;
8. update only `VariantMirror.isActive`;
9. not update `ProductMirror.isActive`;
10. not update `CompositeComponentMirror`;
11. not mutate Pancake;
12. remain idempotent if the requested state already matches current state.

Server-side verification is authoritative. A crafted form must not be able to toggle an unrelated variant id.

## Admin status contract

Separate the concepts that are currently collapsed into `Không khả dụng`.

At minimum the UI must distinguish:

- **Pancake presence:** child product/variant still present vs stale;
- **Local variant activation:** active vs inactive;
- **Stock:** numeric stock / hết hàng;
- **Standalone product publication:** child product active vs inactive, shown as informational context only.

Do not label an otherwise present+active child variant `Không khả dụng` solely because its child product is intentionally inactive.

The parent relation view must not claim `Có thể bán` based only on activation, because final purchasability also depends on parent state, mapping, price, ambiguity, and stock. Prefer factual labels such as `Đã kích hoạt biến thể` / `Chưa kích hoạt`.

## Storefront behavior after activation

No new purchase model is introduced.

Once a linked child variant is active, the existing storefront pipeline should do the rest:

```text
ProductDetailRepository
  → composite component group
  → StorefrontProductProjection
  → Loại → Kích cỡ → Màu (when present)
  → real child VariantMirror.id
  → server-side purchase revalidation
  → cart
  → checkout snapshot
  → real Pancake variation id
```

The fix must prove that behavior rather than duplicate it.

## Security boundaries

### Always

- Require admin authorization for every activation mutation.
- Revalidate product/variant ownership and incoming composite membership server-side.
- Treat all form data as untrusted.
- Keep identifiers bounded.
- Preserve current server-side purchase validation.
- Keep direct child PDP closed while child product is inactive.
- Keep Pancake as source of identity, price, inventory, variant presence, and composite relation.

### Ask first

- Any Prisma schema migration.
- Any new activation field on `CompositeComponentMirror`.
- Any product-level activation/publication UI.
- Any automatic activation during Pancake sync.
- Any change that allows inactive child variants into purchase projection.

### Never

- Never infer child relationships from product names, SKU, category, matching size, or image.
- Never auto-activate every synced variant.
- Never set child `ProductMirror.isActive=true` merely to make it purchasable through a set.
- Never bypass `VariantMirror.isActive` in cart/checkout.
- Never write back composite structure or activation to Pancake.
- Never expose a private/non-public child PDP solely because its variant is active.

## Data/schema decision

Expected implementation requires **no migration**.

Use existing:

- `ProductMirror.isActive`;
- `VariantMirror.isActive`;
- `CompositeComponentMirror`;
- current admin auth;
- current relation-aware storefront/cart/checkout logic.

If review discovers that per-parent activation is a real product requirement, stop and revise this spec before code. That would be a different persistence model.

## Testing strategy

### Domain/service

Prove:

- unauthenticated → rejected;
- non-admin → rejected;
- malformed ids → rejected;
- target variant not owned by current child product → rejected;
- target variant with no incoming composite edge → rejected;
- stale/not-present component → activation rejected;
- legitimate linked component → active state changes;
- repeating same request is idempotent.

### Database integration

Create a real parent/child fixture where:

- parent product + parent variant active/present;
- child product present but inactive;
- child variant present but inactive;
- persisted composite edge exists;
- stock/price/size resolve.

RED baseline:

- parent PDP projection has composite graph but omits the inactive child option.

After admin activation:

- `VariantMirror.isActive=true`;
- child product stays `isActive=false`;
- parent projection contains the child option;
- direct child product lookup remains null/private;
- cart accepts the child variation through the parent relation;
- checkout snapshots the real Pancake child variation id.

After deactivation:

- parent projection no longer offers that child variant;
- existing/new cart mutation revalidation treats it unavailable.

### Admin browser/runtime

Authenticated admin browser regression should prove:

- child editor marks relation-linked variants as composite-used;
- activation button is keyboard reachable and labelled;
- save feedback is announced;
- state persists after redirect/reload;
- parent relation view stops mislabelling child-product inactivity as variant unavailability;
- direct editing remains read-only for Pancake relation structure;
- no horizontal overflow/Axe regression.

### Existing regression gates

Run focused and full relevant equivalents of:

- `pnpm test`;
- `pnpm test:db`;
- `pnpm lint`;
- `pnpm typecheck`;
- `pnpm build`;
- admin a11y runtime;
- storefront composite browser runtime;
- catalog indexation/P18 workflows as CI provides them.

## V3 coordination

V3 U0 is currently finishing separately. This planning PR does not modify V3 U0.

Implementation gate:

1. human approves this composite spec/plan;
2. V3 U0b.3 / PR #104 is either merged or its final disposition is known;
3. update this branch from the then-current `main`;
4. re-read any affected admin/a11y changes;
5. begin RED → GREEN implementation on this same PR.

The composite fix should be green before U1b PDP/purchase-copy work is accepted, to avoid mixing commerce eligibility debugging with PDP copy changes.

## Success criteria

This fix is complete only when all are true:

- [ ] relation-linked child variant activation is manageable by an authorized admin without DB hand-editing;
- [ ] mutation cannot toggle an unrelated/non-component variant;
- [ ] Pancake sync behavior remains preserve-local-activation; no auto-activation is added;
- [ ] child product can stay non-public while its linked active variant is offered through an active parent;
- [ ] parent PDP lists the real child option after activation;
- [ ] Add to Bag/cart/checkout use the real child variant/Pancake identity;
- [ ] deactivation closes the option again;
- [ ] admin parent status no longer treats child product inactivity alone as component failure;
- [ ] no schema migration/new dependency/unrelated catalog publication feature;
- [ ] full Definition of Done passes with 0 Critical / 0 Required review findings.

## Review decisions requested before implementation

Please explicitly review these two decisions:

1. **State ownership:** reuse global `VariantMirror.isActive`; do not add per-parent/edge activation state.
2. **UI ownership:** mutate the state from the child product's own relation-linked variant rows; keep the parent composite section as read-only relationship/readiness navigation.

If either decision is rejected, revise this spec/plan before production code.
