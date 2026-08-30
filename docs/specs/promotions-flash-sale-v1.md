# Spec — Promotions & Flash Sale v1

Status: approved product requirements consolidated into an implementation-ready specification. This feature is website-owned: Pancake remains the source of catalog, inventory, and base-price facts, while promotional pricing and campaign lifecycle are owned by LA Clothing.

## Objective
Add an admin-managed promotion system that can run regular promotions and flash sales across products or individual variants, render one authoritative effective price consistently across storefront → cart → checkout → order snapshot → Pancake submission, and preserve trustworthy immutable pricing/audit facts once an order is finalized.

The feature must not write promotional catalog prices back to Pancake.

## Current-system constraints
- Catalog and inventory are mirrored from Pancake through `ProductMirror` / `VariantMirror`.
- `VariantMirror.pancakeRetailPrice` is the website base-price input. `pancakeRetailPriceAfterDiscount` remains mirrored external data but is not authoritative for website promotion pricing.
- The current checkout architecture may create an `OrderMirror` in `DRAFT` as a checkout-attempt/snapshot implementation detail before Pancake submission. This spec does **not** require replacing that architecture.
- Current order submission fetches fresh Pancake catalog facts before create-order. Promotion implementation must integrate that freshness check into the same central effective-price contract rather than comparing a persisted website sale price directly to raw Pancake retail price.
- Pancake create-order structurally accepts an integer `variation_info.retail_price`. Existing project evidence proves the field shape exists; it does **not** prove Pancake will always honor an arbitrary website-owned discounted value without repricing. Production readiness therefore requires the controlled semantic verification gate below.

## Campaign model
A campaign has one shared rule across all of its targets:
- kind: `PROMOTION` or `FLASH_SALE`;
- name;
- discount type: `PERCENTAGE` or `FIXED_PRICE`;
- one discount value;
- one time configuration;
- one or more targets spanning products and/or individual variants.

Target semantics:
- `PRODUCT` means the product as a semantic scope, including variants synced/restored later while the target remains eligible.
- `VARIANT` means one specific variant.
- A campaign may target multiple products and multiple variants across products.
- A campaign must not contain duplicate targets.
- A campaign must not target product A and separately target a variant already covered by product A in the same campaign.
- All targets in one campaign share the same discount type/value/time configuration. Different discount amounts require separate campaigns.

### Explicit v1 input and transaction bounds
These are server-authoritative v1 limits, not UI hints:
- `MAX_CAMPAIGN_NAME_LENGTH = 120` JavaScript string code units after trimming; empty names are invalid.
- `MAX_TARGETS_PER_CAMPAIGN = 200` normalized explicit target rows after duplicate normalization/rejection.
- `MAX_PROMOTION_IDENTIFIER_LENGTH = 128` JavaScript string code units for browser-supplied campaign/product/variant identifiers before lookup.
- `MAX_ADMIN_PROMOTION_PAGE_SIZE = 50` campaigns returned by one admin list/search request.
- `ADMIN_TARGET_SEARCH_LIMIT = 50` product/variant target candidates returned by one admin search request.
- Public `/shop` and `/flash-sale` page size must reuse the existing storefront maximum of `48`; this feature does not introduce an unbounded listing path.
- `MAX_EXPANDED_VARIANTS_PER_CAMPAIGN = 2000` unique currently affected variants that an admin activation/re-enable/Scheduled-edit validation transaction may expand and validate.

Bounds semantics:
- syntactically oversized input such as a name/ID/explicit target array above its cap is rejected before persistence, including for Draft; Draft permissiveness applies to business invalidity, not abusive/unbounded payloads;
- Draft health may inspect PRODUCT expansion with a bounded `limit + 1` style query and report `TARGET_EXPANSION_LIMIT_EXCEEDED` without materializing all covered variants;
- publish/re-enable/Scheduled edit must fail atomically with typed `TARGET_EXPANSION_LIMIT_EXCEEDED` when current unique affected-variant expansion exceeds `2000`; perform the bounded expansion check before acquiring/holding a huge variant lock set;
- the `2000` cap protects admin validation/locking work and is **not** a semantic runtime cap on an already-Active PRODUCT target. If catalog sync later grows dynamic coverage beyond `2000`, valid variants remain governed by the normal runtime pricing/conflict rules; runtime storefront reads and health inspection must remain bounded/paginated rather than attempting one all-variant transaction;
- all named limits require `max` and `max + 1` server-side tests.

Persistence must be website-owned and use integer money for website-owned VND values. Conceptually:
- percentage value: integer;
- fixed sale price: `BigInt`/integer VND, never `Float`;
- target row: exactly one of product or variant is populated;
- order audit money: `BigInt`/integer VND.

The mirrored Pancake price columns remain external mirror fields and may remain `Float?`. This feature does **not** require converting `pancakeRetailPrice` or `pancakeRetailPriceAfterDiscount` to `BigInt`; integer-VND validation/conversion happens at the trusted website pricing boundary.

