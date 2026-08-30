# Spec — Promotions & Flash Sale v1

Status: approved product requirements consolidated into an implementation-ready specification. This feature is website-owned: Pancake remains the source of catalog, inventory, and base-price facts, while promotional pricing and campaign lifecycle are owned by LA Clothing.

## Objective
Add an admin-managed promotion system that can run regular promotions and flash sales across products or individual variants, render one authoritative effective price consistently across storefront → cart → checkout → order snapshot → Pancake submission, and preserve trustworthy immutable pricing/audit facts once an order is finalized.

The feature must not write promotional catalog prices back to Pancake.

## Current-system constraints
- Catalog and inventory are mirrored from Pancake through `ProductMirror` / `VariantMirror`.
- `VariantMirror.pancakeRetailPrice` is the normal website base-price read model. `pancakeRetailPriceAfterDiscount` remains mirrored external data but is not authoritative for website sale pricing.
- The current checkout architecture may create an `OrderMirror` in `DRAFT` as a checkout-attempt/snapshot implementation detail before Pancake submission. This spec does **not** require replacing that architecture.
- Current order submission fetches fresh Pancake catalog facts before create-order. Promotion implementation must integrate that freshness check into the same central effective-price contract rather than comparing the persisted sale price directly to raw Pancake retail price.
- Pancake create-order currently accepts an integer `variation_info.retail_price` field in the reviewed structural contract. Existing project evidence proves that field shape exists; it does **not** prove that Pancake will always honor an arbitrary website-owned discounted value without repricing. Production readiness therefore requires the controlled semantic verification gate below.

## Campaign model
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
- All targets in one campaign share the same discount type/value/time configuration. Different discount amounts require separate campaigns.

Persistence must be website-owned and use integer money for website-owned VND values. Conceptually:
- percentage value: integer;
- fixed sale price: `BigInt`/integer VND, never `Float`;
- target row: exactly one of product or variant is populated;
- order audit money: `BigInt`/integer VND.

Exact Prisma names may be refined in `/plan`, but database/server invariants must enforce valid target shape and campaign relationships rather than relying on UI-only checks.

## Campaign lifecycle
Persist enough lifecycle history to distinguish all of these facts reliably, including after process restarts and after a scheduled window passes without admin traffic:
- explicit Draft versus explicitly Disabled-before-activation;
- never Active versus Active at least once;
- terminally Disabled/Ended after activation.

A representation using fields such as `enabled`, activation history, and `disabledAt` is acceptable; `firstActivatedAt` may be part of the model but is not by itself mandatory. The implementation must make the rules below enforceable without depending on a browser session or client clock.

Admin-visible statuses:
- `Draft`: explicit work-in-progress that has not been enabled/published.
- `Scheduled`: enabled and valid, with effective start in the future.
- `Active`: enabled, valid, and current server time is inside the active interval.
- `Ended`: campaign was enabled through an effective active window and that configured window has ended.
- `Disabled`: explicitly disabled by admin, whether before or after it ever became Active.

Lifecycle rules:
- Draft campaigns are fully editable and may be saved even while incomplete/invalid; health/validation errors must be shown.
- Scheduled campaigns are fully editable, but because they are enabled every successful save must leave them valid and non-overlapping. An invalid edit is rejected atomically and the previous campaign definition remains effective.
- A Disabled campaign that has **never** been Active may be edited and re-enabled after full activation validation.
- An Active campaign cannot directly change targets, discount type, discount value, or material pricing/time behavior. To materially change it, disable/end the current campaign and create/copy a new one.
- Active campaigns may be ended early by disabling them.
- Once a campaign has been Active and is then Disabled, it is terminal/read-only and cannot be re-enabled. Re-run via Copy → Draft.
- Ended campaigns are terminal/read-only and cannot be re-enabled. Re-run via Copy → Draft.
- All statuses support Copy.

Copy behavior:
- Always creates a new `Draft` with a new campaign ID.
- Keeps kind, discount type/value, targets, and time configuration.
- Copies the name with a visible suffix such as `- Bản sao`.
- Does not inherit runtime status, lifecycle history, related orders, activation history, or source campaign ID as identity.
- Time, price validity, target validity, and overlap must be revalidated before the copy can be enabled.

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
- may end at a configured time while starting immediately;
- may start in the future and run indefinitely (`endsAt = null`);
- may be completely indefinite (`startsAt = null`, `endsAt = null`);
- if both exist, `endsAt > startsAt`.

