# Spec: Marketing Analytics, Ads Tracking & Google Shopping

Status: Proposed — self-reviewed; ready for human review

## 1. Objective

Build a production-only marketing measurement and catalog-export foundation for LA Clothing covering:

- Google Tag Manager (GTM);
- Google Analytics 4 (GA4);
- Google Ads conversion tracking;
- TikTok Pixel through GTM;
- the existing direct Meta Pixel + Meta Conversions API integration;
- an automated Google Merchant Center product feed for Google Shopping.

The storefront and order system remain the source of truth. Tracking and catalog vendors consume canonical application facts; they must not invent commerce truth from DOM text, generic button clicks, duplicated pricing rules, or raw mirror-table assumptions that conflict with the public storefront projection.

### Confirmed product decisions

1. GA4 + Google Ads + TikTok Pixel run through GTM.
2. Meta Pixel + Meta CAPI stay direct; no Meta-to-GTM migration in this scope.
3. TikTok Events API is a later phase, not part of this implementation.
4. One canonical commerce-event/fact layer supplies the new tracking destinations.
5. `purchase` exists only for `OrderMirror.state === CONFIRMED`.
6. `OrderMirror.publicCode` is the canonical purchase transaction/event ID.
7. Only the real production storefront sends real production vendor traffic.
8. A central consent/tracking-policy abstraction is built now, but no consent UI is displayed initially; current owner policy allows tracking immediately in production.
9. Merchant Center uses a public HTTPS product-data URL + Scheduled Fetch.
10. Merchant items represent real public selectable variants/options; composite products must follow the storefront projection rather than blindly grouping raw variants by database ownership.
11. `brand = LA Clothing`; current SKU is the manufacturer part number (`mpn`).
12. Pancake-generated/internal barcode is not assumed to be GTIN; `gtin` is omitted unless a real assigned valid GTIN exists.
13. An otherwise valid out-of-stock offer remains in the feed with `availability = out_of_stock`.

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

Current compatibility facts:

- Meta Purchase value uses `OrderMirror.totalVnd`.
- Meta product `content_ids` use product slug when the mirror still exists, with fallback to Pancake variation ID.
- Existing Meta browser/server payload semantics are not changed in this scope.

### Storefront product visibility is not editorial publication

Current storefront product visibility is driven by the canonical storefront repository and, at baseline, requires the configured shop plus:

```text
ProductMirror.isPresent === true
ProductMirror.isActive === true
```

`ProductContent.status === PUBLISHED` is an **editorial-copy publication boundary**, not a product-visibility gate. Draft/reviewed/missing editorial content must not automatically make a storefront-visible product disappear from Merchant merely because the editorial fields are not published.

Merchant may still require a usable compliant description. `/plan` must choose a safe existing description source/fallback or deliberately exclude a record with diagnostics; it must not redefine public product visibility to solve a feed-content problem.

### Current storefront price authority

The current storefront resolves a sell price only when `pancakeRetailPrice` and `pancakeRetailPriceAfterDiscount` are both usable and equal. If they differ, storefront logic returns no resolved price and the option becomes `PRICE_UNRESOLVED`.

Therefore Merchant, analytics item values, and landing-page assertions must reuse the current storefront resolved-price policy rather than independently preferring `pancakeRetailPriceAfterDiscount`.

Any future pricing-policy change belongs in canonical commerce code first; vendor mappings follow it afterward.

### Composite product projection

The storefront supports both standalone and composite product projections. A component variant owned by another `ProductMirror` may legitimately be selectable and purchasable from a parent composite PDP.

Consequences:

- raw `VariantMirror.productId` is not sufficient to determine Merchant grouping/landing context for every sellable option;
- candidate Merchant offers must be derived from the public storefront projection/selectable options;
- a component variant must never be advertised under a URL/grouping that contradicts the page where the shopper can actually select and buy it;
- `/plan` must define stable identifiers and deep-link semantics for composite projection options before composite offers are activated.

### Media trust boundary

Product media is already validated through the storefront trusted-media contract. Merchant must reuse that normalized trusted-media output; it must not bypass the reviewed HTTPS Pancake CDN validation merely because Merchant accepts a URL.

### Existing CSP and deployment behavior