Exact Prisma names may be refined in `/plan`, but database/server invariants must enforce valid target shape and campaign relationships rather than relying on UI-only checks.

## Campaign lifecycle
Persistence/status logic must distinguish reliably:
- explicit Draft versus explicitly Disabled-before-activation;
- never Active versus Active at least once;
- terminally Disabled/Ended after activation.

This distinction must remain correct after process restarts and even when a scheduled campaign opens and closes with **zero** storefront/admin traffic.

The implementation must not define “has ever been Active” by a lazy write that happens only when a request happens to observe an Active campaign. A campaign that was enabled and whose effective interval actually crossed an active period counts as having been Active even if no request was served during that interval.

An implementation may satisfy this with deterministic time/lifecycle derivation, durable lifecycle transitions, or equivalent persisted facts. Any stored activation timestamp must be trustworthy history, not a traffic-dependent observation cache that can miss a zero-traffic active window.

Admin-visible statuses:
- `Draft`: explicit work-in-progress that has not been enabled/published.
- `Scheduled`: enabled and valid, with effective start in the future.
- `Active`: enabled, valid, and current server time is inside the active interval.
- `Ended`: campaign was enabled through an effective active window and that configured window has ended.
- `Disabled`: explicitly disabled by admin, whether before or after it ever became Active.

Lifecycle rules:
- Draft campaigns are fully editable and may be saved while incomplete/invalid; health/validation errors must be shown.
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
- Does not inherit runtime status, lifecycle history, related orders, activation history, or source campaign identity.
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

A value entering authoritative website VND pricing must satisfy:

```ts
function isUsableBasePriceVnd(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value > 0;
}
```

Therefore null, `NaN`, infinity, fractional, non-positive, or unsafe-integer values are unusable for authoritative website pricing.

This is an explicit v1 website-pricing rule, not merely a promotion-only check. A variant with unusable `pancakeRetailPrice` is `BASE_PRICE_UNAVAILABLE` and must not complete a website purchase until a usable integer-VND base price is available. Storefront/listing projections that currently use a looser predicate must be reconciled so they do not advertise a variant as purchasable when checkout cannot represent the same money safely.

### Pre-rollout price-data audit
Before enabling promotion behavior in production, run a read-only data audit over current mirrored variants and report counts/examples for:
- `pancakeRetailPrice IS NULL`;
- zero;
- negative;
- non-finite if such values can reach application memory;
- non-integer;
- values outside JavaScript safe-integer range.

The rollout must explicitly account for any currently visible variant that would become unavailable under the authoritative integer-VND rule; do not discover this only from customer-facing storefront regressions.

### Pancake `retailPriceAfterDiscount` clarification
`pancakeRetailPriceAfterDiscount` must not:
- determine storefront effective price;
- cause `PRICE_UNRESOLVED` merely because it differs from `pancakeRetailPrice`;
- override a website promotion;
- become final order price authority.

This is intentional even when Pancake itself currently reports `pancakeRetailPriceAfterDiscount < pancakeRetailPrice`. With no active website promotion, website price remains `pancakeRetailPrice`, so the website may intentionally display/charge a higher price than Pancake's own discounted catalog value. That is a known consequence of making website promotions independent from Pancake discounts, not an accidental refactor side effect.

Because Pancake may have its own downstream repricing semantics, the controlled custom-price acceptance gate in this spec is mandatory before declaring real discounted order submission production-ready.

### Latest Pancake base-price rule
The business rule is always to resolve against the **latest trusted Pancake base price available to the website**.

Normal storefront/cart reads use the latest successfully mirrored `VariantMirror.pancakeRetailPrice`.

If checkout submission obtains a fresher trusted Pancake catalog value than the current mirror, that fresher base price enters the **same central effective-price resolver** for that checkout attempt. It must not be used only inside the Pancake mapper as a second independent pricing authority.

Consequences:
- `%` promotion recalculates against the fresher base price;
- `FIXED_PRICE` keeps its configured sale price and is revalidated against the fresher base price;
- if the resulting quote differs from what the buyer last confirmed, return `PRICE_CHANGED` before create-order;
- the refreshed quote must be capable of becoming the next DRAFT/final pricing snapshot, so a stale mirror cannot cause an infinite `PRICE_CHANGED` loop. Exact orchestration belongs in `/plan`.

### Central effective-price authority
There is one semantic pricing authority used by storefront, cart, checkout, order snapshotting, structured data, analytics, and final Pancake line-price mapping.

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

The preferred implementation is one reusable TypeScript/domain resolver operating on batch-fetched facts. However, the anti-N+1 requirement is also binding. If `/plan` demonstrates that a SQL-side price/promotion projection is necessary for bounded listing queries, one explicitly sanctioned SQL projection may mirror the central semantics. It must not become an independent business authority and must have parity tests against the central resolver for price usability, discount rounding, time boundaries, invalidation, and representative-price cases.