Flash Sale:
- requires both `startsAt` and `endsAt`;
- requires `endsAt > startsAt`.

Server time is authoritative for activation and checkout. Client countdowns are presentation only.

## Pricing contract
### Base price
`pancakeRetailPrice` is the only Pancake price field used as website promotional base price in v1.

A usable VND base price must satisfy:

```ts
function isUsableBasePriceVnd(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0;
}
```

Therefore null, `NaN`, infinity, fractional, non-positive, or unsafe-integer values are unusable. A variant with unusable base price has `BASE_PRICE_UNAVAILABLE` and is not purchasable until a usable base price is available.

`pancakeRetailPriceAfterDiscount` must not:
- determine storefront effective price;
- cause `PRICE_UNRESOLVED` merely because it differs from `pancakeRetailPrice`;
- override a website promotion;
- be used as the final order price authority.

### Latest Pancake base-price rule
The business rule is always to resolve against the **latest trusted Pancake base price available to the website**.

Normal storefront/cart reads use the latest successfully mirrored `VariantMirror.pancakeRetailPrice`.

If checkout submission obtains a fresher trusted Pancake catalog value than the current mirror, that fresher base price must enter the **same central effective-price resolver** for that checkout attempt. It must not be used only inside the Pancake mapper as a second independent pricing authority.

Consequences:
- `%` promotion recalculates against the fresher base price;
- `FIXED_PRICE` keeps its configured sale price and is revalidated against the fresher base price;
- if the resulting quote differs from what the buyer last confirmed, return `PRICE_CHANGED` before create-order;
- the refreshed quote must be capable of becoming the next DRAFT/final pricing snapshot, so a stale mirror cannot cause an infinite `PRICE_CHANGED` loop. The implementation may update trusted mirror facts first or carry the fresh validated quote into a new/superseding DRAFT; exact orchestration belongs in `/plan`.

### Central effective-price resolver
There is one server-owned pricing resolver used by storefront, cart, checkout, order snapshotting, structured data, analytics, and the final Pancake line-price mapper.

Its conceptual output contains at least:
- `basePriceVnd`;
- `effectivePriceVnd`;
- `isDiscounted`;
- promotion/campaign ID when applied;
- campaign name;
- kind;
- discount type/value;
- start/end facts required for badges/countdown/audit.

Rules:
- no valid active website campaign → `effectivePriceVnd = basePriceVnd`;
- valid active campaign → compute website-owned effective price;
- never stack campaigns;
- browser-provided prices are never authority.

### Percentage
- Integer percentage only.
- Allowed range: `1..99`.
- Compute integer VND using integer-safe arithmetic equivalent to `Math.round(baseVnd * (100 - percent) / 100)`.
- Result must satisfy `0 < effectivePriceVnd < basePriceVnd`; otherwise the campaign/target is invalid and is not applied.

Example: base changes from `500000` to `600000` while a `20%` campaign remains active → new effective price is `480000`.

### Fixed price
`FIXED_PRICE` means the final customer price, not an amount-off.

Validation for every affected variant:
- integer VND;
- `0 < fixedSalePriceVnd < basePriceVnd`.

Product-level fixed price applies the exact same configured final price to all variants under that product while the product target is healthy.

## Save / publish / activation validation
Draft save:
- may persist incomplete or currently invalid campaign configuration;
- must surface typed validation/health errors to admin;
- must not affect storefront pricing.

Enable/publish a Draft or re-enable a never-Active Disabled campaign:
- validate all current affected variants;
- reject if any affected current variant lacks usable base price;
- reject invalid percentage/fixed-price values;
- reject invalid time configuration;
- reject any enabled/published overlap;
- operation is atomic: no partially enabled campaign.

Scheduled save:
- rerun the same validation because Scheduled is already enabled;
- reject the edit atomically if the resulting campaign would be invalid or overlapping.

Active runtime degradation caused **after** successful activation is handled by the runtime rules below; it does not retroactively make the original activation invalid.

## Overlap and concurrency contract
Enabled/published campaigns must not overlap for the same affected variant, including future Scheduled intervals.

Conflict examples:
- product-level campaign on product A conflicts with any overlapping variant-level campaign on any variant under A;
- variant-level campaign conflicts with an overlapping product-level campaign that covers its product;
- two product targets covering the same product conflict;
- two variant targets for the same variant conflict.

Disabled campaigns do not reserve an interval.

Validation must be server-side and concurrency-safe. UI-only prechecks are insufficient. Two concurrent admin writes must not both publish overlapping effective coverage.

