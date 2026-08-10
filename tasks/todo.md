# LA Clothing — Task Checklist

Status: build in progress
Intended repository path: `tasks/todo.md`

- [x] T0 Establish repository baseline and save approved spec
- [~] T1 Verify Pancake product/variant/warehouse/order/webhook/idempotency contracts — endpoint/base URL and trusted product/warehouse structural discovery verified; stock semantics and write-path contracts remain
- [x] T2 Bootstrap Next.js project and real quality commands
- [x] T3 Build design system and storefront shell
- [x] T4 Add database and secure CUSTOMER/ADMIN auth foundation
- [~] T5 Implement typed Pancake adapter with schema validation — secure client/discovery foundation merged; reviewed product fields/stock semantics and order/status contracts remain
- [ ] T6 Implement idempotent catalog synchronization/mirror
- [ ] T7 Deliver Pancake-backed PLP/PDP vertical slice
- [~] T8 Deliver stock-aware Color × Size selection and anonymous cart — DB service, ownership lock, opaque cookie, 30-day TTL, read-only request identity and bounded Server Functions are implemented; catalog-backed UI remains
- [ ] T9 Deliver guest COD checkout → exactly one Pancake order
- [ ] T10 Sync order statuses and implement safe guest tracking
- [ ] T11 Add optional customer account and protected order history — deferred by product owner
- [~] T12 Add editorial homepage/lookbook and restricted content admin — restricted product editorial admin foundation implemented; homepage/lookbook composition remains
- [ ] T13 Add URL-backed search/filter/collections
- [ ] T14 Add verified promotions presentation and shipping configuration
- [ ] T15 Run security/observability/accessibility/E2E hardening
- [ ] T16 Add CI and release/rollback readiness

## Current execution path: C3 trusted-local product/warehouse shape discovery is complete; stock quantity semantics must be proven before C4

- [x] C1 Next.js guest-cart request identity adapter
  - [x] RED test
  - [x] GREEN implementation
  - [x] focused/full verification
  - [x] self-review: correctness → security → architecture → simplicity → performance
- [x] C2 Bounded public cart mutations + cookie orchestration — clean re-review approved and fix merged in PR #34
  - [x] 50-distinct-line technical abuse ceiling enforced atomically
  - [x] public Server Function strips `cartId` / `expiresAt` capability metadata from browser-visible success results
  - [x] PostgreSQL + injected cookie-store runtime verification
  - [x] actual Next HTTP Server Action `Set-Cookie` round-trip verified in CI
  - [x] post-fix verdict: APPROVE — 0 Critical / 0 Required; merged to `main`
- [~] C3 Pancake product/warehouse exact contract — structural discovery complete; stock semantics/review gate remains
  - [x] official OpenAPI reference review confirms production base URL and required product-variation/warehouse endpoints
  - [x] trusted-local discovery rerun after PR #37 returned `format: normalized-path-types-v1` + `complete: true` for both `productVariations` and `warehouses`
  - [~] exact product/variation/warehouse fields and observed types are available from trusted discovery; reviewed fixtures/allowlists still need to be committed from the approved subset
  - [x] product owner decision: website sellable inventory aggregates **all Pancake warehouses** for each variation; no warehouse-ID subset is required
  - [~] legacy explicit `PANCAKE_ONLINE_WAREHOUSE_IDS` parser is superseded by the all-warehouse business rule and must not govern C4 aggregation
  - [~] PR #38 adds a read-only trusted-local stock probe for `actual_remain_quantity`, `remain_quantity`, `total_quantity`, `pending_quantity`, `waiting_quantity`, and `returning_quantity`; controlled before/order/cancel evidence still required
  - [ ] identify the verified sellable-quantity field from controlled behavior evidence; do not infer semantics from field names alone
  - [x] self-review of the configuration/discovery slices; 0 Critical / 0 Required
- [ ] C4 Catalog mirror sync/read model — STOPPED until C3 exact contract + stock semantics are complete
  - [ ] schema only for verified external fields
  - [ ] aggregate the verified sellable quantity across all `variations_warehouses[]`
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

## Independent T12 slice: restricted product editorial admin foundation

- [~] Website-owned product editorial administration
  - [x] full Better Auth session validation on each admin page and mutation
  - [x] exact `ADMIN` authorization before protected reads/writes
  - [x] bounded fail-closed validation for editorial/SEO browser input
  - [x] `ProductContent` repository upsert/read/list with a 100-row admin list ceiling
  - [x] `/admin` product list and `/admin/products/[productId]` editorial editor
  - [x] actual Next HTTP smoke verifies unauthenticated `/admin` access redirects to `/account`
  - [x] Prisma/database/lint/typecheck/domain/build verification on the implementation branch
  - [x] self-review: correctness → security → architecture → simplicity → performance; 0 Critical / 0 Required after hardening malformed `FormData` handling
  - [x] human review of PR #35: APPROVE — 0 Critical / 0 Required / 2 Consider; merged to `main`
  - [x] Consider #1 follow-up: authenticated HTTP proof verifies CUSTOMER cannot read `/admin`, ADMIN renders the editor, and the real ADMIN Server Action persists `ProductContent`
  - [x] Consider #2 follow-up: CI `31359367828` verifies a real 390×844 Chromium UI, keyboard focus, zero selected Axe WCAG A/AA violations, clean console/network, and real macOS VoiceOver announcements for both persisted success and server-validation error after redirect
  - [ ] editorial homepage/lookbook composition

## Stop conditions
- Do not guess shipping fee, Pancake field semantics/types, create-order idempotency/reference semantics, or webhook authentication/replay behavior.
- Do not reintroduce warehouse subset filtering unless the product owner changes the approved all-warehouse inventory policy.
- Do not move past a slice with a Required/Critical self-review finding or failing CI.
- Do not claim browser runtime verification without an actual browser/runtime check.

## Human gates
- [x] Intent approved
- [x] Spec v0.1 approved
- [x] Plan approved
- [ ] Build verified
- [ ] Review approved
- [ ] Ship approved