Do not independently reimplement pricing formulas in UI, cart, checkout, SEO, analytics, or Pancake mapping modules.

### Percentage
- Integer percentage only.
- Allowed range: `1..99`.
- Percentage pricing is defined by **exact positive-integer rational arithmetic**, not by JavaScript floating-point evaluation of the formula. For usable integer `baseVnd` and integer `percent`, compute:

```ts
const numerator = BigInt(baseVnd) * BigInt(100 - percent);
const effectiveBigInt = (numerator + 50n) / 100n; // nearest VND; exact .5 rounds upward
const effectivePriceVnd = Number(effectiveBigInt);
```

- The conversion back to `number` is permitted only after verifying the result remains a positive safe integer. Because `percent` is `1..99` and usable base is a positive safe integer, a valid discounted result is below the safe-integer base, but implementation must still assert the boundary rather than rely on implicit coercion.
- `Math.round(baseVnd * (100 - percent) / 100)` may be used as an explanatory shorthand for ordinary-sized VND values, but it is **not** the normative implementation/reference across the full accepted `Number.isSafeInteger` domain.
- SQL or any sanctioned projection must implement the same exact rational result; PostgreSQL `numeric` arithmetic is required before percentage multiplication/division.
- Result must satisfy `0 < effectivePriceVnd < basePriceVnd`.

Required parity examples include ordinary exact-half cases and an upper-safe-integer case:
- `150 @ 1% → 149`;
- `350 @ 1% → 347`;
- `110 @ 5% → 105`;
- `9007199254740989 @ 1% → 8917127262193579`.

Example: base changes from `500000` to `600000` while a `20%` campaign remains active → new effective price is `480000`.

A percentage can become invalid for a specific low-priced variant after rounding, e.g. `base=50`, `1%` → rounded effective price `50`, which is not a discount. Runtime scope is defined in **Runtime target invalidation** below.

### Fixed price
`FIXED_PRICE` means the final customer price, not an amount-off.

Validation for every affected variant:
- integer VND;
- `0 < fixedSalePriceVnd < basePriceVnd`.

A product-level fixed-price target configures the same final fixed price for every covered variant that remains valid at runtime.

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
- reject current target expansion above `MAX_EXPANDED_VARIANTS_PER_CAMPAIGN` with typed `TARGET_EXPANSION_LIMIT_EXCEEDED`;
- operation is atomic: no partially enabled campaign.

Scheduled save:
- rerun the same validation because Scheduled is already enabled;
- reject the edit atomically if the resulting campaign would be invalid, overlapping, or exceed the admin expansion cap.

Active runtime degradation caused **after** successful activation is handled by runtime rules below; it does not retroactively make original activation invalid.

## Overlap and concurrency contract
Enabled/published campaigns must not overlap for the same affected variant, including future Scheduled intervals.

Conflict examples:
- product-level campaign on product A conflicts with any overlapping variant-level campaign on any variant under A;
- variant-level campaign conflicts with an overlapping product-level campaign covering its product;
- two product targets covering the same product conflict;
- two variant targets for the same variant conflict.

Disabled campaigns do not reserve an interval.

Validation must be server-side and concurrency-safe. UI-only prechecks are insufficient. Two concurrent admin writes must not both publish overlapping effective coverage.

Exact PostgreSQL locking/constraint strategy is an implementation-plan decision, but the persisted result must satisfy the invariant atomically.

## Catalog changes while campaign is Scheduled/Active
Product targets are semantic product scopes, not frozen variant lists.

When Pancake sync introduces/restores/re-associates a variant under a targeted product:
- the variant becomes covered by that product target automatically;
- pricing validity and overlap are evaluated dynamically;
- no website promotion target is written back to Pancake.

### Runtime target invalidation
Runtime invalidation semantics are the same for `PERCENTAGE` and `FIXED_PRICE`.

If a newer base price or newly covered variant makes the configured discount invalid for a specific affected variant:
- never apply the invalid promotion to that variant;
- an explicit `VARIANT` target loses promotion for that variant only;
- a `PRODUCT` target is evaluated as dynamic variant coverage: only the invalid covered variant loses promotion; other covered variants that still satisfy the same campaign rule continue receiving it;
- the product target/campaign health is reported as partially invalid when only some covered variants fail;
- unrelated targets in the same campaign continue when healthy;
- admin sees the affected product/variant and typed reason.

This affected-variant runtime fallback is an explicit product decision that **supersedes the earlier draft wholesale-invalid PRODUCT behavior**. The distinction is deliberate: at publish/activation time a PRODUCT-level `FIXED_PRICE` still validates every current covered variant and activation is blocked if any current variant violates `0 < fixed < base`; only **after successful activation**, if later Pancake drift or a newly synced/restored covered variant makes one variant invalid, that variant falls back to usable base price while valid sibling variants keep the same configured fixed price and the target becomes `PARTIALLY_INVALID`.