Exact PostgreSQL locking/constraint strategy is an implementation-plan decision, but the persisted result must satisfy the invariant atomically.

## Catalog changes while campaign is Scheduled/Active
Product targets are semantic product scopes, not frozen variant lists.

When Pancake sync introduces or restores a variant under a targeted product:
- the variant becomes covered by that product target automatically;
- pricing validity and overlap are evaluated dynamically;
- no website promotion target is written back to Pancake.

### Runtime fixed-price invalidation
If a newer Pancake base price makes `FIXED_PRICE` invalid:
- never apply the invalid fixed price;
- for an explicit `VARIANT` target, only that variant target loses promotion;
- for a `PRODUCT` target, if any currently covered variant makes the shared fixed price invalid, that product target is unhealthy and is not applied while invalid, preserving the one-price-for-the-whole-product target contract;
- unrelated targets in the same campaign continue when healthy;
- admin sees a clear health/error state naming the affected target/variant and reason.

If the target later becomes valid again while the campaign is still within its enabled effective interval and no overlap exists, promotion applies again automatically and the health warning clears. Runtime invalidation is not a permanent disable.

### Runtime overlap discovered from catalog mutation
A new/restored/re-associated variant can expose a conflict that did not exist when campaigns were originally published.

The system must fail closed:
- never stack or silently prioritize campaigns;
- on the conflicted variant, apply **no website promotion** until the conflict disappears or admin resolves it;
- healthy, non-conflicted variants/targets continue according to their own rules;
- surface an admin health warning identifying all conflicting campaign IDs/targets;
- when the conflict disappears and the remaining campaign is otherwise valid/active, pricing recovers automatically.

If base price itself becomes unusable, the affected variant becomes `BASE_PRICE_UNAVAILABLE` and is not purchasable. This is distinct from a usable base price that merely invalidates a promotion.

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
- show whether an Active/Scheduled campaign is healthy or has runtime-invalid/conflicting targets;
- show target-specific validation errors for overlap, unusable base price, invalid fixed price, invalid percentage, and invalid scheduling.

Product admin pages do not become the primary editor. They show current/upcoming related campaigns and link to the relevant campaign in `/admin/promotions`.

All admin mutations reuse the existing authenticated/authorized admin boundary and validate browser input server-side.

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
A product card is considered on sale when at least one currently purchasable variant has a valid active website promotion.

On normal listings:
1. Consider currently purchasable promoted variants.
2. Select the promoted variant with the lowest `effectivePriceVnd` as the representative sale variant.
3. If tied, use the repository's stable variant ordering; if no stable domain ordering exists, use a deterministic ID tie-breaker.
4. Strike through the **base price of the same representative variant**.
5. Badge/kind/countdown come from that representative variant's campaign.
6. For the common case where that sale price is also the product's minimum current effective price, display the approved form `Từ <sale price>`.
7. If an unpromoted/currently non-sale variant is cheaper than the representative sale variant, do not falsely imply the sale price is the product-wide minimum. Use explicit sale wording such as `Sale từ <sale price>` while preserving the existing normal price/range cue as layout allows.
8. If no variant is actively promoted, fall back to existing normal product-card price behavior using base prices.

On `/flash-sale`, apply the representative rule only among currently purchasable variants with a valid active `FLASH_SALE` campaign; use `FLASH SALE` presentation/countdown from that representative flash-sale variant.

PDP always resolves the exact selected variant. When variant selection changes, base price, effective price, strike-through, badge, and countdown update for the selected variant. A selected variant with no valid promotion shows base price and no sale/flash-sale badge/countdown.

Countdown expiry is not pricing authority. At/after expiry, server-rendered/revalidated data must stop applying the campaign. Cache/revalidation behavior must not keep stale promotional pricing authoritative past `startsAt`/`endsAt`.

## Cart, checkout, and final order pricing
The cart does not lock promotional price. Cart and checkout display the current server-resolved effective price.

### Price-change confirmation contract
On submit, the server recomputes the authoritative effective quote from the latest trusted base-price facts + current valid website campaign state.

If the recomputed quote differs from what the buyer last confirmed:
- return typed `PRICE_CHANGED` with refreshed line prices and totals;
- do not transition that stale attempt to `POS_SUBMITTING`;
- do not call Pancake create-order;
- require the buyer to explicitly review and submit/confirm the refreshed totals again.

