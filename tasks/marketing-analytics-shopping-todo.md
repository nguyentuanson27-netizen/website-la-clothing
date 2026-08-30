# Marketing analytics & Google Shopping — task checklist

Status: **PROPOSED — do not start `/build` until human approval of `tasks/marketing-analytics-shopping-plan.md`.**

Source spec: `docs/specs/marketing-analytics-shopping.md`

PR #153 remains docs-only. Runtime work must land in the focused PRs below.

## Owner/account gates

- [ ] **O1 Google Ads value:** approve merchandise-only vs `OrderMirror.totalVnd` before Ads Purchase publish.
- [ ] **O2 Merchant market:** confirm initial country/language/currency; proposed Vietnam / Vietnamese / VND.
- [ ] **O3 Apparel facts:** confirm whether emitted standalone inventory can truthfully use `gender=male`, `age_group=adult`, `condition=new`; otherwise add product-owned facts before Merchant activation.
- [ ] **O4 Vendor config:** provide/review GTM container, GA4 Measurement ID, Google Ads conversion ID/label, TikTok Pixel ID.

## Review-resolution gates

- [ ] **R1 Preview isolation:** app publishes `la_tracking_mode` before GTM; every production GA4/Ads/TikTok tag requires `live`; preview stays disabled until a checked-in GTM config/export statically proves those guards.
- [ ] **R2 Atomic cart deltas:** cart update/remove transaction returns committed `previousQuantity`/`quantity`/`removedQuantity`; browser never derives delta from stale rendered/pre-read quantity.
- [ ] **R3 Merchant composite:** all composite projections are excluded from Merchant v1 with `COMPOSITE_DEFERRED`; standalone `pancakeProductId` is the only v1 `item_group_id` candidate and only after durability proof.
- [ ] **R4 Merchant resource envelope:** public feed enforces 5,000 offers, 16 MiB complete body, ≤8 DB round trips; overflow is non-success/503, never partial `200`.

## PR-A — tracking foundation

### T1 Canonical event/dataLayer contract
- [ ] Typed canonical ecommerce item/Purchase/event facts; no customer PII.
- [ ] Reset ecommerce state before every ecommerce push.
- [ ] Tracking publisher is fail-safe and never replaces initialized `window.dataLayer`.
- [ ] RED/GREEN tests for sequential-event isolation and malformed/unavailable tracking.

### T2 Tracking mode + CSP/config
- [ ] Central `disabled | preview | live` resolver.
- [ ] `live` is deployment-owned; no Host/query/client activation.
- [ ] Build-time GTM config matches baked CSP; no wildcard origins or production `unsafe-eval`.
- [ ] `preview` remains no-GTM/disabled until R1 isolation artifact exists.
- [ ] Update `.env.example`, VPS env example and focused config/CSP tests.

### T3 GTM + consent + page-view bootstrap
- [ ] Push `la_tracking_mode` before GTM bootstrap.
- [ ] Preserve existing direct Meta mount; no Meta tag in GTM.
- [ ] Establish current Google consent default before measurement.
- [ ] Emit exactly one application-owned initial/App Router `page_view`; later disable overlapping GA4 auto/history page views.
- [ ] Checkpoint A statically proves preview cannot load before R1 exists.

### Checkpoint A
- [ ] Focused tests green.
- [ ] `pnpm typecheck` green.
- [ ] `pnpm lint` green.
- [ ] Security review: CSP least privilege, no PII, no Meta duplication, preview fail-closed.

## PR-B — commerce browser events

### T4 Stable projected analytics item facts
- [ ] Propagate `pancakeVariationId` + optional SKU through standalone/composite projection facts.
- [ ] Keep local `VariantMirror.id` as mutation/authorization identity.
- [ ] Existing price/stock/composite privacy behavior unchanged.

### T5 Catalog/PDP/AddToCart
- [ ] Emit `view_item_list`, `select_item`, `view_item` from rendered/canonical facts.
- [ ] Emit `add_to_cart` only after existing successful server mutation.
- [ ] Preserve current Meta ViewContent/AddToCart behavior.

### T6 Atomic cart delta + checkout events
- [ ] Under the existing cart lock, update returns `previousQuantity` + committed `quantity`.
- [ ] Under the same lock, remove captures/returns `removedQuantity`; already-missing line is not reported as a real removal.
- [ ] Increase → delta `add_to_cart`; decrease/remove → delta `remove_from_cart`; zero delta/failure → no event.
- [ ] RED/GREEN concurrency tests: two absolute updates, remove/already-removed, same quantity, failed mutation.
- [ ] Emit `view_cart` / `begin_checkout` from canonical resolved state.
- [ ] Keep `add_shipping_info` / `add_payment_info` absent until a real accepted milestone exists.