For percentage campaigns, the same variant-level fallback applies when rounding yields no real discount (`effectivePriceVnd >= basePriceVnd`) or another percentage invariant fails for only some covered variants.

If an invalid variant later becomes valid again while the campaign remains inside its enabled effective interval and no overlap exists, promotion reapplies automatically and the health warning clears. Runtime invalidation is not a permanent disable.

If base price itself becomes unusable, the affected variant becomes `BASE_PRICE_UNAVAILABLE` and is not purchasable. This is distinct from a usable base price that merely invalidates a promotion.

If post-activation catalog growth makes a PRODUCT campaign cover more than `MAX_EXPANDED_VARIANTS_PER_CAMPAIGN`, that fact alone does not invalidate otherwise valid active pricing. The cap limits admin validation/locking transactions; runtime resolution remains dynamic and bounded per storefront/admin-health query.

### Runtime overlap discovered from catalog mutation
A new/restored/re-associated variant can expose a conflict that did not exist when campaigns were originally published.

The system must fail closed:
- never stack or silently prioritize campaigns;
- on the conflicted variant, apply **no website promotion** until the conflict disappears or admin resolves it;
- healthy, non-conflicted variants/targets continue according to their own rules;
- surface an admin health warning identifying all conflicting campaign IDs/targets;
- when the conflict disappears and the remaining campaign is otherwise valid/active, pricing recovers automatically.

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
- show whether an Active/Scheduled campaign is healthy, partially invalid, or conflicted;
- show target-specific validation errors for overlap, unusable base price, invalid fixed price, invalid percentage, invalid scheduling, and expansion-limit rejection.

Product admin pages do not become the primary editor. They show current/upcoming related campaigns and link to the relevant campaign in `/admin/promotions`.

All admin mutations reuse the existing authenticated/authorized admin boundary and validate browser input server-side. Campaign list/search and target search are paginated/bounded by the named v1 limits above.

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
2. Select the promoted variant with lowest `effectivePriceVnd` as representative sale variant.
3. If tied, use stable repository variant ordering; if none exists, use deterministic ID tie-breaker.
4. Strike through the **base price of the same representative variant**.
5. Badge/kind/countdown come from that representative variant's campaign.
6. If that sale price is also the product's minimum current effective price, display the approved form `Từ <sale price>`.
7. If an unpromoted/currently non-sale variant is cheaper, do not falsely imply sale price is product-wide minimum. Use explicit sale wording such as `Sale từ <sale price>` while preserving normal price/range cue as layout allows.
8. If no variant is actively promoted, fall back to existing normal product-card price behavior using base prices.

On `/flash-sale`, apply the representative rule only among currently purchasable variants with a valid active `FLASH_SALE` campaign; use `FLASH SALE` presentation/countdown from that representative flash-sale variant.

PDP always resolves the exact selected variant. When variant selection changes, base price, effective price, strike-through, badge, and countdown update for selected variant. A selected variant with no valid promotion shows base price and no sale/flash-sale badge/countdown.

### Cache/revalidation correctness
Countdown expiry is not pricing authority.

Transactional correctness is strict:
- add-to-cart/cart reconstruction/checkout must re-resolve server-authoritative price and campaign state;
- a stale cached storefront page must never authorize a stale transaction price.

Storefront presentation has a maximum promotional display staleness of **60 seconds while the page is visible**. The implementation may refresh earlier at a known boundary, but it must never rely solely on transition facts from the currently hydrated page slice.

For `/shop` and `/flash-sale`:
- the server must compute the **query-wide earliest relevant future campaign transition** before pagination, using the full route candidate universe relevant to that request rather than only currently hydrated/on-page rows or currently active members;
- `/shop` transition discovery must account for an off-page product/variant whose campaign start/end can change effective-price filtering/sorting and therefore current page membership/order;
- `/flash-sale` transition discovery must include upcoming enabled Flash Sale campaigns even when current active membership is empty, so an empty page can refresh when the first sale begins;
- transition discovery itself must be aggregate/bounded (for example an indexed `MIN` over eligible transition facts), not an unbounded application-side materialization.

The server derives a relative refresh delay from authoritative server time:
- `refreshAfterMs = min(max(nextTransitionAt - requestNow, 0), 60_000)` when a future transition exists;
- `refreshAfterMs = 60_000` when no relevant future transition is currently known;
- the Client Component schedules from `refreshAfterMs`, not by subtracting an absolute timestamp from `Date.now()`, so browser wall-clock skew cannot postpone refresh;
- after each `router.refresh()`, the new Server Component payload supplies a new delay;
- on `visibilitychange` back to visible and on `pageshow`, if the server-provided delay elapsed while the page was hidden/suspended, trigger an immediate `router.refresh()` rather than waiting for a throttled timer.

