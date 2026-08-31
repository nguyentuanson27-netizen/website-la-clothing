# Marketing analytics & Google Shopping — implementation plan

Status: **PROPOSED — planning artifact only; human approval required before `/build`.**

Source specification: `docs/specs/marketing-analytics-shopping.md`.

PR #153 intentionally keeps `/spec` + `/plan` together as a docs-only review unit. This plan is the normative v1 implementation narrowing of the specification. Where a conceptual example in the spec is broader than the repository can truthfully support today, the reviewed decisions below govern implementation. Runtime code must land in focused implementation PRs, not in this planning PR.

## 1. Goal and invariants

Implement GA4 + Google Ads + TikTok Pixel through GTM, preserve the existing direct Meta Pixel + CAPI integration, and expose an automated Google Merchant product-data source without moving commerce truth into vendor tooling or weakening current CSP/search-exposure behavior.

Core invariants:

- business/order/cart state owns commerce truth;
- GTM is routing/mapping only;
- Purchase exists only for `OrderMirror.state === CONFIRMED`;
- `publicCode` is the shared Purchase transaction/event identity;
- no GTM container may load before the exact reviewed container version is available;
- only approved production configuration may send live vendor traffic;
- preview/test traffic must be mechanically isolated from production destinations;
- tracking failure must never break shopping/checkout;
- no customer PII enters the generic commerce `dataLayer`;
- upper-funnel events must not invent a selected variant when the UI has not selected one;
- cart/Purchase events use server-committed facts rather than stale browser facts;
- Merchant output is fail-closed when identity, price, landing context, serialization, cache, or resource limits are unsafe.

## 2. Repository facts that shape implementation

- `next.config.mjs` currently has no Cache Components opt-in and builds a fail-closed CSP from build-time tracking configuration.
- `src/app/layout.tsx` owns the direct Meta mount point and is the app-level location where future GTM loading can be enabled.
- `StorefrontProductCard` represents one product card, links to `/shop/<slug>`, and may show an exact product price or `Từ <minimum>`; it does not select one variant.
- `ProductPurchasePanel` starts with kind/color/size unselected and shows product-level exact/range pricing until a concrete option is selected.
- current PDP AddToCart captures `selection.selectedPrice` in the browser before awaiting the server action.
- `storefront-purchase.ts` re-fetches the current product and re-resolves the authorized option on the server before the cart mutation, while the public action currently collapses success to `{ ok: true }`. Therefore the browser price is not an authoritative post-mutation fact.
- `/checkout` renders only when current cart, price, stock, and shipping facts resolve, so it is the current `begin_checkout` truth point.
- `/checkout/success` checks `OrderMirror.state === CONFIRMED` before browser Purchase.
- `OrderLineSnapshot` stores `pancakeVariationId`, product name, color, size, quantity, and immutable prices, but not SKU/slug/Merchant/composite context.
- `VariantMirror.pancakeVariationId` is DB-unique; SKU is nullable and not DB-unique.
- mirror sync reconciles variants by `pancakeVariationId` and products by `pancakeProductId`; this proves repository identity semantics but not upstream lifetime durability by itself.
- cart mutations serialize on the cart row, but current update/remove results do not return old/removed quantity from inside that lock.
- composite storefront projection can sell a component variation through a different public parent PDP; presentation keys such as `component-1` are not stable external IDs.
- current PDP JSON-LD is aggregate, not exact variant authority.
- Next.js Route Handlers are not cached by default. Current repo does not enable Cache Components, so v1 must not assume `use cache` without a separate framework/config decision.
- current VPS Compose topology declares one `app` service instance behind the proxy path; v1 single-flight requirements are scoped to that reviewed topology. If deployment is changed to multiple application replicas before Merchant activation, V1 must add/prove a shared cross-replica cache/single-flight layer rather than assuming a process-local guard is sufficient.

## 3. Locked v1 decisions

### 3.1 Two commerce identity levels: product impression vs selected variant

The earlier conceptual `CommerceItem` sketch in the spec must **not** be interpreted as requiring a `pancakeVariationId` for every ecommerce event. The repository has upper-funnel states where no variant is selected.

