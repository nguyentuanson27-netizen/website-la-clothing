# Spec — Promotions & Flash Sale v1

Status: approved product requirements consolidated into an implementation-ready specification. This feature is website-owned: Pancake remains the source of catalog/inventory/base-price facts, while promotional pricing and campaign lifecycle are owned by LA Clothing.

## Objective
Add an admin-managed promotion system that can run regular promotions and flash sales across products or individual variants, render the resulting effective price consistently across the storefront/cart/checkout/order flow, and preserve a trustworthy immutable sale-price snapshot once an order is finalized.

The feature must not write promotional catalog prices back to Pancake.

## Current-system constraints
- Catalog and inventory are mirrored from Pancake through `ProductMirror` / `VariantMirror`.
- `VariantMirror.pancakeRetailPrice` is the website base-price input. `pancakeRetailPriceAfterDiscount` remains mirrored external data but is not authoritative for website sale pricing.
- The current checkout architecture may create an `OrderMirror` in `DRAFT` as a checkout-attempt/snapshot implementation detail before Pancake submission. This spec does **not** require replacing that architecture.
- Pancake create-order currently accepts an integer `variation_info.retail_price` field in the reviewed structural contract. Existing project evidence proves that field shape exists; it does **not** prove that Pancake will always honor an arbitrary website-owned discounted value without repricing. Production readiness therefore requires a separate controlled semantic verification gate described below.

## Campaign model and lifecycle
A campaign has one shared rule across all of its targets:
- kind: `PROMOTION` or `FLASH_SALE`;
- name;
- discount type: `PERCENTAGE` or `FIXED_PRICE`;
- one discount value;
- one time configuration;
- one or more targets spanning products and/or individual variants.

Target semantics:
- `PRODUCT` means the product as a semantic scope, including variants synced later while the target remains eligible.
- `VARIANT` means one specific variant.
- A campaign may target multiple products and multiple variants across products.
- A campaign must not contain duplicate targets.
- A campaign must not target product A and separately target a variant already covered by product A in the same campaign.

Persist enough lifecycle history to enforce editability after the campaign has run. At minimum the persisted model must distinguish:
- never activated;
- activated at least once;
- disabled/ended after activation.

A field such as `firstActivatedAt` is acceptable; a different representation is allowed if it enforces the same contract.

Derived/admin-visible statuses:
- `Draft`: not currently enabled/published.
- `Scheduled`: enabled, valid, start is in the future.
- `Active`: enabled, valid, and current time is inside the active interval.
- `Ended`: campaign was activated and its configured end has passed.
- `Disabled`: explicitly disabled after it was activated, or otherwise terminally stopped according to the rules below.

Lifecycle rules:
- Draft and Scheduled campaigns are fully editable, but every save/publish must revalidate price rules and overlap.
- An Active campaign cannot directly change targets, discount type, discount value, or the material pricing rule. To materially change it, disable the current campaign and create/copy a new one.
- Active campaigns may be ended early by disabling them.
- Once a campaign has been Active and is then Disabled, it is terminal/read-only and cannot be re-enabled. Re-run via Copy → Draft.
- Ended campaigns are terminal/read-only and cannot be re-enabled. Re-run via Copy → Draft.
- A never-activated Draft may be edited and enabled later.
- All statuses support Copy.

Copy behavior:
- Always creates a new `Draft` with a new campaign ID.
- Keeps kind, discount type/value, targets, and time configuration.
- Copies the name with a visible suffix such as `- Bản sao`.
- Does not inherit runtime status, lifecycle history, related orders, or activation timestamps.
- Time, price validity, and overlap must be revalidated before the copy can be enabled.

## Scheduling and time semantics
Admin displays/accepts campaign time in `Asia/Ho_Chi_Minh`; persisted instants are UTC.

Use half-open intervals `[startsAt, endsAt)`:
- start is inclusive;
- end is exclusive;
- campaign B may start exactly when campaign A ends without overlap.