PDP may use the selected/current product's relevant transition facts because pagination membership is not involved, but it still uses server-derived relative delay with the same `<=60s` visible-page fallback and resume guard.

Whichever concrete implementation realizes this contract must have runtime/browser coverage around start/end boundaries, off-page membership changes, empty Flash Sale activation, browser clock skew, and background-tab/page-resume behavior. A briefly stale badge/price may be tolerated only within the declared display bound; transaction price remains server-authoritative with no such grace period.

## Cart, checkout, and final order pricing
The cart does not lock promotional price. Cart and checkout display current server-resolved effective price.

### Price-change confirmation contract
On submit, server recomputes authoritative effective quote from latest trusted base-price facts + current valid website campaign state.

If recomputed quote differs from what buyer last confirmed:
- return typed `PRICE_CHANGED` with refreshed line prices and totals;
- do not transition that stale attempt to `POS_SUBMITTING`;
- do not call Pancake create-order;
- require buyer to explicitly review and submit/confirm refreshed totals again.

Compatibility with current state machine:
- an `OrderMirror(DRAFT)` may already exist before this check;
- stale attempt may remain DRAFT, be refreshed, or be marked `REJECTED`/superseded according to existing checkout orchestration, provided it is never submitted to Pancake at stale price;
- a terminal stale attempt must not block creation of fresh DRAFT carrying refreshed quote after buyer confirms again;
- no implementation may loop forever between stale mirror snapshot and fresher Pancake price.

When buyer submits a quote that still matches server recomputation:
- freeze order-line pricing facts used for final submission no later than transition out of DRAFT into final validation/submission;
- subsequent campaign/base-price changes do not rewrite finalized snapshot;
- final purchase reporting and Pancake line mapping consume immutable snapshot.

## Order-line audit snapshot
Each finalized order line must retain enough immutable data to explain historical customer pricing without consulting current campaign record.

Required facts:
- `baseUnitPriceVnd` — base price used by effective-price resolver at confirmation time;
- existing/final `unitPriceVnd` — customer unit price;
- `lineTotalVnd`;
- nullable `promotionId`;
- nullable `promotionName` snapshot;
- nullable `promotionKind` snapshot (`PROMOTION` / `FLASH_SALE`);
- nullable `promotionDiscountType` snapshot (`PERCENTAGE` / `FIXED_PRICE`);
- nullable percentage value when percentage applied;
- nullable fixed-sale-price VND value when fixed price applied.

Promotion fields are null for lines without website promotion.

Campaign copy, disable, edit of never-active campaign, upstream catalog changes, or later Pancake price changes must not alter finalized order history.

## Pancake order submission contract
Website catalog promotion state is never written back to Pancake.

For a finalized order, application intends to send immutable final `unitPriceVnd`/effective price as line `variation_info.retail_price`, so Pancake receives same customer unit price recorded locally.

Fresh Pancake validation before create-order may still verify required shop/variation identity and stock. Any fresh base-price fact affecting customer price must first pass through central effective-price/`PRICE_CHANGED` contract.

### Required changes to the current submission behavior
Implementation must explicitly audit `createPancakeOrderSubmissionService` and close all three current live-price assumptions below. These are behavioral invariants; do not rely on today's source line numbers remaining stable.

1. **Price-change comparison**
   - Current behavior compares persisted `line.unitPriceVnd` to a raw/live Pancake-resolved price.
   - Required behavior compares the buyer-confirmed/final snapshot against the newly computed **effective website quote** using fresh trusted base facts + website promotion state.
   - A promoted order must not reject forever merely because discounted snapshot price differs from raw Pancake base retail.

2. **Subtotal/shipping/total validation**
   - Current submission path recomputes monetary totals from the live catalog price before comparing them to persisted order totals.
   - Required behavior validates totals from the authoritative effective/final line prices. Live base retail must not be substituted into promoted line totals.
   - Shipping calculations that depend on merchandise subtotal must use the same authoritative effective-price subtotal used by the order snapshot.

3. **Pancake request line price**
   - Current request-line construction derives `unitPriceVnd` from the live catalog price.
   - Required behavior passes immutable finalized order-line `unitPriceVnd` into `buildPancakeCreateOrderRequest`, which maps it to `variation_info.retail_price`.
   - The Pancake mapper must never silently replace final website sale price with live catalog retail price.

Required integration tests must independently fail if any one of those three behaviors remains on raw `livePrice`.

### Pancake semantic acceptance gate
The checked structural OpenAPI evidence only establishes existence/type of `variation_info.retail_price`. Before feature is production-ready, verification must establish Pancake create-order accepts and preserves a value different from catalog base price without silently repricing/rejecting it.

