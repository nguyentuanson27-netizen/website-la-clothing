# Spec: Marketing Analytics, Ads Tracking & Google Shopping

Status: Proposed — self-reviewed twice; implementation plan added; ready for human review before `/build`

## 1. Objective

Build a production marketing-measurement and catalog-export foundation for LA Clothing covering:

- Google Tag Manager (GTM);
- Google Analytics 4 (GA4);
- Google Ads Purchase conversion tracking;
- TikTok Pixel through GTM;
- the existing direct Meta Pixel + Meta Conversions API integration;
- an automated Google Merchant Center product feed for Google Shopping.

The storefront and order system remain the source of truth. Tracking and catalog vendors consume canonical application facts; they must not invent commerce truth from DOM text, generic clicks, duplicated pricing rules, or raw mirror-table assumptions that conflict with the public storefront projection.

### Confirmed product decisions

1. GA4 + Google Ads + TikTok Pixel run through GTM.
2. Meta Pixel + Meta CAPI stay direct; no Meta-to-GTM migration in this scope.
3. TikTok Events API is a later phase, not part of this implementation.
4. One canonical commerce-event/fact layer supplies the new tracking destinations.
5. `purchase` exists only for `OrderMirror.state === CONFIRMED`.
6. `OrderMirror.publicCode` is the canonical Purchase transaction/event ID.
7. Only the real production storefront may send real production vendor traffic.
8. A central consent/tracking-policy abstraction is built now, but no consent UI is displayed initially; current owner policy grants analytics and advertising tracking in production.
9. Merchant Center uses a public HTTPS product-data URL + Scheduled Fetch.
10. Merchant offers represent real public storefront option/projection contexts; composite products must not be grouped from raw database ownership alone.
11. `brand = LA Clothing`; current SKU is intended as manufacturer part number (`mpn`) and must pass a presence/uniqueness/stability audit before feed activation.
12. Pancake-generated/internal barcode is not assumed to be GTIN; `gtin` is omitted unless a real assigned valid GTIN exists.
13. An otherwise structurally valid out-of-stock offer remains in the feed with `availability = out_of_stock`.

## 2. Repository Invariants This Feature Must Preserve

### Stack

- Next.js 16.2.11
- React 19.2.0
- TypeScript 5.9.x
- Prisma 7.9.1
- PostgreSQL
- pnpm 11.4.0

### Existing Meta behavior

The repository already implements Meta directly with:

- browser Meta/Facebook Pixel;
- App Router PageView handling;
- failure-safe browser delivery;
- server-side Meta Conversions API;
- browser/server Purchase deduplication using the order code as event ID;
- one-time browser Purchase behavior;
- Purchase only for confirmed orders.

Compatibility constraints:

- Meta Purchase value remains `OrderMirror.totalVnd` in this scope.
- Meta product `content_ids` remain product slug when the mirror exists, with Pancake variation ID fallback.
- no second Meta Pixel is added through GTM.
- any shared helper introduced beneath Meta must preserve observable behavior and pass regression tests.

### Public order-code identity

Current checkout runtime generates public order codes as `LA-${randomUUID()}`. The database also enforces `OrderMirror.publicCode` uniqueness.

Consequences:

- `publicCode` is a non-PII, stable per-order identifier suitable as the canonical Purchase transaction/event ID;
- vendor adapters must not replace it with phone/email/session/cart identifiers;
- refresh/revisit of the same confirmed order must reuse the same `publicCode`, never mint a new Purchase ID.

### Storefront product visibility is not editorial publication

Current storefront product visibility is driven by canonical storefront repository rules and, at baseline, requires the configured shop plus:

```text
ProductMirror.isPresent === true
ProductMirror.isActive === true
```

`ProductContent.status === PUBLISHED` is an editorial-copy publication boundary, not a product-visibility gate. Draft/reviewed/missing editorial content must not automatically make an otherwise storefront-visible product disappear from Merchant.

Merchant still needs compliant customer-facing content. `/plan` must choose an approved description source/fallback or deliberately exclude a record with diagnostics; it must not redefine public product visibility to solve a feed-content problem.

### Current storefront price authority

The current storefront resolves a sell price only when `pancakeRetailPrice` and `pancakeRetailPriceAfterDiscount` are both usable and equal. If they differ, storefront logic returns no resolved price and the option becomes `PRICE_UNRESOLVED`.

Therefore Merchant, live-catalog analytics item values, and landing-page assertions must reuse the current storefront resolved-price policy rather than independently preferring `pancakeRetailPriceAfterDiscount`.

Any future pricing-policy change belongs in canonical commerce code first; vendor mappings follow it afterward.

### Storefront availability versus structural eligibility

The storefront can represent an option that is structurally valid but temporarily unavailable, such as `OUT_OF_STOCK`.

Feed logic must distinguish:

- **structural/catalog eligibility**: the public option exists, has stable identity, valid price/content/media/URL, and is not malformed; from
- **current availability**: stock may make the otherwise valid offer `in_stock` or `out_of_stock`.

A `PRICE_UNRESOLVED`, forged, unreachable, ambiguous, or otherwise structurally invalid option is not equivalent to a merely out-of-stock option.

### Composite product projection

The storefront supports standalone and composite projections. A component variant owned by another `ProductMirror` may legitimately be shown and purchased through a parent composite PDP.

Consequences:

- raw `VariantMirror.productId` is not sufficient to determine Merchant grouping/landing context for every public option;
- candidate Merchant offers must derive from public storefront projection/options, including structurally valid out-of-stock options;
- a component variant must never be advertised under a URL/grouping that contradicts the page where the shopper actually sees it;
- `/plan` must define stable identifiers and deep-link semantics for composite options before composite offers are activated.

### Purchase snapshot boundary

`OrderLineSnapshot` preserves purchased `variantId`, `pancakeVariationId`, product name, color, size, quantity, unit price and line total. It does not snapshot SKU, product slug, Merchant item ID, or composite projection context.