The repository currently builds a fail-closed CSP from configured tracking state and keeps third-party origins closed when the corresponding integration is absent. Build-time and runtime tracking configuration must remain aligned so a runtime tag is not rendered behind a baked CSP that blocks it.

### Existing search-exposure policy

ADR 0004 currently approves `la.lanadesign.vn` as the temporary production origin but requires:

```text
SEARCH_INDEXING_ENABLED=false
```

until a permanent domain and separate human indexing approval exist.

Google Shopping work must **not** turn on organic search indexing, public canonicals, or sitemap exposure as a side effect. Merchant launch only requires that the submitted landing pages and images are fetchable by Google's relevant crawlers under the existing approved crawl boundary. Any change to `SEARCH_INDEXING_ENABLED` remains a separate explicit human decision.

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

### Baseline events

The browser contract must support at least:

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

`add_payment_info` is optional until checkout has a real payment-selection interaction. Do not emit fake funnel stages only to fill a vendor schema.

### Item facts

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
  projectionContext?: string;
};
```

Rules:

- `sku` is the current LA Clothing SKU and Merchant `mpn`.
- New Google/TikTok product matching should use the stable Merchant item identity where the destination supports matching.
- Composite projection context may be needed so the same underlying component variant is not ambiguously advertised through multiple sellable contexts.
- Existing Meta content-ID semantics remain unchanged in this phase.

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
  eventId: string;             // OrderMirror.publicCode in this initial contract
  currency: "VND";
  merchandiseValueVnd: number;
  shippingVnd: number;
  totalVnd: number;
  items: CommerceItem[];        // built from OrderLineSnapshot facts
};
```

Requirements:

- `transactionId = OrderMirror.publicCode`.
- canonical purchase `eventId = OrderMirror.publicCode` where browser/server deduplication uses it;
- purchased quantities/prices come from immutable `OrderLineSnapshot`, not current mutable catalog values;
- invalid/malformed money that cannot be represented safely must fail closed for the vendor event rather than fabricate a value.

### Destination-specific value semantics

The canonical layer exposes business facts; adapters map vendor semantics explicitly.

- **GA4:** `purchase.value` is merchandise item value (`price × quantity` sum); shipping is sent separately as `shipping`.
- **Meta:** preserve current `OrderMirror.totalVnd` Purchase value in this scope.
- **Google Ads:** `/plan` must explicitly choose and document merchandise-only versus total-order conversion value; do not inherit GA4 semantics accidentally.
- **TikTok:** `/plan` must verify the current official event/value contract and map from the same canonical purchase facts.

Intentional cross-platform arithmetic differences must be documented and tested.

## 5. Destination Requirements

### Google Tag Manager

- Load one GTM web container only when the real-production gate, tracking policy, and valid build/runtime configuration permit it.
- Push deterministic application events into `window.dataLayer`.
- Use GTM custom-event triggers/native tags or reviewed templates for routing.
- Do not store pricing, inventory, order-state, product-visibility, or Purchase-truth logic in GTM.
- Keep a reviewable GTM container/workspace export or equivalent versioned configuration documentation.
- Do not add production `unsafe-eval` merely to support GTM Custom JavaScript. Prefer native tags, variables, and reviewed Custom Templates where possible.

### GA4

Map the canonical contract to current GA4-recommended ecommerce events. Preserve at least:

- `transaction_id`
- `currency`
- `value`
- `shipping`
- `items[]`
- item ID/name/price/quantity
- useful variant metadata.

App Router navigation must not double-count page views through overlapping initial-load and client-navigation mechanisms.

### Google Ads

- Confirmed Purchase is the minimum conversion action in scope.
- Use `OrderMirror.publicCode` as the unique transaction ID.
- Conversion ID/label should live in GTM when only GTM consumes them.
- Product/remarketing identifiers should align with Merchant item identity where supported.
- Secondary conversion actions require explicit `/plan` inclusion.

### TikTok Pixel

- Deploy through GTM in this phase.
- Map canonical application events to current TikTok event names in GTM.
- At minimum map product view, AddToCart, checkout initiation, and Purchase/CompletePayment.
- Network/ad-blocker/pixel failure must not break the storefront.
- Implementation must re-check current official TikTok GTM/event guidance during `/plan`/`/build`.

### TikTok Events API

Out of scope now.

The event contract must permit a future server copy to use the same `event_id` as its browser twin where TikTok deduplication requires it.

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

