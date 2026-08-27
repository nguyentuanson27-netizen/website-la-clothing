# ADR 0006: Mobile admin layout remains unchanged and non-blocking

- **Status:** Accepted
- **Date:** 2026-08-27
- **Amends:** the Admin Product Management V3 accessibility/browser contract only where it made 390px admin page-level overflow a release blocker
- **Preserves:** existing mobile admin behavior, authenticated admin authorization, mutation correctness, keyboard/focus behavior, Axe/VoiceOver coverage, storefront mobile coverage, and all data-integrity/security requirements

## Context

Admin Product Management V3 added dense operational controls for catalog activation, bulk variant management, confirmation flows, and product editing. The existing browser runtime exercises admin pages at 390px and exposed page-level horizontal overflow in the product editor.

The product owner explicitly chose not to change the mobile admin presentation for this release. The known overflow is a presentation limitation only; current verification has not shown it causing mutation, authorization, database, or storefront correctness defects.

## Decision

1. **Keep the current mobile admin UI unchanged.** PR #138 must not add a responsive-layout workaround or broad CSS masking solely to eliminate the known 390px overflow.
2. **The known mobile-only admin overflow is non-blocking for V3.** It does not block merge unless it is shown to cause a correctness, security, accessibility-operability, or data-integrity defect beyond presentation overflow.
3. **V3 product-editor runtime coverage may use a representative desktop viewport for the no-page-overflow assertion.** `admin-commerce-v3.spec.ts` and `admin-editor.spec.ts` run at `1280×900`; pre-existing admin runtime specs retain their existing 390px harness.
4. **All non-layout quality gates remain blocking.** ADMIN authentication/authorization, route-owned identity, input validation, atomic writes, confirmation freshness, fail-closed behavior, keyboard/focus semantics, Axe, and VoiceOver remain required.
5. **Buyer/storefront mobile coverage is unchanged.** Shopping, checkout, discovery, account, and other customer-facing flows keep their existing mobile verification.
6. **Do not suppress unrelated failures.** A runtime failure unrelated to the accepted mobile overflow still requires normal debugging and verification before merge.

## Consequences

- PR #138 does not need a mobile responsive refactor for the known ~604px admin-editor document width at a 390px viewport.
- Existing mobile admin rendering remains exactly as implemented before this decision; no layout workaround is introduced.
- A4/A5 browser behavior, Axe, VoiceOver, focus, and desktop no-overflow remain verified in the V3 editor specs.
- Existing admin bulk/collection runtime specs keep their prior mobile test environment.
- If mobile admin later becomes an explicitly supported operational workflow, responsive acceptance criteria and dedicated regression coverage should be added then.
