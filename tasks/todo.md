# LA Clothing — Task Checklist

Status: build in progress
Intended repository path: `tasks/todo.md`

- [x] T0 Establish repository baseline and save approved spec
- [~] T1 Verify Pancake product/variant/warehouse/order/webhook/idempotency contracts — endpoint/base URL sources verified; exact response/write schemas still require reviewed live discovery
- [x] T2 Bootstrap Next.js project and real quality commands
- [x] T3 Build design system and storefront shell
- [x] T4 Add database and secure CUSTOMER/ADMIN auth foundation
- [~] T5 Implement typed Pancake adapter with schema validation — secure client/discovery foundation merged; exact product/order/status contracts still require reviewed fields
- [ ] T6 Implement idempotent catalog synchronization/mirror
- [ ] T7 Deliver Pancake-backed PLP/PDP vertical slice
- [~] T8 Deliver stock-aware Color × Size selection and anonymous cart — DB service, ownership lock, opaque cookie, 30-day TTL, read-only request identity and bounded Server Functions are implemented; catalog-backed UI remains
- [ ] T9 Deliver guest COD checkout → exactly one Pancake order
- [ ] T10 Sync order statuses and implement safe guest tracking
- [ ] T11 Add optional customer account and protected order history — deferred by product owner
- [ ] T12 Add editorial homepage/lookbook and restricted content admin
- [ ] T13 Add URL-backed search/filter/collections
- [ ] T14 Add verified promotions presentation and shipping configuration
- [ ] T15 Run security/observability/accessibility/E2E hardening
- [ ] T16 Add CI and release/rollback readiness

## Current execution path: finish T8 → T10

- [x] C1 Next.js guest-cart request identity adapter
  - [x] RED test
  - [x] GREEN implementation
  - [x] focused/full verification
  - [x] self-review: correctness → security → architecture → simplicity → performance
- [x] C2 Bounded public cart mutations + cookie orchestration
  - [x] 50-distinct-line technical abuse ceiling enforced atomically
  - [x] PostgreSQL + injected cookie-store runtime verification
  - [~] actual browser/HTTP Server Action `Set-Cookie` round-trip pending browser/DevTools-capable environment
  - [x] self-review; 0 Critical / 0 Required
- [~] C3 Pancake product/warehouse exact contract — BLOCKED at trusted live discovery/review boundary
  - [x] official OpenAPI reference review confirms production base URL and required product-variation/warehouse endpoints
  - [ ] exact product/variation/warehouse fields, types and paths reviewed into fixtures/allowlists
  - [x] explicit online warehouse configuration parser; no default/first/all-warehouse assumption
  - [ ] actual LA Clothing online warehouse IDs configured
  - [ ] safe trusted live discovery using server-only local credentials
  - [x] self-review of the configuration slice; 0 Critical / 0 Required
- [ ] C4 Catalog mirror sync/read model — STOPPED until C3 exact contract is complete
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
