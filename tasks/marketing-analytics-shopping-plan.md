# Marketing analytics & Google Shopping — implementation plan

Status: **PROPOSED — planning artifact only; human approval required before `/build`.**

Source specification: `docs/specs/marketing-analytics-shopping.md`.

PR #153 intentionally keeps `/spec` + `/plan` together as a docs-only review unit. This plan is the implementation-level narrowing of the spec: where the spec allows more than one safe implementation, the decisions below are normative for v1. Runtime code must land in focused implementation PRs, not in this planning PR.

## 1. Goal

Implement GA4 + Google Ads + TikTok Pixel through GTM, preserve the existing direct Meta Pixel + CAPI integration, and expose an automated Google Merchant product-data source without moving commerce truth into vendor tooling or weakening current CSP/search-exposure behavior.

Core invariants:

- business/order/cart state owns commerce truth;
- GTM is routing/mapping only;
- Purchase exists only for `OrderMirror.state === CONFIRMED`;
- `publicCode` is the shared Purchase transaction/event identity;
- only approved production configuration may send live vendor traffic;
- preview/test traffic must be mechanically isolated from production destinations;
- tracking failure must never break shopping/checkout;
- no customer PII enters the generic commerce `dataLayer`;
- Merchant output is fail-closed when identity, price, landing context, serialization, or resource limits are unsafe.

## 2. Repository facts that shape implementation

- `next.config.mjs` builds a fail-closed CSP from build-time tracking configuration; Google/TikTok must preserve build/runtime alignment.
- `src/app/layout.tsx` owns the direct Meta mount point and is the app-level GTM bootstrap boundary.
- PDP Meta `AddToCart` already fires only after `addStorefrontItemToBag()` succeeds; canonical AddToCart must reuse that success boundary.
- `/checkout` renders only when current cart, price, stock, and shipping facts resolve, so it is the current `begin_checkout` truth point.
- `/checkout/success` checks `OrderMirror.state === CONFIRMED` before browser Purchase.
- `OrderLineSnapshot` stores `pancakeVariationId`, product name, color, size, quantity, and immutable prices, but not SKU/slug/Merchant/composite context.
- `VariantMirror.pancakeVariationId` is DB-unique; SKU is nullable and not DB-unique.
- mirror sync upserts variants by `pancakeVariationId` and products by `pancakeProductId`, which proves current repository identity semantics but not upstream lifetime durability by itself.
- cart mutations serialize on the cart row, but the current update/remove results do not return old/removed quantity from inside that lock.
- composite storefront projection can sell a component variation through a different public parent PDP; presentation keys such as `component-1` are not stable external IDs.
- current PDP JSON-LD is aggregate, not exact variant authority.

## 3. Locked v1 decisions

### 3.1 Canonical commerce identity

- Browser/GA4/TikTok canonical `item_id` candidate: `pancakeVariationId`.
- Purchase `transaction_id` / `event_id`: `OrderMirror.publicCode`.
- Internal `VariantMirror.id` remains the mutation/authorization identity and is not exposed as the preferred external catalog identity.
- SKU remains intended as LA Clothing MPN only after M1 proves presence, uniqueness and stability for emitted items.
- Pancake barcode is never assumed to be GTIN.

### 3.2 Merchant scope — standalone only in v1

Merchant v1 **does not emit composite projections**.

Reason: a component variation sold through a parent composite PDP does not yet have a proven durable Merchant family identity, and a composite set/component relationship is not automatically the same thing as a normal color/size variant family. Google requires `item_group_id` to group actual variants of the same product and recommends keeping it stable. Until a separate design proves a durable composite public-context family contract, composite offers fail closed with `COMPOSITE_DEFERRED`.

For standalone products only:

- `id` candidate = `pancakeVariationId` after durability/format audit;
- `item_group_id` candidate = `pancakeProductId` when the standalone product has variants and after durability/format audit;
- each submitted variation gets a distinct deep link `/shop/<slug>?variant=<pancakeVariationId>`;
- the deep link preselects only a valid current public standalone option;
- organic-search canonical remains the base PDP contract; the variant query must not silently create an independent organic canonical/indexing policy.

Composite Merchant support becomes a separate later design/plan, not an implicit extension of M3.