Compatibility with the current state machine:
- an `OrderMirror(DRAFT)` may already exist before this check;
- the stale attempt may remain DRAFT, be refreshed, or be marked `REJECTED`/superseded according to the existing checkout orchestration, provided it is never submitted to Pancake at the stale price;
- a terminal stale attempt must not block creation of a fresh DRAFT carrying the refreshed quote after the buyer confirms again;
- no implementation may loop forever between a stale mirror snapshot and a fresher Pancake price.

When the buyer submits a quote that still matches server recomputation:
- freeze the order-line pricing facts used for final submission no later than the transition out of DRAFT into final validation/submission;
- subsequent campaign/base-price changes do not rewrite that finalized snapshot;
- final purchase reporting and Pancake line mapping consume the immutable snapshot.

## Order-line audit snapshot
Each finalized order line must retain enough immutable data to explain historical customer pricing without consulting the current campaign record.

Required facts:
- `baseUnitPriceVnd` — base price used by the effective-price resolver at confirmation time;
- existing/final `unitPriceVnd` — customer unit price;
- `lineTotalVnd`;
- nullable `promotionId`;
- nullable `promotionName` snapshot;
- nullable `promotionKind` snapshot (`PROMOTION` / `FLASH_SALE`);
- nullable `promotionDiscountType` snapshot (`PERCENTAGE` / `FIXED_PRICE`);
- nullable percentage value when percentage applied;
- nullable fixed-sale-price VND value when fixed price applied.

Promotion fields are null for lines without website promotion.

Campaign copy, disable, edit of a never-active campaign, deletion/absence of upstream catalog facts, or later Pancake price changes must not alter finalized order history.

## Pancake order submission contract
Website catalog promotion state is never written back to Pancake.

For a finalized order, the application intends to send the order's immutable final `unitPriceVnd`/effective price as line `variation_info.retail_price`, so Pancake receives the same customer unit price recorded locally.

Fresh Pancake validation before create-order may still verify required shop/variation identity and stock. Any fresh base-price fact that affects customer price must first pass through the central effective-price/`PRICE_CHANGED` contract; the Pancake mapper must not silently replace the immutable final sale price with live catalog retail price.

The checked structural OpenAPI evidence only establishes the existence/type of `variation_info.retail_price`. Before this feature is production-ready, verification must establish that Pancake's real create-order behavior accepts and preserves a value different from catalog base price without silently repricing/rejecting it.

Required evidence gate:
1. Unit/integration tests prove the local mapper sends immutable final order snapshot value, not browser input, `pancakeRetailPriceAfterDiscount`, or an unrelated live retail value.
2. A controlled Pancake acceptance check in an approved non-destructive/testable context verifies semantic behavior for discounted `retail_price` different from catalog base.
3. Do not introduce blind retry behavior; existing one-shot/idempotency safety rules remain authoritative.
4. If semantic acceptance cannot be verified, local promotion implementation may exist but must not be declared production-ready for real discounted Pancake order submission.

## Analytics and SEO
Customer-value surfaces use website effective/final customer price, not `pancakeRetailPriceAfterDiscount`:
- product structured-data Offer price;
- storefront/cart/checkout analytics monetary values;
- final purchase reporting from immutable order snapshot.

`/flash-sale` follows the existing repository search-indexing policy/ADR. This feature does not independently change indexing policy.

## Security and trust boundaries
Assets:
- admin authority to change customer pricing;
- campaign configuration and schedule;
- final order monetary integrity;
- Pancake credentials/integration integrity;
- customer order totals.

Trust boundaries:
1. Admin/browser form data is untrusted.
2. Mirrored/direct Pancake catalog responses are external data and must be validated before privileged pricing use.
3. Database campaign/order records are server-owned authority after validation.
4. Pancake create-order is an external side effect and remains inside the existing one-shot safety boundary.

Required controls:
- Promotion writes require existing admin authentication **and authorization**.
- Validate campaign name/type/value, timestamps, lifecycle transition, target IDs, and target array size server-side with explicit finite bounds.
- Product/variant IDs supplied by browser must resolve to expected website mirror records; never trust browser-supplied price/catalog facts.
- Effective/final price is always server-computed.
- Checkout client may submit an expected quote/version for stale detection, never an authoritative final price.
- Overlap enforcement is server-side and concurrency-safe.
- Pancake payload remains a strict server-owned allowlist built from immutable order snapshot plus freshly validated required external identity/stock facts.
- Do not log secrets, Pancake credentials, or unnecessary customer PII.

