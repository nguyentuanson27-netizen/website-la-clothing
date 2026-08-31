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

### Review `5061555088`
- [ ] **R1 Preview isolation:** production destination tags require `la_tracking_mode=live`; preview never relies on Tag Assistant as a sandbox.
- [ ] **R2 Atomic cart deltas:** update/remove transaction returns committed old/new/removed quantities from inside the cart lock.
- [ ] **R3 Merchant composite:** composite Merchant offers deferred in v1; standalone IDs require durability proof.
- [ ] **R4 Merchant envelope:** max 5,000 offers, 16 MiB, ≤8 DB round trips; overflow never partial `200`.

### Review `5062244480`
- [ ] **R5 GTM live interlock:** PR-A contains **no GTM loader**. Requested preview/live stay operationally disabled until T8 has an exact saved GTM version + reviewed export. PR-C owns first GTM script/CSP opening.
- [ ] **R6 Server-truth AddToCart:** successful server purchase action returns `pancakeVariationId`, current resolved unit price, accepted quantity, and bounded item facts from the same authorized selection committed to cart; browser does not use stale pre-request price.
- [ ] **R7 Product vs variant identity:** list/select/initial unselected PDP use product-level `pancakeProductId`; exact variant `pancakeVariationId` begins only when a concrete variant is selected/committed. Price ranges are never reported as an exact selected price.
- [ ] **R8 Feed amplification:** complete successful Merchant feed is cached for 300s under a fixed bounded key; concurrent cold requests are single-flight; byte counting is incremental; repeated GETs within TTL do not re-run heavy DB generation.

## PR-A — tracking preparation; zero new GTM/vendor network delivery

### T1 Canonical event/dataLayer contracts
- [ ] Define `CommerceProductImpression` separately from selected `CommerceVariantItem`.
- [ ] Product impression supports product external ID + exact/min/max price without requiring a fake variant.
- [ ] Selected variant item requires `pancakeVariationId`, exact unit price, quantity.
- [ ] Typed Purchase/event facts contain no customer PII.
- [ ] Reset ecommerce state before every ecommerce push.
- [ ] Tracking publisher is fail-safe and never replaces initialized `window.dataLayer`.
- [ ] RED/GREEN tests cover product-vs-variant identity, sequential-event isolation, malformed/unavailable tracking.

### T2 Desired tracking mode/config + CSP interlock
- [ ] Parse/validate desired `disabled | preview | live` + future GTM container ID.
- [ ] `live` is deployment-owned; no Host/query/client activation.
- [ ] Before T8, both requested `preview` and requested `live` resolve to **no GTM load**.
- [ ] PR-A opens no new Google/TikTok CSP origins and adds no production `unsafe-eval`/wildcard.
- [ ] Update env examples and focused config/CSP tests.

### T3 dataLayer + consent + page-view preparation; still no GTM loader
- [ ] Initialize/queue `dataLayer` and immutable `la_tracking_mode` fact.
- [ ] Queue current Google consent default before eventual measurement.
- [ ] Emit exactly one application-owned initial/App Router `page_view` into dataLayer.
- [ ] Preserve existing direct Meta mount.
- [ ] Assert no GTM script/iframe/network loader exists in PR-A.

### Checkpoint A
- [ ] Focused tests green.
- [ ] `pnpm typecheck` green.
- [ ] `pnpm lint` green.
- [ ] Security review proves PR-A cannot load GTM in any mode and adds no new third-party network path.

## PR-B — commerce browser events

### T4 Product + selected-variant projection facts
- [ ] Expose stable `pancakeProductId` on list/PDP product facts.
- [ ] Propagate `pancakeVariationId` + optional SKU through concrete standalone/composite options.
- [ ] Keep local `VariantMirror.id` as mutation/authorization identity.
- [ ] Presentation `kindKey` never becomes external identity.
- [ ] Existing price/stock/composite privacy behavior unchanged.

