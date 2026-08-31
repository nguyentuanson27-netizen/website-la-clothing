# Spec: Marketing Analytics, Ads Tracking & Google Shopping

Status: Proposed — self-reviewed; implementation plan added; ready for human review before `/build`

This specification defines the approved product outcome and safety boundaries. The implementation-level choices are normative in `tasks/marketing-analytics-shopping-plan.md`. In particular, the plan intentionally narrows conceptual examples here where the current storefront cannot truthfully supply a variant-level fact yet.

## 1. Objective

Build a production marketing-measurement and catalog-export foundation for LA Clothing covering:

- Google Tag Manager (GTM);
- Google Analytics 4 (GA4);
- Google Ads Purchase conversion tracking;
- TikTok Pixel through GTM;
- existing direct Meta Pixel + Meta Conversions API;
- automated Google Merchant Center product data for Google Shopping.

The storefront and order system remain the source of truth. Tracking/catalog vendors consume canonical application facts; they must not invent commerce truth from DOM text, button clicks, mutable client state, duplicated pricing rules, or raw mirror ownership that conflicts with the public storefront projection.

## 2. Confirmed product decisions

1. GA4 + Google Ads + TikTok Pixel run through GTM.
2. Meta Pixel + Meta CAPI stay direct; no Meta-to-GTM migration in this scope.
3. TikTok Events API is a later phase.
4. One canonical commerce fact/event layer supplies new tracking destinations.
5. Purchase exists only for `OrderMirror.state === CONFIRMED`.
6. `OrderMirror.publicCode` is the canonical Purchase transaction/event ID.
7. Only approved production configuration may send real production vendor traffic.
8. Consent/tracking-policy abstraction is built now; visible consent UI is deferred; current production owner policy grants analytics/advertising tracking immediately.
9. Merchant Center uses public HTTPS product-data URL + Scheduled Fetch.
10. Merchant v1 is **standalone product/variant only**. Composite Merchant offers are deferred until a separate durable family/context identity design exists.
11. `brand = LA Clothing`; current SKU is intended as MPN only after presence/uniqueness/stability audit.
12. Pancake/internal barcode is not assumed to be GTIN.
13. Structurally valid zero-stock standalone offer remains in feed as `out_of_stock`.
14. Search indexing remains separately governed; this feature does not enable `SEARCH_INDEXING_ENABLED`.

## 3. Repository invariants to preserve

### Existing Meta

The repository already has direct browser Meta Pixel, App Router PageView handling, server Meta CAPI, confirmed-order Purchase, browser/server dedup using order code, and failure-safe delivery.

Compatibility constraints:

- no second Meta Pixel through GTM;
- Meta Purchase remains confirmed-order only;
- `publicCode` remains Meta Purchase event identity;
- current Meta content-ID semantics remain unless a focused correctness regression proves a value-source fix is needed;
- tracking failure never changes checkout success.

### Public order identity

`publicCode` is unique and non-PII. No vendor adapter may replace it with email/phone/session/cart identity for Purchase dedup.

### Storefront visibility and price

Storefront visibility follows current active/present storefront rules, not editorial `ProductContent.status === PUBLISHED`.

Current storefront sell price is authoritative. Where `pancakeRetailPrice` and `pancakeRetailPriceAfterDiscount` differ, current storefront behavior remains `PRICE_UNRESOLVED` until the upstream pricing contract is separately proven and canonical commerce logic changes first.

### Structural eligibility vs availability

A structurally valid option with zero stock may remain a Merchant offer as `out_of_stock`. `PRICE_UNRESOLVED`, malformed, forged, unreachable, ambiguous, or private options are structurally ineligible rather than merely out of stock.

### Composite storefront

Composite storefront/cart/checkout remain supported. A component may be sold through another parent PDP. Raw `VariantMirror.productId` and presentation `kindKey` are therefore not universal Merchant family identity.

For Merchant v1 this complexity is resolved conservatively: **all composite projections are excluded** with a bounded diagnostic such as `COMPOSITE_DEFERRED`. This does not disable composite analytics/storefront commerce.

### Purchase snapshot

`OrderLineSnapshot` preserves purchased `pancakeVariationId`, product name, color, size, quantity, unit price and line total. It does not guarantee SKU, product slug, Merchant item ID or composite projection context.

Immutable Purchase facts come from the snapshot. Current catalog enrichment is optional and must not override immutable price/quantity facts.

### SKU/MPN

SKU is nullable and not DB-unique. Merchant activation must prove emitted MPN presence, uniqueness and sufficient stability. Missing/duplicate/invalid values fail closed with diagnostics.