Abuse cases that tests/review must address:
- non-admin attempts promotion mutations;
- forged target IDs/discount values/timestamps;
- oversized target arrays or campaign names;
- two concurrent publishes racing into overlap;
- stale checkout attempting to submit old sale price;
- manipulated browser price/discount metadata;
- malformed or surprising Pancake price data influencing order totals.

## Performance and data-access requirements
Promotion resolution must not add one database query per product card or per variant.

Required properties:
- storefront/listing promotion lookup is bounded and batch-oriented;
- `/flash-sale` query is bounded/paginated consistent with existing listing patterns;
- target/campaign lookup has indexes appropriate for campaign identity, target identity, enabled/lifecycle filtering, and time-window access;
- product-target expansion does not create unbounded serial query chatter;
- admin target selection/search is bounded rather than loading an unbounded catalog into the browser.

Performance optimization beyond these anti-N+1/bounded-query requirements should be measurement-driven.

## Observability
Critical pricing/lifecycle failures need structured, non-PII diagnostics. Exact event plumbing may reuse existing project patterns.

At minimum make these situations observable:
- campaign publish/activation rejected, with reason code;
- campaign runtime target invalidated/recovered after catalog price/variant change;
- runtime overlap discovered/recovered;
- checkout `PRICE_CHANGED` before Pancake create-order;
- promotion-aware Pancake submission validation rejection.

Useful context includes campaign ID, target type/ID, variant ID when applicable, and typed reason code. Do not log customer address/phone or secrets merely to diagnose promotion behavior.

## Project structure / expected ownership
Exact filenames may be refined during `/plan`, but ownership should remain separated:
- Prisma schema/migration: website-owned campaign/target and order-audit persistence.
- Promotion domain/repository: campaign validation, lifecycle, targets, overlap, runtime health, active-campaign lookup.
- Central pricing resolver: base/effective-price calculation and typed failure facts.
- Admin: `/admin/promotions` UI + authenticated server actions.
- Storefront projection/card/PDP: presentation derived from central quote facts.
- Cart/checkout/order: reprice/`PRICE_CHANGED`/immutable snapshot integration.
- Pancake order mapper: consumes final local snapshot and validated external identity/stock facts.
- Tests: domain + database + integration + browser/a11y coverage in existing locations.

Do not duplicate pricing formulas in UI, cart, checkout, SEO, analytics, or Pancake mapping modules.

## Testing strategy
New behavior must have tests that would fail without the implementation.

Required domain/database/integration coverage:
- percentage integer/range/rounding edges, including result that would round to base/zero;
- fixed-price validity at variant and product scope;
- unusable base-price cases;
- `pancakeRetailPriceAfterDiscount` mismatch no longer blocks website pricing;
- active/scheduled/ended/disabled interval boundaries using `[start,end)`;
- Disabled-before-Active remains editable/re-enableable; Disabled-after-Active is terminal;
- Draft can save invalid configuration but cannot affect storefront; activation is blocked until valid;
- invalid Scheduled edit is rejected atomically without corrupting prior enabled definition;
- null regular-promotion boundaries;
- overlap product↔variant and concurrent publish attempts;
- copy lifecycle/history reset;
- new/restored variant under product target;
- active fixed-price invalidation and automatic recovery after base-price change;
- runtime overlap from catalog mutation fails closed and recovers after conflict removal;
- representative card pricing/ties/mixed Promotion + Flash Sale variants;
- card case where an unpromoted variant is cheaper than lowest promoted variant does not falsely label sale price as product-wide minimum;
- `/flash-sale` active-only membership;
- cart repricing;
- stale checkout returns `PRICE_CHANGED`, refreshed totals, does not enter `POS_SUBMITTING`, and performs no Pancake write;
- stale DRAFT/REJECTED attempt can be superseded by a buyer-confirmed refreshed quote without infinite price-change loop;
- confirmed checkout snapshots all required base/final/promotion audit facts;
- Pancake mapper uses final local order snapshot value;
- structured data / analytics values use effective/final customer price;
- admin authz, bounded input, and malformed external price handling;
- observability reason codes for critical rejection/invalidation paths;
- keyboard/mobile/Axe coverage for campaign form and storefront sale UI.

## Verification commands
Use the repository's actual gates. Implementation PRs must run the relevant subset locally and pass the full applicable CI matrix before merge.

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

## Migration and rollback requirements
Implementation requires an additive Prisma/PostgreSQL migration.

Migration rules:
- do not remove `pancakeRetailPriceAfterDiscount` in this feature;
- promotion campaign/target persistence is additive;
- new order promotion-audit fields are nullable for existing historical rows except where a new-row invariant can be safely enforced;
- existing `unitPriceVnd`/order history must remain valid;
- migration/deploy must support rolling application code back without requiring an emergency destructive down-migration.

