# Composite child-variant activation — execution checklist

Status: **IMPLEMENTED / AUTOMATED VERIFIED — trusted real-catalog acceptance pending**

PR #105 remained planning-only and was merged after approval. Composite PR-A/#106, PR-B/#108 and PR-C/#109 were then reviewed and merged. Current merged implementation: `main@a0c362cb6d7dc50f2224db17f07ca7975c1f9a37`.

## Closeout evidence

- [x] PR-A/#106 merged: activation boundary only
- [x] PR-B/#108 merged: admin activation/readiness UI only
- [x] PR-C/#109 merged: 2-file test-only commerce convergence proof
- [x] Squash merge trees match their reviewed green PR-head trees
- [x] Exact-head CI #1224 green: DB smoke, auth/security smoke, lint, typecheck, 408/408 domain/integration, build/start
- [x] Playwright/VoiceOver 25/25 green, including the modified storefront composite convergence test
- [x] Catalog indexation #213 green
- [x] P18 final QA #95 green
- [x] Final combined self-review: 0 Critical / 0 Required
- [ ] Trusted real-catalog acceptance on an authorized environment

## Planning gate

- [x] Review `docs/design/composite-child-variant-activation.md`
- [x] Approve global `VariantMirror.isActive` as the existing activation truth
- [x] Approve child-product editor relation-linked variant controls as mutation owner
- [x] Approve parent product/parent variant activation as out of scope
- [x] Approve no-schema / no-new-dependency approach
- [x] Before implementation, refresh #105 onto then-current `main`
- [x] Recheck V3 U0/a11y changes after refresh
- [x] Merge approved planning-only #105 before production work
- [x] Predeclare Composite PR-A activation boundary (≤5 files)
- [x] Predeclare Composite PR-B admin ownership/status UI (≤5 files, or B1/B2 split before implementation)
- [x] Predeclare Composite PR-C commerce proof/convergence (≤5 files)
- [x] Create implementation branches from current `main`, not the mutable planning branch

## C0 — Baseline GREEN contract

- [x] Characterize live-shaped fixture: active parent product/variant
- [x] Child product present but inactive
- [x] Child variant present but inactive
- [x] Persist real `CompositeComponentMirror` edge
- [x] Give child valid size/price/stock
- [x] Baseline GREEN proves child option is absent/unpurchasable before activation
- [x] Baseline GREEN proves direct child PDP remains private
- [x] Existing active-component P17 regression remains green
- [x] Do not label these already-existing facts as RED

## C1 / Composite PR-A — Authorized activation boundary

- [x] First discriminating RED calls the missing activation operation and fails before production implementation
- [x] Add focused admin service
- [x] Add focused Prisma repository
- [x] Require ADMIN session
- [x] Bound/trim product + variant ids
- [x] Target state is explicit boolean
- [x] Verify target variant belongs to current child product
- [x] Verify target has incoming persisted composite edge
- [x] Reject unrelated forged variant id
- [x] Reject no-edge variant
- [x] Reject stale/not-present child product/variant on activation
- [x] Update only `VariantMirror.isActive`
- [x] Do not update child `ProductMirror.isActive`
- [x] Do not mutate `CompositeComponentMirror`
- [x] Do not write to Pancake
- [x] Idempotent same-state mutation
- [x] Domain RED/GREEN tests
- [x] DB RED/GREEN tests
- [x] Confirm no migration

## C2 / Composite PR-B — Admin UI + status semantics

### Child product editor — Website commerce section

- [x] Project incoming composite-parent membership for own variants
- [x] Show composite-use context only from persisted relations
- [x] Relation-linked variant gets accessible activation control
- [x] Non-component variant gets no composite-specific toggle
- [x] Copy explains activation is global to the variant
- [x] Copy explains child product is not published by this action
- [x] Copy explains future standalone product activation would reuse same variant state
- [x] Success feedback persists after redirect/reload
- [x] Error feedback is accessible

### Parent composite table

- [x] Keep relationship structure read-only
- [x] Keep link to child editor
- [x] Remove child `ProductMirror.isActive=false` as sole `Không khả dụng` condition
- [x] Show child presence truth
- [x] Show child variant activation truth
- [x] Keep stock separate
- [x] Do not claim final purchasability from activation alone
- [x] Keep parent activation/publication outside this fix; do not claim final purchasability from the child activation badge

### Verification

- [x] DB projection assertions
- [x] Browser admin activation persistence
- [x] Keyboard reachability
- [x] Axe clean
- [x] No horizontal overflow
- [x] Forged non-component action rejected server-side

## C3 / Composite PR-C — Commerce regression

- [x] Before activation: child not enabled on parent
- [x] Activate via new service/admin path
- [x] Child `VariantMirror.isActive=true`
- [x] Child `ProductMirror.isActive=false`
- [x] Parent projection contains exact child variant id
- [x] Parent selector shows real child product label
- [x] Direct child PDP still 404/private
- [x] Add to Bag server revalidation accepts real child id through parent
- [x] Cart shows safe child facts without private PDP link
- [x] Checkout stores real child Pancake variation id
- [x] Product/Offer JSON-LD stays parent-only
- [x] Deactivate child variant
- [x] Parent option closes/revalidation rejects it
- [x] Existing composite browser/DB regressions green

## C4 — Final convergence quality gate on current main

- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] `pnpm test:db`
- [x] `pnpm build`
- [x] Admin a11y runtime
- [x] Storefront composite runtime
- [x] CI green
- [x] Catalog indexation runtime green
- [x] P18 final QA runtime green
- [x] No schema migration
- [x] No new dependency
- [x] No sync auto-activation
- [x] No child product auto-publication
- [x] No relation inference
- [x] No unrelated V3 U1/U4 implementation mixed in
- [x] Correctness review
- [x] Security review
- [x] Architecture review
- [x] Simplicity review
- [x] Performance review
- [x] 0 Critical
- [x] 0 Required

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

- [x] #105 remained planning-only and was merged only after plan approval
- [x] Each Composite PR-A/B/C received its own human review before merge
- [ ] Full final DoD passes after A/B/C converge on current `main` — **pending only trusted real-catalog acceptance**
- [x] No production regression was found at convergence; no focused production fix PR was required
- [x] Each implementation PR merged only after explicit human instruction