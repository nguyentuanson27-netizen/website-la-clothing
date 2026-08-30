# Marketing analytics & Google Shopping — task checklist

Status: **PROPOSED — do not start `/build` until human approval of `tasks/marketing-analytics-shopping-plan.md`.**

Source spec: `docs/specs/marketing-analytics-shopping.md`

## Owner/account gates

- [ ] **O1 Google Ads value:** approve merchandise-only vs `OrderMirror.totalVnd` before the Ads Purchase tag is published.
- [ ] **O2 Merchant market:** approve initial country/language/currency; proposed baseline is Vietnam / Vietnamese / VND.
- [ ] **O3 Apparel facts:** confirm whether all emitted inventory can truthfully use catalog-wide `gender=male`, `age_group=adult`, `condition=new`; otherwise revise plan for product-owned attributes before Merchant activation.
- [ ] **O4 Vendor IDs:** provide/review GTM container, GA4 measurement, Google Ads conversion ID/label, and TikTok Pixel ID in their proper account/configuration owners.

## PR-A — tracking foundation

### T1 Canonical event/dataLayer contract
- [ ] Add typed canonical ecommerce item/purchase/event facts with no customer PII.
- [ ] Add the browser dataLayer publisher with ecommerce reset-before-event behavior.
- [ ] Add focused tests proving sequential-event isolation and fail-safe tracking.

### T2 Tracking mode + CSP/config
- [ ] Add centralized `disabled | preview | live` configuration and validation.
- [ ] Align build-time GTM configuration with baked CSP; no wildcard origins or production `unsafe-eval`.
- [ ] Update env examples and focused config/CSP tests.

### T3 GTM + consent + page-view boot
- [ ] Mount one GTM container behind the tracking-mode gate without touching direct Meta.
- [ ] Establish current Google consent defaults before measurement tags using the implementation pattern re-verified against current GTM consent guidance.
- [ ] Add application-owned initial/App Router `page_view` and disable overlapping GA4 automatic/history behavior in GTM/property config.

### Checkpoint A
- [ ] Focused tests green.
- [ ] `pnpm typecheck` and `pnpm lint` green on exact PR-A head.
- [ ] Security review: CSP least privilege, preview isolation, no Meta duplication, no PII.

## PR-B — commerce browser events

### T4 Stable projected item facts
- [ ] Propagate `pancakeVariationId` and optional SKU through standalone/composite public projection facts.
- [ ] Keep internal local variant ID as mutation authorization identity.
- [ ] Prove existing price/stock/composite privacy behavior is unchanged.

### T5 Catalog/PDP/AddToCart
- [ ] Emit `view_item_list`, `select_item`, and `view_item` from canonical rendered facts.
- [ ] Emit `add_to_cart` only after the existing server-success boundary.
- [ ] Preserve existing Meta ViewContent/AddToCart behavior.

### T6 Cart/checkout
- [ ] Quantity increase emits accepted delta `add_to_cart`; decrease/full remove emits accepted `remove_from_cart`; failures emit nothing.
- [ ] Emit `view_cart` and `begin_checkout` from resolved server-authoritative state.
- [ ] Keep `add_shipping_info` and `add_payment_info` absent until a real accepted milestone exists.

### Checkpoint B
- [ ] Focused cart/PDP/checkout tests green.
- [ ] `pnpm test`, `pnpm typecheck`, and `pnpm lint` green on converged tracking branches.
- [ ] Review item identity/value/quantity semantics against storefront truth.

## PR-C — confirmed Purchase + GTM destination mapping

### T7 Canonical Purchase
- [ ] Add vendor-neutral confirmed-Purchase snapshot based on `OrderMirror` + immutable `OrderLineSnapshot` facts.
- [ ] Use `publicCode` for both transaction/event ID; catalog enrichment remains optional and non-authoritative.
- [ ] Publish on the existing confirmed success boundary without changing Meta Purchase/CAPI semantics.

### T8 GTM mapping
- [ ] Version/review GA4 mapping and exactly-one page-view configuration.
- [ ] Configure Google Ads Purchase with O1 value, `publicCode` transaction ID, Google tag/conversion-linking functionality, no Enhanced Conversions.
- [ ] Configure TikTok template/custom-event mapping with Purchase `event_id=publicCode` and live-mode firing guard.