Therefore:

- immutable Purchase price/quantity/name/variation facts come from the order-line snapshot;
- Purchase tracking must not require a field that cannot be reconstructed reliably after catalog mutation/deletion;
- optional current-catalog enrichment may never override immutable snapshot price/quantity facts and must fail safely if current mirror data is absent;
- if Merchant item identity requires composite context that is not reconstructible from the order snapshot, `/plan` must choose a context-independent identity strategy or surface the need for an explicitly approved snapshot/schema change;
- do not claim durable Purchase-to-Merchant item matching until this reconstruction invariant is proven.

### SKU / MPN boundary

`VariantMirror.sku` is nullable and indexed but not database-unique. The product decision is to use current SKU as MPN, but feed activation must first prove the emitted SKU values are present, stable enough for the intended lifecycle, and unique wherever manufacturer-part identity requires uniqueness.

Missing/duplicate/invalid SKU must produce an explicit diagnostic and must not silently create ambiguous MPN identity.

### Media trust boundary

Product media is already validated through the storefront trusted-media contract. Merchant must reuse normalized trusted-media output; it must not bypass the reviewed HTTPS Pancake CDN validation merely because Merchant accepts a URL.

### Existing product structured data is aggregate, not variant authority

Current product JSON-LD emits at most one product-level `Offer` for the PDP. It only emits that offer when all represented option prices resolve to one common price and unavailable states are stock-only. The current offer URL is the product PDP URL and does not identify SKU/MPN/color/size/projection context per Merchant variant.

Therefore:

- the current JSON-LD must not be assumed to be exact variant-level Merchant authority;
- Merchant automatic item updates must not be enabled blindly for variant offers until structured-data matching is proven for the submitted option URL/identity;
- `/plan` must either define the smallest structured-data change needed for exact submitted offers, or explicitly configure Merchant automations so current aggregate markup cannot overwrite correct variant feed data;
- feed, visible landing-page data, and any structured data used by Merchant must agree for price, availability, currency and condition.

### Existing CSP and deployment behavior

The repository builds a fail-closed CSP from configured tracking state and keeps third-party origins closed when the corresponding integration is absent. Build-time and runtime tracking configuration must remain aligned so a runtime tag is not rendered behind a baked CSP that blocks it.

### Existing search-exposure policy

ADR 0004 approves `la.lanadesign.vn` as the temporary production origin but requires:

```text
SEARCH_INDEXING_ENABLED=false
```

until a permanent domain and separate human indexing approval exist.

Google Shopping work must not turn on organic search indexing, public canonicals, or sitemap exposure as a side effect. Merchant launch requires submitted pages/images to be fetchable by Google's relevant crawlers under the approved crawl boundary. Any change to `SEARCH_INDEXING_ENABLED` remains a separate explicit owner decision.

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
Pancake mirror data
      |
      v
canonical storefront visibility / projection / price / stock / media
      |
      v
Merchant feed adapter + safe serializer
      |
      v
public HTTPS product-data URL
      |
      v
Merchant Center Scheduled Fetch
```

GTM does not generate or own the Merchant catalog.

## 4. Canonical Commerce Event Contract

### Principles

- Business code owns event truth.
- `dataLayer` carries deterministic structured facts from application code to GTM.
- GTM is a routing/mapping layer, not a second commerce-rules engine.
- Do not infer ecommerce events from button text, CSS selectors, DOM structure, or generic click triggers.
- Tracking failure must be a no-op from the shopper's perspective.
- Money, item identity, quantity, and order state come from typed application data.
- Do not emit a vendor funnel stage merely because a vendor recommends the event name; emit it only when LA Clothing has a real corresponding milestone.

### dataLayer state discipline

The application-side helper must preserve GTM's shared data layer rather than replacing it after initialization.

For each ecommerce event, clear the previous ecommerce object immediately before pushing the new one, or use an equivalently proven reset mechanism:

```js
dataLayer.push({ ecommerce: null });
dataLayer.push({ event: "add_to_cart", ecommerce: { /* current event only */ } });
```

Requirements:

- a later event must not inherit `items`, `value`, `shipping`, `transaction_id`, or other keys from an earlier event;
- event construction is immutable/deterministic for the facts supplied;
- tests must prove event B is unchanged by whether event A fired before it;
- never clear or reassign the entire `window.dataLayer` in a way that destroys GTM state/listeners.

### Event vocabulary and truth points

The contract supports:

- `page_view`
- `view_item_list`
- `select_item`
- `view_item`
- `add_to_cart`
- `remove_from_cart`
- `view_cart`
- `begin_checkout`
- `add_shipping_info` when a real shipping milestone exists
- `add_payment_info` when a real payment-selection milestone exists
- `purchase`

Emission rules:

- `view_item_list`: after rendering/obtaining a canonical storefront list, using the list facts actually shown.
- `select_item`: from an intentional product/list selection with the canonical item identity available.
- `view_item`: from the canonical PDP projection actually shown, not from DOM scraping.
- `add_to_cart`: only after the server-authoritative cart mutation succeeds; report the accepted variant/context and accepted quantity.
- `remove_from_cart`: only after the authoritative remove/update mutation succeeds; report the removed quantity/facts actually accepted.
- `view_cart`: from resolved server-authoritative cart state.
- `begin_checkout`: from a real checkout state with a valid resolved cart, not from a generic checkout-button click that may fail validation/navigation.
- `add_shipping_info`: current checkout is a one-page guest COD flow and does not automatically imply a distinct shipping-information milestone. Do not synthesize this event unless `/plan` identifies an authoritative accepted-shipping transition worth measuring.
- `add_payment_info`: omitted until a real payment-selection milestone exists.
- `purchase`: only from confirmed order truth defined below.

### Live-catalog item facts

Conceptually, pre-purchase events may expose:

```ts
type CommerceItem = {
  variantExternalId: string;
  sku?: string;
  productId?: string;
  productSlug?: string;
  itemName: string;
  unitPriceVnd: number;
  quantity: number;
  color?: string;
  size?: string;
  projectionContext?: string;
};
```

Rules:

- use stable external identity available for the actual public option;
- new Google/TikTok product matching aligns with Merchant identity only where that identity is stable and reproducible for the event being sent;
- composite context may be carried for live browsing/cart events when known;
- SKU is optional in the canonical item contract because historical Purchase snapshots do not currently guarantee it;
- existing Meta content-ID semantics remain unchanged.

### Purchase item facts

A Purchase adapter starts from immutable `OrderLineSnapshot` facts, conceptually:

```ts
type PurchaseItemFacts = {
  pancakeVariationId: string;
  itemName: string;
  unitPriceVnd: number;
  quantity: number;
  color?: string;
  size: string;
};
```

Current-catalog enrichment such as SKU, slug, or product metadata is optional and must be explicitly marked as enrichment. Missing enrichment must not invalidate an otherwise reportable confirmed Purchase unless a specific vendor strictly requires it.

If the chosen Merchant item ID cannot be derived from immutable purchase facts, `/plan` must not promise post-purchase Merchant matching without resolving that data-model gap.

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
  eventId: string;             // OrderMirror.publicCode
  currency: "VND";
  merchandiseValueVnd: number;
  shippingVnd: number;
  totalVnd: number;
  items: PurchaseItemFacts[];
};
```

