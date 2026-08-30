# Spec: Marketing Analytics, Ads Tracking & Google Shopping

Status: Draft for human review

## Objective

Implement a production-only marketing measurement and catalog export architecture for LA Clothing that supports Google Analytics 4 (GA4), Google Ads, Google Tag Manager (GTM), TikTok Pixel, the existing Meta Pixel + Conversions API integration, and an automated Google Merchant Center feed.

The implementation must preserve the storefront as the source of truth for commerce behavior. Tracking systems may consume canonical commerce events, but must never infer core business outcomes such as a successful purchase from DOM clicks or page structure.

### Target outcomes

1. GA4, Google Ads, and TikTok Pixel are deployed through GTM.
2. Existing Meta Pixel + Meta Conversions API remain direct integrations and are not migrated into GTM in this scope.
3. All marketing destinations consume the same canonical commerce event contract and stable product/order identifiers.
4. A consent-capable policy layer exists from day one, but no consent UI is shown initially; production tracking is allowed immediately under the current product-owner policy.
5. Only production sends real analytics/advertising traffic.
6. Google Merchant Center receives an automatically generated scheduled-fetch feed from LA Clothing catalog data.
7. Each sellable variant is a separate Merchant Center item, grouped by its parent product.
8. Purchase conversion is emitted only for a real `OrderMirror.state === CONFIRMED` order.

## Current Repository Context

### Stack

- Next.js 16.2.11
- React 19.2.0
- TypeScript 5.9.x
- Prisma 7.9.1
- PostgreSQL
- pnpm 11.4.0

### Existing analytics/integration behavior

The repository already has a direct Meta implementation with:

- browser Facebook/Meta Pixel;
- App Router page-view handling;
- failure-safe browser event dispatch;
- server-side Meta Conversions API;
- browser/server deduplication via order/event ID;
- one-time browser Purchase reporting for confirmed orders.

This behavior is a compatibility constraint. The new work must not replace or duplicate it.

### Existing catalog/order data

Relevant canonical fields already exist in the mirror database:

- `ProductMirror`: parent product identity, slug, name, image, presence/active state;
- `ProductContent`: publish state and editorial/SEO content;
- `VariantMirror`: Pancake variation ID, SKU, barcode, color, size, price, active/present flags, hidden/locked source flags;
- `WarehouseStock`: variant-level inventory;
- `OrderMirror`: public order code, order state, merchandise/shipping/total values;
- `OrderLineSnapshot`: immutable purchased variant snapshot.

## Architecture

### Browser/server measurement topology

```text
LA Clothing commerce/business events
                |
                +----> Existing Meta Pixel (direct browser integration)
                |
                +----> Existing Meta CAPI (direct server integration)
                |
                +----> Canonical dataLayer event
                           |
                           v
                          GTM
                    +------+------+------+
                    |      |      |      |
                   GA4  Google  TikTok  future
                        Ads     Pixel   browser tags

Future phase only:
Server-side confirmed events ---> TikTok Events API
```

### Google Shopping topology

```text
Pancake source
    |
    v
LA Clothing mirror database
    |
    v
Google Merchant feed endpoint
    |
    v
Merchant Center Scheduled Fetch
    |
    v
Google Shopping / Shopping Ads
```

GTM is not used to generate or manage the Merchant Center catalog feed.

## Canonical Commerce Event Contract

### Design rules

- Business code owns event truth.
- GTM is a routing/mapping layer, not a business-rules engine.
- Do not infer ecommerce events by reading button text, CSS classes, DOM structure, or generic click triggers.
- Tracking failures must be no-ops from the shopper's perspective.
- No analytics/pixel exception may interrupt navigation, cart, checkout, order placement, or success rendering.
- Product and transaction identifiers must remain stable across destinations.

### Required baseline events

The canonical browser contract must support at least:

- `page_view`
- `view_item_list`
- `select_item`
- `view_item`
- `add_to_cart`
- `remove_from_cart`
- `view_cart`
- `begin_checkout`
- `add_shipping_info`
- `purchase`

`add_payment_info` is optional until the checkout actually has a meaningful payment-selection step. Do not emit fake funnel events merely to match a vendor schema.

### Canonical item shape

Each commerce item should expose the smallest stable vendor-neutral payload needed by downstream destinations, conceptually:

```ts
type CommerceItem = {
  itemId: string;
  sku: string;
  productId: string;
  itemName: string;
  priceVnd: number;
  quantity: number;
  color?: string;
  size?: string;
};
```

Requirements:

- `itemId` must map to the same sellable variant identifier used for Merchant Center and ad-platform content matching wherever practical.
- `sku` is the current LA Clothing SKU and is also the Merchant Center `mpn`.
- currency is `VND`.
- money values must come from canonical commerce/order data, never DOM text.

### Purchase contract

A `purchase` event is valid only when:

```text
OrderMirror.state === CONFIRMED
```

The canonical purchase payload must use:

- `transaction_id` = `OrderMirror.publicCode`;
- canonical cross-channel event/deduplication ID = `OrderMirror.publicCode` for this initial contract;
- `value` = confirmed order total according to the selected analytics convention below;
- `currency` = `VND`;
- `items` = `OrderLineSnapshot` data, not current mutable catalog values.

The implementation must not emit Purchase for `DRAFT`, `VALIDATING`, `POS_SUBMITTING`, `REJECTED`, or `SYNC_UNKNOWN`.

### Purchase value convention

Use one convention consistently across GA4, Google Ads, TikTok, and Meta unless a vendor explicitly requires otherwise. The implementation plan must verify whether current Meta uses merchandise subtotal or final total and reconcile that with the desired cross-channel definition before code changes.

Default target for the new canonical contract: `OrderMirror.totalVnd`, including shipping, because it represents the confirmed order total. If current Meta semantics differ, the plan must surface the discrepancy rather than silently changing Meta reporting.

## Destination Mapping

### Google Tag Manager

Production loads one GTM web container configured by environment.

The application emits structured `dataLayer` events. GTM maps them to destination-specific tags.

GTM must not contain hidden copies of LA Clothing pricing, stock, order-state, or product eligibility rules.

### GA4

GA4 must receive GA4-recommended ecommerce events mapped from the canonical contract, preserving:

- transaction ID;
- item ID;
- item name;
- price;
- quantity;
- currency;
- value;
- variant metadata where useful.

App Router client navigation must produce correct page measurement without duplicate full-load/client-navigation PageView events.

### Google Ads

Google Ads conversion measurement must use the confirmed Purchase event and stable transaction ID to reduce duplicate conversions.

The plan must define which Google Ads conversion action(s) are in scope. At minimum, Purchase is required.

Remarketing/product matching, if enabled, must use the same stable variant identifiers as the Merchant Center feed wherever supported.

### TikTok Pixel

TikTok Pixel is deployed through GTM in this phase.

Map canonical events to TikTok equivalents without changing the canonical event names in application code.

At minimum support:

- product view;
- add to cart;
- checkout initiation;
- purchase/complete payment.

TikTok Pixel failures/ad blockers must not affect storefront behavior.

### TikTok Events API

Out of scope for implementation in this phase, but the contract must remain compatible with adding it later.

Future server-side TikTok events must use the same canonical event/order ID as their browser twin where TikTok deduplication requires it.

### Meta Pixel + Conversions API

Keep the existing direct architecture.

Requirements:

- Do not deploy a second Meta Pixel through GTM.
- Preserve existing Meta CAPI behavior.
- Preserve browser/server Purchase deduplication.
- Preserve one-time Purchase behavior.
- The canonical contract may be introduced underneath/alongside Meta only if behavior remains equivalent and regression tests prove it.

## Consent/Tracking Policy Layer

### Current launch policy

Initial production policy:

```text
consent UI: hidden
analytics tracking: granted by default
advertising tracking: granted by default
```

Therefore production GA4, Google Ads, TikTok Pixel, and the existing Meta tracking may run immediately when configured.

### Architectural requirement

The application must still expose a small central consent/tracking-policy abstraction so later enabling consent UI does not require rewriting the event architecture.

Conceptually:

```ts
type TrackingConsent = {
  analytics: "granted" | "denied";
  advertising: "granted" | "denied";
};
```

Do not scatter hard-coded `always true` tracking decisions across individual components.

The GTM/Google setup should be compatible with Google Consent Mode so a later policy change can switch default state and update consent without replacing the commerce event contract.

### Future consent UI

Out of scope for visible launch UI.

The architecture should allow a later banner/settings UI to change the central policy to, for example:

- Essential: always available;
- Analytics: user-controlled;
- Advertising: user-controlled.

## Environment & Configuration

### Production-only real tracking

Only the production deployment may send real data to production GA4, Google Ads, TikTok, Meta, or Merchant Center integrations.

Local, preview, test, and staging environments must not contaminate production analytics/advertising data.

Allowed non-production behavior:

- tracking disabled entirely; or
- debug/test-only `dataLayer` inspection; or
- explicit vendor test/debug destinations that cannot pollute production reporting.

### Environment variables

Exact names may follow repository conventions, but the spec expects equivalents of:

