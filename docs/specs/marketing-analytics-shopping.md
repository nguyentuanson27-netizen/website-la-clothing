# Spec: Marketing Analytics, Ads Tracking & Google Shopping

Status: Proposed — ready for human review

## 1. Objective

Build a production-only marketing measurement and catalog-export foundation for LA Clothing covering:

- Google Tag Manager (GTM);
- Google Analytics 4 (GA4);
- Google Ads conversion tracking;
- TikTok Pixel through GTM;
- the existing direct Meta Pixel + Meta Conversions API integration;
- an automated Google Merchant Center product feed for Google Shopping.

The storefront and order system remain the source of truth. Tracking vendors may consume canonical commerce facts, but GTM/pixels must never infer core business outcomes such as a successful purchase from DOM text, CSS selectors, or a button click.

### Confirmed product decisions

1. GA4 + Google Ads + TikTok Pixel run through GTM.
2. Meta Pixel + Meta CAPI stay direct; no Meta-to-GTM migration in this scope.
3. TikTok Events API is a later phase, not part of this implementation.
4. One canonical commerce-event layer supplies the facts used by new destinations.
5. `purchase` exists only for `OrderMirror.state === CONFIRMED`.
6. `OrderMirror.publicCode` is the canonical purchase transaction/event ID.
7. Only the real production deployment sends real vendor traffic.
8. A central consent/tracking-policy abstraction is built now, but no consent UI is displayed initially; current launch policy allows tracking immediately in production.
9. Google Merchant Center uses a public feed URL + Scheduled Fetch.
10. Each sellable variant is a separate Merchant item; variants of the same parent share an `item_group_id`.
11. `brand = LA Clothing`; current SKU is the manufacturer part number (`mpn`).
12. Pancake-generated barcode is not assumed to be GTIN. `gtin` is omitted unless a valid assigned GTIN exists.
13. An otherwise eligible out-of-stock variant stays in the feed with `availability = out_of_stock`.

## 2. Current Repository Context

### Tech stack

- Next.js 16.2.11
- React 19.2.0
- TypeScript 5.9.x
- Prisma 7.9.1
- PostgreSQL
- pnpm 11.4.0

### Existing Meta behavior — compatibility constraint

The repository already implements Meta directly with:

- browser Meta/Facebook Pixel;
- App Router PageView handling;
- browser event delivery that fails safely;
- server-side Meta Conversions API;
- browser/server Purchase deduplication using the order code as event ID;
- one-time browser Purchase behavior;
- Purchase only for confirmed orders.

Current Meta Purchase value uses `OrderMirror.totalVnd`. Current Meta product `content_ids` are based on product slug where available, with a fallback to Pancake variation ID. This implementation is intentionally preserved in this scope unless an explicit later migration is approved.

### Existing catalog/order data

The mirror already provides the core facts needed by this feature:

- `ProductMirror`: parent identity, Pancake product ID, slug, name, primary image, active/present state;
- `ProductContent`: publish status and editorial/SEO content;
- `VariantMirror`: Pancake variation ID, SKU, Pancake barcode, color, size, price fields, active/present state, hidden/locked source flags;
- `WarehouseStock`: variant-level stock;
- `OrderMirror`: `publicCode`, lifecycle state, merchandise subtotal, shipping fee, total;
- `OrderLineSnapshot`: immutable purchased line facts.

## 3. Target Architecture

### Browser/server measurement

```text
LA Clothing business/commerce facts
               |
               +----> Existing Meta Pixel (direct browser)
               |
               +----> Existing Meta CAPI (direct server)
               |
               +----> Canonical dataLayer events
                          |
                          v
                         GTM
                  +-------+--------+---------+
                  |       |        |         |
                 GA4   Google   TikTok    future
                       Ads      Pixel     browser tags

Future phase only:
confirmed server events -----------------> TikTok Events API
```

### Google Shopping

```text
Pancake source
     |
     v
LA Clothing mirror DB
     |
     v
public Merchant product-feed URL
     |
     v
Merchant Center Scheduled Fetch
     |
     v
Free listings / Shopping Ads
```

GTM does not own or generate the Merchant catalog.

## 4. Canonical Commerce Contract