Use two fact shapes.

#### Product-level impression fact

Used for `view_item_list`, `select_item`, and the initial unselected PDP `view_item`:

```ts
type CommerceProductImpression = {
  productExternalId: string; // candidate: pancakeProductId
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

- `productExternalId` candidate is `pancakeProductId`, not a guessed variant.
- one rendered card produces one product impression; do not explode one card into every variation.
- `select_item` describes the product card the shopper selected, even though no size/color variant exists yet.
- initial PDP `view_item` is product-level unless the route itself authoritatively preselects a valid variant in a later approved contract.
- if all currently represented resolved options have the same price, `exactPriceVnd` may be set and vendor `price`/`value` may use it.
- if represented prices form a range, carry min/max only as canonical/custom facts and **omit vendor fields that would pretend the minimum is the exact selected price**.
- if there is no resolved price, omit monetary fields rather than fabricate one.
- GA4 mapping may use `item_id = productExternalId`; GA4 requires an item ID or item name, while price is optional. Merchant offer matching is not promised for these unselected upper-funnel impressions.

#### Selected/committed variant fact

Used for `add_to_cart`, `remove_from_cart`, `view_cart`, `begin_checkout`, and Purchase items:

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

Rules:

- `variantExternalId = pancakeVariationId` only when the application has a concrete selected/committed variant.
- internal `VariantMirror.id` remains the mutation/authorization identity.
- browser/cart/Purchase values use server-authoritative committed facts at their truth point.
- SKU remains intended as LA Clothing MPN only after M1 proves presence, uniqueness and stability for emitted Merchant items.
- Pancake barcode is never assumed to be GTIN.

Purchase `transaction_id` / `event_id` remains `OrderMirror.publicCode`.

### 3.2 Merchant scope — standalone only in v1

Merchant v1 **does not emit composite projections**.

Reason: a component variation sold through a parent composite PDP does not yet have a proven durable Merchant family identity, and a composite set/component relationship is not automatically the same thing as a normal color/size variant family. Until a separate design proves a durable composite public-context family contract, composite offers fail closed with `COMPOSITE_DEFERRED`.

For standalone products only:

- `id` candidate = `pancakeVariationId` after durability/format audit;
- `item_group_id` candidate = `pancakeProductId` when the standalone product has variants and after durability/format audit;
- each submitted variation gets a distinct deep link `/shop/<slug>?variant=<pancakeVariationId>`;
- the deep link preselects only a valid current public standalone option;
- organic-search canonical remains the base PDP contract; the variant query must not silently create an independent organic canonical/indexing policy.

Composite Merchant support is a separate later design/plan, not an implicit extension of M3.

### 3.3 External-ID durability gate

DB uniqueness/current upsert semantics are insufficient evidence for a live Merchant identity. Before Merchant activation M1 must collect at least one durability proof for both `pancakeVariationId` and `pancakeProductId`:

1. provider/API contract evidence that the IDs are stable for the lifetime of the same upstream product/variation; or
2. controlled repeated full-catalog resync evidence showing the same upstream objects retain the same IDs, combined with repository tests proving mirror rows are reconciled by those IDs; or
3. equivalent historical evidence approved in review.

If durability cannot be established, Merchant activation is blocked. Do not silently fall back to slug, color/size text, array position, presentation key, or local cuid.

### 3.4 GTM load gate: PR-A prepares dataLayer; PR-C owns the first actual GTM load

**No GTM script/container is loaded in PR-A.** This is stricter and simpler than trying to make a partially configured `live` mode safe.

PR-A may implement:

- validated desired mode/config inputs;
- `dataLayer` initialization;
- immutable `la_tracking_mode` bootstrap fact;
- current consent-default commands/state;
- canonical page-view/ecommerce events queued into `dataLayer`;
- tests that tracking preparation is fail-safe.

But before T8:

- both requested `preview` and requested `live` resolve operationally to **no GTM load**;
- Google/TikTok CSP origins stay closed unless another already-active reviewed integration needs them;
- no production GA4/Ads/TikTok network delivery is possible from the new integration.

T8 / PR-C owns the first GTM loader and CSP opening, and it may do so only after the exact container version below is reviewed.

### 3.5 Immutable GTM version contract

GTM workspace state is mutable, so a generic checked-in export is not enough. T8 must create and record an immutable version before final preview/publish.

Required record:

- GTM container ID;
- saved **container version number/ID**;
- export JSON produced from that exact saved version;
- repository path + checksum/Git identity for the reviewed export;
- destination IDs/labels redacted only if actually secret (ordinary GA4/Ads/TikTok public identifiers may remain visible according to repo policy);
- review result proving every production GA4/Ads/TikTok destination tag is gated by `la_tracking_mode == live`.

Required lifecycle:

1. configure workspace;
2. save/create an immutable GTM version;
3. export that exact version and commit/review it;
4. preview **that exact saved version**, not an unversioned mutable workspace;
5. verify production destinations are blocked in preview/test mode;
6. only then allow application preview mode to load GTM;
7. for live activation, publish that exact reviewed version and record the published version ID;
8. any later console change requires a new GTM version + new export/review before production publish.

Tag Assistant is runtime evidence, not the isolation mechanism.

### 3.6 Consent

The application owns vendor-neutral consent state. Current production policy is tracking granted immediately and visible consent UI remains deferred, but the implementation must queue/establish Google consent defaults before GTM measurement and keep the policy replaceable later without changing the commerce event contract.

### 3.7 Destination semantics

- Exactly one GA4 page-view authority: application-owned canonical `page_view`; overlapping automatic/history page view must be disabled in the reviewed GTM version/property setup.
- Before each ecommerce event, clear/reset the prior ecommerce object so stale keys cannot bleed into the next event.
- Google Ads: Purchase is the only required primary conversion in v1; `transaction_id = publicCode`; conversion-linking functionality is required; Enhanced Conversions are out of scope.
- TikTok Pixel runs through GTM; Purchase/CompletePayment uses `event_id = publicCode` now so later Events API can share identity.
- Existing Meta Pixel + CAPI remain direct and no Meta tag is added to GTM.

### 3.8 Server-authoritative AddToCart success facts

T5 must extend the existing server purchase success boundary rather than reporting from `selection.selectedPrice` captured before the request.

On a successful AddToCart, the server returns a bounded non-PII item snapshot derived from the **same re-resolved option that passed server validation and was committed to the cart**, including at minimum:

- `pancakeVariationId`;
- current resolved `unitPriceVnd`;
- accepted `quantity`;
- product/item name needed for analytics;
- color/size when available;
- optional product external ID/projection context when safely known.

The browser builds the canonical AddToCart event only from this success payload. A stale pre-request price must never win over the server-resolved committed price.

Existing Meta event name, content-ID semantics, success/failure boundary, and direct-delivery architecture remain unchanged. If the refactored success payload is used to supply Meta `value`, it must use the same current server-resolved price and dedicated regression tests must prove no duplicate or failure-path behavior change.

### 3.9 Merchant public-route envelope, cache, and request-amplification control

A finite per-generation envelope is necessary but insufficient for a public GET route. V1 therefore uses **cached complete-feed generation plus a single-flight rebuild contract**.

Current repo does not enable Cache Components. During `/build`, re-verify Next.js 16.2.x APIs; the baseline v1 approach is the existing supported Data Cache (`unstable_cache`) with no request-derived cache key rather than enabling Cache Components as an unrelated architecture change.

Initial contract:

- `MAX_MERCHANT_OFFERS = 5_000` emitted offers;
- `MAX_MERCHANT_FEED_BYTES = 16 * 1024 * 1024` bytes;
- `MAX_MERCHANT_DB_ROUND_TRIPS = 8` database round trips per heavy generation;
- `MERCHANT_FEED_CACHE_TTL_SECONDS = 300`;
- one fixed cache key per configured shop + feed schema/version; URL query/header values must not create unbounded cache keys;
- cache **only a complete successful serialized feed**; never cache partial output as success;
- collapse concurrent cache misses through a proved single-flight mechanism for the current deployment runtime; if the chosen framework cache cannot prove concurrent-miss collapse, add the smallest process-local guard for the current one-app-service topology before exposing the route;
- if production topology is changed to multiple app replicas, activation is blocked until a shared cross-replica cache/single-flight mechanism is proved;
- repeated requests inside TTL return cached bytes without repeating DB-heavy generation;
- no per-record/N+1 query path.

Serialization must be incrementally bounded:

- validate/normalize bounded fields before serialization;
- maintain running UTF-8 byte count while appending serialized chunks;
- abort/fail closed as soon as the next chunk would exceed 16 MiB;
- do not build an arbitrarily large full body and measure it only afterward.

Overflow/failure behavior:

- offer/query/byte envelope overflow returns non-success (target `503 Service Unavailable`) with bounded non-sensitive diagnostics;
- never silently truncate and never return a partial `200`;
- a failed rebuild must not replace a previously valid complete cache entry with partial/corrupt data;
- route accepts no request-controlled shop/source URL or expensive filter dimension.

Required amplification tests:

- first miss invokes heavy generation once;
- repeated GETs within TTL invoke heavy generation zero additional times;
- many concurrent GETs on one cold key cause at most one heavy generation per proved runtime/cache domain;
- TTL expiry causes one rebuild, not one rebuild per concurrent caller;
- query-string noise does not create new generation/cache keys;
- offer limit, limit+1, byte limit/overflow, and query budget remain enforced.

## 4. Owner/account gates

These do not block pure foundations but block the affected live destination:

- **O1 — Google Ads Purchase value:** choose merchandise-only vs `OrderMirror.totalVnd` before Ads Purchase publish. GA4 remains merchandise value with shipping separate.
- **O2 — Merchant market:** proposed initial market Vietnam / Vietnamese / VND; confirm before Merchant activation.
- **O3 — Apparel facts:** confirm whether every emitted standalone item can truthfully use catalog-wide `gender=male`, `age_group=adult`, `condition=new`; otherwise add product-owned facts before activation.
- **O4 — Vendor configuration:** provide/review GTM container, GA4 Measurement ID, Google Ads conversion ID/label, and TikTok Pixel ID through their proper account owners.

## 5. Dependency graph

```text
T1 canonical event + identity-level contracts
 ↓