For overlap math:
- `startsAt = null` means negative infinity;
- `endsAt = null` means positive infinity.

Regular Promotion:
- may start immediately (`startsAt = null`);
- may run indefinitely (`endsAt = null`);
- if both exist, `endsAt > startsAt`.

Flash Sale:
- requires both `startsAt` and `endsAt`;
- requires `endsAt > startsAt`.

Server time is authoritative for activation and checkout. Client countdowns are presentation only.

## Pricing contract
### Base price
`pancakeRetailPrice` is the only Pancake mirror field used as the website promotional base price in v1.

A usable VND base price must satisfy:

```ts
function isUsableBasePriceVnd(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0;
}
```

If the mirrored base price is null, non-finite, fractional, non-positive, or outside JavaScript safe-integer range, the variant has `BASE_PRICE_UNAVAILABLE` and is not purchasable until the base price is usable.

`pancakeRetailPriceAfterDiscount` must not:
- determine storefront effective price;
- cause `PRICE_UNRESOLVED` merely because it differs from `pancakeRetailPrice`;
- override a website promotion.

### Effective price
There is one centralized server-owned pricing resolver used by storefront, cart, checkout, order snapshotting, structured data, and tracking/analytics values.

Its conceptual output contains at least:
- `basePriceVnd`;
- `effectivePriceVnd`;
- `isDiscounted`;
- promotion/campaign identity when applied;
- kind;
- discount type/value;
- start/end facts required for badges/countdown/audit.

Rules:
- no valid active website campaign → `effectivePriceVnd = basePriceVnd`;
- valid active campaign → compute website-owned effective price;
- never stack campaigns; overlap prevention guarantees at most one applicable active campaign per affected variant.

### Percentage
- Integer percentage only.
- Allowed range: `1..99`.
- Compute an integer VND result using integer-safe arithmetic equivalent to `Math.round(baseVnd * (100 - percent) / 100)`.
- Result must satisfy `0 < effectivePriceVnd < basePriceVnd`; otherwise the campaign/target is invalid and must not be applied.

### Fixed price
`FIXED_PRICE` means the final customer price, not an amount-off.

Validation for every affected variant:
- integer VND;
- `0 < fixedSalePriceVnd < basePriceVnd`.

Product-level fixed price applies the exact same final price to all variants under that product. If any covered variant fails the fixed-price rule, that product target is invalid.

## Overlap and concurrency contract
Enabled/published campaigns must not overlap for the same affected variant, including future Scheduled intervals.

Conflict examples:
- product-level campaign on product A conflicts with any overlapping variant-level campaign on any variant under A;
- variant-level campaign conflicts with an overlapping product-level campaign that covers its product;
- two product targets covering the same product conflict;
- two variant targets for the same variant conflict.

Disabled/terminal campaigns do not reserve an interval.

Validation must be server-side and concurrency-safe. UI-only prechecks are insufficient. Two concurrent admin writes must not be able to publish overlapping effective coverage.

Exact PostgreSQL locking/constraint strategy is an implementation-plan decision, but the persisted result must satisfy the invariant atomically.

## Catalog changes while a campaign is scheduled/active
Product targets are semantic product scopes, not frozen lists.

When Pancake sync introduces a new variant under a targeted product:
- the new variant becomes covered by that product target automatically;
- overlap and pricing validity are evaluated for that variant;
- no website promotion target is written back to Pancake.

If a Pancake base-price change or newly synced variant makes an active `FIXED_PRICE` target invalid:
- never apply an invalid fixed price;
- stop applying only the affected target unit, not unrelated targets in the same campaign;
- for a product-level target, the affected unit is the entire product target, preserving the rule that all variants under that product share one fixed price;
- unaffected campaign targets may continue;
- surface a clear admin health/error state naming the affected product/variants and reason.

If base price itself becomes unusable, the affected variant becomes `BASE_PRICE_UNAVAILABLE` and is not purchasable; this is distinct from a usable base price that merely invalidates a fixed promotion.

