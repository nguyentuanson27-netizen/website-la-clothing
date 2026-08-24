# Composite child-variant activation — execution checklist

Status: **PLANNING / REVIEW ONLY**

PR #105 remains planning-only. After explicit human approval it is refreshed onto current `main` and merged; production work then proceeds in focused Composite PR-A/B/C branches from current `main`.

## Planning gate

- [ ] Review `docs/design/composite-child-variant-activation.md`
- [ ] Approve global `VariantMirror.isActive` as the existing activation truth
- [ ] Approve child-product variant table as mutation owner
- [ ] Approve parent product/parent variant activation as out of scope
- [ ] Approve no-schema / no-new-dependency approach
- [ ] Before implementation, refresh #105 onto then-current `main`
- [ ] Recheck V3 U0/a11y changes after refresh
- [ ] Merge approved planning-only #105 before production work
- [ ] Predeclare Composite PR-A activation boundary (≤5 files)
- [ ] Predeclare Composite PR-B admin ownership/status UI (≤5 files, or B1/B2 split before implementation)
- [ ] Predeclare Composite PR-C commerce proof/convergence (≤5 files)
- [ ] Create implementation branches from current `main`, not the mutable planning branch

## C0 — Baseline GREEN contract

- [ ] Characterize live-shaped fixture: active parent product/variant
- [ ] Child product present but inactive
- [ ] Child variant present but inactive
- [ ] Persist real `CompositeComponentMirror` edge
- [ ] Give child valid size/price/stock
- [ ] Baseline GREEN proves child option is absent/unpurchasable before activation
- [ ] Baseline GREEN proves direct child PDP remains private
- [ ] Existing active-component P17 regression remains green
- [ ] Do not label these already-existing facts as RED

## C1 / Composite PR-A — Authorized activation boundary

- [ ] First discriminating RED calls the missing activation operation and fails before production implementation
- [ ] Add focused admin service
- [ ] Add focused Prisma repository
- [ ] Require ADMIN session
- [ ] Bound/trim product + variant ids
- [ ] Target state is explicit boolean
- [ ] Verify target variant belongs to current child product
- [ ] Verify target has incoming persisted composite edge
- [ ] Reject unrelated forged variant id
- [ ] Reject no-edge variant
- [ ] Reject stale/not-present child product/variant on activation
- [ ] Update only `VariantMirror.isActive`
- [ ] Do not update child `ProductMirror.isActive`
- [ ] Do not mutate `CompositeComponentMirror`
- [ ] Do not write to Pancake
- [ ] Idempotent same-state mutation
- [ ] Domain RED/GREEN tests
- [ ] DB RED/GREEN tests
- [ ] Confirm no migration

## C2 / Composite PR-B — Admin UI + status semantics

### Child product variant table

- [ ] Project incoming composite-parent membership for own variants
- [ ] Show composite-use context only from persisted relations
- [ ] Relation-linked variant gets accessible activation control
- [ ] Non-component variant gets no composite-specific toggle
- [ ] Copy explains activation is global to the variant
- [ ] Copy explains child product is not published by this action
- [ ] Copy explains future standalone product activation would reuse same variant state
- [ ] Success feedback persists after redirect/reload
- [ ] Error feedback is accessible

### Parent composite table

- [ ] Keep relationship structure read-only
- [ ] Keep link to child editor
- [ ] Remove child `ProductMirror.isActive=false` as sole `Không khả dụng` condition
- [ ] Show child presence truth
- [ ] Show child variant activation truth
- [ ] Keep stock separate
- [ ] Do not claim final purchasability from activation alone
- [ ] Optionally expose parent inactive state as separate readiness blocker

### Verification

- [ ] DB projection assertions
- [ ] Browser admin activation persistence
- [ ] Keyboard reachability
- [ ] Axe clean
- [ ] No horizontal overflow
- [ ] Forged non-component action rejected server-side

## C3 / Composite PR-C — Commerce regression

- [ ] Before activation: child not enabled on parent
- [ ] Activate via new service/admin path
- [ ] Child `VariantMirror.isActive=true`
- [ ] Child `ProductMirror.isActive=false`
- [ ] Parent projection contains exact child variant id
- [ ] Parent selector shows real child product label
- [ ] Direct child PDP still 404/private
- [ ] Add to Bag server revalidation accepts real child id through parent
- [ ] Cart shows safe child facts without private PDP link
- [ ] Checkout stores real child Pancake variation id
- [ ] Product/Offer JSON-LD stays parent-only
- [ ] Deactivate child variant
- [ ] Parent option closes/revalidation rejects it
- [ ] Existing composite browser/DB regressions green

## C4 — Final convergence quality gate on current main

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm test:db`
- [ ] `pnpm build`
- [ ] Admin a11y runtime
- [ ] Storefront composite runtime
- [ ] CI green
- [ ] Catalog indexation runtime green
- [ ] P18 final QA runtime green
- [ ] No schema migration
- [ ] No new dependency
- [ ] No sync auto-activation
- [ ] No child product auto-publication
- [ ] No relation inference
- [ ] No unrelated V3 U1/U4 implementation mixed in
- [ ] Correctness review
- [ ] Security review
- [ ] Architecture review
- [ ] Simplicity review
- [ ] Performance review
- [ ] 0 Critical
- [ ] 0 Required

## Trusted real-catalog acceptance

- [ ] Run only in authorized environment
- [ ] Use sanitized evidence
- [ ] Pick a known real composite parent
- [ ] Confirm persisted child edges
- [ ] Confirm child product stays non-public
- [ ] Activate one real child variant in admin
- [ ] Parent PDP offers it when price/stock/mapping/parent state allow
- [ ] Add to cart
- [ ] Reach checkout
- [ ] Reload admin and confirm state persists
- [ ] Deactivate and verify closure if safe for the chosen live variant
- [ ] Never expose credentials/private Pancake payloads

## Merge gates

- [ ] #105 remains planning-only and is merged only after plan approval
- [ ] Each Composite PR-A/B/C receives its own human review before merge
- [ ] Full final DoD passes after A/B/C converge on current `main`
- [ ] Any production regression found at convergence becomes a focused fix PR
- [ ] Merge each implementation PR only after explicit human instruction