### Media

Merchant must reuse trusted normalized storefront media rather than bypassing the existing external-media trust boundary.

### Structured data

Current PDP JSON-LD is aggregate and is not exact variant authority. Merchant price/availability/condition automations start disabled until exact submitted-variant structured-data matching is proven.

### CSP/deployment

Third-party origins remain closed unless the reviewed integration actually needs them. Build/runtime configuration must stay aligned.

### Search exposure

ADR 0004 remains authoritative. Merchant crawlability must not silently enable organic indexing, canonical exposure policy, or sitemap exposure.

### Current runtime topology

Current VPS Compose declares a single `app` service instance behind the proxy path. Merchant v1 may use a process/runtime-scoped single-flight guard only while that topology remains true. If production is changed to multiple app replicas before Merchant activation, shared cross-replica cache/single-flight protection becomes a launch prerequisite.

## 4. Canonical commerce event contract

### 4.1 General rules

- Business code owns event truth.
- GTM routes/maps events; it does not reconstruct business logic.
- No DOM price scraping or generic click-derived Purchase/AddToCart.
- Tracking is fail-safe.
- Before each ecommerce push, clear/reset the previous ecommerce object; never replace initialized `window.dataLayer`.
- No customer name, phone, address, email, note, or other checkout PII enters the generic commerce dataLayer.

### 4.2 Product-level upper funnel vs selected variant

The storefront has legitimate states where a variant has **not** been selected. Therefore the implementation must distinguish product impressions from selected/committed variant items.

Product-level facts are used for:

- `view_item_list`;
- `select_item`;
- initial unselected PDP `view_item`.

Conceptually:

```ts
type CommerceProductImpression = {
  productExternalId: string;
  itemName: string;
  exactPriceVnd?: number;
  minimumPriceVnd?: number;
  maximumPriceVnd?: number;
  listId?: string;
  listName?: string;
  index?: number;
};
```

Rules:

- candidate product external ID is `pancakeProductId` after repository propagation;
- one visible card produces one product impression, not one impression per hidden variant;
- do not guess first/cheapest variant to obtain a `pancakeVariationId`;
- if all represented resolved options have one exact common price, that exact value may be mapped to vendor price/value;
- if prices form a range, min/max may remain canonical/custom facts but the minimum must not be reported as if it were a selected exact variant price;
- unresolved product price omits monetary vendor fields rather than fabricating values.

Selected/committed variant facts are used for cart/checkout/Purchase stages:

```ts
type CommerceVariantItem = {
  variantExternalId: string; // pancakeVariationId
  productExternalId?: string;
  itemName: string;
  unitPriceVnd: number;
  quantity: number;
  color?: string;
  size?: string;
  projectionContext?: string;
};
```

Exact variation identity begins only when the application actually has a concrete selected/committed variant.

### 4.3 Event vocabulary/truth points

Supported baseline events:

- `page_view`
- `view_item_list`
- `select_item`
- `view_item`
- `add_to_cart`
- `remove_from_cart`
- `view_cart`
- `begin_checkout`
- `purchase`

`add_shipping_info` and `add_payment_info` remain absent until the application has distinct accepted milestones worth measuring.

Truth rules:

- list/select/view_item use canonical rendered facts and the identity level described above;
- AddToCart only after successful server-authoritative mutation;
- RemoveFromCart only after committed cart mutation;
- ViewCart/BeginCheckout use resolved canonical cart/checkout state;
- Purchase only after confirmed-order truth.

### 4.4 Server-authoritative AddToCart

The browser must not report a price captured before awaiting the server action when the server re-resolves the product/option.

Successful AddToCart must return a bounded, non-PII item snapshot from the **same current server-resolved option that passed authorization and was committed**, including at minimum:

- `pancakeVariationId`;
- current resolved unit price;
- accepted quantity;
- item/product name required for analytics;
- color/size when available.

Canonical AddToCart is built only from those returned success facts. Failed mutations emit no AddToCart.

### 4.5 Atomic cart quantity events

Quantity update/removal analytics must use facts captured under the same serialized cart transaction that commits the mutation. Required success facts include previous/committed quantity for update and removed quantity for removal. Client/pre-read quantity is not authoritative for delta measurement.

### 4.6 Purchase truth

Purchase requires:

```text
OrderMirror.state === CONFIRMED
```

Never emit Purchase for DRAFT, VALIDATING, POS_SUBMITTING, REJECTED or SYNC_UNKNOWN.

Canonical Purchase facts include:

```ts
type CommercePurchase = {
  transactionId: string; // publicCode
  eventId: string;       // publicCode
  currency: "VND";
  merchandiseValueVnd: number;
  shippingVnd: number;
  totalVnd: number;
  items: CommerceVariantItem[];
};
```

Purchased price/quantity/variation identity comes from immutable order snapshots. Refresh/revisit reuses the same transaction/event ID.

### 4.7 Destination value semantics

- GA4 Purchase value = merchandise item sum; shipping separate.
- Meta keeps total-order Purchase semantics in this scope.
- Google Ads Purchase value remains owner decision: merchandise-only vs total order.
- TikTok mapping is re-verified at build time; Purchase event identity remains `publicCode`.

Intentional arithmetic differences must be documented/tested.

## 5. GTM / GA4 / Ads / TikTok requirements

### 5.1 No GTM load before reviewed immutable version

The implementation plan owns a strict interlock:

- PR-A prepares dataLayer, consent defaults/policy, page-view events and desired tracking configuration;
- PR-A must not load a GTM script/iframe in any requested mode and must not open new Google/TikTok CSP origins for the new integration;
- both requested `preview` and requested `live` remain operationally no-GTM until T8/PR-C;
- T8 creates/reviews an immutable saved GTM container version and only then adds the actual GTM loader/CSP requirements.

This prevents a partially merged application from loading an old/unreviewed mutable container.

### 5.2 Immutable GTM version evidence

Before preview/live enablement, record:

- container ID;
- exact saved container version number/ID;
- export JSON from that exact version;
- immutable repository identity/checksum for the reviewed export.

Every production GA4/Ads/TikTok tag in that version must require application `la_tracking_mode == live`.

Final preview must preview that exact saved version, not a later mutable workspace. Live publish must publish the same reviewed version. Any later console edit requires a new version/export/review cycle.

Tag Assistant is verification evidence, not a network-isolation control.

### 5.3 Page views

Application code owns canonical initial/App Router `page_view`. The GTM/GA4 configuration must disable overlapping automatic/history page-view behavior so one navigation is counted once.

### 5.4 Consent compatibility

A vendor-neutral consent abstraction exists from the start. Current owner policy grants tracking immediately, with UI hidden. Google consent defaults must be established/queued before measurement. Later visible consent UI/default-denied behavior must be possible without changing commerce event contracts.

### 5.5 Google Ads

Purchase is the required primary conversion in this phase. Use `publicCode` as transaction ID and preserve conversion-linking functionality. Enhanced Conversions/customer PII are out of scope.

### 5.6 TikTok

TikTok Pixel runs through GTM. Purchase/CompletePayment uses `event_id = publicCode` now so a later Events API implementation can share the same identity.

## 6. Google Merchant Center requirements

### 6.1 Delivery

Use a public HTTPS GET-only product-data route and Merchant Center Scheduled Fetch. Do not use Merchant API realtime sync in v1.

### 6.2 Standalone identity only

V1 candidate identifiers:

```text
id            = pancakeVariationId
item_group_id = pancakeProductId (for standalone variant family)
brand         = LA Clothing
mpn           = audited current SKU
gtin          = omitted unless real assigned valid GTIN exists
```

Before activation, `pancakeVariationId` and `pancakeProductId` require evidence of lifecycle durability beyond current DB uniqueness/upsert behavior.

Composite Merchant offers are excluded in v1.

### 6.3 Exact variant landing URL

Standalone feed item links to:

```text
/shop/<slug>?variant=<pancakeVariationId>
```

The query may preselect only a currently valid public standalone option and must show matching visible price/color/size/image. Forged/stale/private/composite values fail closed.

Organic canonical/search exposure remains the base PDP contract; the variant query does not create independent indexing policy.

### 6.4 Feed truth

Feed mapper derives from canonical storefront facts:

- active/present public standalone product/option;
- current storefront price resolver;
- trusted media;
- stock mapped separately to `in_stock`/`out_of_stock`;
- truthful required apparel facts;
- safe customer-facing description source;
- audited identifiers.

Never infer GTIN from Pancake barcode.

### 6.5 Safe serialization

External catalog/editorial text is untrusted input. Use standards-aware serialization; escape XML correctly; reject/normalize illegal controls/malformed URLs/oversized fields; parse generated output in tests. No hand-built raw XML interpolation.

### 6.6 Public route resource and amplification boundary

The public route must not regenerate a bounded-but-expensive feed for every request.

Initial v1 envelope:

```text
MAX_MERCHANT_OFFERS             = 5_000
MAX_MERCHANT_FEED_BYTES         = 16 MiB
MAX_MERCHANT_DB_ROUND_TRIPS     = 8 per heavy generation
MERCHANT_FEED_CACHE_TTL_SECONDS = 300
```