The Google adapter must explicitly map the domain policy to Google's current consent types, including:

```text
analytics -> analytics_storage
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

### Real-production gate

`NODE_ENV === "production"` is insufficient by itself. `/plan` must identify the deployment convention and define one centralized live-storefront gate using reviewed configuration such as the expected `APP_DOMAIN`/deployment environment plus tracking enablement.

Local, CI, test, preview, and staging must not send to production analytics/ad destinations.

### Configuration ownership

If GA4, Google Ads, and TikTok are configured entirely in GTM, the application should conceptually need only the GTM container setting plus a centralized enablement gate. Exact env names must follow repository conventions.

GA4 measurement IDs, Ads IDs/labels, and TikTok Pixel IDs should remain inside GTM when no application code consumes them.

No access token/API secret may be exposed in `NEXT_PUBLIC_*`, `dataLayer`, HTML, or client logs.

### CSP

Preserve the current fail-closed approach:

- third-party origins open only when the reviewed integration is configured;
- no wildcard script/connect/image sources;
- build-time CSP and runtime rendered tag configuration must agree;
- use current official origin requirements plus actual Tag Assistant/browser network evidence;
- do not add `unsafe-eval` merely for convenience;
- prefer nonce-compatible/native/template approaches where practical without broadening scope into a wholesale CSP refactor;
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

The endpoint must be deterministic, bounded, cache-aware where appropriate, and fetchable without a secret embedded in the URL.

### Source of truth: public storefront offer, not raw mirror ownership

Merchant candidates are derived from the same public storefront product detail/projection facts used to decide what a shopper can select and buy.

For **standalone** products, an eligible selectable storefront variant normally maps to one Merchant item.

For **composite** products, a raw component `VariantMirror` may be exposed through a parent PDP projection. `/plan` must therefore define:

- which projection options become Merchant offers;
- whether a component can appear in more than one public projection context;
- the stable Merchant `id` for each sellable context;
- the stable `item_group_id` representing the public variant family;
- a landing URL that preselects/identifies the exact submitted option;
- how title/image/color/size/price are represented so the landing page matches the feed.

Composite Merchant offers must remain disabled until this mapping is deterministic and testable. Do not blindly use `VariantMirror.productId` as Merchant grouping authority.

### Merchant identifiers

For every emitted offer:

- `id`: stable external offer/item identifier;
- `item_group_id`: stable public variant-family identifier where variants are grouped;
- `brand`: `LA Clothing`;
- `mpn`: current SKU;
- `gtin`: omit unless a real valid assigned GTIN exists.

Pancake internal/auto-generated barcode must not be promoted to GTIN without validation and explicit evidence that it is an assigned GTIN.

For standalone variants, `/plan` should verify durability of candidate IDs in this order:

1. `pancakeVariationId` if durable across lifecycle/resync;
2. SKU if SKU immutability is guaranteed;
3. local immutable variant ID only if it is appropriate as an external identity.

Composite contexts may require a stable context-aware ID rather than one raw variant ID. Once Merchant IDs are live, changing them casually is prohibited.

### Eligibility

A product may participate only if it is reachable through canonical public storefront behavior. Current baseline product visibility is:

```text
ProductMirror.isPresent === true
ProductMirror.isActive === true
```

`ProductContent.status === PUBLISHED` is **not** an additional visibility condition.

A candidate option/offer must also have, through canonical storefront/projection policy:

- a real present/active underlying variant;
- deterministic non-ambiguous selectable variant mapping;
- valid SKU for MPN;
- a resolved storefront price;
- a valid production landing URL;
- trusted product media;
- a usable Merchant description source;
- the current required target-market attributes.

`pancakeIsHidden` and `pancakeIsLocked` exist in the mirror but must not become Merchant-only exclusion rules unless the canonical storefront policy actually uses them or `/plan` explicitly establishes a new shared policy. The feed must not silently invent a second visibility model.

### Price

Merchant `price` must equal the value displayed/used by the storefront for the exact submitted selectable option.

Current rule:

- use the canonical `resolveStorefrontPrice`/projection price;
- if retail and after-discount prices differ under current storefront logic, the option is `PRICE_UNRESOLVED` and cannot be advertised as a normal purchasable offer;
- do not independently choose `pancakeRetailPriceAfterDiscount` in the feed.

### Availability

Otherwise eligible offers remain in the feed when stock reaches zero:

```text
canonical sellable stock > 0  -> in_stock
canonical sellable stock <= 0 -> out_of_stock
```

Stock aggregation must reuse the same storefront rule. Availability must describe the exact landing-page option/context.

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

Merchant requires a real product description even when storefront editorial content is not published. `/plan` must define the approved source priority using fields already owned by the repository, for example published editorial copy and/or a reviewed source-description fallback.

Do not expose draft editorial content merely to satisfy Merchant. If no compliant safe description exists, omit the offer and surface a diagnostic rather than publishing unapproved copy.

### XML / structured-feed serialization boundary

Pancake names, source descriptions, editorial text, color, size, SKU, and URLs are external or mutable data. Feed generation must use a proper serializer/escaping strategy rather than manual XML string concatenation.

Requirements:

- escape XML-reserved characters correctly;
- reject/normalize illegal XML control characters and malformed Unicode according to the chosen serializer contract;
- validate required URLs/IDs/price/currency before serialization;
- omit unsupported empty fields rather than writing structurally invalid elements;
- bound input lengths/counts where untrusted upstream data can otherwise inflate feed generation;
- tests must include `<`, `>`, `&`, quotes, Unicode, invalid control characters, and malformed URLs;
- generated XML must be parsed again in tests with a standards-compliant parser before being considered valid.

### Crawlability vs organic indexing

Merchant requires submitted pages/images to be fetchable. That does **not** authorize changing ADR 0004.

For the current temporary production domain:

- keep `SEARCH_INDEXING_ENABLED=false`;
- do not enable public canonical/sitemap exposure as part of this feature;
- verify that current `robots.txt`/edge behavior still permits the Google crawlers Merchant needs to fetch product pages/images;
- if Merchant diagnostics show the existing noindex/crawl configuration itself prevents approval, treat that as a surfaced launch blocker requiring a separate explicit owner decision rather than silently weakening SEO policy.

### Merchant account setup outside source code

The launch plan must cover, as applicable:

- website verification/claiming;
- data source + Scheduled Fetch schedule;
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
- keep generic browser ecommerce payloads free of customer name, phone, address, email, auth/session tokens, and other unnecessary PII;
- isolate tracking failures from shopper flows;
- preserve CSP least privilege;
- serialize Merchant data safely;
- reuse trusted media/URL validation;
- prevent non-production contamination of production analytics/ad accounts;
- document destination-specific data sharing.

### Ask first

- TikTok Events API credentials/server-side matching;
- changes to Meta CAPI/user-data fields;
- migrating Meta Pixel into GTM;
- visible consent UI or default-consent change;
- Google Enhanced Conversions or any hashed customer-data transmission;
- new ad vendors;
- database-schema changes solely for analytics;
- Merchant API realtime sync;
- changes to Meta content-ID/Purchase-value semantics;
- changing `SEARCH_INDEXING_ENABLED` or temporary-domain SEO exposure policy.

### Never

- commit real access tokens/secrets;
- put server tokens in client bundles;
- emit Purchase from a click-only trigger;
- deploy a second Meta Pixel while the direct one is active;
- infer GTIN from Pancake internal barcode;
- put customer PII into generic `dataLayer` ecommerce events;
- let local/staging pollute production vendor reports;
- broadly weaken CSP or add `unsafe-eval` merely to make tags work;
- manually concatenate unescaped XML from external text;
- invent Merchant visibility/pricing rules that diverge from storefront truth;
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
- Purchase impossible for non-`CONFIRMED` orders;
- Purchase transaction/event ID uses `publicCode`;
- purchase item facts use immutable order-line snapshots;
- GA4 value excludes shipping and shipping maps separately;
- existing Meta value/content-ID semantics remain unchanged;
- centralized production and consent gates;
- Google consent mapping covers `analytics_storage`, `ad_storage`, `ad_user_data`, and `ad_personalization`;
- Merchant eligibility follows storefront visibility rather than editorial publication;
- Merchant price uses canonical resolved storefront price and rejects `PRICE_UNRESOLVED`;
- out-of-stock offers remain as `out_of_stock`;
- SKU maps to MPN and internal Pancake barcode does not become GTIN;
- trusted media contract is reused;
- feed IDs/group IDs are deterministic for supported standalone/composite cases;
- XML escaping/invalid-character/malformed-URL cases are safe and parseable.

### Integration/database

Prove at minimum:

- GTM renders only behind the real-production/configuration policy;
- `dataLayer` schema is deterministic;
- no duplicate Meta Pixel is introduced;
- confirmed success creates canonical Purchase while unconfirmed/invalid success state does not;
- Merchant route returns a supported parseable format;
- draft editorial status alone does not hide an otherwise storefront-visible product;
- hidden/locked source flags do not become accidental Merchant-only policy;
- standalone price/stock/media match storefront;
- composite feed contexts match the parent PDP projection and cannot advertise forged/unreachable component variants;
- stable catalog input produces stable external IDs;
- unsafe external text cannot corrupt the whole feed.

### Browser/runtime before activation

When browser tools/vendor diagnostics are available:

- GTM Preview/Tag Assistant shows expected events/tags;
- GA4 DebugView shows expected ecommerce events;
- Google Ads test Purchase carries unique transaction ID;
- TikTok diagnostics show intended Pixel events;
- current Meta Pixel+CAPI dedup remains healthy;
- a confirmed test order is not double-counted by refresh/revisit;
- App Router navigation does not duplicate PageView;
- vendor/ad-blocker failure does not break commerce UI;
- CSP allows exactly the required requests and no unnecessary origins;
- consent defaults are established before Google measurement tags;
- third-party scripts do not materially block core storefront interaction.

### Merchant before activation

- Scheduled Fetch can fetch the production product-data URL;
- output parses without structural errors;
- sample standalone variants group correctly;
- sample composite mappings resolve to exact selectable parent-PDP context;
- variant URLs preselect/represent submitted options;
- price/availability/media match storefront;
- out-of-stock offers remain present;
- no false GTIN;
- editorial publication state is not confused with product visibility;
- images are fetchable;
- Google crawlers can fetch submitted pages/images while ADR 0004 remains unchanged;
- Merchant diagnostics are reviewed before campaigns/free-listing activation.

### Repository gates before completion

Use the checked-in commands appropriate to the changed implementation:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db
pnpm build
pnpm release:check
```

