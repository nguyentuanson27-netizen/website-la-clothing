# LA Clothing — Task Checklist

Status: build in progress
Intended repository path: `tasks/todo.md`

- [x] T0 Establish repository baseline and save approved spec
- [ ] T1 Verify Pancake product/variant/warehouse/order/webhook/idempotency contracts
- [x] T2 Bootstrap Next.js project and real quality commands
- [x] T3 Build design system and storefront shell
- [x] T4 Add database and secure CUSTOMER/ADMIN auth foundation
- [~] T5 Implement typed Pancake adapter with schema validation — secure client/discovery foundation merged; exact product/order/status contracts still require reviewed fields
- [ ] T6 Implement idempotent catalog synchronization/mirror
- [ ] T7 Deliver Pancake-backed PLP/PDP vertical slice
- [~] T8 Deliver stock-aware Color × Size selection and anonymous cart — DB service, ownership lock, opaque cookie boundary and 30-day absolute TTL merged; Next request/public mutation/UI remain
- [ ] T9 Deliver guest COD checkout → exactly one Pancake order
- [ ] T10 Sync order statuses and implement safe guest tracking
- [ ] T11 Add optional customer account and protected order history — deferred by product owner
- [ ] T12 Add editorial homepage/lookbook and restricted content admin
- [ ] T13 Add URL-backed search/filter/collections
- [ ] T14 Add verified promotions presentation and shipping configuration
- [ ] T15 Run security/observability/accessibility/E2E hardening
- [ ] T16 Add CI and release/rollback readiness

## Current execution path: finish T8 → T10

- [ ] C1 Next.js guest-cart request identity adapter
  - [ ] RED test
  - [ ] GREEN implementation
  - [ ] focused/full verification
  - [ ] self-review: correctness → security → architecture → simplicity → performance
- [ ] C2 Bounded public cart mutations + real cookie emission
  - [ ] define/enforce a distinct-line abuse bound
  - [ ] actual Next request evidence for emitted `Set-Cookie`
  - [ ] self-review
- [ ] C3 Pancake product/warehouse exact contract
  - [ ] official OpenAPI review
  - [ ] reviewed fields/types/fixtures
  - [ ] explicit online warehouse configuration; no default warehouse assumption
  - [ ] safe live verification when credentials are available
  - [ ] self-review
- [ ] C4 Catalog mirror sync/read model
  - [ ] schema only for verified external fields
  - [ ] idempotent PostgreSQL sync tests
  - [ ] self-review
- [ ] C5 PLP/PDP Color × Size storefront
  - [ ] server-authoritative price/availability
  - [ ] automated tests/build
  - [ ] browser/mobile/a11y verification when tool available
  - [ ] self-review
- [ ] C6 Cart UI
  - [ ] current price/availability, update/remove
  - [ ] automated tests/build
  - [ ] browser/mobile/a11y verification when tool available
  - [ ] self-review
- [ ] C7 Guest COD checkout persistence + server revalidation
  - [ ] approved shipping rule available
  - [ ] migration/runtime tests
  - [ ] security review
- [ ] C8 Pancake create-order orchestration
  - [ ] exact create-order contract verified
  - [ ] success/reject/timeout/`SYNC_UNKNOWN` tests
  - [ ] no blind retry
  - [ ] self-review
- [ ] C9 Order status reconciliation
  - [ ] exact status/lookup contract verified
  - [ ] unknown status fail-closed
  - [ ] idempotent reconciliation tests
  - [ ] self-review
- [ ] C10 Guest order tracking
  - [ ] public code + phone proof
  - [ ] database-backed rate limit
  - [ ] minimal disclosure/no PII logging
  - [ ] security review

## Stop conditions
- Do not guess warehouse selection, shipping fee, Pancake field names/types, create-order idempotency/reference semantics, or webhook authentication/replay behavior.
- Do not move past a slice with a Required/Critical self-review finding or failing CI.
- Do not claim browser runtime verification without an actual browser/runtime check.

## Human gates
- [x] Intent approved
- [x] Spec v0.1 approved
- [x] Plan approved
- [ ] Build verified
- [ ] Review approved
- [ ] Ship approved