Required evidence gate:
1. Unit/integration tests prove local mapper sends immutable final order snapshot value, not browser input, `pancakeRetailPriceAfterDiscount`, or unrelated live retail.
2. A controlled Pancake acceptance check in an approved non-destructive/testable context verifies semantic behavior for discounted `retail_price` different from catalog base.
3. Do not introduce blind retry behavior; existing one-shot/idempotency safety rules remain authoritative.
4. If semantic acceptance cannot be verified, local promotion implementation may exist but must not be declared production-ready for real discounted Pancake order submission.

## Analytics and SEO
Customer-value surfaces use website effective/final customer price, not `pancakeRetailPriceAfterDiscount`:
- product structured-data Offer price;
- storefront/cart/checkout analytics monetary values;
- final purchase reporting from immutable order snapshot.

`/flash-sale` follows existing repository search-indexing policy/ADR. This feature does not independently change indexing policy.

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
4. Pancake create-order is an external side effect inside existing one-shot safety boundary.

Required controls:
- Promotion writes require existing admin authentication **and authorization**.
- Validate campaign name/type/value, timestamps, lifecycle transition, target IDs, and target array size server-side against the explicit named v1 bounds above; do not let UI pagination be the only bound.
- Product/variant IDs supplied by browser must resolve to expected website mirror records; never trust browser-supplied price/catalog facts.
- Effective/final price is always server-computed.
- Checkout client may submit expected quote/version for stale detection, never authoritative final price.
- Overlap enforcement is server-side and concurrency-safe.
- Admin PRODUCT expansion validation is capped before large lock acquisition, while runtime dynamic coverage remains bounded per query.
- Pancake payload is a strict server-owned allowlist built from immutable order snapshot plus freshly validated required external identity/stock facts.
- Do not log secrets, Pancake credentials, or unnecessary customer PII.

Abuse cases that tests/review must address:
- non-admin attempts promotion mutations;
- forged target IDs/discount values/timestamps;
- oversized target arrays or campaign names;
- explicit-bound `max` and `max + 1` cases;
- target expansion at `2000` and `2001` current affected variants;
- concurrent publishes racing into overlap;
- stale checkout attempting old sale price;
- manipulated browser price/discount metadata;
- malformed/surprising Pancake price data influencing order totals.

## Performance and data-access requirements
Promotion resolution must not add one database query per product card or per variant.

Required properties:
- storefront/listing promotion lookup is bounded and batch-oriented;
- `/shop` and `/flash-sale` reuse the existing storefront max page size of `48` and remain paginated;
- admin campaign list/search returns at most `50` campaigns per request and target search at most `50` candidates per request;
- target/campaign lookup has indexes appropriate for campaign identity, target identity, enabled/lifecycle filtering, and time-window access;
- product-target expansion does not create unbounded serial query chatter or unbounded admin lock sets;
- activation/re-enable/Scheduled-edit expansion detection uses a bounded `MAX_EXPANDED_VARIANTS_PER_CAMPAIGN + 1` read and rejects above the cap before attempting a huge lock set;
- runtime PRODUCT coverage may grow beyond the admin expansion cap after activation but storefront/admin-health access remains bounded/paginated;
- query-wide storefront transition discovery uses bounded aggregate queries, not application-side loading of every potentially affected row;
- admin target selection/search is bounded rather than loading an unbounded catalog into browser.

If a SQL price/promotion projection is introduced to satisfy bounded listing access, it is a sanctioned projection of central pricing semantics and must have parity tests; it is not a second authority.

Performance optimization beyond these anti-N+1/bounded-query requirements should be measurement-driven.

## Observability
Critical pricing/lifecycle failures need structured, non-PII diagnostics. Exact event plumbing may reuse existing project patterns.

At minimum make observable:
- campaign publish/activation rejected, with reason code;
- campaign runtime variant invalidated/recovered after catalog price/variant change;
- campaign/product target becomes `PARTIALLY_INVALID` / recovers;
- runtime overlap discovered/recovered;
- checkout `PRICE_CHANGED` before Pancake create-order;
- promotion-aware Pancake submission validation rejection.

Useful context includes campaign ID, target type/ID, variant ID when applicable, and typed reason code. Do not log customer address/phone or secrets merely to diagnose promotion behavior.

## Project structure / expected ownership
Exact filenames may be refined during `/plan`, but ownership remains separated:
- Prisma schema/migration: website-owned campaign/target and order-audit persistence.
- Promotion domain/repository: campaign validation, lifecycle, targets, overlap, runtime health, active-campaign lookup.
- Central pricing resolver: base/effective-price calculation and typed failure facts.
- Admin: `/admin/promotions` UI + authenticated server actions.
- Storefront projection/card/PDP: presentation derived from central quote facts.
- Cart/checkout/order: reprice/`PRICE_CHANGED`/immutable snapshot integration.
- Pancake order mapper: consumes final local snapshot and validated external identity/stock facts.
- Tests: domain + database + integration + browser/a11y coverage in existing locations.