Focused tests run during TDD; relevant full checks run before implementation is considered complete. This docs-only spec PR does not itself claim those runtime gates have been executed.

## 12. Observability & Performance

- Non-production may inspect canonical event shapes without sending real vendor traffic.
- Merchant generation should expose safe structured diagnostics for excluded/malformed records without customer PII.
- Do not log tokens, auth headers, customer names/phones/addresses/emails, or whole order payloads.
- Feed/runtime failures should flow through the project's existing deployment/error monitoring when available.
- Tracking tags must load asynchronously/non-blockingly according to vendor-supported patterns; shopper-critical actions must not wait on analytics requests.
- Browser verification should check for obvious regressions in interaction/loading behavior rather than approving unlimited third-party script cost merely because events fire.
- A production disable/rollback path must exist for GTM/tracking and Merchant feed activation.

## 13. Success Criteria

### Tracking

- [ ] GA4 + Google Ads + TikTok Pixel route through GTM.
- [ ] Existing direct Meta Pixel + CAPI remain direct and non-duplicated.
- [ ] Purchase is impossible unless the order is `CONFIRMED`.
- [ ] `publicCode` is the Purchase transaction/event identity.
- [ ] Product/money facts come from canonical application state, never DOM parsing.
- [ ] GA4 and Meta retain their explicitly documented value semantics.
- [ ] Only the real production storefront sends production vendor traffic.
- [ ] Consent policy is centralized and current Google consent fields are mapped explicitly.

