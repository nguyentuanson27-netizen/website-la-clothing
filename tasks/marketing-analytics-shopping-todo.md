# Marketing analytics & Google Shopping — task checklist

Status: **PR-A (T1–T3), T4, T5 and T6 IMPLEMENTED; M1 partially delivered. T7 onward remain proposed and
require human approval of `tasks/marketing-analytics-shopping-plan.md` before `/build`.**

Delivered slices: **T1–T3** (U2, PR #157 — still loads no GTM in any mode), **T4** (U8, PR #164 resolved cart lines
+ PR #165 product/option facts), and the durability half of **M1** (U9, PR #175). Verified on
`main@d8b1a6696f03bdd683e15577b493e5cf46fa51e0`; see `docs/audits/wave-1-checkpoint-a.md` for the T4 record.

T7, T8, M2, M3, M4, M5 and V1 are **not** implemented. No GTM loader exists: T8 still owns the first
actual GTM load and CSP opening.

Source spec: `docs/specs/marketing-analytics-shopping.md`

PR #153 itself is docs-only; runtime work lands in the focused PRs below, of which PR-A (T1–T3), T4 and part of M1
have merged.

## Owner/account gates

- [ ] **O1 Google Ads value:** approve merchandise-only vs `OrderMirror.totalVnd` before Ads Purchase publish.
- [ ] **O2 Merchant market:** confirm initial country/language/currency; proposed Vietnam / Vietnamese / VND.
- [x] **O3 Apparel facts — policy decision resolved by ADR 0007:** Merchant v1 shop defaults are `gender=male`, `age_group=adult`, `condition=new`; standalone products may override each fact through local website-owned product data. Runtime persistence/validation/admin/effective-fact resolution remains open under M3 and Merchant activation stays blocked until that implementation is verified.
- [ ] **O4 Vendor config:** provide/review GTM container, GA4 Measurement ID, Google Ads conversion ID/label, TikTok Pixel ID.

## Review-resolution gates

### Review `5061555088`
- [ ] **R1 Preview isolation:** production destination tags require `la_tracking_mode=live`; preview never relies on Tag Assistant as a sandbox.
- [ ] **R2 Atomic cart deltas:** update/remove transaction returns committed old/new/removed quantities from inside the cart lock.
- [ ] **R3 Merchant composite:** composite Merchant offers deferred in v1; standalone IDs require durability proof.
- [ ] **R4 Merchant envelope:** max 5,000 offers, 16 MiB, ≤8 DB round trips; overflow never partial `200`.

### Review `5062244480`
- [ ] **R5 GTM live interlock:** PR-A contains **no GTM loader**. Requested preview/live stay operationally disabled until T8 has an exact saved GTM version + reviewed export. PR-C owns first GTM script/CSP opening.
- [ ] **R6 Server-truth AddToCart:** successful server purchase action returns canonical bounded item facts from the same authorized selection committed to cart; browser does not use stale pre-request price.
- [ ] **R7 Product vs variant identity:** list/select/initial unselected PDP use product-level `pancakeProductId`; exact variant `pancakeVariationId` begins only when a concrete variant is selected/committed. Price ranges are never reported as an exact selected price.
- [ ] **R8 Feed amplification:** complete successful Merchant feed is cached for 300s under a fixed bounded key; concurrent cold requests are single-flight for current one-app-service topology; byte counting is incremental; repeated GETs within TTL do not re-run heavy DB generation. Multi-replica deployment requires shared cross-replica protection before activation.

### Review `5062693858`
- [ ] **R9 PDP atomic add semantics:** PDP “Thêm vào giỏ hàng” uses a distinct server mutation that atomically increments the existing line by exactly `+1` under the cart lock; it must not reuse absolute `setItemQuantity(..., 1)` semantics. Success returns `previousQuantity`, committed `quantity`, and `addedQuantity=1`; no successful no-op/decrease may be reported as `add_to_cart`.
- [ ] **R10 Mutation event snapshot:** PDP add, cart absolute update, and remove return a bounded non-PII `CommerceVariantItem` snapshot captured/resolved server-side at the accepted mutation truth point under the same serialized cart transaction. It includes `pancakeVariationId`, authoritative resolved `unitPriceVnd`, item name, color/size where available, and the relevant committed delta quantity. Any pre-transaction availability check is advisory only; accepted absolute update must revalidate current eligibility/stock under the serialized mutation. If a safe snapshot cannot be resolved, the commerce mutation remains authoritative but analytics fails closed with no stale client fallback.
- [ ] **R11 Merchant failure backoff:** a failed/overflow heavy rebuild installs a fixed-key negative backoff sentinel for `MERCHANT_FEED_FAILURE_BACKOFF_SECONDS=60`. Sequential or concurrent requests during backoff return a cheap bounded `503` (with bounded `Retry-After`) and do not invoke heavy generation. Failure state never overwrites/poisons a valid successful feed cache entry.

### Review `5062818394`
- [ ] **R12 Canonical cart/checkout analytics projection:** propagate `pancakeVariationId` through canonical resolved cart facts used by cart/checkout (or one dedicated equivalent projection). `view_cart` and `begin_checkout` are **all-or-nothing**: if any non-empty line lacks safe external variant identity, authoritative price, positive quantity, or item name, suppress the whole event. Never substitute local `VariantMirror.id`, never drop only the unsafe line, and never report a partial merchandise total.

## PR-A — tracking preparation; zero new GTM/vendor network delivery

### T1 Canonical event/dataLayer contracts
- [x] Define `CommerceProductImpression` separately from selected `CommerceVariantItem`.
- [x] Product impression supports product external ID + exact/min/max price without requiring a fake variant.
- [x] Selected variant item requires `pancakeVariationId`, exact unit price, quantity.
- [x] Typed Purchase/event facts contain no customer PII.
- [x] Reset ecommerce state before every ecommerce push.
- [x] Tracking publisher is fail-safe and never replaces initialized `window.dataLayer`.
- [x] RED/GREEN tests cover product-vs-variant identity, sequential-event isolation, malformed/unavailable tracking.

### T2 Desired tracking mode/config + CSP interlock
- [x] Parse/validate desired `disabled | preview | live` + future GTM container ID.
- [x] `live` is deployment-owned; no Host/query/client activation.
- [x] Before T8, both requested `preview` and requested `live` resolve to **no GTM load**.
- [x] PR-A opens no new Google/TikTok CSP origins and adds no production `unsafe-eval`/wildcard.
- [x] Update env examples and focused config/CSP tests.

### T3 dataLayer + consent + page-view preparation; still no GTM loader
- [x] Initialize/queue `dataLayer` and immutable `la_tracking_mode` fact.
- [x] Queue current Google consent default before eventual measurement.
- [x] Emit exactly one application-owned initial/App Router `page_view` into dataLayer.
- [x] Preserve existing direct Meta mount.
- [x] Assert no GTM script/iframe/network loader exists in PR-A.

### Checkpoint A
- [x] Focused tests green.
- [x] `pnpm typecheck` green.
- [x] `pnpm lint` green.
- [x] Security review proves PR-A cannot load GTM in any mode and adds no new third-party network path.

## PR-B — commerce browser events

### T4 Product + selected-variant projection facts
- [x] Expose stable `pancakeProductId` on list/PDP product facts.
- [x] Propagate `pancakeVariationId` + optional SKU through concrete standalone/composite options and server cart mutation lookup facts.
- [x] Extend canonical resolved cart/checkout line facts with `pancakeVariationId` for every analytics-safe line; composite component lines use the actual purchased component variation ID, not parent/presentation identity.
- [x] Keep local `VariantMirror.id` as mutation/authorization identity only; it must never be mapped as vendor `item_id` fallback.
- [x] Presentation `kindKey` never becomes external identity.
- [x] Existing price/stock/composite privacy behavior unchanged.
- [x] RED/GREEN projection tests cover standalone cart line, composite component cart line, and unresolvable/private line without fabricating external identity.

### T5 Product-level list/PDP/select + atomic server-authoritative AddToCart
- [x] `view_item_list` emits exactly one product impression per visible card.
- [x] `select_item` uses clicked product identity even though no size/color is selected yet.
- [x] Initial unselected `view_item` uses product identity.
- [x] Equal resolved product price may map as exact price; multi-price range does **not** map minimum as selected exact price; unresolved price omits monetary fields.
- [x] Introduce a dedicated PDP atomic add mutation; do not call the cart’s absolute set-quantity path with `quantity=1`.
- [x] Under the existing cart lock, absent line → `0→1`; existing quantity `q` → `q→q+1`, subject to current stock/integer bounds. Each successful repeated/concurrent PDP add against the same live cart identity contributes exactly one committed unit.
- [x] Successful PDP add returns `previousQuantity`, committed `quantity`, `addedQuantity=1`, plus bounded canonical item snapshot from the same accepted transaction.
- [x] `add_to_cart.quantity = addedQuantity`; a no-op/decrease/failure can never emit PDP `add_to_cart`.
- [x] AddToCart event uses server-returned `pancakeVariationId`, `unitPriceVnd`, item name/color/size and accepted delta; never stale `selection.selectedPrice` or rendered cart data.
- [x] Direct Meta event name/content IDs/direct-delivery/success boundary remain compatible; any Meta value-source correction has regression coverage.
- [x] RED/GREEN tests: absent→1, existing 1→2, existing >1 increments rather than resetting, stock-bound failure, concurrent repeated PDP clicks against the same live cart identity, stale browser price vs current server snapshot, failed snapshot → no canonical tracking, no duplicate Meta behavior.

### T6 Atomic cart delta + authoritative mutation snapshot + checkout events
- [x] Any `canSetQuantity`/rendered pre-check outside the mutation is advisory only; re-resolve current commerce eligibility and requested-quantity stock sufficiency inside the serialized mutation before accepting an absolute update.
- [x] Under existing cart lock, update returns `previousQuantity` + committed `quantity`.
- [x] Under the same lock, remove captures `removedQuantity` before destructive delete; already-missing line is not a real removal.
- [x] The transaction also captures/resolves bounded non-PII event item facts: `pancakeVariationId`, authoritative `unitPriceVnd`, product/item name, color/size where available, plus optional safe product/projection context.
- [x] Increase → delta `add_to_cart`; decrease/remove → delta `remove_from_cart`; zero delta/failure → no event.
- [x] Browser builds quantity events only from the returned server snapshot + delta. It never falls back to server-rendered/client-cached name, price, variant ID, or quantity after a mutation.
- [x] If safe identity/price snapshot resolution fails, cart mutation result remains commerce truth but tracking emits nothing and must not throw into cart UX.
- [x] Build one pure canonical cart analytics projection from current resolved cart facts. It succeeds only when **every** non-empty line has safe `pancakeVariationId`, authoritative non-negative unit price, positive integer quantity, and item name; otherwise it returns unavailable without a partial items array.
- [x] `view_cart` and `begin_checkout` use only that complete projection. Event merchandise `value` is the sum of `unitPriceVnd × quantity` across the exact full emitted line set. If projection is unavailable, suppress the whole event; do not drop unsafe lines or recalculate/report a partial total.
- [x] `view_cart` may emit only from current cart truth. `begin_checkout` may emit only after the existing checkout commerce-validity gates pass; analytics projection failure never blocks cart/checkout UI.
- [x] Local CUID/`VariantMirror.id` is forbidden as GA4/Ads/TikTok item identity fallback.
- [x] RED/GREEN mutation tests: two absolute updates, remove/already-removed, same quantity, failed mutation; price/catalog/stock change between render/pre-check and mutation; full remove snapshot captured before delete; enrichment disappearance/snapshot failure → no stale event.
- [x] RED/GREEN cart/checkout projection tests: all-safe standalone lines → complete `view_cart`; all-safe composite component line → real component `pancakeVariationId`; multiple safe lines → full item set and exact full merchandise sum; one safe + one unresolvable/private/missing-external-ID line → **no whole `view_cart`** and **no `begin_checkout` tracking event**; no partial totals.
- [x] Keep `add_shipping_info` / `add_payment_info` absent until a real accepted milestone exists.

### Checkpoint B
- [x] Focused cart/PDP/checkout tests green.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint` green.
- [x] Review product-vs-variant IDs, canonical cart/checkout external identity, exact full-cart values, committed delta, server snapshot and all-or-nothing failure-closed tracking semantics.

This is the PR-B tracking checkpoint only. The growth-commerce master programme has a separate
storefront Checkpoint B covering U12–U17; nothing here marks that one.

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
- [x] Prove external-ID durability by provider contract, controlled repeated full-catalog resync evidence + repository reconciliation tests, or equivalent approved history. **PROVEN via §3.3 Option B.** A controlled experiment on production product `a132` (`scripts/pancake-m1-durability-experiment.ts`) with independent owner-controlled cryptographic markers at the raw Pancake API boundary proved that the same upstream product and variations retain the exact same `pancakeProductId` and `pancakeVariationId` across controlled reversible mutations and repeated full-catalog observations, with zero remap and verified restoration; combined with repository reconciliation tests (`tests/database/merchant-identity-audit.test.ts`). Recorded in `docs/audits/merchant-identity-m1.md`.
- [ ] Audit SKU-as-MPN presence/uniqueness/stability.
- [ ] Every composite projection becomes `COMPOSITE_DEFERRED` in v1.
- [ ] Audit price/media/content/apparel **runtime readiness** with bounded non-PII diagnostics; ADR 0007 resolves owner policy but does not by itself make runtime apparel facts ready.

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
- [ ] Add local website-owned product-level O3 override persistence and server-authoritative validation for the reviewed Merchant enums; Pancake sync cannot erase overrides.
- [ ] Add product admin editing with an explicit “use shop default” state; clearing an override returns to inheritance rather than copying the current default.
- [ ] Resolve effective apparel facts as `explicit product override → ADR 0007 shop default`; never infer from product name/category/description/size/model output.
- [ ] Map canonical price, availability, trusted image, description, exact deep link, color/size, current required variant fields and effective O2/O3 values.
- [ ] Structurally valid zero-stock offers remain `out_of_stock`.
- [ ] Malformed/unavailable apparel policy or overrides exclude the offer with a bounded `APPAREL_FACT_UNRESOLVED`-class reason; unsafe/unresolved/composite records remain excluded with bounded reasons.
- [ ] RED/GREEN tests cover inherited defaults, each independent override, mixed overrides, clearing back to inheritance, invalid values, Pancake resync preservation, and fail-closed unresolved apparel facts.

### M4 Cached/single-flight serializer + bounded public route + failure backoff
- [ ] GET-only `/feeds/google-merchant` with safe standards-aware serialization.
- [ ] `MAX_MERCHANT_OFFERS = 5_000`.
- [ ] `MAX_MERCHANT_FEED_BYTES = 16 MiB` with **incremental UTF-8 byte accounting**; abort before next chunk exceeds limit.
- [ ] `MAX_MERCHANT_DB_ROUND_TRIPS = 8`; no N+1.
- [ ] `MERCHANT_FEED_CACHE_TTL_SECONDS = 300`.
- [ ] `MERCHANT_FEED_FAILURE_BACKOFF_SECONDS = 60`.
- [ ] Fixed success-cache and failure-backoff key domain is configured shop + feed schema/version only; query/header noise cannot create unbounded keys.
- [ ] Cache only complete successful serialized feed; failure sentinel stores bounded non-sensitive failure class/retry time only.
- [ ] Repeated GETs within success TTL perform zero additional heavy DB generations.
- [ ] Concurrent cold requests are collapsed by a tested single-flight mechanism for current one-app-service topology.
- [ ] After a failed/overflow heavy rebuild, sequential or concurrent requests inside 60s backoff return cheap `503` with bounded `Retry-After` and perform zero additional heavy DB generations.
- [ ] Backoff expiry admits one new single-flight rebuild attempt, not one attempt per waiting request.
- [ ] Failure/backoff state never overwrites, corrupts, or marks a complete successful feed body as failed.
- [ ] If production changes to multiple app replicas, block activation until shared cross-replica cache/single-flight/backoff protection is proved.
- [ ] Failed/overflow rebuild never publishes/caches partial result as success.
- [ ] Overflow target `503`; never partial/truncated `200`.
- [ ] Tests: parse output, escaping/Unicode/control chars, malformed URLs, deterministic order, offer/byte limit and limit+1, query budget, first miss/repeated hit, concurrent cold miss, concurrent TTL expiry, query-string cache noise, sequential failure backoff, concurrent failed rebuild, backoff expiry single retry, success-cache/failure-sentinel isolation.

### Checkpoint E
- [ ] Focused Merchant mapping/route/cache/backoff tests green.
- [ ] `pnpm test`, `pnpm test:db`, `pnpm typecheck`, `pnpm lint`, `pnpm build` green on exact PR-E head.
- [ ] Real Next runtime smoke confirms cached/backoff route status/content type/complete body/no secrets and cheap repeated failure behavior.

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
- [ ] Merchant cache/backoff/fetch/diagnostics/crawler evidence recorded.
- [ ] Verify production topology still matches one-app-service cache/single-flight/backoff assumption; otherwise shared cross-replica protection is mandatory.
- [ ] Final review: correctness → security → architecture → simplicity → performance.
- [ ] Rollback documented for GTM exact-version delivery and Merchant data source/cache/backoff.
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