## Admin UX
Primary management surface: `/admin/promotions`.

Required capabilities:
- list Promotion and Flash Sale campaigns;
- create;
- edit when lifecycle allows;
- enable/publish;
- disable/end early;
- copy;
- choose one or more product/variant targets;
- clearly show Draft / Scheduled / Active / Ended / Disabled;
- show validation errors for overlap, unusable base price, invalid fixed price, invalid percentage, and invalid scheduling.

Product admin pages do not become the primary editor. They show current/upcoming related campaigns and link to the relevant campaign in `/admin/promotions`.

All admin mutations must reuse the existing authenticated/authorized admin boundary and must validate browser input server-side.

## Storefront UX
Regular promotion:
- original/base price shown struck through;
- effective sale price emphasized;
- visible sale badge, e.g. `-20%` for percentage campaigns.

Flash Sale:
- regular sale treatment;
- visible `FLASH SALE` badge;
- countdown to `endsAt` on product card and PDP while active.

Dedicated `/flash-sale` page:
- contains products with at least one currently purchasable variant under a valid active `FLASH_SALE` campaign;
- excludes regular-promotion-only products;
- excludes Scheduled/Ended/Disabled flash sales.

### Product-card representative pricing
When variants under one product have different promotion states, card rendering must be deterministic.

On normal listings:
1. Consider currently purchasable variants with a valid active website promotion.
2. If one or more exist, select the variant with the lowest `effectivePriceVnd` as the representative sale variant.
3. If tied, use the repository's stable variant ordering; if no existing stable order is available, use a deterministic ID tie-breaker.
4. Show `Từ <effective price>` when the product has materially different purchasable variant prices.
5. Strike through the **base price of the same representative variant**, not a base price from another variant.
6. Badge/kind/countdown come from the representative variant's campaign.
7. If no variant is actively promoted, fall back to the existing normal product-card price behavior using base prices.

On `/flash-sale`, apply the same representative rule but only among currently purchasable variants with a valid active `FLASH_SALE` campaign.

PDP always resolves the exact selected variant; after variant selection it displays that variant's own base/effective price and applicable badge/countdown.

Countdown expiry must not be the authority for pricing. At/after expiry, server-rendered/revalidated data must stop applying the campaign. Cache/revalidation behavior must not allow stale promotional pricing to remain authoritative past `startsAt`/`endsAt`.

## Cart, checkout, and final order pricing
The cart does not lock promotional price.

Cart and checkout display the current server-resolved effective price. Final order pricing is determined at checkout submission time.

### Price-change confirmation contract
On submit, the server recomputes the current effective price from current base-price facts + current valid website campaign state.

If the recomputed price differs from the quote the buyer last confirmed:
- return a typed `PRICE_CHANGED` outcome with refreshed price/totals;
- do not transition the checkout attempt to `POS_SUBMITTING` or another final submission state;
- do not call Pancake;
- require the buyer to explicitly submit/confirm the refreshed totals again.

The existing architecture may persist or refresh an `OrderMirror(DRAFT)` and its lines while handling this checkout attempt. The prohibition is against creating/finalizing an immutable submitted order at the stale price, **not** against the existence of a DRAFT checkout snapshot.

When the buyer submits a quote that still matches the server recomputation:
- freeze the order-line pricing snapshot used for the final submission;
- subsequent campaign changes do not rewrite that finalized snapshot;
- preserve enough immutable facts to audit base price, final unit price, and applied campaign identity/rule at order time.

The exact column set may vary, but the final order snapshot must be able to prove historical customer pricing after campaigns are copied, disabled, or ended.

## Pancake order submission contract
Website catalog promotion state is never written back to Pancake.

For a finalized order, the application intends to send the order's snapshotted final `effectivePriceVnd` as the line `variation_info.retail_price`, so Pancake receives the same customer unit price recorded locally.

