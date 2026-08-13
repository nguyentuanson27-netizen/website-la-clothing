# C10 Guest Order Tracking — implementation plan

## Dependency graph
1. Safe input/public-state model.
2. Database lookup with allowlisted projection.
3. Atomic public rate limits using existing storage.
4. Public action composition with trusted-client identity.
5. Tracking page/form.
6. Browser/accessibility runtime verification and review.

## Task 1 — tracking domain + database contract
Acceptance criteria:
- Parse bounded order code + phone.
- Lookup guest order by both values in one DB predicate.
- Return only code, public local-state mapping, created time, total VND.
- Wrong/missing proof collapses to `NOT_FOUND`.
Verification: focused domain + DB tests.

Status: implemented. CI #652 reached 85/85 database tests green, including code+phone proof, allowlisted output, guest-only scoping, and wrong-proof/nonexistent equivalence.

## Task 2 — abuse controls + public boundary
Acceptance criteria:
- 10/min pseudonymous client bucket.
- 5/min HMAC order-code bucket.
- Atomic PostgreSQL fixed-window update.
- Raw IP/order code/phone absent from rate-limit keys and public failures.
- Public action consumes client budget before lookup and fails safely on limiter/config errors.
Verification: domain + DB rate-limit tests.

Status: implemented. The limiter uses parameterized PostgreSQL upsert/CAS-style fixed-window updates and HMAC/pseudonymous keys only. No raw IP, phone, or public code is stored in tracking bucket IDs.

## Task 3 — storefront tracking UI
Acceptance criteria:
- `/track-order` with labelled order-code and telephone fields.
- Generic not-found/unavailable messaging.
- Successful result shows only safe summary.
- Footer and checkout-success page make tracking discoverable.
Verification: typecheck/build + existing checkout Playwright/Axe/VoiceOver runtime extended through a real confirmed order lookup.

Status: implemented. Runtime coverage seeds a real confirmed local order and verifies wrong-phone non-disclosure, correct-phone safe summary, rate-limit key privacy, mobile overflow, keyboard focus, Axe, console/network cleanliness. CI #652 exposed only an ambiguous Playwright `role=alert` locator because Next.js also owns a route-announcer alert; the test locator was narrowed without changing production behavior.

## Task 4 — review / quality gate
Review order: correctness → security → architecture → simplicity → performance.
Definition of Done gate: tests, integration, docs, security, runtime accessibility, no unrelated refactor.

### TDD / debugging evidence
- RED `83bb0ee96a7ae8a7f9cbd05c4c92d7fdd5a8a48e`, CI #649: 79 existing DB tests passed; only the two new tracking tests failed because production tracking modules did not exist.
- Public-boundary test-only commit `c07f46de1687d221427b822bd550c28127698edc` landed before the public-action implementation.
- GREEN production commit `15456e4ce37f5514329847feb7be246e1318569b` added the DB-only tracking service, dual rate limits, Server Action, route/form, and discoverability links.
- CI #651 found a test-fixture defect: two new DB fixtures violated the pre-existing complete-checkout-snapshot database constraint. The fixtures were corrected; the database invariant was not weakened and production behavior was unchanged.
- CI #652 then passed all 85 DB tests plus HTTP security/checkout/admin smokes and lint. It identified two verification-only compatibility issues: TypeScript target rejection of BigInt literal syntax and a strict Playwright locator collision with Next's route announcer.
- Fixes replace BigInt literals with `BigInt(...)` and target the visible not-found text directly. No tracking semantics, database query, rate-limit policy, or public response shape changed.

Current gate: final exact-head CI after the verification fixes is required before this slice can be marked review-ready.