### 3.3 External-ID durability gate

DB uniqueness/current upsert semantics are insufficient evidence for a live Merchant identity. Before Merchant activation M1 must collect at least one durability proof for both `pancakeVariationId` and `pancakeProductId`:

1. provider/API contract evidence that the IDs are stable for the lifetime of the same upstream product/variation; **or**
2. controlled repeated full-catalog resync evidence showing the same upstream objects retain the same IDs, combined with repository tests proving mirror rows are reconciled by those IDs; **or**
3. equivalent historical evidence approved in review.

If durability cannot be established, Merchant activation is blocked; implementation must not silently fall back to slug, color/size text, array position, or local cuid.

### 3.4 Tracking mode and GTM preview isolation

One application resolver owns `disabled | preview | live`, but **`preview` is fail-closed until container-side isolation is reviewable and present**.

Normative mechanism:

1. before the GTM bootstrap, the app publishes an immutable bootstrap fact such as `la_tracking_mode` into the existing `dataLayer`;
2. every GA4, Google Ads and TikTok tag that targets a production property/account must require `la_tracking_mode === "live"` in its firing conditions;
3. preview/test-only tags may target isolated test/debug destinations, but never production destinations;
4. a checked-in GTM export/config record is statically reviewed to prove the live guard is attached to every production destination tag;
5. application `preview` mode must resolve to no-GTM/disabled until that reviewed isolation artifact exists; enabling preview and the corresponding container mapping happens together in PR-C, not earlier in PR-A;
6. Tag Assistant remains runtime verification, not the isolation mechanism itself.

This closes the gap where GTM Preview otherwise behaves like the current container draft is deployed and could fire production tags.

### 3.5 Consent

The application owns a vendor-neutral consent state. Current production policy is tracking granted immediately and visible consent UI remains deferred, but the implementation must establish Google consent defaults before measurement and keep the policy replaceable later without changing the commerce event contract.

### 3.6 GA4 / Ads / TikTok

- Exactly one GA4 page-view authority: application-owned canonical `page_view`; overlapping automatic/history page view must be disabled in GTM/property setup.
- Before each ecommerce event, clear/reset the prior ecommerce object so stale keys cannot bleed into the next event.
- Google Ads: Purchase is the only required primary conversion in v1; `transaction_id = publicCode`; conversion-linking functionality is required; Enhanced Conversions are out of scope.
- TikTok Pixel runs through GTM; Purchase/CompletePayment uses `event_id = publicCode` now so repeated browser events and later Events API events can share identity.
- Existing Meta browser/CAPI semantics are preserved and no Meta tag is added to GTM.

### 3.7 Merchant public-route resource envelope

Use bounded on-request generation for v1 rather than introducing a new background/precompute subsystem.

Initial hard limits:

- `MAX_MERCHANT_OFFERS = 5_000` emitted offers;
- `MAX_MERCHANT_FEED_BYTES = 16 * 1024 * 1024` bytes for the complete serialized response;
- `MAX_MERCHANT_DB_ROUND_TRIPS = 8` database round trips for one feed generation;
- no per-record/N+1 query path is allowed.

Overflow behavior is fail-closed:

- check the catalog/offer envelope before returning a successful body;
- if offer count, response bytes, or planned query/work budget exceeds the limit, return a non-success response (target `503 Service Unavailable`) and a bounded non-sensitive diagnostic/telemetry signal;
- never silently truncate the feed and never return a partial `200` data source;
- tests cover `limit`, `limit + 1`, byte overflow, deterministic complete output, and query-budget regression.

These application limits are intentionally much tighter than any vendor file-size ceiling; they are a local security/reliability envelope and can be raised only with measured evidence and review.

## 4. Owner/account gates

These do not block pure foundations but block the affected live destination:

- **O1 — Google Ads Purchase value:** choose merchandise-only vs `OrderMirror.totalVnd` before Ads Purchase publish. GA4 remains merchandise value with shipping separate.
- **O2 — Merchant market:** proposed initial market Vietnam / Vietnamese / VND; confirm before Merchant activation.
- **O3 — Apparel facts:** confirm whether every emitted standalone item can truthfully use catalog-wide `gender=male`, `age_group=adult`, `condition=new`; otherwise add product-owned facts before activation.
- **O4 — Vendor configuration:** provide/review GTM container, GA4 Measurement ID, Google Ads conversion ID/label, and TikTok Pixel ID through their proper account owners.

