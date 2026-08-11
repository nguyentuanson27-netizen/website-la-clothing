# Commerce implementation plan — guest cart through order tracking/sync

## Goal
Build the next buyer-journey slices from the merged anonymous-cart foundation through safe guest order tracking and Pancake status synchronization, while keeping Pancake as operational source of truth and avoiding guessed external contracts.

## Dependency graph
1. Guest-cart Next.js request boundary
2. Public cart mutations + bounded abuse surface
3. Pancake product/warehouse contract verification + typed mapping
4. Catalog mirror sync/read model
5. PLP/PDP Color × Size storefront
6. Cart UI
7. Guest COD checkout persistence/validation
8. Pancake create-order orchestration + uncertain-write recovery
9. Pancake order status reconciliation
10. Guest order tracking lookup

Tasks 3–10 depend on the Pancake API contract. The guest shipping-fee rule for Task 7 was approved on 2026-08-11: 30,000 VND by default; free shipping when authoritative merchandise subtotal is over 1,000,000 VND or total product quantity is at least 3, with the first qualifying freeship condition applied. Webhook-driven sync is optional until Pancake webhook authentication/replay semantics are verified; polling/manual reconciliation remains the safe fallback.

## Slice checkpoints
After every slice:
- run focused RED/GREEN evidence for changed behavior;
- run repository CI gates relevant to the slice;
- self-review in this order: correctness → security → architecture → simplicity → performance;
- do not continue with a known Required/Critical finding;
- keep each slice independently revertible.

## Task 1 — Bind guest-cart identity to Next.js request context
**Description:** Add the server-only request adapter that reads the opaque cart cookie through Next.js `cookies()` and resolves only a live anonymous cart through the existing PostgreSQL service. No public mutation yet.

**Acceptance criteria:**
- malformed/missing/stale/account-owned cookie resolves to no cart;
- live anonymous cookie resolves to its cart without exposing account resources;
- no cookie write occurs during Server Component rendering.

**Verification:** focused integration test + typecheck/build; browser runtime remains pending unless an HTTP runtime test is added.

**Dependencies:** merged PR #30.

## Task 2 — Expose bounded cart mutations
**Description:** Add a small public mutation boundary only after request identity is established. Validate inputs server-side, preserve the PR #28 ownership lock, apply a distinct-line cap before allowing arbitrary browser writes, and use framework same-origin/CSRF protections. Cookie creation/rotation occurs only from a Server Function or Route Handler.

**Acceptance criteria:**
- first valid add creates a cart and emits the opaque cookie with DB-owned expiry;
- update/remove cannot cross into account-owned or expired carts;
- invalid quantity/variant and cart-line abuse fail without unintended persistence.

**Verification:** PostgreSQL runtime tests plus actual Next HTTP/Server Action evidence for emitted `Set-Cookie` before considering the transport complete.

**Dependencies:** Task 1.

## Task 3 — Verify Pancake product/warehouse contract
**Description:** Use current official Pancake POS OpenAPI as the primary source, then trusted live discovery where credentials are available. Replace empty reviewed-key allowlists only with human-reviewed exact fields/types needed by the website. Online-stock warehouse IDs must be explicit configuration; no warehouse is silently assumed to be online stock.

**Acceptance criteria:**
- exact product/variation price, color/size/SKU, active state and warehouse-stock fields are validated before mapping;
- unknown external fields remain fail-closed according to the reviewed contract tooling;
- no API key is exposed to client or CI logs.

**Verification:** contract fixtures/validators/mappers + reviewed live verification when credentials are available.

**Dependencies:** none, but must complete before production catalog sync.

## Task 4 — Sync Pancake catalog into the local mirror
**Description:** Extend the mirror only with fields justified by Task 3, then implement idempotent read-side upsert of products/variants/warehouse stock and operational price.

**Acceptance criteria:**
- repeated sync converges without duplicate products/variants/stocks;
- deactivated/missing Pancake records are handled deliberately rather than silently deleted;
- online availability derives only from explicitly configured online warehouse IDs.

**Verification:** mapper fixtures + PostgreSQL integration tests + safe read-only live sync verification when credentials exist.

**Dependencies:** Task 3.

## Task 5 — Build PLP/PDP from the mirror
**Description:** Replace storefront shells with mirror-backed product listing/detail and Color × Size selection using server-authoritative price/availability.