T2 desired tracking config / fail-closed interlock
 ↓
T3 dataLayer + consent + page_view preparation (NO GTM load)
 ↓
T4 product + variant projection facts
 ├───────────────┐
 ↓               ↓
T5 list/PDP +    T6 atomic cart deltas + checkout
server-truth ATC │
 └───────┬───────┘
         ↓
T7 confirmed Purchase
         ↓
T8 immutable GTM version + loader/CSP + destination mapping + preview/live enablement

T4 → M1 Merchant identity/durability audit
       ↓
     M2 standalone variant deep link + canonical/query contract
       ↓
     M3 standalone Merchant mapper
       ↓
     M4 cached bounded serializer/public route
       ↓
     M5 Merchant activation

T8 + M5 → V1 final verification / rollback gate
```

## 6. Implementation slices

ADR 0005 governs reviewability; file count is only a signal.

- **PR-A — tracking preparation:** T1–T3. It must produce zero new GTM/vendor network delivery.
- **PR-B — commerce browser events:** T4–T6, including server-authoritative AddToCart facts.
- **PR-C — confirmed Purchase + immutable GTM activation:** T7–T8, including actual GTM loader/CSP opening, saved-version export, static live-guard audit, preview enablement, and later live publish gate.
- **PR-D — Merchant identity + standalone deep link:** M1–M2.
- **PR-E — Merchant feed:** M3–M4, including cache/single-flight/resource controls.
- **PR-F — Merchant activation + final convergence:** M5 + V1; primarily operational/verification records unless a verified launch defect requires code.

Do not split directly affected tests away from their behavior merely to hit a line target; do split independent subsystems when review/revert boundaries are cleaner.

---

## T1 — Canonical event contracts and dataLayer publisher

**Build:** typed product-impression, selected-variant, Purchase, and event facts plus one browser publisher.

**Acceptance:**

- upper funnel can represent a product without a selected variant;
- selected/cart/Purchase events require concrete variant identity;
- no customer PII in generic events;
- reset ecommerce state immediately before every ecommerce push;
- publisher never replaces initialized `window.dataLayer`;
- malformed/unavailable tracking fails closed without throwing into commerce.

**Verification:** RED/GREEN deterministic mapping, product-vs-variant identity separation, sequential A→B event isolation, malformed values, browser unavailable path.

## T2 — Desired tracking configuration and fail-closed deployment interlock

**Build:** validate desired `disabled | preview | live` configuration and future GTM container ID without loading GTM.

**Acceptance:**

- desired `live` cannot come from Host/query/client input;
- malformed/missing configuration fails closed;
- until T8-reviewed container artifact is present, both desired `preview` and desired `live` resolve operationally to no GTM load;
- no new production `unsafe-eval`, wildcard source, or Google/TikTok CSP hole is opened in PR-A.

**Verification:** config tests for disabled/requested-preview/requested-live before T8, malformed IDs, and zero loader/CSP vendor exposure.

## T3 — dataLayer, consent default, and page-view authority — still no GTM loader

**Build:** initialize/queue `dataLayer`, `la_tracking_mode`, consent defaults, and App Router canonical page-view events. Preserve direct Meta mount.

**Acceptance:**

- bootstrap ordering is deterministic;
- no GTM script/iframe/network loader exists yet;
- requested preview/live cannot deliver new vendor traffic;
- Google consent defaults are queued before eventual measurement;
- exactly one canonical initial/navigation `page_view` is queued.

**Verification:** source/component tests prove ordering, one page-view event, zero GTM loader, and no Meta duplication.

### Checkpoint A

Focused tests + `pnpm typecheck` + `pnpm lint`; security review proves PR-A cannot load GTM in any mode and adds no new third-party network path.

---

## T4 — Product-impression and selected-variant projection facts

**Build:** expose stable `pancakeProductId` on product/list/detail facts and `pancakeVariationId` on concrete options while retaining local variant ID for authorization.

**Acceptance:**

- one card has a product-level external identity independent of variant choice;
- concrete standalone/composite options carry variation identity;
- presentation `kindKey` never becomes external identity;
- existing price/stock/ambiguity/privacy behavior unchanged.

**Verification:** list/PDP standalone + multi-price + composite projection tests, including no selected variant at initial PDP state.

## T5 — List/PDP/select events and server-authoritative AddToCart

**Build:** emit upper-funnel events from product facts; extend successful purchase action to return canonical committed item facts; emit AddToCart from that success payload.

**Acceptance:**

- `view_item_list` contains one item per visible product card, not every variant;
- `select_item` uses the clicked product identity;
- initial unselected `view_item` uses product identity;
- exact vendor `price`/`value` is emitted only when product-level pricing is exact; a range is not reported as if the minimum were selected;
- AddToCart only after successful server mutation;
- AddToCart variation ID, unit price and quantity come from server-returned current committed facts, never stale pre-request `selection.selectedPrice`;
- failed mutation emits no AddToCart;
- direct Meta event name/content-ID/success boundary remains compatible; any Meta value source change is covered by regression tests.

**Verification:** multi-price product, equal-price product, no-resolved-price product, click-before-selection, stale-browser-price/server-new-price, failed mutation, and no duplicate Meta behavior.

## T6 — Atomic cart delta events and BeginCheckout

**Build:** extend cart transaction results so analytics receives committed quantity transitions rather than stale UI state.

Required mutation facts captured **inside the existing cart lock/transaction**:

- update success returns `previousQuantity` and committed `quantity`;
- remove success returns `removedQuantity` and distinguishes already-missing line from a real removal;
- public action returns only bounded facts needed for event construction;
- browser derives delta only from server-returned committed facts.

**Acceptance:** increase → delta AddToCart; decrease/remove → delta RemoveFromCart; same quantity/failure/already-removed → no fabricated event; cart/checkout payloads contain no customer name/phone/address; valid checkout emits `begin_checkout`; shipping/payment milestones remain absent until real distinct accepted states exist.

**Verification:** RED/GREEN concurrent absolute updates, concurrent remove/already-removed, same quantity, failed mutation, and existing cart behavior.

### Checkpoint B

Focused cart/PDP/checkout tests + `pnpm test` + `pnpm typecheck` + `pnpm lint`; review product-vs-variant identity, value, quantity and server-truth semantics.

---

## T7 — Canonical confirmed Purchase

**Build:** vendor-neutral Purchase snapshot from immutable order facts; browser event on existing confirmed-success boundary.

**Acceptance:** only `CONFIRMED`; `transactionId/eventId = publicCode`; item quantities/prices/variation IDs from `OrderLineSnapshot`; mutable catalog enrichment optional and non-authoritative; repeat visit keeps same identity; tracking failures do not alter checkout success.

**Verification:** non-confirmed states, catalog deletion/enrichment loss, money bounds, repeat identity; existing Meta browser+CAPI tests stay green.

## T8 — Immutable GTM version, actual loader/CSP, destination mapping, preview/live gates

**Build:** create/review exact GTM saved version; only then add actual GTM loader and required CSP origins.

**Acceptance:**

- record container ID + saved container version number/ID;
- export JSON from that exact saved version and commit it with immutable repository identity/checksum;
- static audit proves every production GA4/Ads/TikTok tag has explicit `la_tracking_mode == live` condition/blocker;
- GA4 auto/history page views disabled under app-owned page-view strategy;
- Ads Purchase uses `publicCode`, O1 value and conversion linking; no Enhanced Conversions;
- TikTok Purchase/CompletePayment uses `event_id=publicCode`;
- preview/test tags target isolated test/debug destinations only;
- application preview may load GTM only after the exact saved version/export audit passes;
- final verification previews that exact saved version;
- live publish must publish that same reviewed version and record its published version ID;
- any console edit after review invalidates approval and requires new version/export/review.

**Verification:** static export assertion + recorded version ID + Tag Assistant preview of exact version + GA4 DebugView/test destination + Ads/TikTok diagnostics. Explicitly prove preview sends zero traffic to production destinations.

---

## M1 — Read-only Merchant identity, durability and catalog audit

**Build:** bounded audit over current mirrored catalog.

**Acceptance:** validate format/length for `pancakeVariationId` and standalone `pancakeProductId`; prove durability gate; audit SKU-as-MPN presence/uniqueness/stability; classify all composite projections as `COMPOSITE_DEFERRED`; audit price/media/content/apparel facts without PII.

**Verification:** missing/duplicate/overlong IDs, missing SKU, composite deferred, out-of-stock, `PRICE_UNRESOLVED`, malformed text, authorized real-catalog evidence.

## M2 — Standalone variant deep link and search contract

**Build:** `/shop/<slug>?variant=<pancakeVariationId>` only for valid current standalone variation.

**Acceptance:** exact option preselection and matching price/color/size/image; forged/stale/inactive/private/composite query cannot expose unauthorized option; base PDP canonical/search exposure remains authoritative; variant query does not independently enable indexing.

**Verification:** standalone valid/stale/forged/composite-rejected tests + representative browser regression + SEO canonical/query regression informed by merged SEO/GEO audit.

### Checkpoint C

Do not build/activate Merchant feed until ID/MPN/durability audit is green for intended standalone records. Composite inventory remains intentionally absent from Merchant v1.

---

## M3 — Standalone Merchant mapper and diagnostics

**Build:** pure mapper from canonical standalone product/variation facts.

**Acceptance:** stable audited ID/grouping, `brand=LA Clothing`, audited MPN, no inferred GTIN, canonical price, trusted image, exact deep link, color/size, current required variant fields, approved O2/O3 values; structurally valid zero-stock offer remains `out_of_stock`; unsafe/unresolved/composite rows excluded with bounded reason.

**Verification:** normal variant, out-of-stock, missing content, invalid SKU, price/media mismatch, composite exclusion; counts reconcile with M1.

## M4 — Cached, single-flight, bounded serializer and public Merchant route

**Build:** standards-aware serializer + fixed public GET `/feeds/google-merchant` route + complete-feed cache.

**Acceptance:**

- heavy generator bounded by 5,000 offers and ≤8 DB round trips;
- serializer counts UTF-8 bytes incrementally and aborts before >16 MiB;
- complete successful serialized result cached for 300 seconds under a fixed shop/schema key with no request-derived unbounded dimensions;
- repeated requests inside TTL do not re-run DB-heavy generation;
- concurrent cold requests are collapsed by a tested single-flight mechanism for the current one-app-service topology;
- if deployment changes to multiple app replicas, activation is blocked until a shared cross-replica cache/single-flight layer is proved;
- failed/overflow generation never replaces a valid complete cache entry with partial output;
- correct content type and safe escaping/Unicode/control-char handling;
- route cannot become arbitrary shop/source URL fetch or expensive query API;
- any envelope overflow returns non-success (503 target), never partial/truncated 200.

**Verification:** parse generated output; limit vs limit+1; byte boundary/overflow; malformed URLs/text; deterministic order; query budget; first miss vs repeated hit; concurrent cold requests; TTL expiry concurrency; query-string cache-key noise; real Next runtime status/content type/complete body.

---

## M5 — Merchant Center Scheduled Fetch activation

**Build/ops:** verify/claim site, configure data source, O2 market, shipping/returns and Ads linkage; point Scheduled Fetch to production HTTPS feed.

**Acceptance:** highest practical regular account-supported schedule; review Merchant Automations explicitly and keep automatic price/availability/condition updates off until exact variant structured data is proven; Google can fetch landing pages/images while `SEARCH_INDEXING_ENABLED=false` remains unchanged.

**Verification:** Merchant Latest update/Diagnostics for representative in-stock/out-of-stock/variant records; crawler/landing checks; no composite v1 expectation.

---

## V1 — Final convergence, review and rollback gate

**Verification on exact implementation head:**

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:db`
- `pnpm build`
- `pnpm release:check`
- applicable browser/runtime suites
- exact GTM container/version/export record + Tag Assistant + GA4 + Ads + TikTok diagnostics
- Merchant cache/fetch/diagnostics/crawler checks
- verify production deployment topology still matches the single-app-service cache/single-flight assumption; if not, require shared cross-replica protection before Merchant activation