Operational rollback plan:
1. stop new promotion activation / disable active campaigns through admin or an equivalent safe operational control;
2. stop new promotion-priced final submissions before rolling application code back;
3. DRAFT checkout attempts carrying promotion prices may be rejected/superseded and re-quoted under rolled-back behavior; they must never be submitted at a price the rolled-back code cannot validate;
4. confirmed/terminal order pricing and promotion-audit data are never rewritten or down-migrated;
5. leave additive tables/nullable columns in place until a separately reviewed cleanup migration, if ever needed.

## Boundaries
Always:
- Treat Pancake catalog price as base-price input and website campaign state as the only promotion authority.
- Compute prices centrally on the server.
- Revalidate overlap and price validity on every enabled campaign mutation.
- Reprice at checkout submission using latest trusted base facts.
- Preserve immutable final order pricing/audit facts.
- Keep admin mutations authenticated/authorized, bounded, and concurrency-safe.
- Fail closed on runtime promotion conflicts rather than stack or guess priority.

Ask first:
- New third-party dependencies.
- Any Pancake catalog write for promotional pricing.
- Any destructive migration or change to existing order-state meanings.
- Any change to current Pancake one-shot/idempotency safety policy.
- Any promotion stacking/coupon interaction beyond this spec.
- Any requirement to silently choose a winner when overlapping campaigns are discovered at runtime.

Never:
- Trust browser-provided final prices.
- Use `pancakeRetailPriceAfterDiscount` as website promotion authority.
- Apply two active promotions to one variant.
- Silently apply an invalid fixed price.
- Submit stale checkout pricing after `PRICE_CHANGED`.
- Blindly retry ambiguous Pancake order creation.
- Rewrite finalized historical order price/audit data.
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
1. `/admin/promotions` is admin-protected and supports create/edit/enable/disable/copy according to lifecycle rules.
2. Campaigns can target multiple products/variants with one shared rule; Product targets dynamically include later synced/restored variants.
3. Draft may save invalid configuration without storefront effect; enabling/re-enabling/Scheduled edits are atomically validated.
4. Disabled-before-Active campaigns may be edited/re-enabled; Disabled-after-Active and Ended campaigns are terminal and rerun only via Copy → Draft.
5. No two enabled campaign intervals can safely apply to the same variant; concurrent publish is race-safe and runtime catalog-created conflicts fail closed with no promotion on the conflicted variant.
6. Website effective pricing uses usable latest trusted Pancake base price + website campaign state; `pancakeRetailPriceAfterDiscount` mismatch no longer blocks pricing by itself.
7. Percentage and fixed-price calculations are integer-VND, centralized, deterministic, and validated; `%` recalculates on new base price and fixed price remains configured while valid.
8. Runtime-invalid targets stop receiving promotion safely, surface admin health warnings, and recover automatically when valid again during the same campaign interval.
9. Storefront cards/PDP/cart/checkout/structured data/analytics share the same pricing contract; mixed variant promotions render deterministically without misleading minimum-price wording.
10. `/flash-sale` contains only products with a valid active Flash Sale variant and displays active flash-sale price/badge/countdown correctly.
11. Checkout detects stale pricing from promotion/base-price changes, returns `PRICE_CHANGED` with refreshed totals, performs no Pancake create-order on that stale attempt, and requires explicit reconfirmation while remaining compatible with `OrderMirror(DRAFT)` architecture.
12. Finalized order lines preserve immutable base price, customer price, line total, campaign identity/name/kind/type/value snapshots.
13. Pancake order mapping sends immutable final customer unit price; fresh external price facts cannot silently bypass the central `PRICE_CHANGED` contract.
14. Controlled semantic evidence confirms Pancake accepts/preserves a discounted `variation_info.retail_price` override before production readiness is declared.
15. Admin/authz/security, database concurrency, bounded data access, observability, rollback, domain/integration tests, browser/Axe coverage, migrations, lint, typecheck, build, release checks, and repository CI gates pass before implementation merge.

## Implementation / PR sizing guidance
This spec is one product contract, but implementation may be split into dependency-safe PRs when that improves reviewability. Follow ADR 0005: file count is not the gate; atomicity, subsystem ownership, risk, effective changed lines, verification, and rollback/revert clarity are.

Do not split directly affected tests away from the behavior they prove merely to reduce file count. Do not combine unrelated refactors with promotion implementation.