## Testing strategy
New behavior must have tests that would fail without implementation.

Required domain/database/integration coverage:
- percentage integer/range/rounding edges, including result that rounds to base/zero;
- exact integer percentage arithmetic across the full accepted safe-integer domain, including `9007199254740989 @ 1% → 8917127262193579` in the TypeScript resolver;
- SQL↔TS percentage parity includes the same upper-safe-integer fixture as well as exact-half fixtures;
- percentage runtime invalidation/recovery for one variant inside a product target while sibling variants remain promoted;
- fixed-price validity at variant and product scope;
- fixed-price runtime invalidation/recovery for one variant inside a product target while sibling variants remain promoted;
- unusable global base-price cases;
- pre-rollout audit query/script or equivalent read-only diagnostic coverage;
- `pancakeRetailPriceAfterDiscount` mismatch no longer blocks website pricing and does not become website price authority;
- explicit case where Pancake after-discount is lower than website base price;
- active/scheduled/ended/disabled interval boundaries using `[start,end)`;
- zero-traffic scheduled window still becomes terminal `Ended` when appropriate;
- Disabled-before-Active remains editable/re-enableable; Disabled-after-Active is terminal;
- Draft can save business-invalid configuration but oversized syntactic input remains rejected;
- every named finite bound has `max` and `max + 1` coverage, including explicit targets and affected-variant expansion;
- invalid Scheduled edit rejected atomically without corrupting prior enabled definition;
- null regular-promotion boundaries;
- overlap product↔variant and concurrent publish attempts;
- copy lifecycle/history reset;
- new/restored variant under product target;
- runtime overlap from catalog mutation fails closed and recovers;
- representative card pricing/ties/mixed Promotion + Flash Sale variants;
- unpromoted cheaper variant does not cause misleading product-wide `Từ` sale wording;
- `/flash-sale` active-only membership;
- route-wide transition aggregate sees an off-page campaign that changes `/shop` effective-price order/filter membership;
- empty `/flash-sale` before the first Scheduled sale refreshes when that sale starts;
- boundary refresher is unaffected by browser `Date.now()` skew because it consumes server-derived relative delay;
- background-tab/page resume triggers immediate revalidation when the server-provided refresh delay elapsed while suspended;
- visible storefront promotion presentation never remains stale for more than 60 seconds under the chosen refresher;
- cart repricing;
- stale checkout returns `PRICE_CHANGED`, refreshed totals, does not enter `POS_SUBMITTING`, and performs no Pancake write;
- stale DRAFT/REJECTED attempt can be superseded by buyer-confirmed refreshed quote without infinite loop;
- confirmed checkout snapshots all required base/final/promotion audit facts;
- Pancake submission price-change comparison uses effective quote, not raw base price;
- Pancake submission subtotal/shipping/total validation uses effective/final line values;
- Pancake request mapper uses final local order snapshot `unitPriceVnd`;
- if SQL price projection exists, parity tests cover central resolver edge cases;
- structured data / analytics values use effective/final customer price;
- admin authz, bounded input, malformed external price handling;
- observability reason codes for critical rejection/invalidation paths;
- keyboard/mobile/Axe coverage for campaign form and storefront sale UI.

## Verification commands
Use repository's actual gates. Implementation PRs must run relevant subset locally and pass full applicable CI matrix before merge.

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

Browser/a11y gate follows existing isolated runtime workspace:
- `cd tests/a11y-runtime && npm ci --ignore-scripts --no-audit --no-fund`
- `cd tests/a11y-runtime && npx playwright install chromium`
- `cd tests/a11y-runtime && npx playwright test --config playwright.config.ts`

Controlled Pancake custom-sale-price semantic acceptance check is a production-readiness gate but must not become an uncontrolled recurring write from CI.

## Migration and rollback requirements
Implementation requires additive Prisma/PostgreSQL migration.

Migration rules:
- keep mirrored `pancakeRetailPrice` / `pancakeRetailPriceAfterDiscount` field types unchanged unless separately approved; this feature validates them at resolver boundary rather than destructively changing mirror storage;
- do not remove `pancakeRetailPriceAfterDiscount` in this feature;
- promotion campaign/target persistence is additive;
- new order promotion-audit fields are nullable for existing historical rows except where a new-row invariant can safely be enforced;
- existing `unitPriceVnd`/order history remains valid;
- migration/deploy supports rolling application code back without emergency destructive down-migration.

Operational rollback plan:
1. stop new promotion activation / disable active campaigns through admin or equivalent safe operational control;
2. stop new promotion-priced final submissions before rolling application code back;
3. DRAFT checkout attempts carrying promotion prices may be rejected/superseded and re-quoted under rolled-back behavior; never submit a price rolled-back code cannot validate;
4. confirmed/terminal order pricing and promotion-audit data are never rewritten/down-migrated;
5. leave additive tables/nullable columns until separately reviewed cleanup migration, if ever needed.