```text
NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID=
NEXT_PUBLIC_GOOGLE_ANALYTICS_ID=
GOOGLE_ADS_CONVERSION_ID=
GOOGLE_ADS_PURCHASE_LABEL=
TIKTOK_PIXEL_ID=
MARKETING_TRACKING_ENABLED=
```

Important design constraint: if GA4/Ads/TikTok are fully configured in GTM, vendor IDs that only GTM needs should preferably live in GTM rather than being duplicated in application env. The implementation plan must minimize duplicate configuration sources.

Existing Meta env remains unchanged unless compatibility work requires a clearly documented adjustment.

No API secret or access token may be exposed through `NEXT_PUBLIC_*` variables.

## Content Security Policy

The repository currently keeps Meta origins closed unless Meta is configured. The new implementation must preserve a fail-closed CSP philosophy.

Production CSP must allow only the minimum origins required by the selected GTM/Google/TikTok implementation.

Requirements:

- no broad `*` script/connect/image allowances;
- no weakening CSP globally merely to make tags work;
- tracking disabled/unconfigured should not unnecessarily open third-party origins;
- CSP changes must be reviewed against actual browser requests from GTM Preview/vendor diagnostics.

## Google Merchant Center Feed

### Delivery method

Initial integration uses:

```text
Public HTTPS feed URL
    +
Merchant Center Scheduled Fetch
```

No Merchant API realtime integration in this phase.

### Feed format

Use a Google-supported primary product data format that is straightforward to generate and validate from Next.js. XML/RSS is preferred unless implementation evidence shows another supported format fits the repository better.

The endpoint must be deterministic, cache-aware where appropriate, and safe for Google fetchers without authentication secrets in the URL.

### Variant model

Each eligible `VariantMirror` is one Merchant Center item.

Variants under the same `ProductMirror` share one stable `item_group_id`.

Example:

```text
Parent ProductMirror: Oxford Shirt

variant S -> Merchant item A --+
variant M -> Merchant item B ---+--> same item_group_id
variant L -> Merchant item C --+
```

### Merchant identifiers

For each variant:

- `id`: stable variant identifier; prefer a value that will not change if merchandising copy changes;
- `brand`: `LA Clothing`;
- `mpn`: current SKU;
- `gtin`: omit unless the value is a valid real GTIN under Google's requirements;
- Pancake-generated internal barcode must not automatically be submitted as `gtin`.

The implementation plan must choose the exact feed `id`. Preferred candidates, in order:

1. stable `pancakeVariationId` if guaranteed durable across the catalog lifecycle;
2. stable SKU if LA Clothing guarantees SKU immutability;
3. local immutable `VariantMirror.id` only if externally stable URLs/tracking do not need the same value.

Do not choose without verifying current catalog lifecycle semantics.

### Required variant attributes

Where applicable and available:

- title;
- description;
- link;
- image link;
- availability;
- price;
- brand;
- mpn;
- item group ID;
- color;
- size;
- condition = new;
- additional apparel attributes required by the target market/category if Google requires them.

### Feed eligibility

A variant may be emitted only if its storefront product is legitimately publishable/sellable.

Baseline rule:

Product requirements:

```text
ProductMirror.isPresent === true
ProductMirror.isActive === true
ProductContent.status === PUBLISHED
```

Variant requirements:

```text
VariantMirror.isPresent === true
VariantMirror.isActive === true
not excluded by storefront hidden/locked policy
SKU exists
valid sell price exists
valid product landing URL exists
valid image exists
```

The implementation must reuse the storefront's canonical visibility/sellability policy when one exists instead of duplicating a subtly different Merchant-only rule.

### Availability

Out-of-stock variants remain in the feed with the same stable item ID.

```text
available stock > 0 -> in_stock
available stock <= 0 -> out_of_stock
```

Do not remove an otherwise valid variant merely because inventory temporarily reaches zero.

The exact stock aggregation rule across `WarehouseStock` must match the storefront's sellable-stock rule.

### Price

Feed price must match the actual variant landing page price.

If `pancakeRetailPriceAfterDiscount` is the active sell price according to storefront logic, Merchant output must reflect the same pricing semantics. Do not create an independent price-selection algorithm for Google Shopping.

### Landing URLs

Variant feed links must resolve to a valid public production PDP.

For products with multiple variants, the URL should identify/select the intended variant when the storefront supports stable variant deep-linking. If the current PDP cannot represent a specific variant in its URL, the `/plan` phase must decide whether a query parameter/fragment/state contract is necessary to satisfy Merchant variant landing-page consistency.

### Images