Requirements:

- `transactionId = OrderMirror.publicCode`;
- `eventId = OrderMirror.publicCode` for destinations using an event ID;
- purchased quantities/prices come from immutable order-line snapshots;
- invalid/malformed money that cannot be represented safely fails closed for that vendor event rather than fabricating a value;
- refresh/revisit of one order retains the same transaction/event identity.

### Destination-specific value semantics

The canonical layer exposes business facts; adapters map vendor semantics explicitly.

- **GA4:** `purchase.value` is merchandise item value (`price × quantity` sum); shipping is sent separately as `shipping`.
- **Meta:** preserve current `OrderMirror.totalVnd` Purchase value in this scope.
- **Google Ads:** conversion value remains an explicit owner/plan decision: merchandise-only versus `OrderMirror.totalVnd`. The chosen convention must be documented and tested before activation.
- **TikTok:** `/plan` must verify current event/value/content requirements, while Purchase dedup identity is already fixed to `publicCode`.

Intentional cross-platform arithmetic differences must be documented and tested.

## 5. Destination Requirements

### Google Tag Manager

Production traffic and GTM preview are separate concerns.

- In **live** mode, the reviewed GTM web container may load only when the real-production gate, tracking policy, and valid build/runtime configuration permit it.
- Normal local/CI/test/staging operation keeps production vendor delivery disabled.
- An explicit **preview/test** mode may load GTM for Tag Assistant/debugging only when production destinations are provably blocked or replaced with isolated test destinations; preview mode must not contaminate production GA4/Ads/TikTok data.
- `/plan` must define one centralized mode contract such as `disabled | preview | live`; do not scatter hostname checks across tags/components.
- Push deterministic application events into `window.dataLayer`.
- Use GTM custom-event triggers/native tags or reviewed templates for routing.
- Do not store pricing, inventory, order-state, product-visibility, or Purchase-truth logic in GTM.
- Keep a reviewable GTM container/workspace export or equivalent versioned configuration record.
- Treat GTM configuration changes as production changes: no unreviewed Custom HTML/Custom JavaScript tags.
- Do not add production `unsafe-eval` merely to support GTM Custom JavaScript. Prefer native tags, variables, and reviewed Custom Templates where possible.
- `/plan` must explicitly decide whether the standard GTM `<noscript>` iframe is included; if it is, CSP `frame-src` requirements must be reviewed rather than accidentally relying on `default-src`.

### GA4

Map the canonical contract to current GA4-recommended ecommerce parameters including, where applicable:

- `transaction_id`
- `currency`
- `value`
- `shipping`
- `items[]`
- item ID/name/price/quantity
- useful variant metadata when available.

#### Page-view single-source rule

`page_view` must have exactly one GA4 authority.

`/plan` must choose and document one of these equivalent patterns:

1. canonical application `page_view` events mapped through GTM, with Google automatic initial/history page-view behavior disabled as required; or
2. Google/GTM automatic/history-based SPA page views, with application mapping prevented from sending a second GA4 `page_view`.

Whichever pattern is chosen, verify initial load and App Router client navigation. Manual page views must never coexist with enabled automatic/history page views in a way that double-counts navigation.

### Google Ads

- Confirmed Purchase is the minimum conversion action in scope.
- Use `OrderMirror.publicCode` as the unique order/transaction ID.
- Conversion ID/label should live in GTM when only GTM consumes them.
- Ensure Google Ads conversion-linking functionality is enabled in the final Google tag/GTM configuration. `/plan` must determine whether the selected Google tag setup already supplies the required linker behavior or whether an explicit Conversion Linker tag is required.
- Product/remarketing identifiers should align with Merchant item identity only when that identity is reproducible from the event context.
- Secondary conversion actions require explicit `/plan` inclusion.
- Enhanced Conversions/user-provided data remain out of scope.

### TikTok Pixel

- Deploy through GTM in this phase.
- Map canonical application events to current TikTok event names in GTM.
- At minimum map product view, AddToCart, checkout initiation, and Purchase/CompletePayment where the corresponding canonical event exists.
- TikTok Purchase/CompletePayment must send `event_id = OrderMirror.publicCode`.
- Repeated browser copies of the same Purchase therefore retain the same event name and `event_id`, allowing TikTok's Pixel-to-Pixel deduplication behavior to recognize overlap.
- Network/ad-blocker/pixel failure must not break the storefront.
- Implementation must re-check current official TikTok GTM/event parameter guidance during `/plan`/`/build`.