### Principles

- Business code owns event truth.
- `dataLayer` carries structured facts from application code to GTM.
- GTM maps canonical events to vendor-specific tags/events.
- GTM must not reimplement LA Clothing pricing, stock, order state, or catalog eligibility rules.
- Tracking failure must be a no-op for the shopper journey.
- No vendor exception may interrupt navigation, cart, checkout, order placement, or success rendering.
- Money/product values come from typed commerce/order data, never parsed DOM text.

### Baseline browser events

The contract must support at least:

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

`add_payment_info` is not required until checkout has a real payment-selection interaction worth measuring. Do not emit synthetic funnel events only to fill a vendor schema.

### Canonical item facts

Conceptually:

```ts
type CommerceItem = {
  variantExternalId: string;
  sku: string;
  productId: string;
  productSlug: string;
  itemName: string;
  unitPriceVnd: number;
  quantity: number;
  color?: string;
  size?: string;
};
```

The contract deliberately carries enough identity to support different destination requirements without forcing every destination to use the same identifier when an existing compatibility contract says otherwise.

Rules:

- `sku` is the current LA Clothing SKU and Merchant Center `mpn`.
- New Merchant/GA4/Ads/TikTok product matching should use the same stable sellable-variant ID wherever supported.
- Existing Meta `content_ids` remain compatible with the current Meta catalog/dynamic-ad strategy in this phase; do not silently switch them to the new Merchant variant ID.

### Purchase truth

A Purchase is valid only when:

```text
OrderMirror.state === CONFIRMED
```

Never emit `purchase` for:

- `DRAFT`
- `VALIDATING`
- `POS_SUBMITTING`
- `REJECTED`
- `SYNC_UNKNOWN`

Canonical purchase facts must include at least:

```ts
type CommercePurchase = {
  transactionId: string;       // OrderMirror.publicCode
  eventId: string;             // same publicCode for this initial contract
  currency: "VND";
  merchandiseValueVnd: number; // immutable sum / OrderMirror merchandise subtotal
  shippingVnd: number;
  totalVnd: number;
  items: CommerceItem[];        // built from OrderLineSnapshot facts
};
```

Requirements:

- `transactionId = OrderMirror.publicCode`.
- Canonical purchase `eventId = OrderMirror.publicCode` for browser/server deduplication where the destination supports it.
- Purchased product quantities/prices come from `OrderLineSnapshot`, not current mutable catalog records.

### Destination-specific value semantics

The canonical layer exposes business facts; vendor adapters map them according to each vendor's documented semantics. Do **not** force one ambiguous `value` field onto every platform.

- **GA4:** `purchase.value` must be the sum of item `price × quantity`; shipping is supplied separately as `shipping`. Therefore shipping is not added into GA4 `value`.
- **Meta:** preserve the current implementation in this scope, where Purchase value is `OrderMirror.totalVnd`, unless a later explicitly reviewed change is approved.
- **Google Ads:** Purchase conversion value is a business/advertising KPI decision. `/plan` must select and document whether Ads receives total order value or merchandise-only value; the transaction ID remains `publicCode` either way.
- **TikTok:** `/plan` must verify the current official TikTok event/value contract and map from the same canonical purchase facts.

Any intentional cross-platform reporting difference must be documented; no silent arithmetic differences are allowed.

## 5. Destination Requirements

### Google Tag Manager

- Production loads one GTM web container when production tracking is enabled and the container ID is valid.
- Application code pushes deterministic custom/ecommerce events to `window.dataLayer`.
- GTM custom-event triggers consume those events.
- GTM contains routing/mapping only, not hidden commerce policy.
- A GTM workspace/container export or equivalent configuration documentation must be reviewable so production tag logic is not an undocumented second codebase.

### GA4

GA4 receives the recommended ecommerce events mapped from the canonical contract, including as applicable:

- `transaction_id`
- `currency`
- `value`
- `shipping`
- `items[]`
- item ID/name/price/quantity
- useful variant metadata such as color/size

App Router navigation must be handled without duplicate PageViews caused by both initial-load and client-navigation logic firing for the same navigation.

### Google Ads