Use real trusted product media only. Do not emit placeholders or inaccessible source images.

The selected image must correspond to the variant when variant-specific imagery exists.

## Security & Privacy Boundaries

### Always

- Treat GTM/vendor/browser responses as external/untrusted integration data.
- Keep API secrets server-only.
- Validate env/config IDs before rendering third-party tags.
- Tracking failures are isolated from commerce behavior.
- Preserve CSP least privilege.
- Preserve order/variant identifiers without leaking unnecessary PII.
- Avoid sending name, phone, address, email, or other customer PII in generic browser ecommerce payloads.
- Document external data destinations and later consent-policy changes.

### Ask first

- Adding server-side TikTok Events API credentials/PII matching;
- changing Meta CAPI data fields;
- migrating Meta Pixel into GTM;
- enabling visible consent UI or changing default consent policy;
- enabling Enhanced Conversions or any hashed customer-data transmission;
- adding new advertising vendors;
- changing database schema solely for analytics;
- adopting Merchant API realtime sync.

### Never

- Commit real GTM/vendor secrets/tokens.
- Put server API access tokens in client bundles.
- Emit Purchase from a click-only trigger.
- Deploy a second Meta Pixel while the direct Pixel is enabled.
- Treat a Pancake internal barcode as GTIN without validation.
- Let local/staging contaminate production analytics.
- Put customer PII into `dataLayer` unless separately specified, reviewed, and justified.
- Disable failing tests or weaken CSP broadly to make tracking pass.

## Project Structure (Intended)

Exact file names may adapt to existing patterns during `/plan`, but expected ownership is:

```text
src/
  analytics/
    commerce-events.*
    tracking-consent.*
    data-layer.*
    environment.*
  components/
    analytics/
      google-tag-manager.*
      ...existing Meta components...
  integrations/
    meta/                 # existing
    google/               # config/mapping if needed outside GTM
    tiktok/               # browser mapping only if application-side helpers are needed
  commerce/
    ...canonical product/order adapters...
  app/
    feeds/
      google-merchant.*   # route or equivalent supported Next.js route

tests/
  domain/
  integrations/
```

Prefer one canonical commerce-event builder/mapping layer over vendor-specific data construction scattered across pages/components.

## Commands

Repository commands already defined in `package.json`:

```bash
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:domain
pnpm test:db
pnpm release:check
```

During implementation, use focused tests first and run the full relevant suite before completion.

## Testing Strategy

### Unit/domain tests

Must prove:

- canonical event payload construction;
- item ID/SKU/value/currency mapping;
- Purchase rejects all non-`CONFIRMED` order states;
- Purchase uses `publicCode` transaction/event ID;
- confirmed Purchase uses immutable order-line snapshots;
- consent policy default is configurable centrally;
- tracking disabled/non-production becomes a no-op;
- Merchant feed eligibility rules;
- out-of-stock item stays in feed with `out_of_stock`;
- invalid/missing required merchant fields exclude or fail safely according to the selected feed policy;
- no Pancake barcode is emitted as GTIN without explicit valid-GTIN handling.

### Integration tests

Must prove:

- GTM component renders only when production tracking is configured;
- `dataLayer` events have deterministic vendor-neutral schemas;
- no duplicate Meta Pixel is introduced;
- success page emits canonical Purchase only for confirmed orders;
- Merchant feed endpoint returns valid supported feed output;
- feed IDs/group IDs stay stable for identical catalog input;
- feed price/availability match canonical storefront policy.

### Browser/runtime verification

Required before release when browser tools are available:

- GTM Preview/Tag Assistant validates expected tags;
- GA4 DebugView receives expected ecommerce events;
- Google Ads diagnostics receive Purchase with transaction ID;
- TikTok Pixel Helper/Events Manager sees expected browser events;
- Meta Pixel/CAPI existing dedup remains healthy;
- one real/test confirmed order yields one conversion per intended destination, not duplicates;
- client-side navigation does not duplicate PageView;
- ad blocker/script failure does not break commerce UI;
- browser network/CSP console shows no unintended blocked requests after final CSP configuration.

### Merchant verification

Before launch:

- Merchant Center successfully fetches the scheduled URL;
- feed parses with zero structural errors;
- sample parent with multiple variants groups correctly;
- sample out-of-stock variant remains present and out of stock;
- landing-page price/availability match feed;
- product diagnostics show no invalid GTIN caused by Pancake barcode;
- images are fetchable by Google;
- no unpublished/hidden/locked product leaks into the feed.

## Observability

Tracking itself must be diagnosable without logging customer PII.

At minimum:

- non-production debug mode can inspect canonical event names/payload shape without sending real vendor traffic;
- Merchant feed generation exposes safe structured error evidence in server logs for malformed catalog records;
- no secrets, phone numbers, addresses, emails, or auth/session tokens in analytics debug logs;
- feed failures should be observable through existing deployment/error monitoring where available.

Do not introduce high-cardinality production metrics solely for individual event/product IDs unless the project already has an appropriate telemetry system.

## Success Criteria

### Architecture

- [ ] One canonical commerce event contract is the source for new tracking destinations.
- [ ] GA4, Google Ads, TikTok Pixel are routed through GTM.
- [ ] Existing Meta Pixel + CAPI remain direct and do not double-fire through GTM.
- [ ] TikTok Events API is not implemented yet, but the contract can support later browser/server deduplication.

### Correctness

- [ ] `purchase` is impossible unless `OrderMirror.state === CONFIRMED`.
- [ ] `transaction_id`/canonical purchase event ID is `OrderMirror.publicCode`.
- [ ] product IDs/SKUs/prices/quantities come from canonical commerce data, not DOM parsing.
- [ ] one confirmed order produces at most one intended browser Purchase per destination per transaction under normal operation.

### Environment & consent readiness

- [ ] only production can send to real production tracking destinations.
- [ ] consent/tracking policy is centralized.
- [ ] initial policy is tracking granted with consent UI hidden.
- [ ] enabling future consent UI does not require replacing the commerce event contract.

### Google Shopping

- [ ] Merchant Center uses Scheduled Fetch from a production HTTPS feed URL.
- [ ] each eligible variant is a separate Merchant item.
- [ ] parent variants share `item_group_id`.
- [ ] `brand = LA Clothing`.
- [ ] current SKU is sent as `mpn`.
- [ ] Pancake barcode is not automatically sent as `gtin`.
- [ ] out-of-stock variants remain in feed with `out_of_stock`.
- [ ] unpublished/inactive/hidden/locked/non-sellable records do not appear.
- [ ] feed price/availability match the storefront.

### Quality/security

- [ ] no real secrets committed.
- [ ] no production PII added to generic `dataLayer` ecommerce events.
- [ ] CSP remains least-privilege and verified against real tag traffic.
- [ ] analytics failures never break shopper flows.
- [ ] lint/typecheck/tests/build pass using repository commands.
- [ ] browser diagnostics and Merchant Center diagnostics are checked before release.

## Out of Scope

- Migrating existing Meta browser Pixel into GTM.
- Replacing Meta CAPI.
- TikTok Events API implementation.
- Merchant API realtime product sync.
- Visible consent/cookie banner.
- User-facing consent settings page.
- Enhanced Conversions/customer-match style hashed PII transmission.
- New database schema unless `/plan` proves existing fields cannot satisfy a required contract.
- Unrelated SEO/catalog/UI refactors.

## Risks & Required Plan-Time Decisions

The `/plan` phase must explicitly resolve these before implementation:

1. **Stable Merchant/tracking variant ID**: verify whether `pancakeVariationId` or SKU is the durable external ID and choose one canonical `item_id`.
2. **Purchase value semantics**: verify existing Meta Purchase value (subtotal vs total including shipping) and decide whether cross-platform reporting should match it or intentionally differ with documentation.
3. **Storefront sellability helper**: find/reuse the canonical product/variant visibility, stock, and price rules rather than duplicating them in feed code.
4. **Variant landing deep link**: confirm whether PDP URLs can resolve/select the Merchant variant deterministically.
5. **GTM config ownership**: minimize duplicate GA4/Ads/TikTok identifiers between source env and GTM workspace.
6. **CSP origin list**: derive from actual GTM/GA4/Ads/TikTok runtime requests and official docs; do not guess a broad allowlist.
7. **Google Ads conversion actions**: Purchase is mandatory; any secondary conversions require explicit product-owner scope.

## Definition of Done Gate

This feature is not complete merely because scripts appear on the page or Merchant Center accepts a file.

Before `/ship`, the implementation must satisfy both this spec's acceptance criteria and the project Definition of Done, including:

- behavioral tests for new logic;
- full relevant test/build/lint/type checks;
- runtime browser verification;
- integration compatibility with existing Meta behavior;
- security review for third-party scripts/config/secrets;
- observability/diagnostics appropriate to feed and tracking failures;
- rollback path for tag/config rollout;
- human review before production activation.

## Open Questions

No product-requirement blocker remains for planning.

The seven plan-time technical decisions above are implementation discoveries, not product ambiguity, and should be resolved from repository evidence + current official vendor documentation during `/plan`.