### TikTok Events API

Out of scope now.

A future server copy of Purchase must use the same `event_id = OrderMirror.publicCode` as its browser twin so Pixel/Events API deduplication can operate without changing the canonical order identity.

### Meta Pixel + Meta CAPI

Keep the existing direct architecture:

- no second Meta Pixel inside GTM;
- preserve current CAPI behavior;
- preserve browser/server Purchase deduplication;
- preserve one-time browser Purchase behavior;
- preserve current Meta value and content-ID semantics;
- if a shared helper is introduced under Meta later, regression tests must prove equivalent observable behavior.

## 6. Consent / Tracking Policy

### Current owner policy

Initial production behavior is:

```text
visible consent UI   = OFF
analytics            = granted
advertising          = granted
```

This is a product policy choice, not a claim of legal suitability for every market.

### Domain-level abstraction

Application code may keep a vendor-neutral abstraction such as:

```ts
type TrackingConsent = {
  analytics: "granted" | "denied";
  advertising: "granted" | "denied";
};
```

Do not scatter `always true` tracking checks through components.

### Google Consent Mode adapter

The Google adapter must explicitly map domain policy to Google's current consent types, including:

```text
analytics   -> analytics_storage
advertising -> ad_storage
advertising -> ad_user_data
advertising -> ad_personalization
```

Requirements:

- establish the Google consent default before Google measurement tags/events are allowed to fire;
- later policy changes update consent through one central adapter;
- commerce functionality is independent of consent;
- vendor-specific consent keys stay out of the core commerce-event model;
- visible consent UI/default-denied behavior remains a future separately approved change.

## 7. Environment, Configuration & CSP

### Tracking modes and real-production gate

`NODE_ENV === "production"` is insufficient by itself. `/plan` must define one centralized deployment-aware tracking-mode resolver.

Conceptually:

```text
disabled -> no third-party delivery
preview  -> explicit debug/test GTM mode; production destinations blocked
live     -> real production origin only; reviewed production destinations enabled
```

Requirements:

- the current temporary production origin is `la.lanadesign.vn`; future permanent-domain cutover updates the live-origin policy deliberately;
- local, CI, test, preview deployments and staging must never send to production analytics/ad destinations;
- preview mode is opt-in and auditable, not inferred merely from a query string or untrusted request Host;
- server/build configuration decides whether third-party origins need to be opened in CSP;
- browser-provided hostname alone is not a trust boundary for enabling live delivery.

### Configuration ownership

If GA4, Google Ads, and TikTok are configured entirely in GTM, application configuration should conceptually need only GTM/tracking-mode settings. Exact env names must follow repository conventions.

GA4 measurement IDs, Ads IDs/labels, and TikTok Pixel IDs should remain inside GTM when no application code consumes them.

No access token/API secret may be exposed in `NEXT_PUBLIC_*`, `dataLayer`, HTML, or client logs.

### CSP

Preserve the current fail-closed approach:

- third-party origins open only for reviewed configured modes that require them;
- no wildcard script/connect/image sources;
- build-time CSP and runtime rendered tag configuration agree;
- use current official origin requirements plus actual Tag Assistant/browser network evidence;
- do not add `unsafe-eval` merely for convenience;
- prefer nonce-compatible/native/template approaches where practical without turning this feature into an unrelated CSP rewrite;
- review `frame-src` if a GTM noscript iframe is included;
- preview/test origins must not accidentally become permanent production allowances without review;
- verify final browser console/network behavior before activation.

## 8. Google Merchant Center Feed

### Delivery and format

Initial delivery:

```text
public HTTPS product-data URL
        +
Merchant Center Scheduled Fetch
```

No Merchant API realtime sync in this phase.

Use a currently supported Merchant product-data format. XML/RSS 2.0 is preferred unless `/plan` finds a stronger repository-specific reason for another supported format.

The endpoint must be deterministic, bounded, cache-aware where appropriate, GET-only for this public data source, and fetchable without a secret embedded in the URL. User-supplied query parameters must not be able to turn the route into an arbitrary URL fetcher or unbounded catalog query.

### Source of truth: public storefront option/projection, not raw mirror ownership

Merchant candidates derive from public storefront product detail/projection facts.

For **standalone** products, a structurally eligible storefront variant option normally maps to one Merchant offer whether currently in stock or temporarily out of stock.

For **composite** products, a raw component `VariantMirror` may be exposed through a parent PDP projection. `/plan` must define:

- which projection options become Merchant offers;
- whether one component can appear in more than one public projection context;
- the stable Merchant `id` for each activated context;
- the stable `item_group_id` representing the public variant family;
- a landing URL that preselects/identifies the exact submitted option;
- how title/image/color/size/price are represented so the landing page matches the feed;
- whether the chosen offer identity remains reconstructible for post-purchase tracking from existing snapshots.

Composite Merchant offers remain disabled until this mapping is deterministic and testable. Do not blindly use `VariantMirror.productId` as Merchant grouping authority.

### Merchant identifiers

For every emitted offer:

- `id`: stable external offer/item identifier;
- `item_group_id`: stable public variant-family identifier where variants are grouped;
- `brand`: `LA Clothing`;
- `mpn`: current audited SKU;
- `gtin`: omit unless a real valid assigned GTIN exists.

Pancake internal/auto-generated barcode must not be promoted to GTIN without evidence that it is an assigned GTIN.

For standalone variants, `/plan` should verify durability of candidate IDs in this order:

1. `pancakeVariationId` if durable across lifecycle/resync;
2. SKU if SKU immutability and uniqueness are proven;
3. local immutable variant ID only if appropriate as an external identity.

Composite contexts may require a stable context-aware ID rather than one raw variant ID. Once Merchant IDs are live, changing them casually is prohibited.