- At minimum, track the confirmed Purchase conversion.
- Purchase uses `OrderMirror.publicCode` as unique transaction ID to reduce duplicate conversions on refresh/revisit.
- Conversion ID/label belong in GTM configuration unless application code truly needs them.
- Product/remarketing identifiers should align with the stable Merchant variant ID where the Google Ads setup supports product matching.
- Secondary conversion actions are out of scope unless explicitly added during `/plan`.

### TikTok Pixel

- TikTok Pixel is configured through GTM in this phase.
- Map canonical application events to current TikTok event names in GTM; do not rename application events to vendor-specific names.
- At minimum map product view, AddToCart, checkout initiation, and Purchase/CompletePayment.
- Follow current official TikTok GTM setup/event-tag guidance during implementation; do not invent an unsupported integration pattern from memory.
- Pixel/ad-blocker/network failure must not affect storefront behavior.

### TikTok Events API — future compatibility only

Not implemented now.

The contract must allow a later server copy of the same conversion to use the same `event_id` as its Pixel twin. TikTok currently requires matching `event_id` for deduplication when Pixel and Events API send duplicate copies of the same event.

### Meta Pixel + Meta CAPI

Keep the current direct architecture.

Required:

- no second Meta Pixel inside GTM;
- preserve current CAPI behavior;
- preserve browser/server Purchase deduplication;
- preserve one-time browser Purchase behavior;
- preserve current Meta product ID semantics unless separately migrated;
- if a shared commerce helper is introduced under Meta, regression tests must prove equivalent behavior before replacing existing logic.

## 6. Consent / Tracking Policy Layer

### Current product-owner policy

Initial production behavior is intentionally:

```text
visible consent UI       = OFF
analytics tracking       = granted by default
advertising tracking     = granted by default
```

Therefore configured production tracking may run immediately when a shopper enters the site.

This is a product policy choice, not a hard-coded architectural limitation and not a claim about legal compliance in every market.

### Future-ready architecture

Create one small central policy abstraction, conceptually:

```ts
type TrackingConsent = {
  analytics: "granted" | "denied";
  advertising: "granted" | "denied";
};
```

Rules:

- Do not scatter `always track = true` decisions through components.
- Google/GTM setup must be compatible with later Google Consent Mode default/update behavior.
- Later enabling a banner must require changing policy/UI wiring, not rewriting the commerce event contract.
- Commerce/order functionality remains independent of tracking consent.

### Visible consent UI

Out of scope now.

Future UI may expose:

- Essential: always on;
- Analytics: user controlled;
- Advertising: user controlled.

Changing the current default tracking policy or displaying consent UI requires explicit approval.

## 7. Environment & Configuration

### Production-only real tracking

Real vendor traffic is allowed only from the real production storefront.

Local, CI, test, preview, and staging environments must not pollute production GA4/Ads/TikTok/Meta data.

Non-production may:

- disable third-party tracking completely;
- push to a debug/local `dataLayer` without sending vendor requests;
- use explicit vendor test/debug destinations that cannot contaminate production reports.

`NODE_ENV === "production"` alone is not a sufficient definition of the real storefront, because production builds can be run outside the live production deployment. `/plan` must identify the repository's deployment convention and choose an explicit production gate, such as approved tracking configuration plus the expected production `APP_DOMAIN`/deployment environment.

### Application configuration ownership

If GA4, Google Ads, and TikTok are configured entirely inside GTM, the application should not duplicate those vendor IDs.

Expected application-side configuration is conceptually limited to:

```text
NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID=
MARKETING_TRACKING_ENABLED=
```

Exact names must follow repository conventions. Because CSP may be built from tracking configuration, `/plan` must decide which settings are build-time versus runtime and make that explicit.

GA4 measurement IDs, Google Ads conversion IDs/labels, and TikTok Pixel IDs should live in GTM when only GTM consumes them.

Existing Meta configuration remains as-is unless compatibility work requires an explicitly reviewed adjustment.

No API secret/access token may be exposed through a `NEXT_PUBLIC_*` variable or browser `dataLayer`.

## 8. Content Security Policy

Preserve the repository's fail-closed CSP philosophy.

Requirements:

- allow only origins actually required by the final GTM/Google/TikTok implementation;
- no broad `*` script/connect/image allowances;
- do not globally weaken CSP just to make tags work;
- disabled/unconfigured tracking should not unnecessarily open vendor origins;
- derive the final origin list from current official documentation plus observed GTM Preview/browser network traffic;
- verify production browser console/network behavior after CSP changes.

## 9. Google Merchant Center Feed

### Delivery

Initial delivery method:

```text
public HTTPS product-data URL
        +
Merchant Center Scheduled Fetch
```

No Merchant API realtime sync in this phase.

The URL must point directly to a supported product data source rather than an HTML page and must be fetchable by Google without a secret embedded in the URL.

### Format

Use a currently supported Merchant Center file format that is simple to generate and validate from Next.js. XML/RSS is preferred unless `/plan` finds a stronger repository-specific reason to use another supported file format.

The output must be deterministic and safe to regenerate repeatedly.

### Variant model

Each eligible `VariantMirror` is one Merchant item.

All variants of the same `ProductMirror` share one stable `item_group_id`.

```text
Oxford Shirt parent
  |- white / S -> unique Merchant item ID --+
  |- white / M -> unique Merchant item ID --+--> same item_group_id
  `- white / L -> unique Merchant item ID --+
```

Do not submit the parent as a separate purchasable Merchant item merely to represent the group.

### Merchant identifiers

For every variant:

- `id`: stable unique variant identifier;
- `item_group_id`: stable parent-group identifier;
- `brand`: `LA Clothing`;
- `mpn`: current SKU;
- `gtin`: omitted unless the variant has a real valid assigned GTIN;
- Pancake auto-generated/internal barcode is not automatically treated as GTIN.

Because LA Clothing is the manufacturer/brand, using the current SKU as MPN is an explicit product decision. Google permits a manufacturer/sole seller without GTIN to supply its brand and a unique MPN of its choosing.

### Exact Merchant item ID — plan-time discovery

`/plan` must verify catalog lifecycle semantics before choosing the external item ID. Candidate order:

1. `pancakeVariationId` if it is durable across variant lifecycle/resync;
2. SKU if LA Clothing guarantees SKU immutability;
3. local immutable `VariantMirror.id` only if external product matching/deep-link needs do not require another identifier.

Do not change Merchant `id` casually after launch because it is an external stable identity.

### Required product attributes

Emit all current required attributes for the target market/category and any available high-value attributes, including as applicable:

- `id`
- `title`
- `description`
- `link`
- `image_link`
- `availability`
- `price`
- `condition = new`
- `brand = LA Clothing`
- `mpn = SKU`
- `item_group_id`
- `color`
- `size`
- any currently required apparel attributes for the target country, such as gender/age-group/size-system where applicable.

Because Merchant requirements evolve, `/plan` must verify the exact target-country apparel requirements against current official Merchant Center documentation.

### Feed eligibility — confirmed rule

A variant may be emitted only when its parent/product is valid for the public storefront.

Product baseline:

```text
ProductMirror.isPresent === true
ProductMirror.isActive === true
ProductContent.status === PUBLISHED
```

Variant baseline:

```text
VariantMirror.isPresent === true
VariantMirror.isActive === true
not excluded by canonical storefront hidden/locked policy
SKU exists
valid sell price exists
valid production landing URL exists
valid trusted product image exists
```

The Merchant feed must reuse the storefront's canonical visibility/sellability helpers when they exist. Do not create a subtly different Merchant-only interpretation of active, hidden, locked, stock, or sale price.

### Availability

An otherwise eligible variant remains in the feed when temporarily out of stock.

```text
sellable stock > 0  -> in_stock
sellable stock <= 0 -> out_of_stock
```

The exact stock aggregation across `WarehouseStock` must match the storefront's canonical sellable-stock rule.

### Price

Merchant price must match the actual landing-page sell price for that exact variant.

If storefront logic prefers `pancakeRetailPriceAfterDiscount`, Merchant must reuse that same pricing policy. Do not implement independent feed pricing rules.

### Variant landing page

Each Merchant variant URL must land on a page where the submitted variant can be identified/selected and where displayed price, availability, color, size, and image match the submitted data.

Google's current variant guidance recommends distinct variant URLs using a path or query parameter. If the existing PDP cannot deep-link to a variant, `/plan` must define the smallest compatible URL/selection contract before Merchant launch.

### Images

- only real trusted product media;
- no placeholders;
- URL fetchable by Google;
- variant-specific image when variant-specific imagery exists;
- feed image and landing-page presentation must not materially contradict the submitted variant.

### Merchant account/setup outside source code

The implementation/launch plan must also cover the external Merchant Center setup needed to make the feed useful, including as applicable:

- production website verification/claiming;
- product data source + Scheduled Fetch schedule;
- target country/language;
- shipping/return settings required by Merchant Center;
- diagnostics review;
- linkage to the intended Google Ads account for Shopping campaigns.

Account IDs/settings that are owned by Merchant Center or GTM should not be duplicated into source code without a technical reason.

## 10. Security & Privacy Boundaries

### Always

- treat vendor/GTM/browser output as untrusted integration data;
- validate tracking configuration before rendering third-party tags;
- keep API credentials server-only;
- keep generic browser ecommerce payloads free of customer name, phone, address, email, auth tokens, and session identifiers;
- isolate tracking failures from commerce behavior;
- preserve least-privilege CSP;
- document new external data destinations and later consent-policy changes;
- keep non-production traffic away from production analytics/ad accounts.

### Ask first

- TikTok Events API credentials/server-side matching;
- changes to Meta CAPI payload/user-data fields;
- migration of Meta Pixel into GTM;
- visible consent banner or default consent-policy change;
- Google Enhanced Conversions or any hashed customer-data transmission;
- new advertising vendors;
- database-schema changes solely for analytics;
- Merchant API realtime sync;
- changing existing Meta content-ID or Purchase-value semantics.

### Never

- commit real access tokens/secrets;
- expose server API tokens to browser code;
- emit Purchase from a click-only trigger;
- run a GTM Meta Pixel while the existing direct Pixel remains enabled;
- invent/guess a GTIN from Pancake's internal barcode;
- put customer PII into generic `dataLayer` ecommerce events;
- let staging/local pollute production reports;
- weaken CSP broadly or remove failing tests merely to make tracking work.

## 11. Intended Project Structure

Exact paths may adapt to existing patterns during `/plan`; intended ownership is:

```text
src/
  analytics/
    commerce-events.*
    data-layer.*
    tracking-policy.*
    tracking-environment.*
  components/
    analytics/
      google-tag-manager.*
      ...existing Meta components...
  integrations/
    meta/                  # existing direct integration
    google/                # only app-side helpers if genuinely needed
    tiktok/                # only app-side helpers if genuinely needed
  commerce/
    ...canonical adapters / existing sellability & pricing helpers...
  app/
    feeds/
      ...Merchant feed route in a valid Next.js route shape...