Final review order: correctness → security → architecture → simplicity → performance. Re-check Definition of Done, rollback for GTM delivery and Merchant data source, PII/secret boundaries, and `SEARCH_INDEXING_ENABLED=false` unless separately approved.

## 7. TDD rule

For every behavior change: add the smallest discriminating RED test, implement minimum GREEN behavior, run focused suite, then refactor only within scope. Existing already-green behavior is baseline evidence, not a fake new RED.

## 8. Source-driven checks during `/build`

Re-check current official docs for Next.js 16.2.x Route Handler/cache/CSP behavior; GTM preview/version/export/consent APIs; GA4 ecommerce item requirements and page-view semantics; Google Ads conversion/linker behavior; TikTok GTM/dedup; and Merchant identity/variant/landing/data-source requirements. Version-sensitive APIs must not be implemented from memory.

Because current repo does not enable Cache Components, do not enable that framework-wide model merely to implement M4. If `unstable_cache` behavior at build time cannot satisfy the tested single-flight/cache contract, stop and choose the smallest source-verified alternative rather than weakening the requirement.

## 9. Explicitly deferred

- Meta migration into GTM.
- Meta CAPI replacement/content-ID redesign.
- TikTok Events API.
- Google Enhanced Conversions / hashed customer PII.
- Merchant API realtime sync.
- Composite Merchant offers/item-group design.
- Visible consent UI/default-denied policy.
- Search-indexing/permanent-domain change.
- Unrelated SEO/catalog/admin refactor.

## 10. Human approval gate

Before `/build`, reviewer approves this task split, two-level product/variant identity contract, server-authoritative AddToCart facts, GTM no-load-until-T8 interlock + immutable version workflow, standalone Merchant identity/durability gate, composite Merchant deferral, Merchant cache/single-flight/resource envelope, owner gates O1–O4 or their continued activation block, and PR slicing.

Approval authorizes implementation work only. It is not approval to publish GTM tags, enable Merchant listings/campaigns, change consent defaults, or enable search indexing.