### MPN validation

Before activation, audit SKU values used as MPN for:

- non-empty/valid representation;
- uniqueness appropriate to LA Clothing manufacturer-part identity;
- stability across expected Pancake sync/lifecycle behavior;
- collision behavior across standalone and composite contexts.

A missing/duplicate/ambiguous SKU must be excluded with diagnostics until resolved; do not submit misleading MPN data.

### Structural eligibility

A product may participate only if reachable through canonical public storefront behavior. Current baseline product visibility is:

```text
ProductMirror.isPresent === true
ProductMirror.isActive === true
```

`ProductContent.status === PUBLISHED` is not an additional visibility condition.

A candidate offer must also have, through canonical storefront/projection policy:

- a real present/active underlying variant;
- deterministic non-forged public option mapping;
- an audited valid SKU for MPN;
- a resolved storefront price;
- a valid production landing URL;
- trusted product media;
- a usable approved Merchant description;
- the current required target-market attributes.

`pancakeIsHidden` and `pancakeIsLocked` exist in the mirror but must not become Merchant-only exclusion rules unless canonical storefront policy actually uses them or `/plan` establishes a new shared policy. The feed must not silently invent a second visibility model.

### Availability

Availability is evaluated after structural eligibility. An otherwise valid offer remains in the feed when stock reaches zero:

```text
canonical sellable stock > 0  -> in_stock
canonical sellable stock <= 0 -> out_of_stock
```

Do not exclude an offer solely because current storefront `purchasable` state is false due to `OUT_OF_STOCK`.

Stock aggregation must reuse the storefront rule and describe the exact submitted option/context.

### Price

Merchant `price` must equal the value displayed/used by storefront for the exact submitted option.

Current rule:

- use canonical `resolveStorefrontPrice`/projection price;
- if retail and after-discount prices differ under current storefront logic, the option is `PRICE_UNRESOLVED` and is structurally ineligible for Merchant;
- do not independently choose `pancakeRetailPriceAfterDiscount` in the feed.

### Landing URLs

Every submitted URL must:

- resolve on the approved production origin;
- identify/preselect the exact submitted variant/projection option where multiple choices exist;
- display matching price, availability, color, size, and image;
- remain stable across normal navigation/resync;
- be fetchable by Google's relevant crawlers.

If current PDP routing cannot express the selected standalone/composite option, `/plan` must define the smallest stable query/path contract before Merchant activation.

### Images

Reuse the storefront trusted-media resolver/contract:

- HTTPS trusted media only;
- no placeholders;
- no bypass of the existing Pancake CDN allowlist/URL validation;
- variant/context-specific image when reliable imagery exists;
- image must be fetchable by Google.

### Description/content

Merchant requires a real description even when storefront editorial content is not published. `/plan` must define approved source priority from repository-owned fields, for example published editorial copy and/or a reviewed/normalized source-description fallback.

Do not expose draft editorial content merely to satisfy Merchant. Do not blindly pass through source HTML/promotional markup; normalize to the allowed Merchant text contract. If no compliant safe description exists, omit the offer and surface a diagnostic.

### Scheduled Fetch freshness and Merchant automations

Scheduled Fetch is the approved initial delivery mechanism, but feed freshness must be explicit.

`/plan` must:

- identify how often mirror price/stock can materially change;
- choose a Scheduled Fetch cadence that keeps Merchant data acceptably close to storefront state;
- coordinate fetch timing with the catalog-sync/update cycle where practical;
- verify Merchant's automatic updates/Automations settings rather than assuming defaults are safe;
- treat automatic updates as a temporary mismatch correction mechanism, not a replacement for regular accurate feed updates;
- if actual price/stock volatility cannot be supported safely by Scheduled Fetch + verified automations, surface that as a launch limitation. Merchant API realtime sync remains out of scope unless the owner expands scope.

### Structured-data compatibility for automatic updates

Before relying on automatic price/availability updates:

- verify the submitted offer's landing page exposes structured data matching the exact offer identity/context;
- feed price/availability/currency/condition, visible landing-page values, and structured data must agree;
- current aggregate PDP `Offer` must not be treated as variant-specific proof when it cannot identify the submitted size/color/context;
- if variant-specific structured data is not implemented in this phase, configure Merchant automations to avoid unsafe corrections and rely on the chosen Scheduled Fetch cadence plus diagnostics.

### XML / structured-feed serialization boundary

Pancake names, source descriptions, editorial text, color, size, SKU, and URLs are external or mutable data. Feed generation must use a proper serializer/escaping strategy rather than manual XML string concatenation.

Requirements:

- escape XML-reserved characters correctly;
- reject/normalize illegal control characters and malformed Unicode according to the chosen serializer contract;
- validate required URLs/IDs/price/currency before serialization;
- omit unsupported empty fields rather than writing structurally invalid elements;
- bound input lengths/counts where upstream data could inflate generation;
- tests include `<`, `>`, `&`, quotes, Unicode, invalid control characters, malformed URLs, and oversized fields;
- generated XML is parsed again in tests with the selected standards-aware parser before it is considered valid.

### Crawlability versus organic indexing

Merchant requires submitted pages/images to be fetchable. That does not authorize changing ADR 0004.

For the current temporary production domain:

- keep `SEARCH_INDEXING_ENABLED=false`;
- do not enable public canonical/sitemap exposure as part of this feature;
- verify current `robots.txt`/edge behavior permits the crawlers Merchant needs to fetch submitted pages/images;
- if Merchant diagnostics show existing noindex/crawl configuration prevents approval, surface a launch blocker requiring a separate owner decision rather than silently weakening SEO policy.

### Merchant account setup outside source code

The launch plan must cover, as applicable:

- website verification/claiming;
- data source + Scheduled Fetch cadence/schedule;
- Merchant Automations settings;
- target country/language;
- shipping and returns configuration;
- diagnostics review;
- Google Ads account linkage for Shopping campaigns.

