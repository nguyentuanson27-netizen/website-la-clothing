# Wave 2 Checkpoint B — integrated verification

Status: **PASS — 0 Critical / 0 Required**

Verified integration head: `main@649e04c328353c016e4ba41831b6eec7d49d1d54`

This record closes the growth-commerce master **Checkpoint B** after Wave 2 U12–U17 and the shared Wave 3 cart/analytics prerequisites U18–U19 were integrated on `main`. It records repository and CI evidence only; it does **not** enable promotion activation, search indexing, GTM, Merchant, or any later launch gate.

## Integrated prerequisites

- **U12 / M2** — standalone variant deep link via `/shop/<slug>?variant=<pancakeVariationId>`; current product authorization remains the boundary and forged/foreign/private/component identities fail closed.
- **U13 / W15b** — the two missing SEO HTTP/runtime signals are merged without duplicating the existing SEO smoke suite.
- **U14 / P5** — promotion admin UX is fully integrated through P5a PR #184 + P5b PR #185; React remains outside pricing/overlap authority.
- **U15 / P6** — PDP/composite promotion projection uses the central pricing resolver and the selected-variant identity contract.
- **U16 / P7a** — `/shop` discovery filters/sorts/paginates by effective price; the sanctioned SQL projection is regression-tested against the TypeScript pricing authority.
- **U17 / P7b** — `/flash-sale` uses the same promotion semantics, bounded pagination, server-authored representative selection and freshness behavior.
- **U18 / T5** — PDP add-to-cart is atomic `+1`; canonical add tracking is built from committed server facts.
- **U19 / T6** — cart update/remove deltas and cart/checkout analytics projection are authoritative and fail closed; cart, checkout render and order snapshot pricing converge on the central promotion resolver.

## Checkpoint B acceptance review

### One pricing authority

PASS. PDP projection calls `resolvePromotionPricing`; `/shop` has one sanctioned SQL mirror whose output is compared against `resolvePromotionPricing`; Flash membership/representative behavior is regression-tested against the same semantics. The integrated cart/checkout/order projection delivered by U19 also resolves promotion pricing through the shared authority rather than introducing a second formula.

### Identity and addressability

PASS. U12 resolves only `pancakeVariationId` values belonging to the already-authorized current standalone product projection. Local `VariantMirror.id` remains internal-only; repeated, oversized, ambiguous, stale, foreign, inactive/private and composite-invalid requests do not become selected public variants. The browser suite includes `variant-deep-link.spec.ts`.

### SQL ↔ TypeScript pricing parity

PASS. `tests/database/shop-effective-price-parity.test.ts` runs the shipped `buildVariantStockCte` projection against PostgreSQL and compares it with `resolvePromotionPricing` across mandated rounding fixtures, fixed/percentage campaigns, conflicts, time windows and invalid bases. The exact-head DB suite passed.

### Flash membership, representative and freshness

PASS. `tests/database/flash-sale-listing.test.ts` proves only active, valid, discounting and purchasable Flash variants qualify; conflicts fail closed; a cheaper ordinary variant cannot steal the Flash representative. The browser suite includes `flash-sale-freshness.spec.ts` and completed successfully on the integration head.

### Admin UX and authorization

PASS. P5a/P5b are both merged. The exact-head CI runs the admin authorization HTTP smoke and the complete Playwright/Axe configuration, including `admin-promotions.spec.ts`; both completed successfully.

### Activation remains off

PASS. `src/commerce/promotion-activation.ts` enables activation only when server-side `LA_PROMOTION_ACTIVATION_ENABLED === "true"`. The exact-head CI environment does not set that variable, so default-off remains the integrated runtime policy. Checkpoint B does not authorize turning it on.

## Exact-head verification evidence

All evidence below is for `main@649e04c328353c016e4ba41831b6eec7d49d1d54` after PR #185 and PR #186 were merged in that order.

- **CI push run `33739762266`: SUCCESS**
  - `verify`: SUCCESS — Prisma validate/generate/migrate deploy; DB smoke tests; Next HTTP security smoke; guest checkout Server Action HTTP smoke; authenticated admin HTTP authz smoke; lint; typecheck; domain tests; build; shipping runtime policy smoke; release preflight; production start smoke.
  - `admin-a11y-runtime`: SUCCESS — full `tests/a11y-runtime/playwright.config.ts` suite completed, including promotion admin, PDP promotion, Flash freshness, variant deep link, storefront/cart/checkout and analytics browser regressions.
- **Catalog indexation runtime `33739762252`: SUCCESS**.
- **VPS container verification `33739762271`: SUCCESS**.

P18 final QA is not a `push` workflow gate for this merge head, so no synthetic P18 evidence is claimed here.

## Security and failure-closed review

- Promotion admin writes remain behind authenticated admin boundaries; external identifiers and mutable catalog facts are revalidated by the owning services.
- Variant deep links do not perform an unscoped identity lookup or expose local IDs.
- Pricing uses current server-owned catalog/promotion facts; malformed/conflicting promotion state fails closed to no discount rather than selecting an arbitrary campaign.
- Canonical analytics snapshots remain bounded/non-PII and cannot roll back accepted commerce when tracking facts are unavailable.
- No GTM loader/CSP opening, Merchant activation, search-index enablement or promotion activation enablement is part of Checkpoint B.

## Fresh integrated review

Review priority: correctness → security → architecture → simplicity → performance.

Result: **0 Critical / 0 Required — APPROVE / CHECKPOINT B PASS**.

No duplicate pricing, cart, external identity or variant-URL authority was found in the integrated scope. Existing bounded-query and pagination guards remain in place; no new performance blocker was introduced by the integration.

## Gate transition

Checkpoint B is complete on the verified integration head. Therefore **U20 / P8 — mutable DRAFT quote + promotion audit is now unblocked**.

This does not bypass later sequencing:

`U20/P8 → U21/P9a → U22/P9b → U23/P10 → U24/T7 → Checkpoint C`

Promotion activation remains default-off, and real discounted activation / downstream launch gates still require their later acceptance criteria and Checkpoint C.