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

## Task 2 — abuse controls + public boundary
Acceptance criteria:
- 10/min pseudonymous client bucket.
- 5/min HMAC order-code bucket.
- Atomic PostgreSQL fixed-window update.
- Raw IP/order code/phone absent from rate-limit keys and public failures.
- Public action consumes client budget before lookup and fails safely on limiter/config errors.
Verification: domain + DB rate-limit tests.

## Task 3 — storefront tracking UI
Acceptance criteria:
- `/track-order` with labelled order-code and telephone fields.
- Generic not-found/unavailable messaging.
- Successful result shows only safe summary.
- Footer and checkout-success page make tracking discoverable.
Verification: typecheck/build + existing checkout Playwright/Axe/VoiceOver runtime extended through a real confirmed order lookup.

## Task 4 — review / quality gate
Review order: correctness → security → architecture → simplicity → performance.
Definition of Done gate: tests, integration, docs, security, runtime accessibility, no unrelated refactor.