## 5. Dependency graph

```text
T1 canonical events
 ↓
T2 tracking config/CSP
 ↓
T3 GTM bootstrap + consent + page_view (preview still fail-closed)
 ↓
T4 stable projected item facts
 ├─────────────┐
 ↓             ↓
T5 list/PDP    T6 atomic cart deltas + checkout
 └──────┬──────┘
        ↓
T7 confirmed Purchase
        ↓
T8 GTM destination mapping + live guards + enable preview

T4 → M1 Merchant identity/durability audit
       ↓
     M2 standalone variant deep link + canonical/query contract
       ↓
     M3 standalone Merchant mapper
       ↓
     M4 bounded serializer/public route
       ↓
     M5 Merchant activation

T8 + M5 → V1 final verification / rollback gate
```

## 6. Implementation slices

ADR 0005 governs reviewability; file count is only a signal.

- **PR-A — tracking foundation:** T1–T3. Preview capability stays disabled until PR-C proves container isolation.
- **PR-B — commerce browser events:** T4–T6.
- **PR-C — confirmed Purchase + GTM mapping:** T7–T8, including static live-guard audit and preview enablement.
- **PR-D — Merchant identity + standalone deep link:** M1–M2.
- **PR-E — Merchant feed:** M3–M4.
- **PR-F — Merchant activation + final convergence:** M5 + V1; primarily operational/verification records unless a verified launch defect requires code.

Do not split directly affected tests away from their behavior merely to hit a line target; do split independent subsystems when review/revert boundaries are cleaner.

---

## T1 — Canonical commerce-event contract and dataLayer publisher

**Build:** typed vendor-neutral item/event/Purchase facts plus one browser publisher.

**Acceptance:**
- no customer PII in generic ecommerce events;
- reset ecommerce state immediately before every ecommerce push;
- publisher never replaces `window.dataLayer` after GTM init;
- malformed/unavailable tracking fails closed without throwing into commerce.

**Verification:** RED/GREEN deterministic mapping, sequential A→B event isolation, malformed values, browser unavailable/ad-blocked path.

## T2 — Tracking configuration and CSP

**Build:** validated deployment-owned `disabled | preview | live` resolver; build/runtime GTM config alignment; minimum required CSP origins only.

**Acceptance:**
- `live` cannot come from Host/query/client input;
- invalid/missing config fails closed;
- no wildcard CSP source and no new production `unsafe-eval`;
- `preview` cannot become operational merely from an application env value; it remains disabled until T8's reviewed GTM isolation artifact is present.

**Verification:** config/CSP tests for disabled/live/preview-before-isolation and malformed IDs.

## T3 — GTM bootstrap, consent default, and page-view authority

**Build:** root-level GTM/dataLayer bootstrap and App Router route tracker; preserve direct Meta mount.

**Acceptance:**
- `la_tracking_mode` is pushed before GTM bootstrap;
- GTM absent in disabled mode;
- before T8, preview resolves to no-GTM/disabled;
- Google consent default is established before measurement according to current official guidance;
- exactly one canonical initial/navigation `page_view` is emitted.

**Verification:** source/component tests prove ordering, mode gating, one page-view event and no Meta duplication. Checkpoint A includes a static assertion that preview cannot load before the reviewed isolation contract exists.

### Checkpoint A

Focused tests + `pnpm typecheck` + `pnpm lint`; security review for CSP, PII, Meta duplication and preview fail-closed behavior.

---

## T4 — Stable projected analytics item facts

**Build:** propagate `pancakeVariationId` and optional SKU through standalone/composite storefront projection facts while retaining local variant ID for server authorization.

**Acceptance:** presentation `kindKey` never becomes external identity; price/stock/ambiguity/privacy behavior unchanged.

**Verification:** standalone + composite projection tests and existing cart/checkout/composite regressions.

## T5 — List/PDP/select/AddToCart events

**Build:** `view_item_list`, `select_item`, `view_item`, `add_to_cart` from rendered/canonical facts.

**Acceptance:** no DOM scraping; AddToCart only after existing successful server action; current Meta ViewContent/AddToCart remains independent.