tests/
  domain/
  integrations/
```

Prefer one canonical commerce-event/fact builder over vendor payload construction scattered across pages/components.

## 12. Code Style

Follow existing TypeScript/Next.js conventions. Prefer explicit typed contracts and small pure mapping functions.

Illustrative style:

```ts
export type PurchaseFacts = Readonly<{
  transactionId: string;
  merchandiseValueVnd: number;
  shippingVnd: number;
  totalVnd: number;
  items: readonly CommerceItem[];
}>;

export function buildPurchaseFacts(order: ConfirmedOrderSnapshot): PurchaseFacts {
  // Pure mapping from already-validated business state; no vendor calls here.
}
```

Vendor dispatch belongs outside the business-fact builder.

## 13. Repository Commands

Use the repository's checked-in commands:

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

Implementation uses focused tests during the TDD loop and full relevant checks before completion.

## 14. Testing Strategy

### Unit/domain tests

Must prove at minimum:

- canonical event/item mapping;
- Purchase cannot be built/emitted from non-`CONFIRMED` state;
- Purchase uses `publicCode` transaction/event ID;
- purchased item facts come from immutable order-line snapshots;
- GA4 value excludes shipping and `shipping` is mapped separately;
- existing Meta Purchase semantics remain unchanged unless explicitly approved;
- production gate is centralized and non-production is a no-op for real vendors;
- tracking policy is centralized and can later switch to denied/user-controlled state;
- Merchant eligibility rules;
- out-of-stock item remains in feed as `out_of_stock`;
- SKU maps to MPN;
- internal Pancake barcode is not emitted as GTIN by default;
- feed IDs/group IDs are deterministic.

### Integration tests

Must prove at minimum:

- GTM component/snippet renders only when the live-production tracking gate and valid config allow it;
- deterministic `dataLayer` event schema;
- no duplicate Meta Pixel is introduced;
- confirmed success flow creates the canonical Purchase while invalid/unconfirmed success URL does not;
- Merchant route returns a currently supported parseable product-data format;
- feed price/availability reuse storefront policy;
- unpublished/inactive/non-sellable variants are absent;
- stable identical catalog input yields stable IDs/group IDs.

### Browser/runtime verification

Required before production activation when browser tools are available:

- GTM Preview / Tag Assistant shows the expected custom events and tags;
- GA4 DebugView receives expected ecommerce events;
- Google Ads test Purchase includes the unique transaction ID;
- TikTok Pixel diagnostics/Events Manager receives intended browser events;
- existing Meta Pixel + CAPI browser/server dedup remains healthy;
- one confirmed test order does not produce duplicate Purchase conversions;
- App Router navigation does not duplicate PageView;
- ad blocker/vendor failure does not break commerce UI;
- browser console/network verifies the final CSP rather than relying on guessed origin lists.

### Merchant verification

Before launch:

- Merchant Center can fetch the production URL on schedule;
- product file parses without structural errors;
- sample parent variants group correctly;
- variant landing URLs select/represent the submitted variant;
- out-of-stock sample remains present as `out_of_stock`;
- price/availability match storefront;
- no false GTIN generated from Pancake barcode;
- images are fetchable;
- hidden/unpublished/non-sellable records do not leak into feed;
- Merchant diagnostics are reviewed before enabling Shopping campaigns.

## 15. Observability

Tracking must be diagnosable without logging customer PII.

At minimum:

- non-production can inspect canonical event names/shapes without sending real vendor traffic;
- Merchant generation logs safe structured evidence for malformed/excluded records where useful;
- do not log names, phones, addresses, emails, auth headers, tokens, or whole customer payloads;
- feed-generation/runtime failures flow through existing deployment/error monitoring where available.

Avoid introducing high-cardinality metrics for per-user/per-order IDs unless the project already has an appropriate telemetry system.

## 16. Success Criteria

### Architecture

- [ ] One canonical commerce fact/event layer supplies new tracking destinations.
- [ ] GA4 + Google Ads + TikTok Pixel are routed through GTM.
- [ ] Existing direct Meta Pixel + CAPI remain direct and are not duplicated in GTM.
- [ ] TikTok Events API is not implemented, but future browser/server dedup is supported by the event-ID contract.

### Correctness

- [ ] `purchase` is impossible unless `OrderMirror.state === CONFIRMED`.
- [ ] Purchase transaction/event ID is `OrderMirror.publicCode`.
- [ ] Product IDs/SKUs/prices/quantities come from canonical application data, not DOM parsing.
- [ ] GA4 Purchase value/shipping semantics match current GA4 documentation.
- [ ] Existing Meta Purchase/content-ID behavior remains compatible.
- [ ] A confirmed order is not double-counted through refresh/revisit under normal supported behavior.

### Production/consent readiness

- [ ] only the real production storefront sends real production tracking traffic;
- [ ] central tracking/consent policy exists;
- [ ] initial policy allows immediate production tracking while UI is hidden;
- [ ] later consent UI/default-denied behavior can be enabled without replacing the commerce event contract.

### Google Shopping

- [ ] Merchant Center uses Scheduled Fetch from a production HTTPS product-data URL.
- [ ] each eligible variant is one Merchant item.
- [ ] sibling variants share one stable `item_group_id`.
- [ ] `brand = LA Clothing`.
- [ ] current SKU is `mpn`.
- [ ] Pancake barcode is not automatically submitted as `gtin`.
- [ ] out-of-stock eligible variants remain present as `out_of_stock`.
- [ ] unpublished/inactive/hidden/locked/non-sellable records do not appear.
- [ ] feed price/availability and variant presentation match the storefront.

### Quality/security

- [ ] no real secrets committed or exposed to browser code;
- [ ] generic browser ecommerce payloads contain no customer PII;
- [ ] CSP remains least-privilege and is verified against real runtime traffic;
- [ ] tracking failure cannot break shopper flows;
- [ ] relevant lint/typecheck/tests/build gates pass;
- [ ] browser diagnostics and Merchant diagnostics are checked before production activation;
- [ ] rollback/disable path exists for GTM/tracking/feed rollout.

## 17. Out of Scope

- migrating existing Meta browser Pixel into GTM;
- replacing Meta CAPI;
- changing current Meta content-ID strategy;
- changing current Meta Purchase value semantics;
- TikTok Events API implementation;
- Merchant API realtime sync;
- visible consent/cookie banner;
- user-facing consent settings page;
- Enhanced Conversions / hashed customer PII transmission;
- database schema changes unless `/plan` proves existing fields cannot satisfy a required contract;
- unrelated SEO/catalog/UI refactors.

## 18. Required `/plan` Discoveries

Before implementation, `/plan` must resolve from repository evidence + current official docs:

1. **Stable external variant ID:** verify durability of `pancakeVariationId` vs SKU and choose Merchant/new-tracking `item_id`.
2. **Google Ads conversion value:** explicitly choose total order value vs merchandise-only value for Ads; do not inherit GA4 semantics by accident.
3. **TikTok value/event mapping:** verify current official TikTok event parameter requirements.
4. **Canonical storefront policy:** locate/reuse existing visibility, hidden/locked, stock aggregation, sale-price, and trusted-image helpers.
5. **Variant deep link:** verify whether PDP URL can select a variant; add the smallest stable query/path contract if needed.
6. **Live-production gate:** determine the deployment-safe condition beyond `NODE_ENV` that prevents local/staging contamination.
7. **GTM ownership:** define container/workspace naming, production vs test workflow, and how GTM configuration is reviewed/exported/versioned.
8. **CSP origins:** derive exact allowlist from current official docs and observed GTM/GA4/Ads/TikTok requests.
9. **Target Merchant market:** verify current apparel-required attributes for the intended target country/language.
10. **Merchant account prerequisites:** website verification, shipping/returns, diagnostics and Google Ads linking.

These are technical discoveries, not unresolved product requirements.

## 19. Authoritative Source Constraints Checked

The spec was checked against current official guidance at drafting time, including:

- Google Tag Manager `dataLayer`: https://developers.google.com/tag-platform/tag-manager/datalayer
- GA4 ecommerce Purchase: https://developers.google.com/analytics/devguides/collection/ga4/ecommerce
- Google Ads transaction IDs: https://support.google.com/google-ads/answer/6386790
- Merchant variant `item_group_id`: https://support.google.com/merchants/answer/6324507
- Merchant Scheduled Fetch: https://support.google.com/merchants/answer/14991445
- Merchant GTIN / brand / MPN: https://support.google.com/merchants/answer/6324461 and https://support.google.com/merchants/answer/160161
- TikTok GTM event tags: https://ads.tiktok.com/resources/help/article/how-to-create-tiktok-event-tags-with-google-tag-manager
- TikTok browser/server event deduplication: https://ads.tiktok.com/resources/help/article/event-deduplication

Version-sensitive details must be rechecked during `/plan`/`/build`; these links are evidence for the present spec, not permission to freeze vendor behavior forever.

## 20. Definition of Done Gate

This work is not complete merely because GTM loads or Merchant Center accepts a file.

Before `/ship`, both this spec and the repository-wide Definition of Done must pass, including:

- behavior tests for new logic;
- relevant full test/type/lint/build checks;
- runtime browser verification;
- compatibility verification for existing Meta behavior;
- security review for third-party scripts/configuration/secrets;
- diagnostics/observability for tracking/feed failures;
- a production disable/rollback path;
- human review before production activation.

## 21. Open Questions

No product-requirement blocker remains for `/plan`.

The items in **Required `/plan` Discoveries** must be answered from codebase evidence and current vendor documentation before implementation choices are locked.