**Acceptance criteria:**
- active products/variants render correct current mirrored data;
- unavailable variants cannot invoke Add to Bag;
- URL/accessibility/mobile behavior follows the approved storefront spec.

**Verification:** domain/integration tests, production build, and browser/mobile/accessibility runtime checks when a browser tool is available.

**Dependencies:** Task 4.

## Task 6 — Build cart UI
**Description:** Render the current anonymous cart with product/variant labels and current mirrored price/availability; update/remove through Task 2 mutations.

**Acceptance criteria:**
- quantity/remove changes persist through refresh;
- stale/inactive variants are surfaced safely and cannot proceed as purchasable lines;
- totals are derived from current server mirror, never client-submitted price.

**Verification:** integration tests + production build + browser runtime when available.

**Dependencies:** Tasks 2, 4, 5.

## Task 7 — Persist and validate guest COD checkout
**Description:** Add website-owned immutable checkout/order snapshot fields for guest name/phone/address/note and order lines. Server revalidates cart, current price, variant and online stock immediately before POS submission.

**Acceptance criteria:**
- browser cannot choose authoritative price/stock/discount;
- invalid/stale cart cannot enter POS submission;
- shipping fee is 30,000 VND by default;
- shipping is free when authoritative merchandise subtotal is over 1,000,000 VND or total product quantity is at least 3;
- exactly 1,000,000 VND does not qualify for subtotal-based freeship unless the quantity rule also qualifies.

**Verification:** migration-from-empty, PostgreSQL runtime tests, validation tests and security review.

**Dependencies:** Tasks 4 and 6. Shipping-fee policy is approved and no longer blocks this task.

## Task 8 — Submit exactly one Pancake order safely
**Description:** Implement create-order only from verified official/live Pancake contract. Persist local state transition `VALIDATING → POS_SUBMITTING`; on confirmed response save Pancake order ID and mark `CONFIRMED`. On timeout/ambiguous write, use `SYNC_UNKNOWN` unless native idempotency/reference semantics are verified.

**Acceptance criteria:**
- successful checkout creates one Pancake order and persists external ID;
- no blind retry after an uncertain write;
- rejected validation/POS responses remain recoverable and auditable.

**Verification:** typed adapter fixtures, orchestration tests for success/reject/timeout/ambiguous response, and a controlled live verification only when safe credentials/test data are available.

**Dependencies:** Task 7 + verified Pancake create-order/idempotency contract.

## Task 9 — Reconcile Pancake order status
**Description:** Normalize only documented Pancake order statuses and refresh confirmed/unknown local orders via safe read reconciliation. Webhooks are added only if authentication/signature/replay behavior is explicitly documented and verified.

**Acceptance criteria:**
- unknown external status fails closed and is observable;
- `SYNC_UNKNOWN` can reconcile to the correct external order when the verified contract provides a safe reference/lookup path;
- reconciliation is idempotent and records sync outcome without leaking PII.

**Verification:** status fixtures + PostgreSQL sync tests + controlled live read verification.

**Dependencies:** Task 8 + exact status/lookup contract.

## Task 10 — Guest order tracking
**Description:** Expose minimal order tracking using public order code + phone proof, database-backed rate limiting, and minimal disclosure of normalized status.

**Acceptance criteria:**
- wrong code/phone does not reveal whether a specific order exists beyond a generic response;
- lookup is rate-limited and phone data is not logged;
- only safe normalized status/order summary is returned.

**Verification:** abuse/error-path integration tests, security review, production build and browser runtime when available.

**Dependencies:** Task 9.

## Known gates / product decisions
- Actual online Pancake warehouse IDs: configuration required before availability can be production-authoritative.
- Guest shipping fee: approved — 30,000 VND default; free above 1,000,000 VND merchandise subtotal or from total quantity 3.
- Pancake create-order idempotency/reference behavior: do not assume; determines safe uncertain-write recovery.
- Pancake webhook auth/signature/replay: do not expose webhook endpoint until verified.

## Final quality gate
Before claiming Order tracking/sync complete, all task acceptance criteria plus the project Definition of Done must pass. Browser-facing accessibility/runtime verification remains explicitly pending when no browser/DevTools tool is available.