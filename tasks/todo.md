# LA Clothing — Task Checklist

Status: build in progress
Intended repository path: `tasks/todo.md`

- [x] T0 Establish repository baseline and save approved spec
- [~] T1 Verify Pancake product/variant/warehouse/order/webhook/idempotency contracts — catalog read contract + reservation-aware stock semantics verified; order/write/webhook contracts remain
- [x] T2 Bootstrap Next.js project and real quality commands
- [x] T3 Build design system and storefront shell
- [x] T4 Add database and secure CUSTOMER/ADMIN auth foundation
- [~] T5 Implement typed Pancake adapter with schema validation — secure client + reviewed catalog parser/fixtures/verification implemented; order/status adapters remain
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

## Current execution path: C3 implementation + trusted-live verifier are complete; human review is the final gate before C4

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
- [~] C3 Pancake product/warehouse exact contract — reviewed implementation + trusted-live verifier complete; human review remains
  - [x] official OpenAPI reference review confirms production base URL and required product-variation/warehouse endpoints
  - [x] trusted-local discovery after PR #37 returned `format: normalized-path-types-v1` + `complete: true` for both `productVariations` and `warehouses`
  - [x] exact observed product/variation/warehouse object keys reviewed into checked-in allowlists
  - [x] sanitized product-variation + warehouse fixtures committed; no live API key/customer data/operational inventory persisted
  - [x] typed catalog parser validates pagination, variation identity, canonical top-level `product_id`, nested `product.name`, mapped attributes/images/raw flags/raw prices and per-warehouse `remain_quantity`
  - [x] nested `product.id` is deliberately not consumed after trusted-live verification proved that extra assumption too strict; canonical product identity comes from top-level variation `product_id`
  - [x] parser rejects malformed mapped types, malformed nested product shape/name and duplicate warehouse rows instead of coercing/guessing
  - [x] pagination metadata retained so C4 can perform bounded full-catalog traversal rather than silently syncing one page
  - [x] product owner decision: website sellable inventory aggregates **all Pancake warehouses** for each variation; no warehouse-ID subset is required
  - [x] obsolete `PANCAKE_ONLINE_WAREHOUSE_IDS` configuration/parser/tests removed
  - [x] PR #38 read-only trusted-local stock probe exercised against the live shop using controlled before/order/cancel snapshots
  - [x] controlled quantity-1 evidence: only `remain_quantity` changed A→B→C (`-1`, then `+1`); the other five observed quantity fields had zero delta
  - [x] verified website inventory rule for the tested reservation lifecycle: `sellable stock = SUM(variations_warehouses[].remain_quantity)` across all distinct warehouses
  - [x] probe CLI usage corrected for pnpm argument forwarding: `pnpm pancake:stock:probe <selector>`; no extra `--`
  - [x] reviewed verifier performs full key allowlist validation and invokes the production mapped parser/type contract before emitting sanitized shape output
  - [x] first trusted-live `pnpm pancake:contract:verify` attempt reached the verifier but exited 1 with the legacy generic failure message and no BEGIN/END block; no secrets/raw payload/unknown field name were shared
  - [x] diagnostic TDD RED: CI #275 failed only the new safe-localization expectation because the verifier still collapsed every cause to the generic message
  - [x] diagnostic GREEN: verifier now emits only fixed safe `stage`/`reason` codes for configuration, fetch, key-contract and mapped-contract failures without echoing exception text, API keys, raw scalar values or unknown field names
  - [x] live diagnostic progression safely localized the mapped-contract mismatch to nested `product.id`; regression CI #285 reproduced the over-constraint before the root-cause fix
  - [x] root-cause fix uses top-level `product_id` as canonical identity and ignores nested `product.id`; CI #286 passed DB/runtime, HTTP security/authz, lint, typecheck, domain/integration, production build and macOS Chromium/Axe/VoiceOver runtime
  - [x] trusted-local `pnpm pancake:contract:verify` rerun on the fixed branch returned PASS
  - [x] final-head CI #288 passed Linux DB/runtime, HTTP security/authz, lint, typecheck, domain/integration tests, production build and macOS Chromium/Axe/VoiceOver runtime after tracker updates
  - [x] final self-review: correctness → security → architecture → simplicity → performance; 0 Critical / 0 Required before human review
  - [ ] human review of PR #38 with 0 Critical / 0 Required before marking C3 complete
- [ ] C4 Catalog mirror sync/read model — STOPPED until C3 human review passes
  - [ ] fetch/traverse verified Pancake pagination deliberately
  - [ ] schema only for verified external fields
  - [ ] aggregate `remain_quantity` across all distinct `variations_warehouses[]`
  - [ ] make visibility/Color×Size/final storefront price policies explicit rather than inferring unverified semantics silently
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
- Do not guess shipping fee, unverified Pancake field semantics/types, create-order idempotency/reference semantics, or webhook authentication/replay behavior.
- Do not reintroduce warehouse subset filtering unless the product owner changes the approved all-warehouse inventory policy.
- Do not treat mirrored stock as a reservation; revalidate authoritative `remain_quantity` immediately before order creation.
- Do not let raw external image URLs create a server-side fetch boundary without an explicit trusted-origin policy.
- Do not move past a slice with a Required/Critical self-review finding or failing CI.
- Do not claim browser/runtime/live Pancake verification without actual evidence.

## Human gates
- [x] Intent approved
- [x] Spec v0.1 approved
- [x] Plan approved
- [ ] Build verified
- [ ] Review approved
- [ ] Ship approved
