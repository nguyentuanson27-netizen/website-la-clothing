# ADR 0006: Admin management UI targets desktop, not mobile

- **Status:** Accepted
- **Date:** 2026-08-27
- **Amends:** the Admin Product Management V3 accessibility/browser contract where it implied mobile admin layout support or required mobile no-overflow as a release gate
- **Preserves:** authenticated admin authorization, mutation correctness, desktop accessibility, keyboard/focus behavior, Axe/VoiceOver coverage, storefront mobile coverage, and all data-integrity/security requirements

## Context

Admin Product Management V3 added dense operational controls for catalog activation, bulk variant management, confirmation flows, and product editing. The runtime accessibility suite originally exercised every browser spec through one 390px project. That made mobile page-level horizontal overflow in the admin editor a merge blocker even though the product owner does not intend admin management to be operated from mobile devices.

The mobile admin overflow is a presentation constraint, not evidence of a mutation, authorization, database, or storefront correctness defect. Keeping it as a release requirement would spend implementation and review effort on a viewport that is outside the intended admin operating environment.

## Decision

1. **Admin management routes are desktop-targeted operational tooling for the current product scope.** Mobile admin layout support is not an acceptance criterion or release gate.
2. **Admin browser accessibility tests run at a representative desktop viewport.** `admin-*.spec.ts` runs at `1280×900` while retaining native semantics, keyboard/focus assertions, Axe checks, VoiceOver coverage, confirmation announcements, and desktop no-page-overflow assertions.
3. **Storefront and buyer-facing browser tests keep their existing mobile coverage.** This decision does not reduce mobile requirements for shopping, checkout, product discovery, account, or other customer-facing flows.
4. **Security and correctness remain viewport-independent.** ADMIN authentication/authorization, route-owned identity, input validation, atomic writes, confirmation freshness, and fail-closed behavior remain mandatory and continue to block merge when broken.
5. **Mobile-only admin presentation defects are non-blocking unless they expose a correctness, security, or data-integrity problem.** They may be fixed opportunistically but do not justify broad responsive refactors in feature PRs.
6. **Do not hide or disable quality gates to satisfy this decision.** The runtime suite is split by intended operating surface so each surface is still tested against its actual contract.

## Consequences

- PR #138 no longer needs to solve the known 390px admin-editor horizontal overflow before merge.
- Admin A4/A5 runtime coverage continues on desktop, including variant pagination/selection, catalog confirmation/reconfirmation, quick action, stale composite rejection, Axe, VoiceOver, focus, and no page-level overflow at the supported viewport.
- Existing mobile admin behavior is best-effort and may horizontally overflow without violating the current product contract.
- If mobile admin becomes a supported workflow later, that must be introduced as an explicit product requirement with responsive acceptance criteria and dedicated runtime coverage.