Console-owned account IDs/settings should not be duplicated into source code without a technical reason.

## 9. Security & Privacy Boundaries

### Always

- treat Pancake/vendor/GTM/browser output as untrusted integration data;
- validate configuration before rendering third-party tags;
- keep credentials server-only;
- keep generic browser ecommerce payloads free of customer name, phone, address, email, auth/session tokens, and unnecessary PII;
- isolate tracking failures from shopper flows;
- preserve CSP least privilege;
- review GTM configuration as executable production configuration;
- serialize Merchant data safely;
- reuse trusted media/URL validation;
- bound public feed work and reject arbitrary external fetch behavior;
- prevent non-production contamination of production analytics/ad accounts;
- document destination-specific data sharing.

### Ask first

- TikTok Events API credentials/server-side matching;
- changes to Meta CAPI/user-data fields;
- migrating Meta Pixel into GTM;
- visible consent UI or default-consent change;
- Google Enhanced Conversions or any hashed customer-data transmission;
- new ad vendors;
- database/schema changes to preserve analytics/Merchant identity that current snapshots cannot reconstruct;
- Merchant API realtime sync;
- changes to Meta content-ID/Purchase-value semantics;
- changing `SEARCH_INDEXING_ENABLED` or temporary-domain SEO exposure policy.

### Never

- commit real access tokens/secrets;
- put server tokens in client bundles;
- emit Purchase from a click-only trigger;
- emit cart/checkout funnel success from a click when the authoritative mutation/navigation state failed;
- deploy a second Meta Pixel while the direct one is active;
- infer GTIN from Pancake internal barcode;
- put customer PII into generic `dataLayer` ecommerce events;
- let local/staging pollute production vendor reports;
- broadly weaken CSP or add `unsafe-eval` merely to make tags work;
- add unreviewed GTM Custom HTML/Custom JavaScript in production;
- manually concatenate unescaped XML from external text;
- invent Merchant visibility/pricing rules that diverge from storefront truth;
- drop out-of-stock offers by confusing availability with structural eligibility;
- claim Purchase-to-Merchant item matching if the ID cannot be reconstructed from immutable purchase facts;
- let stale aggregate PDP structured data overwrite exact variant feed truth;
- enable organic indexing as an implicit Merchant prerequisite.

## 10. Intended Project Structure

Exact paths are chosen during `/plan`, but intended ownership is:

```text
src/
  analytics/
    commerce-events.*
    data-layer.*
    tracking-policy.*
    tracking-environment.*
    google-consent-adapter.*
  components/
    analytics/
      google-tag-manager.*
      ...existing Meta components...
  commerce/
    ...existing storefront visibility/projection/price/media helpers...
  integrations/
    meta/                  # existing direct integration
    merchant/              # feed mapping/serialization if introduced
  app/
    feeds/
      ...valid Next.js Merchant feed route...

tests/
  domain/
  integrations/
  database/
```

Prefer pure typed mapping/serialization helpers over vendor payload construction scattered through UI components.

## 11. Testing & Verification Strategy

### Unit/domain

Prove at minimum:

- deterministic canonical event mapping;
- `dataLayer` ecommerce reset prevents stale fields/items from leaking between sequential events;
- successful cart mutations are required before `add_to_cart`/`remove_from_cart` emission;
- conditional funnel stages are not synthesized without a real application milestone;
- Purchase impossible for non-`CONFIRMED` orders;
- Purchase transaction/event ID uses `publicCode`;
- repeated rendering/revisit of the same Purchase preserves the same ID;
- Purchase price/quantity/name/variation facts use immutable order-line snapshots;
- missing mutable catalog enrichment cannot corrupt immutable Purchase facts;
- any promised Purchase-to-Merchant item ID is reconstructible from snapshot facts;
- GA4 value excludes shipping and shipping maps separately;
- existing Meta value/content-ID semantics remain unchanged;
- centralized `disabled | preview | live` tracking policy cannot enable live production destinations outside approved production;
- Google consent mapping covers `analytics_storage`, `ad_storage`, `ad_user_data`, and `ad_personalization`;
- Merchant visibility follows storefront visibility rather than editorial publication;
- out-of-stock is availability, not structural exclusion;
- Merchant price uses canonical resolved storefront price and rejects `PRICE_UNRESOLVED`;
- SKU-to-MPN audit catches missing/duplicate/ambiguous values;
- internal Pancake barcode does not become GTIN;
- trusted media contract is reused;
- feed IDs/group IDs are deterministic for every activated standalone/composite context;
- XML escaping/invalid-character/malformed-URL/oversized-input cases are safe and parseable.

### Integration/database

Prove at minimum:

- live GTM/vendor delivery renders only behind the approved live-production policy;
- explicit preview mode can be exercised without sending to production destinations;
- `dataLayer` schema is deterministic and does not retain stale ecommerce state;
- no duplicate Meta Pixel is introduced;
- confirmed success creates canonical Purchase while unconfirmed/invalid success state does not;
- current confirmed Purchase still works if current catalog enrichment is unavailable where the vendor does not require it;
- TikTok Purchase mapping receives `event_id = publicCode`;
- Google Ads Purchase receives `publicCode` as order/transaction ID and has conversion-linking functionality configured;
- Merchant route returns a supported parseable format;
- draft editorial status alone does not hide an otherwise storefront-visible product;
- hidden/locked source flags do not become accidental Merchant-only policy;
- out-of-stock valid options stay in feed as `out_of_stock`;
- standalone price/stock/media match storefront;
- composite feed contexts match parent PDP projection and cannot advertise forged/unreachable component variants;
- stable catalog input produces stable external IDs;
- unsafe external text cannot corrupt the whole feed.

### Browser/runtime before activation

When browser tools/vendor diagnostics are available:

- explicit preview/test mode loads GTM/Tag Assistant without production destination contamination;
- GTM Preview shows expected dataLayer reset + event order;
- GA4 DebugView/test destination shows expected ecommerce events;
- initial page load and App Router client navigation produce exactly one GA4 page view each under the chosen page-view authority;
- Google Ads test Purchase carries unique transaction ID, chosen conversion-value convention, and functioning conversion-linker behavior;
- TikTok diagnostics show intended Pixel events and Purchase `event_id`;
- two browser copies of the same TikTok Purchase retain the same `event_id`;
- current Meta Pixel+CAPI dedup remains healthy;
- a confirmed order is not double-counted by refresh/revisit according to each destination's supported dedup mechanism;
- vendor/ad-blocker failure does not break commerce UI;
- CSP allows exactly required requests and no unnecessary origins;
- consent defaults are established before Google measurement tags;
- if GTM noscript is used, it is not silently blocked by CSP;
- third-party scripts do not materially block core storefront interaction.

### Merchant before activation

- Scheduled Fetch can fetch the production product-data URL;
- chosen fetch cadence is documented against mirror/catalog update behavior;
- output parses without structural errors;
- SKU/MPN audit passes for all emitted offers;
- sample standalone variants group correctly;
- sample composite mappings resolve to exact parent-PDP option context;
- variant URLs preselect/represent submitted options;
- price/availability/media match storefront;
- out-of-stock offers remain present;
- no false GTIN;
- editorial publication state is not confused with product visibility;
- images are fetchable;
- Merchant Automations settings are reviewed;
- any structured data used for automatic updates matches the exact submitted offer; current aggregate PDP offer is not accepted as variant proof without evidence;
- Google crawlers can fetch submitted pages/images while ADR 0004 remains unchanged;
- Merchant diagnostics are reviewed before campaigns/free-listing activation.

### Repository gates before implementation completion