### Checkpoint B
- [ ] Focused cart/PDP/checkout tests green.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` green.
- [ ] Review IDs/value/quantity against storefront truth.

## PR-C — confirmed Purchase + GTM destination mapping

### T7 Canonical confirmed Purchase
- [ ] Purchase only for `OrderMirror.state === CONFIRMED`.
- [ ] `transaction_id = event_id = publicCode`.
- [ ] Immutable item quantity/price/variation identity from `OrderLineSnapshot`; mutable enrichment optional.
- [ ] Refresh/revisit keeps same ID; tracking failure cannot affect checkout success.
- [ ] Existing Meta Pixel+CAPI semantics/dedup remain unchanged.

### T8 GTM live guards + mapping + preview enablement
- [ ] Checked-in GTM config/export exists and is diff-reviewable.
- [ ] Every production GA4/Ads/TikTok tag has explicit `la_tracking_mode == live` firing guard.
- [ ] Static assertion fails if any production destination tag lacks the guard.
- [ ] Only after that gate is green may application preview mode load GTM.
- [ ] Preview/test tags use isolated debug/test destinations only.
- [ ] GA4 auto/history page views disabled under app-owned page-view strategy.
- [ ] Google Ads Purchase uses O1 value + `publicCode` + conversion-linking functionality; no Enhanced Conversions.
- [ ] TikTok Purchase/CompletePayment uses `event_id=publicCode`.

### Checkpoint C — tracking activation readiness
- [ ] Tag Assistant proves preview sends zero traffic to production destinations.
- [ ] GA4 DebugView/test destination proves expected ecommerce + exactly one page view per navigation.
- [ ] Ads/TikTok diagnostics prove transaction/event IDs and no supported duplicate reporting.
- [ ] Existing direct Meta Pixel+CAPI remains healthy.

## PR-D — Merchant identity + standalone deep link

### M1 Merchant read-only identity/durability audit
- [ ] Audit `pancakeVariationId` and standalone `pancakeProductId` against current Merchant format/length limits.
- [ ] Prove external-ID durability by provider contract, controlled repeated full-catalog resync evidence + repository reconciliation tests, or equivalent approved historical evidence.
- [ ] Audit SKU-as-MPN presence/uniqueness/stability.
- [ ] Classify projection mode; every composite projection becomes `COMPOSITE_DEFERRED` in v1.
- [ ] Audit price/media/content/apparel coverage with bounded non-PII diagnostics.

### M2 Standalone variant deep link + canonical/query contract
- [ ] Implement `/shop/<slug>?variant=<pancakeVariationId>` only for valid current standalone options.
- [ ] Exact selected price/color/size/image matches feed facts.
- [ ] Stale/forged/inactive/private/composite query cannot expose/select an unauthorized option.
- [ ] Base PDP remains organic canonical; variant query does not create independent indexing policy.
- [ ] Regression aligns with merged SEO/GEO audit W4 dependency order.

### Checkpoint D
- [ ] Real-catalog identity/MPN/durability audit green for every intended standalone launch record.
- [ ] Representative Merchant-style deep links show exact variant facts.
- [ ] Composite products are intentionally absent, not silently regrouped.

## PR-E — Merchant feed

### M3 Standalone Merchant mapper
- [ ] Stable audited ID/grouping, `brand=LA Clothing`, audited MPN, no inferred GTIN.
- [ ] Map price, availability, trusted image, description, exact deep link, color/size, current required variant fields such as `variant_option`, O2/O3 values.
- [ ] Structurally valid zero-stock offers remain `out_of_stock`.
- [ ] Unsafe/unresolved/composite records excluded with bounded reason.

### M4 Serializer + bounded public route
- [ ] GET-only `/feeds/google-merchant` with standards-aware safe serialization.
- [ ] `MAX_MERCHANT_OFFERS = 5_000`.
- [ ] `MAX_MERCHANT_FEED_BYTES = 16 MiB` for complete body.
- [ ] `MAX_MERCHANT_DB_ROUND_TRIPS = 8`; no N+1.
- [ ] Limit is checked before successful response; overflow target is `503` and never partial/truncated `200`.
- [ ] Parse generated output back in tests; cover escaping, Unicode/control chars, malformed URLs, deterministic ordering.
- [ ] Boundary tests at offer/byte limit and limit+1 plus query-budget assertion.

### Checkpoint E
- [ ] Focused Merchant mapping/route tests green.
- [ ] `pnpm test`, `pnpm test:db`, `pnpm typecheck`, `pnpm lint`, `pnpm build` green on exact PR-E head.
- [ ] Next runtime smoke confirms route status/content type/complete body/no secrets.

## PR-F — Merchant activation + final convergence

### M5 Merchant Center setup
- [ ] Verify/claim website and configure O2 market, shipping/returns, product data source, Ads linkage.
- [ ] Scheduled Fetch uses production HTTPS route at highest practical regular account-supported cadence.
- [ ] Review Merchant Automations; keep automatic price/availability/condition updates off until exact variant structured data is proven.
- [ ] Google can fetch landing pages/images while `SEARCH_INDEXING_ENABLED=false` remains unchanged.
- [ ] Merchant diagnostics show representative in-stock/out-of-stock/variant records; no composite v1 expectation.

### V1 Definition of Done / launch gate
- [ ] Exact-head `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`, `pnpm build`, `pnpm release:check`.
- [ ] Applicable browser/runtime suites green.
- [ ] GTM/GA4/Ads/TikTok + Merchant diagnostics recorded.
- [ ] Final review: correctness → security → architecture → simplicity → performance.
- [ ] Rollback documented for GTM delivery and Merchant data source.
- [ ] Human approval before publishing live GTM tags / enabling Merchant listings or campaigns.

## Explicitly deferred

- [ ] TikTok Events API.
- [ ] Meta Pixel migration into GTM.
- [ ] Meta CAPI redesign.
- [ ] Google Enhanced Conversions / hashed customer PII.
- [ ] Merchant API realtime sync.
- [ ] Composite Merchant offer / `item_group_id` design.
- [ ] Visible consent UI/default-denied policy.
- [ ] Search-indexing/permanent-domain changes.
- [ ] Unrelated SEO/catalog/admin refactor.