**Verification:** success/failure component/integration tests and runtime event ordering later.

## T6 — Atomic cart delta events and BeginCheckout

**Build:** extend the cart mutation transaction so analytics receives the committed quantity transition rather than inferring it from stale UI state.

Required mutation result facts captured **inside the existing cart lock/transaction**:

- update success returns `previousQuantity` and committed `quantity`;
- remove success returns `removedQuantity` and distinguishes already-missing line from a real removal;
- public action returns only the bounded facts needed for event construction;
- browser calculates add/remove delta only from these server-returned committed facts.

**Acceptance:**
- quantity increase → `add_to_cart` with `quantity - previousQuantity`;
- quantity decrease → `remove_from_cart` with `previousQuantity - quantity`;
- same quantity → zero delta, no add/remove event;
- full successful remove → `remove_from_cart` with `removedQuantity`;
- failed/already-removed/raced mutation → no fabricated event;
- cart/checkout payloads contain no customer name/phone/address;
- valid checkout emits `begin_checkout`; `add_shipping_info` / `add_payment_info` remain absent until a real distinct accepted milestone exists.

**Verification:** RED/GREEN tests for two concurrent absolute updates, concurrent remove/already-removed, same quantity, failed mutation, and existing cart behavior. The test must prove the old/removed quantity is read under the same serialized transaction, not by a client/pre-read.

### Checkpoint B

Focused cart/PDP/checkout tests + `pnpm test` + `pnpm typecheck` + `pnpm lint`; review IDs/value/quantity against storefront truth.

---

## T7 — Canonical confirmed Purchase

**Build:** vendor-neutral Purchase snapshot from immutable order facts; browser event on the existing confirmed-success boundary.

**Acceptance:** only `CONFIRMED`; `transactionId/eventId = publicCode`; item quantities/prices/variation IDs from `OrderLineSnapshot`; mutable catalog enrichment optional and non-authoritative; repeat visit keeps same identity; tracking failures do not alter checkout success.

**Verification:** non-confirmed states, catalog deletion/enrichment loss, money bounds, repeat identity; existing Meta browser+CAPI tests stay green.

## T8 — GTM destination mapping, production live guards, and preview enablement

**Build:** version/review GTM config for GA4, Google Ads and TikTok.

**Acceptance:**
- every production GA4/Ads/TikTok destination tag has the explicit `la_tracking_mode == live` firing condition/blocker;
- checked-in export/config can be statically audited for missing production live guards;
- preview/test tags use isolated debug/test destinations only;
- only after that static gate exists may app `preview` mode load the container;
- GA4 auto/history page views are disabled under app-owned page-view strategy;
- Ads Purchase uses `publicCode`, O1 value and conversion linking; no Enhanced Conversions;
- TikTok Purchase/CompletePayment uses `event_id=publicCode`.

**Verification:** static config assertion plus Tag Assistant/GA4 DebugView/test destination/Ads/TikTok diagnostics. Explicitly prove preview emits zero traffic to production destinations.

---

## M1 — Read-only Merchant identity, durability and catalog audit

**Build:** a bounded audit command over current mirrored catalog.

**Acceptance:**
- validate ID length/format for `pancakeVariationId` and standalone `pancakeProductId` group candidate;
- prove the external-ID durability gate in §3.3 before activation;
- audit SKU-as-MPN presence/uniqueness/stability;
- classify projection mode; all composite projections report `COMPOSITE_DEFERRED` for v1;
- audit price/media/content/apparel facts without PII.

**Verification:** missing/duplicate/overlong IDs, missing SKU, composite deferred, out-of-stock, `PRICE_UNRESOLVED`, malformed text, plus authorized real-catalog audit evidence.

## M2 — Standalone variant deep link and search contract

**Build:** `/shop/<slug>?variant=<pancakeVariationId>` only for a valid current **standalone** projected variation.

**Acceptance:** exact option preselection and matching price/color/size/image; forged/stale/inactive/private/composite query cannot expose an unauthorized option; base PDP canonical/search exposure behavior remains authoritative; variant query does not independently enable indexing.

**Verification:** standalone valid/stale/forged/composite-rejected tests plus representative browser regression and SEO canonical/query regression informed by the merged SEO/GEO audit.