Requirements:

- complete successful serialized feed is cached under a fixed configured-shop/feed-schema key;
- request query/header noise must not create unbounded cache dimensions;
- repeated GETs within TTL perform no additional heavy DB generation;
- concurrent cold requests are collapsed by a tested single-flight mechanism for the current single-app-service runtime;
- if production topology changes to multiple app replicas, activation is blocked until shared cross-replica cache/single-flight protection is proved;
- serialization maintains incremental UTF-8 byte accounting and aborts before exceeding 16 MiB; do not first build an unbounded body and only then measure it;
- overflow/failure returns non-success (target 503), never truncated/partial 200;
- failed rebuild cannot publish/cache partial output as successful feed;
- no N+1 per-offer query path.

The current repo does not enable Next.js Cache Components. `/build` must re-check the current Next 16.2.x supported caching API; do not enable a framework-wide cache model merely for this route unless separately justified.

### 6.7 Merchant Automations

Start automatic price/availability/condition updates disabled until exact variant-level structured-data matching is proven. Current aggregate PDP Offer is not variant authority.

## 7. Security/privacy requirements

- Generic dataLayer contains no checkout/customer PII.
- No Enhanced Conversions in this phase.
- Secrets remain server-only; GTM/GA/Ads/TikTok public IDs are configuration identifiers, not authorization secrets.
- Tracking failures are no-op for commerce.
- GTM CSP changes are least privilege; no convenience production `unsafe-eval`, wildcard origins or unreviewed Custom HTML/JS.
- Merchant route has fixed configured source scope, finite work limits, caching/single-flight protection and no arbitrary request-driven upstream fetch.
- External catalog text cannot inject markup/XML/script.

## 8. Environment/activation policy

### Production

After the corresponding reviewed implementation/activation gates:

- Meta direct continues;
- GTM may load the exact approved container version;
- GA4/Ads/TikTok production destinations require `la_tracking_mode=live`;
- Merchant Scheduled Fetch may use production feed.

### Local/CI/staging before GTM activation

- no new real production vendor traffic;
- PR-A has no GTM loader;
- dataLayer can be tested locally without third-party delivery.

### Preview after T8

- only exact reviewed saved GTM version;
- production destination tags remain live-gated;
- isolated test/debug destinations only;
- zero production destination traffic must be demonstrated.

## 9. Acceptance criteria summary

Implementation is ready for live activation only when:

1. canonical product-vs-variant event contracts pass focused tests;
2. AddToCart uses server-returned committed variation/price/quantity facts;
3. cart delta facts are transactionally authoritative;
4. Purchase is confirmed-only and uses `publicCode` identity;
5. exact GTM saved version/export has been reviewed and previewed; production tags all have live guard;
6. one GA4 page view per navigation is demonstrated;
7. existing Meta direct behavior/dedup remains healthy;
8. standalone Merchant identity/MPN/durability audit is green;
9. exact standalone variant deep links match feed-visible facts;
10. Merchant feed serialization/resource/cache/single-flight tests pass;
11. current production topology is verified; multi-replica topology has shared cache/single-flight protection before activation;
12. Merchant diagnostics/crawler checks are acceptable;
13. `SEARCH_INDEXING_ENABLED=false` remains unchanged unless separately approved;
14. owner decisions for Ads value, Merchant market/apparel facts and vendor account configuration are resolved before affected activation;
15. repository Definition of Done and exact-head verification gates are satisfied.

## 10. Explicitly out of scope / deferred

- Meta Pixel migration into GTM.
- Meta CAPI replacement/content-ID redesign.
- TikTok Events API.
- Google Enhanced Conversions / hashed customer PII.
- Merchant API realtime sync.
- Composite Merchant offer/item-group design.
- Visible consent banner/default-denied policy.
- Search-indexing/permanent-domain changes.
- Product pricing-policy change for retail vs after-discount mismatch.
- Unrelated SEO/catalog/admin refactor.

## 11. Planning handoff

Implementation source of truth is `tasks/marketing-analytics-shopping-plan.md`, with executable checklist in `tasks/marketing-analytics-shopping-todo.md`.

The implementation lifecycle remains:

```text
PR-A tracking preparation (no GTM load)
→ PR-B commerce browser truth
→ PR-C Purchase + immutable GTM version/loader
→ PR-D Merchant identity/deep-link
→ PR-E cached bounded Merchant feed
→ PR-F activation/final verification
```

No runtime implementation belongs in this docs-only PR.