Use the checked-in commands appropriate to the implementation:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
pnpm build
pnpm release:check
```

Focused tests run during TDD; relevant full checks run before implementation is considered complete. This docs-only spec/plan PR does not itself claim those runtime gates have been executed.

## 12. Observability & Performance

- Non-production may inspect canonical event shapes without sending real production vendor traffic.
- Preview/test mode must make its isolation obvious in logs/diagnostics without logging customer PII.
- Merchant generation should expose safe structured diagnostics for excluded/malformed records without customer PII.
- Diagnostics should distinguish reasons such as `PRICE_UNRESOLVED`, invalid URL/media, missing/duplicate MPN, unresolved composite context, unsafe description, serialization failure, structured-data mismatch, and stale-feed risk.
- Do not log tokens, auth headers, customer names/phones/addresses/emails, or whole order payloads.
- Feed/runtime failures should flow through existing deployment/error monitoring when available.
- Tracking tags load asynchronously/non-blockingly according to vendor-supported patterns; shopper-critical actions must not wait on analytics requests.
- Browser verification checks for obvious interaction/loading regressions rather than approving unlimited third-party script cost merely because events fire.
- A production disable/rollback path exists for GTM/tracking and Merchant feed activation.

## 13. Success Criteria

### Tracking

- [ ] GA4 + Google Ads + TikTok Pixel route through GTM in live production.
- [ ] Existing direct Meta Pixel + CAPI remain direct and non-duplicated.
- [ ] Non-production preview/testing cannot send to production vendor destinations.
- [ ] `dataLayer` ecommerce state is reset so sequential events cannot inherit stale fields.
- [ ] Cart/funnel events represent successful canonical milestones rather than raw clicks.
- [ ] Purchase is impossible unless the order is `CONFIRMED`.
- [ ] `publicCode` is the Purchase transaction/event identity.
- [ ] Immutable Purchase facts do not depend on mutable SKU/slug/projection data absent from snapshots.
- [ ] Any Purchase-to-Merchant item matching claim is backed by a reconstructible stable ID.
- [ ] GA4 has exactly one page-view authority and does not double-count App Router navigation.
- [ ] GA4 and Meta retain explicitly documented value semantics.
- [ ] Google Ads conversion-linking functionality is verified.
- [ ] Google Ads conversion-value convention is explicitly approved/documented before activation.
- [ ] TikTok Purchase sends `event_id = publicCode`.
- [ ] Consent policy is centralized and current Google consent fields are mapped explicitly.

### Merchant

- [ ] Scheduled Fetch uses a production HTTPS product-data URL.
- [ ] Scheduled Fetch cadence is justified against catalog/stock volatility.
- [ ] Merchant offers derive from public storefront option/projection truth.
- [ ] ProductContent publication is not incorrectly used as a product-visibility gate.
- [ ] Out-of-stock is not confused with structural ineligibility.
- [ ] Composite options are not grouped/linked by raw DB ownership alone.
- [ ] IDs/group IDs are stable for every activated offer context.
- [ ] SKU-as-MPN passes presence/uniqueness/stability audit.
- [ ] `brand = LA Clothing`; no inferred GTIN from internal barcode.
- [ ] Price uses canonical storefront resolved price.
- [ ] Trusted media and exact option/projection landing URLs are used.
- [ ] Feed serialization safely handles hostile/malformed external text.
- [ ] Public feed work is bounded and cannot become an arbitrary external fetch path.
- [ ] Merchant Automations cannot overwrite exact variant truth from incompatible aggregate structured data.
- [ ] ADR 0004 search-indexing policy remains unchanged unless separately approved.

### Quality/security

- [ ] No customer PII in generic browser ecommerce payloads.
- [ ] No real secrets committed/exposed client-side.
- [ ] GTM configuration is reviewable and production Custom HTML/JS is controlled.
- [ ] CSP remains least privilege; no convenience `unsafe-eval` addition.
- [ ] Vendor failure cannot break commerce flows.
- [ ] Relevant test/type/lint/build gates pass for implementation PR(s).
- [ ] Browser and Merchant diagnostics are checked before production activation.
- [ ] Disable/rollback path is documented.
- [ ] Human review occurs before production activation.

## 14. Out of Scope

- migrating Meta Pixel into GTM;
- replacing Meta CAPI;
- changing existing Meta content-ID/Purchase-value semantics;
- TikTok Events API implementation;
- Merchant API realtime sync;
- visible cookie/consent UI;
- Enhanced Conversions / hashed customer PII;
- database/schema changes unless `/plan` proves existing snapshots cannot satisfy an approved identity contract and the owner separately approves the change;
- changing canonical storefront pricing/visibility policy merely for Merchant;
- enabling search indexing on the temporary production domain;
- unrelated SEO/catalog/UI refactors.

## 15. Required `/plan` Discoveries

The implementation plan is now recorded in `tasks/marketing-analytics-shopping-plan.md` with its checklist in `tasks/marketing-analytics-shopping-todo.md`. It resolves the technical direction while retaining explicit owner/account gates for decisions the codebase cannot safely infer.

Resolved planning direction includes:

1. **Merchant item identity candidate:** `pancakeVariationId`, with fail-closed real-catalog format/durability audit before activation.
2. **Purchase identity reconstruction:** use the same variation identity already preserved in `OrderLineSnapshot`; do not require mutable SKU/slug to report a confirmed Purchase.
3. **Composite context:** only exactly-one approved public projection context is auto-eligible; ambiguous contexts remain excluded rather than forcing a schema change.
4. **Composite/variant deep linking:** planned `/shop/<slug>?variant=<pancakeVariationId>` contract with authorization against the live public projection.
5. **SKU/MPN audit:** read-only audit before feed activation; missing/duplicate/ambiguous values fail closed.
6. **Merchant description:** published editorial copy first; any source-description fallback must be reviewed/normalized and never expose draft editorial content.
7. **Merchant freshness:** Scheduled Fetch with account-supported cadence coordinated to catalog updates; realtime Merchant API remains out of scope.
8. **Merchant Automations:** initially off for price/availability/condition until exact variant structured data is proven compatible.
9. **Google Ads linker:** final Google tag/GTM configuration must provide verified conversion-linking functionality.
10. **GA4 page-view authority:** application-owned manual page views; disable overlapping initial/history automatic collection.
11. **Conditional funnel milestones:** no synthetic `add_shipping_info`/`add_payment_info` under the current one-page COD flow.
12. **TikTok mapping:** official GTM template/custom-event mapping; Purchase `event_id = publicCode`.
13. **Tracking modes:** centralized `disabled | preview | live` deployment-aware policy.
14. **GTM ownership/versioning:** reviewed, diffable config/export record; no unreviewed production Custom HTML/JS.
15. **CSP:** retain fail-closed build/runtime alignment and verify exact current Google/TikTok origins during `/build`.
16. **Merchant target attributes:** explicit owner gate for initial market plus truthfulness of apparel-wide gender/age-group/condition constants; current Google requirements are rechecked during `/build`.
17. **Merchant account prerequisites:** website verification/claim, shipping/returns, diagnostics, data source, and Ads linkage before activation.
18. **Crawler compatibility:** Merchant page/image fetch must work without changing ADR 0004 search-indexing policy.

Remaining owner/account gates before affected production activation:

1. Google Ads Purchase conversion value: merchandise-only vs `OrderMirror.totalVnd`.
2. Merchant initial target country/language/currency; plan proposes Vietnam / Vietnamese / VND pending confirmation.
3. Whether all emitted products truthfully share `gender=male`, `age_group=adult`, `condition=new`; otherwise product-owned fields require a plan revision.
4. Actual GTM/GA4/Ads/TikTok account identifiers and external-console configuration.

## 16. Authoritative Source Constraints Checked

Version-sensitive implementation details must be rechecked during `/build`. Current source categories include:

- GTM `dataLayer` and GA4 ecommerce examples, including clearing the previous ecommerce object before a new ecommerce event;
- GA4 SPA/page-view guidance, including disabling automatic/history page views when manual page views are used;
- Google Consent Mode current consent types/order and GTM/page-level supported patterns;
- Google Ads GTM conversion setup, transaction/order IDs and conversion-linking requirements;
- Merchant product data specification, variant grouping/`variant_option`, Scheduled Fetch, identifiers, landing-page requirements, structured data and automatic updates/Automations;
- TikTok GTM event guidance and event deduplication, including Pixel-to-Pixel and Pixel-to-Events-API `event_id` behavior.

Do not implement version-sensitive tag/platform behavior from memory when current official documentation is available.

## 17. Definition of Done Gate

This work is not complete merely because GTM loads or Merchant accepts a feed.

Before `/ship`, both this spec/plan and the repository-wide Definition of Done must pass, including:

- behavior tests for new logic;
- relevant full tests/typecheck/lint/build gates;
- browser/runtime verification;
- compatibility verification for existing Meta and storefront behavior;
- security review for scripts/configuration/secrets/feed serialization/public endpoint boundaries;
- observability for tracking/feed failure;
- documented production disable/rollback path;
- Merchant diagnostics;
- human review before production activation.

## 18. Open Questions / Owner Decisions

No architecture blocker remains for `/build` after human plan approval. The remaining external/product decisions are deliberately activation-gated rather than guessed:

1. Google Ads Purchase conversion value: merchandise-only value or `OrderMirror.totalVnd`.
2. Merchant initial country/language/currency; proposed baseline Vietnam / Vietnamese / VND.
3. Confirm catalog-wide apparel facts `male` / `adult` / `new`, or revise the plan to add per-product ownership.
4. Supply/review the real GTM, GA4, Google Ads, and TikTok account identifiers/configuration before publishing live tags.

Any schema/snapshot change discovered later remains a separate owner approval; the baseline plan is intentionally no-migration.