### Merchant

- [ ] Scheduled Fetch uses a production HTTPS product-data URL.
- [ ] Merchant offers derive from public storefront selectable/projection truth.
- [ ] ProductContent publication is not incorrectly used as a product-visibility gate.
- [ ] Composite options are not grouped/linked by raw DB ownership alone.
- [ ] IDs/group IDs are stable for every activated offer context.
- [ ] `brand = LA Clothing`, SKU = `mpn`, no inferred GTIN from internal barcode.
- [ ] Price uses canonical storefront resolved price.
- [ ] Out-of-stock eligible offers remain `out_of_stock`.
- [ ] Trusted media and exact variant/projection landing URLs are used.
- [ ] Feed serialization safely handles hostile/malformed external text.
- [ ] ADR 0004 search-indexing policy remains unchanged unless separately approved.

### Quality/security

- [ ] No customer PII in generic browser ecommerce payloads.
- [ ] No real secrets committed/exposed client-side.
- [ ] CSP remains least privilege; no convenience `unsafe-eval` addition.
- [ ] Vendor failure cannot break commerce flows.
- [ ] Relevant test/type/lint/build gates pass for the implementation PR(s).
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
- database changes unless `/plan` proves an existing-field limitation;
- changing canonical storefront pricing/visibility policy merely for Merchant;
- enabling search indexing on the temporary production domain;
- unrelated SEO/catalog/UI refactors.