However, the checked structural OpenAPI evidence only establishes the existence/type of that field. Before this feature is considered production-ready, verification must establish that Pancake's real create-order behavior accepts and preserves a value different from the catalog base price without silently repricing/rejecting it.

Required evidence gate:
1. Unit/integration tests prove the local mapper sends the immutable final order snapshot value, not live catalog price and not browser input.
2. A controlled Pancake acceptance check in an approved non-destructive/testable context verifies semantic behavior for a discounted `retail_price` different from catalog base.
3. Do not introduce blind retry behavior; existing one-shot/idempotency safety rules remain authoritative.
4. If semantic acceptance cannot be verified, the promotion feature may be implemented locally but must not be declared production-ready for real discounted order submission.

## Analytics and SEO
All customer-value surfaces use the website effective/final customer price, not `pancakeRetailPriceAfterDiscount`:
- product structured-data Offer price;
- storefront/cart/checkout analytics values;
- final purchase reporting from the immutable order snapshot.

`/flash-sale` follows the existing repository search-indexing policy/ADR. This feature does not independently change indexing policy.

## Security and trust boundaries
- Browser/admin form data is untrusted; validate type, target IDs, ranges, time bounds, and lifecycle transition server-side.
- Promotion writes require existing admin authentication/authorization.
- Product/variant IDs supplied by the browser must be resolved against website-owned mirror records; never trust browser-supplied prices/product facts.
- Effective price is always server-computed.
- Checkout submit must not accept a browser-provided final unit price as authority.
- Pancake payload remains a strict server-owned allowlist built from the immutable order snapshot and freshly validated required Pancake identity facts.
- Do not log secrets or raw Pancake credentials.

## Project structure / expected ownership
Exact filenames may be refined during `/plan`, but ownership should remain separated:
- Prisma schema/migration: website-owned campaign and order-audit persistence.
- Promotion domain/repository: campaign validation, lifecycle, targets, overlap, active-campaign lookup.
- Central pricing resolver: base/effective-price calculation and typed failure facts.
- Admin: `/admin/promotions` UI + authenticated server actions.
- Storefront projection/card/PDP: presentation derived from central quote facts.
- Cart/checkout/order: reprice/`PRICE_CHANGED`/immutable snapshot integration.
- Pancake order mapper: consumes final local snapshot only.
- Tests: domain + database + integration + browser/a11y coverage in existing locations.

Do not duplicate pricing formulas in UI, cart, checkout, SEO, or analytics modules.

## Testing strategy
New behavior must have tests that would fail without the implementation.

Required coverage:
- percentage integer/range/rounding edges;
- fixed-price validity at variant and product scope;
- unusable base-price cases;
- `pancakeRetailPriceAfterDiscount` mismatch no longer blocks website pricing;
- active/scheduled/ended/disabled interval boundaries using `[start,end)`;
- null regular-promotion boundaries;
- overlap product↔variant and concurrent publish attempts;
- copy/lifecycle terminal rules and `firstActivated` equivalent history;
- new variant under product target;
- active fixed-price invalidation after base-price change;
- representative card pricing/ties/mixed Promotion + Flash Sale variants;
- `/flash-sale` active-only membership;
- cart repricing;
- stale checkout returns `PRICE_CHANGED`, does not enter `POS_SUBMITTING`, and performs no Pancake write;
- confirmed checkout snapshots final sale price and promotion audit facts;
- Pancake mapper uses final local order snapshot value;
- structured data / Meta values use effective/final customer price;
- admin authz and validation;
- keyboard/mobile/Axe coverage for campaign form and storefront sale UI.

## Verification commands
Use the repository's actual gates. Implementation PRs must run the relevant subset locally and must pass the full CI matrix before merge.