### T5 Product-level list/PDP/select + server-authoritative AddToCart
- [ ] `view_item_list` emits exactly one product impression per visible card.
- [ ] `select_item` uses clicked product identity even though no size/color is selected yet.
- [ ] initial unselected `view_item` uses product identity.
- [ ] Equal resolved product price may map as exact price; multi-price range does **not** map minimum as selected exact price; unresolved price omits monetary fields.
- [ ] Successful AddToCart server result includes bounded canonical item facts from the same re-resolved option that passed server validation and was committed.
- [ ] AddToCart event uses server-returned `pancakeVariationId`, `unitPriceVnd`, accepted quantity; never stale `selection.selectedPrice` captured before request.
- [ ] Failed mutation emits no AddToCart.
- [ ] Direct Meta event name/content IDs/direct-delivery/success boundary remain compatible; any Meta value-source correction has regression coverage.
- [ ] RED/GREEN tests: multi-price/tie/no-price product, click before variant selection, stale browser price vs new server price, failed mutation, no duplicate Meta behavior.

### T6 Atomic cart delta + checkout events
- [ ] Under existing cart lock, update returns `previousQuantity` + committed `quantity`.
- [ ] Under same lock, remove captures/returns `removedQuantity`; already-missing line is not a real removal.
- [ ] Increase → delta `add_to_cart`; decrease/remove → delta `remove_from_cart`; zero delta/failure → no event.
- [ ] RED/GREEN concurrency tests: two absolute updates, remove/already-removed, same quantity, failed mutation.
- [ ] Emit `view_cart` / `begin_checkout` from canonical resolved state.
- [ ] Keep `add_shipping_info` / `add_payment_info` absent until a real accepted milestone exists.