## 15. Required `/plan` Discoveries

Before implementation choices are locked, `/plan` must resolve from repository evidence plus current official docs:

1. **Merchant offer identity:** durable standalone variant ID and context-aware composite offer ID/group semantics.
2. **Composite deep linking:** smallest stable URL contract that selects the exact parent/composite projection option.
3. **Merchant description:** approved source/fallback without leaking draft editorial content.
4. **Google Ads value:** merchandise-only vs total-order conversion value.
5. **TikTok mapping:** current official event names/value/content ID requirements.
6. **Live-production gate:** exact deployment condition beyond `NODE_ENV`.
7. **GTM ownership/versioning:** container/workspace naming, test/publish workflow, reviewed export/config record.
8. **CSP origins:** exact current Google/TikTok requirements plus observed runtime requests; no convenience `unsafe-eval`.
9. **Merchant target market:** current apparel-required/recommended attributes for the intended country/language.
10. **Merchant account prerequisites:** website verification, shipping/returns, diagnostics, Google Ads linkage.
11. **Crawler compatibility:** verify Merchant-required page/image fetch works while `SEARCH_INDEXING_ENABLED=false` and ADR 0004 remain intact.

These are implementation discoveries, not unresolved scope permission to invent new business rules.

## 16. Authoritative Source Constraints Checked

Current vendor guidance used by this spec includes:

- GTM `dataLayer`: https://developers.google.com/tag-platform/tag-manager/datalayer
- GTM CSP guidance: https://developers.google.com/tag-platform/security/guides/csp
- Google Consent Mode: https://developers.google.com/tag-platform/security/guides/consent
- GA4 ecommerce Purchase: https://developers.google.com/analytics/devguides/collection/ga4/ecommerce
- Google Ads transaction IDs: https://support.google.com/google-ads/answer/6386790
- Merchant product data specification: https://support.google.com/merchants/answer/7052112
- Merchant RSS/XML format: https://support.google.com/merchants/answer/14987622
- Merchant variant `item_group_id`: https://support.google.com/merchants/answer/6324507
- Merchant Scheduled Fetch: https://support.google.com/merchants/answer/14991445
- Merchant GTIN / brand / MPN: https://support.google.com/merchants/answer/6324461 and https://support.google.com/merchants/answer/160161
- Merchant landing-page requirements/crawlability: https://support.google.com/merchants/answer/4752265 and https://support.google.com/merchants/answer/12472808
- TikTok GTM event tags: https://ads.tiktok.com/resources/help/article/how-to-create-tiktok-event-tags-with-google-tag-manager
- TikTok Pixel/server deduplication: https://ads.tiktok.com/resources/help/article/event-deduplication

Version-sensitive details must be rechecked during `/plan`/`/build`.

## 17. Definition of Done Gate

This work is not complete merely because GTM loads or Merchant accepts a feed.

Before `/ship`, both this spec and the repository-wide Definition of Done must pass, including:

- behavior tests for new logic;
- relevant full tests/typecheck/lint/build gates;
- browser/runtime verification;
- compatibility verification for existing Meta and storefront behavior;
- security review for scripts/configuration/secrets/feed serialization;
- observability for tracking/feed failure;
- documented production disable/rollback path;
- Merchant diagnostics;
- human review before production activation.

## 18. Open Questions

No product-requirement blocker remains for `/plan`.

The items under **Required `/plan` Discoveries** must be answered from current repository behavior and current vendor documentation before implementation is locked.