### Checkpoint C — tracking activation readiness
- [ ] Tag Assistant preview proves no production-destination traffic in preview mode.
- [ ] GA4 DebugView/test destination proves expected ecommerce + one page view per navigation.
- [ ] Google Ads/TikTok diagnostics prove transaction/event IDs and no refresh/revisit double count under supported dedup behavior.
- [ ] Existing direct Meta Pixel+CAPI dedup remains healthy.

## PR-D — Merchant identity + landing contract

### M1 Merchant read-only audit
- [ ] Audit `pancakeVariationId`/group candidates against current Merchant ID limits and SKU-as-MPN presence/uniqueness/stability.
- [ ] Classify each variation as zero/one/multiple public projection contexts; only exactly-one contexts are auto-eligible.
- [ ] Audit price/media/content/apparel coverage and emit safe aggregate diagnostics.

### M2 Variant deep link
- [ ] Add `/shop/<slug>?variant=<pancakeVariationId>` exact selection for valid current projected variants.
- [ ] Reject/fail-safe stale, forged, inactive/private, or ambiguous values without exposing hidden variants.
- [ ] Preserve slug lifecycle, noindex/canonical policy, and ordinary PDP behavior.

### Checkpoint D
- [ ] Read-only real-catalog audit passes for every record intended for launch.
- [ ] Representative Merchant-style URLs show exact matching variant facts.
- [ ] Ambiguous composite offers remain excluded instead of forcing a schema change.

## PR-E — Merchant feed

### M3 Merchant mapper/diagnostics
- [ ] Map stable ID/group, LA Clothing brand, audited MPN, approved apparel values, color/size, current `variant_option` representation where applicable, price, availability, trusted image, description, and exact link.
- [ ] Keep structurally valid zero-stock offers as `out_of_stock`.
- [ ] Exclude unresolved/unsafe/ambiguous records with bounded diagnostic reasons; never infer GTIN.

### M4 Serializer + Route Handler
- [ ] Add standards-aware supported Merchant serialization; no unsafe external-text interpolation.
- [ ] Add public bounded GET-only `/feeds/google-merchant` Route Handler with correct content type.
- [ ] Parse generated output again in tests; cover escaping, Unicode/control chars, malformed URLs, oversized fields, deterministic order.

### Checkpoint E
- [ ] Focused Merchant mapping/route tests green.
- [ ] `pnpm test`, `pnpm test:db`, `pnpm typecheck`, `pnpm lint`, and `pnpm build` green on exact PR-E head.
- [ ] Runtime smoke confirms route status/content type/parseability and no secrets.

## PR-F — Merchant activation + final convergence

### M5 Merchant Center setup
- [ ] Verify/claim website and configure product data source, O2 market, shipping/returns, Google Ads linkage.
- [ ] Scheduled Fetch points to production HTTPS route; use the highest practical account-supported regular cadence (current URL/file setup defaults to 24-hour fetch but is adjustable) and coordinate with catalog updates.
- [ ] Review Automations explicitly; keep price/availability/condition updates off while exact variant structured data is not proven.

### V1 Definition of Done / launch gate
- [ ] Run exact-head `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`, `pnpm build`, `pnpm release:check`.
- [ ] Complete browser/vendor diagnostics for GTM/GA4/Ads/TikTok and Merchant diagnostics/crawler checks.
- [ ] Final review: correctness → security → architecture → simplicity → performance; document rollback for GTM delivery and Merchant source.
- [ ] Confirm `SEARCH_INDEXING_ENABLED=false` remains unchanged unless separately approved.
- [ ] Obtain human approval before publishing live GTM tags / enabling Merchant listings or campaigns.

## Explicitly deferred

- [ ] TikTok Events API — later phase.
- [ ] Meta Pixel migration into GTM — not planned.
- [ ] Meta CAPI replacement/value/content-ID change — not planned.
- [ ] Google Enhanced Conversions / hashed customer PII — not planned.
- [ ] Merchant API realtime sync — not planned.
- [ ] Visible consent UI/default-consent change — separate approval.
- [ ] Search-indexing/permanent-domain changes — separate approval.
- [ ] Schema migration for composite Merchant identity — only if later proven necessary and separately approved.