### Checkpoint B
- [ ] Focused cart/PDP/checkout tests green.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` green.
- [ ] Review product-vs-variant IDs, exact/range values, quantity and server-truth semantics.

## PR-C — confirmed Purchase + immutable GTM activation

### T7 Canonical confirmed Purchase
- [ ] Purchase only for `OrderMirror.state === CONFIRMED`.
- [ ] `transaction_id = event_id = publicCode`.
- [ ] Immutable item quantity/price/variation identity from `OrderLineSnapshot`; mutable enrichment optional.
- [ ] Refresh/revisit keeps same ID; tracking failure cannot affect checkout success.
- [ ] Existing Meta Pixel+CAPI dedup remains healthy.

### T8 Exact GTM saved version + loader/CSP + destination mapping
- [ ] Configure GTM workspace, then **create/save immutable container version before final review**.
- [ ] Record GTM container ID + exact saved container version number/ID.
- [ ] Export JSON from that exact saved version and commit it with repository identity/checksum.
- [ ] Static assertion proves every production GA4/Ads/TikTok tag has explicit `la_tracking_mode == live` firing guard.
- [ ] GA4 auto/history page views disabled under app-owned page-view strategy.
- [ ] Google Ads Purchase uses O1 value + `publicCode` + conversion-linking functionality; no Enhanced Conversions.
- [ ] TikTok Purchase/CompletePayment uses `event_id=publicCode`.
- [ ] Preview/test tags use isolated debug/test destinations only.
- [ ] Only after static audit passes: add actual GTM loader and required least-privilege CSP origins; enable app preview for that exact saved version.
- [ ] Tag Assistant previews that exact saved version, not a mutable unversioned workspace.
- [ ] Live publish publishes the same reviewed saved version and records published version ID.
- [ ] Any later console edit requires new version + export + review before publish.

### Checkpoint C — tracking activation readiness
- [ ] Exact GTM version/export/checksum recorded.
- [ ] Tag Assistant proves preview sends zero traffic to production destinations.
- [ ] GA4 DebugView/test destination proves expected ecommerce + exactly one page view per navigation.
- [ ] Ads/TikTok diagnostics prove transaction/event IDs and no supported duplicate reporting.
- [ ] Existing direct Meta remains healthy.

## PR-D — Merchant identity + standalone deep link

### M1 Merchant read-only identity/durability audit
- [ ] Audit `pancakeVariationId` and standalone `pancakeProductId` against current Merchant format/length limits.
- [ ] Prove external-ID durability by provider contract, controlled repeated full-catalog resync evidence + repository reconciliation tests, or equivalent approved history.
- [ ] Audit SKU-as-MPN presence/uniqueness/stability.
- [ ] Every composite projection becomes `COMPOSITE_DEFERRED` in v1.
- [ ] Audit price/media/content/apparel coverage with bounded non-PII diagnostics.

### M2 Standalone variant deep link + canonical/query contract
- [ ] Implement `/shop/<slug>?variant=<pancakeVariationId>` only for valid current standalone options.
- [ ] Exact selected price/color/size/image matches feed facts.
- [ ] Stale/forged/inactive/private/composite query cannot expose/select unauthorized option.
- [ ] Base PDP remains organic canonical; variant query does not create independent indexing policy.
- [ ] Regression aligns with merged SEO/GEO audit W4 dependency order.

### Checkpoint D
- [ ] Real-catalog identity/MPN/durability audit green for every intended standalone launch record.
- [ ] Representative Merchant deep links show exact variant facts.
- [ ] Composite products intentionally absent, not silently regrouped.

## PR-E — Merchant feed

### M3 Standalone Merchant mapper
- [ ] Stable audited ID/grouping, `brand=LA Clothing`, audited MPN, no inferred GTIN.
- [ ] Map canonical price, availability, trusted image, description, exact deep link, color/size, current required variant fields, O2/O3 values.
- [ ] Structurally valid zero-stock offers remain `out_of_stock`.
- [ ] Unsafe/unresolved/composite records excluded with bounded reason.

### M4 Cached/single-flight serializer + bounded public route
- [ ] GET-only `/feeds/google-merchant` with safe standards-aware serialization.
- [ ] `MAX_MERCHANT_OFFERS = 5_000`.
- [ ] `MAX_MERCHANT_FEED_BYTES = 16 MiB` with **incremental UTF-8 byte accounting**; abort before next chunk exceeds limit.
- [ ] `MAX_MERCHANT_DB_ROUND_TRIPS = 8`; no N+1.
- [ ] `MERCHANT_FEED_CACHE_TTL_SECONDS = 300`.
- [ ] Fixed cache key is configured shop + feed schema/version only; query/header noise cannot create unbounded keys.
- [ ] Cache only complete successful serialized feed.
- [ ] Repeated GETs within TTL perform zero additional heavy DB generations.
- [ ] Concurrent cold requests are collapsed by a tested single-flight mechanism for current runtime/cache domain.
- [ ] Failed/overflow rebuild never publishes/caches partial result as success.
- [ ] Overflow target `503`; never partial/truncated `200`.
- [ ] Tests: parse output, escaping/Unicode/control chars, malformed URLs, deterministic order, offer/byte limit and limit+1, query budget, first miss/repeated hit, concurrent cold miss, concurrent TTL expiry, query-string cache noise.

### Checkpoint E
- [ ] Focused Merchant mapping/route/cache tests green.
- [ ] `pnpm test`, `pnpm test:db`, `pnpm typecheck`, `pnpm lint`, `pnpm build` green on exact PR-E head.
- [ ] Real Next runtime smoke confirms cached route status/content type/complete body/no secrets.

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
- [ ] Exact GTM container/version/export record + GTM/GA4/Ads/TikTok diagnostics recorded.
- [ ] Merchant cache/fetch/diagnostics/crawler evidence recorded.
- [ ] Final review: correctness → security → architecture → simplicity → performance.
- [ ] Rollback documented for GTM exact-version delivery and Merchant data source/cache.
- [ ] Human approval before publishing live GTM version / enabling Merchant listings or campaigns.

## Explicitly deferred

- [ ] TikTok Events API.
- [ ] Meta Pixel migration into GTM.
- [ ] Meta CAPI replacement/content-ID redesign.
- [ ] Google Enhanced Conversions / hashed customer PII.
- [ ] Merchant API realtime sync.
- [ ] Composite Merchant offer / `item_group_id` design.
- [ ] Visible consent UI/default-denied policy.
- [ ] Search-indexing/permanent-domain changes.
- [ ] Unrelated SEO/catalog/admin refactor.