### Checkpoint C

Do not build/activate Merchant feed until ID/MPN/durability audit is green for emitted standalone records. Composite inventory remains intentionally absent from Merchant v1.

---

## M3 — Standalone Merchant mapper and diagnostics

**Build:** pure mapper from canonical standalone product/variation facts.

**Acceptance:** stable audited ID/grouping, `brand=LA Clothing`, audited MPN, no inferred GTIN, canonical price, trusted image, exact deep link, color/size, current required variant fields such as `variant_option` where applicable, and approved O2/O3 values; structurally valid zero-stock offer remains `out_of_stock`; unsafe/unresolved/composite rows are excluded with one bounded reason.

**Verification:** mapping tests for normal variant, out-of-stock, missing content, invalid SKU, price/media mismatch, and composite exclusion; counts reconcile with M1.

## M4 — Bounded serializer and public Merchant route

**Build:** standards-aware serializer plus GET-only `/feeds/google-merchant` Route Handler.

**Acceptance:**
- enforce `MAX_MERCHANT_OFFERS=5_000` before successful output;
- enforce `MAX_MERCHANT_FEED_BYTES=16 MiB` on the complete serialized body;
- repository/feed generation performs at most `MAX_MERCHANT_DB_ROUND_TRIPS=8` and no N+1 path;
- deterministic complete output, correct content type, safe escaping/Unicode/control-char handling;
- no arbitrary query-driven shop/URL fetching, no credentials/diagnostic internals in body;
- any envelope overflow returns non-success (`503` target) and never partial/truncated `200`.

**Verification:** parse generated output back in tests; exactly limit vs limit+1; byte limit vs overflow; malformed URLs/text; deterministic order; query-count/work-budget assertion; Next runtime smoke of status/content type/complete body.

---

## M5 — Merchant Center Scheduled Fetch activation

**Build/ops:** verify/claim site, configure data source, O2 market, shipping/returns and Ads linkage; point Scheduled Fetch to production HTTPS feed.

**Acceptance:** choose highest practical regular schedule supported by the account; review Merchant Automations explicitly and keep price/availability/condition automatic updates off until exact variant structured data is proven; Google can fetch landing pages/images while `SEARCH_INDEXING_ENABLED=false` remains unchanged.

**Verification:** Merchant Latest update/Diagnostics evidence for representative in-stock/out-of-stock/variant records; crawler/landing checks; no composite offers expected in v1.

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
- Tag Assistant + GA4 + Ads + TikTok diagnostics
- Merchant fetch/diagnostics/crawler checks

Final review order: correctness → security → architecture → simplicity → performance. Re-check Definition of Done, rollback for GTM delivery and Merchant data source, PII/secret boundaries, and `SEARCH_INDEXING_ENABLED=false` unless separately approved.

## 7. TDD rule

For every behavior change: add the smallest discriminating RED test, implement the minimum GREEN behavior, run the focused suite, then refactor only within scope. Existing already-green behavior is baseline evidence, not a fake new RED.

## 8. Source-driven checks during `/build`

Re-check current official docs for Next.js 16 script/Route Handler/CSP behavior; GTM Preview/consent APIs; GA4 ecommerce/page-view semantics; Google Ads conversion/linker behavior; TikTok GTM/dedup; and Merchant identity/variant/landing/data-source requirements. Version-sensitive APIs must not be implemented from memory.

## 9. Explicitly deferred

- Meta migration into GTM.
- Meta CAPI replacement/value/content-ID redesign.
- TikTok Events API.
- Google Enhanced Conversions / hashed customer PII.
- Merchant API realtime sync.
- Composite Merchant offers/item-group design.
- Visible consent UI/default-denied policy.
- Search-indexing/permanent-domain change.
- Unrelated SEO/catalog/admin refactor.

## 10. Human approval gate

Before `/build`, reviewer approves this task split, the `pancakeVariationId`/standalone group durability gate, composite Merchant deferral, preview live-guard mechanism, Merchant resource envelope, owner gates O1–O4 or their continued activation block, and PR slicing. Approval authorizes implementation work only; it is not approval to publish GTM tags, enable Merchant listings/campaigns, change consent defaults, or enable search indexing.