## Boundaries
Always:
- Treat `pancakeRetailPrice` as base-price input and website campaign state as only website promotion authority.
- Compute authoritative prices centrally on server using exact integer percentage arithmetic.
- Revalidate overlap and price validity on every enabled campaign mutation.
- Enforce named server-side finite bounds before persistence/large admin locking.
- Reprice checkout submission using latest trusted base facts.
- Preserve immutable final order pricing/audit facts.
- Keep admin mutations authenticated/authorized, bounded, concurrency-safe.
- Fail closed on runtime promotion conflicts rather than stack/guess priority.
- Apply runtime pricing invalidation at affected-variant granularity, including variants covered by `PRODUCT` targets.

Ask first:
- New third-party dependencies.
- Any Pancake catalog write for promotional pricing.
- Any destructive migration or change to existing order-state meanings.
- Any change to current Pancake one-shot/idempotency safety policy.
- Any promotion stacking/coupon interaction beyond this spec.
- Any requirement to silently choose a winner when overlapping campaigns are discovered at runtime.
- Any proposal to make Pancake `pancakeRetailPriceAfterDiscount` website pricing authority again.

Never:
- Trust browser-provided final prices.
- Use JavaScript floating-point multiplication/division as the normative percentage-money calculation across the full accepted safe-integer domain.
- Use `pancakeRetailPriceAfterDiscount` as website promotion authority.
- Apply two active promotions to one variant.
- Silently apply invalid percentage/fixed price.
- Submit stale checkout pricing after `PRICE_CHANGED`.
- Recompute promoted order totals from raw Pancake base retail during final submission.
- Build Pancake request line price from raw live retail instead of final order snapshot.
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
2. Campaigns target multiple products/variants with one shared rule; Product targets dynamically include later synced/restored variants.
3. Draft may save business-invalid configuration without storefront effect; syntactically oversized/unbounded input is rejected; enabling/re-enabling/Scheduled edits are atomically validated within named finite transaction bounds.
4. Lifecycle terminality does not depend on request traffic: zero-traffic active windows still produce correct Active-history/Ended semantics; Disabled-before-Active remains re-enableable while Disabled-after-Active/Ended are terminal.
5. No two enabled campaign intervals safely apply to same variant; concurrent publish is race-safe and runtime catalog-created conflicts fail closed with no promotion on conflicted variant.
6. Website effective pricing uses usable latest trusted `pancakeRetailPrice` + website campaign state; `pancakeRetailPriceAfterDiscount` mismatch no longer blocks pricing and may intentionally be lower than website price without becoming authority.
7. Authoritative website base/effective money is positive safe-integer VND; rollout includes audit of mirrored values incompatible with that rule while mirror columns themselves remain external `Float?` facts.
8. Percentage pricing uses exact integer/rational arithmetic across the full accepted safe-integer domain; SQL and TS agree on ordinary, exact-half, and upper-safe-integer fixtures. Fixed-price pricing is integer-VND and both discount types use the same affected-variant runtime invalidation/recovery semantics.
9. Storefront cards/PDP/cart/checkout/structured data/analytics share same semantic pricing authority; any SQL projection is parity-tested and mixed variant promotions render deterministically without misleading minimum-price wording.
10. `/flash-sale` contains only products with valid active Flash Sale variant and displays active flash-sale price/badge/countdown correctly.
11. Storefront promotion presentation uses query-wide transition awareness plus server-derived relative refresh with a visible-page maximum staleness of 60 seconds, including off-page membership changes, empty Flash Sale activation, clock skew, and resume handling; transactional price is always freshly server-authoritative.
12. Checkout detects stale pricing from promotion/base-price changes, returns `PRICE_CHANGED` with refreshed totals, performs no Pancake create-order on stale attempt, and requires explicit reconfirmation while remaining compatible with `OrderMirror(DRAFT)` architecture.
13. Finalized order lines preserve immutable base price, customer price, line total, campaign identity/name/kind/type/value snapshots.
14. Pancake submission closes all three raw-live-price assumptions: effective quote comparison, effective/final total validation, and request mapping from immutable final `unitPriceVnd`.
15. Controlled semantic evidence confirms Pancake accepts/preserves discounted `variation_info.retail_price` override before production readiness is declared.
16. Admin/authz/security, explicit finite bounds, database concurrency, bounded data access, observability, rollback, domain/integration tests, browser/Axe coverage, migrations, lint, typecheck, build, release checks, and repository CI gates pass before implementation merge.

## Implementation / PR sizing guidance
This spec is one product contract, but implementation may be split into dependency-safe PRs when that improves reviewability. Follow ADR 0005: file count is not the gate; atomicity, subsystem ownership, risk, effective changed lines, verification, and rollback/revert clarity are.

Do not split directly affected tests away from behavior they prove merely to reduce file count. Do not combine unrelated refactors with promotion implementation.