Core project gates:
- `pnpm prisma:validate`
- `pnpm prisma:generate`
- `pnpm prisma:migrate:deploy`
- `pnpm test:db`
- `node --experimental-strip-types scripts/cart-server-action-http-smoke.ts`
- `node --experimental-strip-types scripts/guest-checkout-server-action-http-smoke.ts`
- `node --experimental-strip-types scripts/admin-authz-http-smoke.ts`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm release:check`

Browser/a11y gate follows the existing isolated runtime workspace:
- `cd tests/a11y-runtime && npm ci --ignore-scripts --no-audit --no-fund`
- `cd tests/a11y-runtime && npx playwright install chromium`
- `cd tests/a11y-runtime && npx playwright test --config playwright.config.ts`

The controlled Pancake custom-sale-price semantic acceptance check is a production-readiness gate but must not be converted into an uncontrolled recurring write from CI.

## Boundaries
Always:
- Treat Pancake catalog price as base-price input and website campaign state as the only promotion authority.
- Compute prices centrally on the server.
- Revalidate overlap and price validity on every campaign save/publish.
- Reprice at checkout submission.
- Preserve immutable final order pricing/audit facts.
- Keep admin mutations authenticated/authorized and concurrency-safe.

Ask first:
- New third-party dependencies.
- Any Pancake catalog write for promotional pricing.
- Any destructive migration or change to existing order-state meanings.
- Any change to current Pancake one-shot/idempotency safety policy.
- Any promotion stacking/coupon interaction beyond this spec.

Never:
- Trust browser-provided final prices.
- Use `pancakeRetailPriceAfterDiscount` as website promotion authority.
- Apply two active promotions to one variant.
- Silently apply an invalid fixed price.
- Submit stale checkout pricing after `PRICE_CHANGED`.
- Blindly retry ambiguous Pancake order creation.
- Refactor unrelated commerce/admin code solely to implement this feature.

## Explicitly out of scope for v1
- Promotion-specific stock quota.
- Per-customer purchase caps.
- Coupon codes and stacking.
- Promotion stacking or priority rules.
- Buy-X-get-Y / bundle-discount engines.
- Membership/personalized pricing.
- Manual stock reservation.
- Different discount values inside one campaign.
- Writing website sale prices back to Pancake catalog.
- Advanced campaign revenue/analytics dashboard.

## Success criteria
1. Admin can create, validate, schedule, copy, activate, and terminally stop Promotion/Flash Sale campaigns over multiple product/variant targets according to lifecycle rules.
2. No two enabled campaign intervals can concurrently cover the same variant, including product↔variant conflicts and concurrent writes.
3. Website effective pricing uses only usable `pancakeRetailPrice` + website campaign state; mismatch in `pancakeRetailPriceAfterDiscount` no longer blocks saleability by itself.
4. Percentage and fixed-price calculations are integer-VND, centralized, deterministic, and validated before application.
5. Storefront cards/PDP/cart/checkout/structured data/analytics use the same pricing contract; mixed variant campaigns render deterministically.
6. `/flash-sale` contains only products with a valid active Flash Sale variant and displays active flash-sale price/badge/countdown correctly.
7. Checkout detects stale prices, returns `PRICE_CHANGED`, performs no Pancake submission on that attempt, and requires explicit reconfirmation while remaining compatible with existing `OrderMirror(DRAFT)` snapshot architecture.
8. Final submitted orders preserve immutable base/final price and campaign audit facts.
9. Pancake order mapping sends the immutable final customer unit price, and controlled semantic evidence confirms Pancake accepts/preserves the discounted override before production readiness is declared.
10. Admin/authz/security, database concurrency, domain/integration tests, browser/Axe coverage, lint, typecheck, build, migrations, release checks, and the repository CI gates pass before merge of implementation work.

## Implementation / PR sizing guidance
This spec is one product contract, but implementation may be split into dependency-safe PRs when that improves reviewability. Follow ADR 0005: file count is not the gate; atomicity, subsystem ownership, risk, effective changed lines, verification, and rollback/revert clarity are.

Do not split directly affected tests away from the behavior they prove merely to reduce file count. Do not combine unrelated refactors with promotion implementation.
