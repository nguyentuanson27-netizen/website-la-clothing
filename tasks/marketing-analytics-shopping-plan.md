# Marketing analytics & Google Shopping — implementation plan

Status: **PROPOSED — planning artifact only; human approval required before `/build`.**

Source specification: `docs/specs/marketing-analytics-shopping.md`.

This plan intentionally uses a named task file instead of replacing the repository's existing generic `tasks/plan.md`. The repository already keeps named workstream plans, and this keeps the marketing work reviewable and reversible.

## 1. Planning goal

Implement the approved marketing-measurement and Google Shopping foundation without moving commerce truth into GTM, without changing existing Meta Pixel/CAPI semantics, and without weakening the current storefront/CSP/search-exposure boundaries.

The implementation sequence is designed to fail fast on identity, configuration, and Merchant-data risks before account activation.

## 2. Repository facts that shape the plan

- `next.config.mjs` currently builds a fail-closed CSP from build-time Meta configuration. Google/TikTok tracking must follow the same build/runtime-alignment principle rather than opening third-party origins from an untrusted request host.
- `src/app/layout.tsx` already owns the direct Meta Pixel mount point and is the natural app-level location for GTM bootstrapping.
- PDP `AddToCart` is already emitted to Meta only after `addStorefrontItemToBag()` succeeds. The Google/TikTok contract should reuse that success boundary rather than track the button click.
- `/checkout` renders only after server-authoritative cart, price, stock, and shipping facts resolve. That page is the current authoritative `begin_checkout` truth point.
- `/checkout/success` checks `OrderMirror.state === CONFIRMED` before rendering Meta Purchase. The new canonical Purchase event should reuse that database truth.
- `OrderLineSnapshot` already stores `pancakeVariationId`, quantity, unit price, product name, color, and size, but not SKU, product slug, Merchant ID, or composite projection context.
- `VariantMirror.pancakeVariationId` is database-unique. `VariantMirror.sku` is nullable and indexed but not unique.
- Current storefront projections expose local variant IDs but not enough stable external identity for every component projection; composite `kindKey` values such as `component-1` are presentation/order-derived and must not become external Merchant identifiers.
- Current product JSON-LD has at most one aggregate PDP `Offer`; it is not variant-level Merchant authority.

## 3. Planning decisions locked before implementation

1. **Canonical external item candidate:** use `pancakeVariationId` as the first-choice `item_id` / Merchant `id` because it is unique and is already preserved in immutable Purchase snapshots. Before activation, audit every emitted value against Google's current Merchant ID format/length requirements. A failing audit blocks activation rather than silently changing live identity.
2. **Merchant family candidate:** for standalone products, prefer the stable Pancake product identity as `item_group_id` after the same durability/length audit. Do not use mutable slug, color/size text, array position, or composite `kindKey` as a group ID.
3. **Composite ambiguity rule:** one Pancake variation may be emitted only when it maps to exactly one approved public landing context. Zero/multiple contexts produce an explicit diagnostic and no Merchant offer. No schema change is added merely to force an ambiguous context into the feed.
4. **Variant deep link:** the planned smallest public contract is `/shop/<slug>?variant=<pancakeVariationId>`. The PDP may preselect only when that variation is a valid option in the current public projection. Forged/stale query values must not expose hidden or inactive variants.
5. **Analytics page-view authority:** application-owned canonical `page_view` events are the preferred authority for initial load and App Router navigation. GA4 automatic initial/history page views must be disabled where required so one navigation produces one GA4 page view.
6. **dataLayer discipline:** every ecommerce event clears the prior ecommerce object immediately before pushing the next event; never replace `window.dataLayer` after GTM initialization.
7. **Tracking modes:** one deployment-aware resolver owns `disabled | preview | live`. `live` is limited to the approved production origin/configuration. `preview` is explicit and may load Tag Assistant/GTM only with production destinations blocked or replaced by isolated test destinations.
8. **Consent:** the application owns a vendor-neutral consent policy; the Google adapter establishes the current production default before Google measurement tags. No visible consent UI is added in this scope.
9. **Google Ads:** Purchase is the only required primary Ads conversion in this phase; `transaction_id = publicCode`. The final Google-tag/GTM setup must provide conversion-linking functionality. Enhanced Conversions remain out of scope.
10. **TikTok:** Pixel runs through GTM. Purchase/CompletePayment receives `event_id = publicCode` now so repeated browser copies and a later Events API copy can deduplicate on the same identity.
11. **Merchant delivery:** use a public GET-only Next.js Route Handler returning a supported product-data file. Initial delivery remains Scheduled Fetch, not Merchant API realtime sync.
12. **Merchant Automations:** start with price/availability/condition automatic updates **disabled** until exact variant landing-page structured data is proven compatible. Current aggregate PDP Offer markup is not sufficient evidence for variant-specific corrections.
13. **No baseline schema migration:** the initial plan deliberately uses identities reconstructible from current mirrors and `OrderLineSnapshot`. A schema change requires a separate owner decision only if a later approved composite identity cannot be represented safely.
14. **Existing Meta remains direct:** no Meta tag in GTM, no change to Meta `content_ids`, Purchase value, CAPI request matching, or current browser/server dedup logic.

## 4. Owner/account gates that implementation must not guess

These gates do not block pure code foundations, but the affected vendor tag/feed cannot be activated until they are resolved:

- **O1 — Google Ads Purchase value:** choose merchandise-only or `OrderMirror.totalVnd`. Proposed operational default: total order value if Ads bidding should optimize against actual order value; GA4 remains merchandise value with shipping separate either way.
- **O2 — Merchant market:** proposed initial target is Vietnam / Vietnamese / VND because the storefront is Vietnamese and prices are VND. Confirm before data-source activation.
- **O3 — Apparel constants:** current schema has no per-product gender/age-group/condition fields. Before free-listing/Shopping activation, confirm whether every emitted LA Clothing item can truthfully use catalog-wide `gender=male`, `age_group=adult`, and `condition=new`. If not, the plan must be revised to add product-owned attributes rather than invent values.
- **O4 — Vendor console identifiers:** reviewed GTM container ID, GA4 measurement ID, Google Ads conversion ID/label, and TikTok Pixel ID must be supplied through their proper configuration owners. They are identifiers, not server secrets, but still require correct environment/account ownership.

## 5. Dependency graph

```text
O1/O2/O3/O4 owner gates ────────────────┐
                                        │
T1 Canonical analytics contract         │
  ↓                                     │
T2 Tracking mode + CSP/config           │
  ↓                                     │
T3 GTM/consent/page-view boot           │
  ↓                                     │
T4 Canonical projected item facts       │
  ├───────────────┐                     │
  ↓               ↓                     │
T5 PDP/list       T6 cart/checkout      │
  └───────┬───────┘                     │
          ↓                             │
T7 confirmed Purchase                   │
          ↓                             │
T8 GTM destination mapping  ◀───────────┘

T4 ─→ M1 Merchant identity/audit
          ↓
        M2 variant deep-link
          ↓
        M3 feed mapper/diagnostics
          ↓
        M4 serializer + public route
          ↓
        M5 Merchant account activation

T8 + M5 ─→ V1 final verification / rollback gate
```

Tracking and Merchant implementation may proceed in parallel after T4 where their source contracts no longer overlap, but external activation waits for the corresponding owner/account gates.

## 6. Planned implementation PR slices

ADR 0005 governs reviewability; file count is not a hard gate. Prefer each implementation PR to remain one coherent concern and roughly ≤500 effective changed lines where practical.

- **PR-A — tracking foundation:** T1–T3.
- **PR-B — commerce browser events:** T4–T6.
- **PR-C — confirmed Purchase + GTM mapping:** T7–T8.
- **PR-D — Merchant identity + deep link:** M1–M2.
- **PR-E — Merchant feed:** M3–M4.
- **PR-F — activation/verification record:** M5 + V1; primarily operational/docs evidence unless a verified launch fix is required.

If any slice exceeds reviewable scope because directly affected tests are large, keep source with its verification but split independent concerns before implementation.

---

## Task T1: Add the canonical commerce-event contract and dataLayer publisher

**Description:** Define pure typed item/purchase/event facts and one browser publisher. The publisher owns ecommerce reset semantics and remains a no-op when browser tracking infrastructure is unavailable.

**Acceptance criteria:**
- [ ] Canonical events and item/purchase payloads contain commerce facts only and exclude customer PII.
- [ ] Every ecommerce push clears prior ecommerce state before the new event; sequential events cannot inherit stale `items`, `value`, `shipping`, or transaction fields.
- [ ] Publisher never overwrites `window.dataLayer` after initialization and tracking failure cannot interrupt commerce UI.

**Verification:**
- [ ] Focused domain tests prove deterministic mapping and A→B event isolation.
- [ ] Tests prove malformed money/quantity or unavailable browser state fails closed for tracking rather than throwing into commerce.

**Dependencies:** None.

**Files likely touched:**
- `src/analytics/commerce-events.ts`
- `src/analytics/data-layer.ts`
- `tests/domain/commerce-events.test.ts`
- `tests/domain/data-layer.test.ts`

**Estimated scope:** Medium.

## Task T2: Add centralized tracking modes and build-time CSP/config validation

**Description:** Extend the current build-time Meta/CSP pattern with one validated tracking-mode/container configuration. Third-party Google/TikTok origins open only for reviewed modes that need them.

**Acceptance criteria:**
- [ ] One resolver represents `disabled | preview | live`; `live` cannot be enabled from request Host/query data.
- [ ] Build/runtime GTM configuration is frozen consistently so rendered tags cannot be blocked by a mismatched baked CSP.
- [ ] Missing/malformed config fails closed; no wildcard CSP source and no new production `unsafe-eval` is introduced.

**Verification:**
- [ ] Focused config tests cover invalid mode/container IDs and disabled/live/preview behavior.
- [ ] `next.config.mjs` assertions prove expected CSP origin deltas and Meta allowances remain unchanged.

**Dependencies:** T1.

**Files likely touched:**
- `src/analytics/tracking-environment.ts`
- `next.config.mjs`
- `.env.example`
- `deploy/vps/env.example`
- focused integration/config test

**Estimated scope:** Medium.

## Task T3: Mount GTM, establish Google consent defaults, and own GA4 page views

**Description:** Mount one GTM web container from the root layout using the reviewed tracking mode. Push the vendor-neutral environment/consent initialization before measurement tags, and add one App Router page-view tracker for the canonical application event.

**Acceptance criteria:**
- [ ] GTM is absent in disabled mode; preview/live loading follows T2 and never creates a second Meta Pixel.
- [ ] Google consent defaults are established before Google measurement events under the reviewed GTM consent mechanism.
- [ ] Application emits exactly one canonical `page_view` per initial page and client navigation; GTM/GA4 configuration explicitly disables overlapping automatic/history page views.

**Verification:**
- [ ] Component/integration tests prove loader gating and first/navigation event behavior.
- [ ] Runtime verification later uses Tag Assistant + GA4 DebugView/test destination to prove one page view per navigation and no production contamination in preview mode.

**Dependencies:** T2.

**Files likely touched:**
- `src/components/analytics/google-tag-manager.tsx`
- `src/components/analytics/commerce-route-tracker.tsx`
- `src/analytics/google-consent-adapter.ts`
- `src/app/layout.tsx`
- focused integration tests

**Estimated scope:** Medium.

### Checkpoint A — tracking foundation

Before T4, review T1–T3 for CSP least privilege, no Meta duplication, no customer PII, and deterministic preview/live isolation. Run the focused tests plus `pnpm typecheck` and `pnpm lint` for the implementation PR.

---

## Task T4: Expose stable projected commerce item facts

**Description:** Extend storefront projection/item facts with the stable external identifiers analytics and Merchant need, while keeping local variant IDs for internal mutation authorization.

**Acceptance criteria:**
- [ ] Public projected option facts can carry `pancakeVariationId` and optional audited SKU without replacing internal `VariantMirror.id` authorization.
- [ ] Standalone and composite component queries populate the same canonical external identity; presentation-only `kindKey` is never treated as stable external identity.
- [ ] Existing price/stock/ambiguity rules and direct-child privacy remain unchanged.

**Verification:**
- [ ] Domain/database projection tests cover standalone and composite identity propagation.
- [ ] Existing composite/cart/checkout regressions remain green.

**Dependencies:** T1.

**Files likely touched:**
- `src/commerce/storefront-product.ts`
- `src/commerce/storefront-catalog.ts`
- `src/commerce/storefront-product-detail.ts`
- `src/commerce/storefront-projection.ts`
- focused projection tests

**Estimated scope:** Medium.

## Task T5: Emit catalog/PDP/select/AddToCart events from authoritative UI states

**Description:** Map `view_item_list`, `select_item`, `view_item`, and `add_to_cart` from canonical server/projected facts. Reuse the existing PDP server-success boundary for AddToCart.

**Acceptance criteria:**
- [ ] List/PDP events use the items actually rendered, not DOM scraping or duplicated pricing rules.
- [ ] AddToCart fires only after the existing server action succeeds and uses the accepted projected variation identity/price/quantity.
- [ ] Meta ViewContent/AddToCart behavior remains observably unchanged and independent of dataLayer failure.

**Verification:**
- [ ] Focused component/integration tests prove success vs failed mutation event behavior.
- [ ] Runtime browser check later confirms event ordering and no duplicate Meta tag/event path.

**Dependencies:** T3, T4.

**Files likely touched:**
- storefront list/card tracking boundary
- `src/components/commerce/product-purchase-panel.tsx`
- small analytics event component/helper
- focused integration/browser tests

**Estimated scope:** Medium.

## Task T6: Emit ViewCart, quantity-delta Remove/Add, and BeginCheckout from server-authoritative state

**Description:** Add cart/checkout measurement without trusting stale DOM values. Quantity changes report only the accepted delta after a successful server mutation; full remove reports the accepted removed quantity. Valid checkout state emits `begin_checkout`. Do not synthesize shipping/payment milestones.

**Acceptance criteria:**
- [ ] Successful quantity increase emits `add_to_cart` for the accepted delta; decrease/remove emits `remove_from_cart`; failed mutations emit neither.
- [ ] Cart/checkout event payloads are built from canonical line/totals facts and contain no customer name/phone/address.
- [ ] `begin_checkout` exists only for the resolved checkout state; `add_shipping_info` and `add_payment_info` remain absent until a distinct accepted application milestone exists.

**Verification:**
- [ ] Focused public-action/component tests cover increase/decrease/remove/failure and cart totals.
- [ ] Existing checkout/cart tests stay green.

**Dependencies:** T4, T5.

**Files likely touched:**
- `src/commerce/storefront-cart-public-actions.ts`
- `src/commerce/storefront-cart-actions.ts`
- `src/components/commerce/cart-line-controls.tsx`
- cart/checkout page event boundary
- focused integration tests

**Estimated scope:** Medium.

### Checkpoint B — pre-purchase ecommerce

Review event values/IDs against current storefront truth, then run focused domain/integration tests plus `pnpm test`, `pnpm typecheck`, and `pnpm lint` for the converged tracking branches.

---

## Task T7: Add canonical confirmed-Purchase snapshot and browser event

**Description:** Build a vendor-neutral Purchase snapshot from immutable order facts, then publish the canonical browser Purchase on the existing confirmed-success boundary. Meta keeps using its existing adapter.

**Acceptance criteria:**
- [ ] Purchase is impossible unless `OrderMirror.state === CONFIRMED`; `transactionId` and `eventId` are `publicCode`.
- [ ] Item quantity/name/price/variation identity comes from `OrderLineSnapshot`; missing mutable SKU/slug enrichment cannot corrupt immutable Purchase facts.
- [ ] Revisit/refresh keeps the same ID, and vendor delivery failure cannot change checkout success behavior.

**Verification:**
- [ ] Domain/database tests cover every non-confirmed state, catalog deletion/enrichment loss, money bounds, and repeat identity.
- [ ] Existing Meta Purchase snapshot/CAPI/browser dedup tests stay green.

**Dependencies:** T1, T4.

**Files likely touched:**
- `src/commerce/commerce-purchase-snapshot.ts`
- `src/app/checkout/success/page.tsx`
- small canonical event component/helper
- `tests/database/commerce-purchase-snapshot.test.ts`
- focused integration test

**Estimated scope:** Medium.

## Task T8: Version and verify the GTM destination mapping

**Description:** Create the reviewed GTM configuration record that maps canonical custom events to GA4, Google Ads, and TikTok. GTM remains a mapping/routing layer, not a business-rules engine.

**Acceptance criteria:**
- [ ] GA4 maps canonical ecommerce fields and has automatic/history page views disabled under the application-owned page-view strategy.
- [ ] Google Ads Purchase uses `publicCode` transaction ID, approved O1 value, and verified Google-tag/conversion-linking functionality; no Enhanced Conversions/user-provided data.
- [ ] TikTok uses the official template/custom-event triggers and sends `event_id=publicCode` for Purchase/CompletePayment; production tags require live mode.

**Verification:**
- [ ] Checked-in GTM export/config record is diff-reviewable and contains no secrets or unreviewed Custom HTML/Custom JavaScript.
- [ ] Tag Assistant/GA4 DebugView/Ads diagnostics/TikTok diagnostics are required before publish; preview must prove no production destination traffic.

**Dependencies:** T3, T5, T6, T7, O1, O4.

**Files likely touched:**
- `docs/integrations/marketing-measurement-gtm.md`
- reviewed GTM export/config artifact if export format is practical
- focused source assertions if needed

**Estimated scope:** Small/Medium source-control work plus external-console verification.

---

## Task M1: Add a read-only Merchant identity/attribute audit

**Description:** Fail fast against real mirrored catalog data before feed activation. Audit candidate item/group IDs, SKU-as-MPN, required apparel attributes, public projection context count, price/media/content coverage, and current target-market assumptions.

**Acceptance criteria:**
- [ ] Audit proves every emitted candidate `pancakeVariationId` and group candidate meets current Merchant identity limits and SKU/MPN is present/unambiguous/stable enough for LA manufacturer identity.
- [ ] Each variation is classified as zero, one, or multiple public projection contexts; only exactly-one contexts can proceed automatically.
- [ ] Audit reports the impact of O2/O3 apparel/market choices and excludes unsafe descriptions/media/price without leaking PII.

**Verification:**
- [ ] Unit/integration tests cover duplicates, overlong IDs, missing SKU, ambiguous composite contexts, out-of-stock, `PRICE_UNRESOLVED`, and malformed external text.
- [ ] A dedicated read-only command can be run against an authorized catalog and prints aggregate diagnostics only.

**Dependencies:** T4, O2, O3 for activation conclusions; code can be built with gates unresolved.

**Files likely touched:**
- `src/integrations/merchant/catalog-audit.ts`
- `scripts/merchant-catalog-audit.ts`
- `package.json`
- `tests/integrations/merchant-catalog-audit.test.ts`

**Estimated scope:** Medium.

## Task M2: Add exact variant deep-link selection

**Description:** Support the approved public `?variant=<pancakeVariationId>` landing contract so Merchant can point to the exact standalone/public projection option without trusting color/size labels.

**Acceptance criteria:**
- [ ] A valid current projected variation preselects the exact option/context and visible price/color/size/image remain consistent with feed facts.
- [ ] Unknown, stale, inactive, private-child, or forged variation values cannot expose or select an unauthorized option.
- [ ] Existing slug lifecycle, noindex/canonical policy, and ordinary PDP navigation remain unchanged.

**Verification:**
- [ ] Domain/integration tests cover standalone, composite-valid, stale/forged, and ambiguous-context cases.
- [ ] Browser regression verifies direct Merchant-style URL and no new organic-indexing exposure.

**Dependencies:** T4, M1.

**Files likely touched:**
- `src/app/shop/[slug]/page.tsx` or current PDP route owner
- `src/commerce/storefront-product-detail.ts` / focused selection helper
- `src/components/commerce/product-purchase-panel.tsx`
- focused domain/browser tests

**Estimated scope:** Medium.

### Checkpoint C — Merchant identity and landing truth

Do not build/activate the feed until the candidate ID/MPN audit is green for emitted records and representative deep links prove exact public option matching. Composite records that remain semantically or contextually ambiguous stay excluded rather than delaying standalone launch.

---

## Task M3: Build the Merchant offer mapper and diagnostics

**Description:** Map canonical public product/projection facts into vendor-neutral Merchant offers, separating structural eligibility from availability. Keep mapping pure and independently testable from HTTP/XML delivery.

**Acceptance criteria:**
- [ ] Each emitted offer has stable ID/grouping, LA Clothing brand, audited MPN, no inferred GTIN, canonical price, trusted image, exact deep link, color/size, and the approved O2/O3 apparel values.
- [ ] Structurally valid zero-stock offers remain with `out_of_stock`; malformed/unresolved/ambiguous records are excluded with one bounded diagnostic reason.
- [ ] Description priority never exposes draft editorial content; unsafe/unusable source text is normalized by a reviewed contract or excluded.

**Verification:**
- [ ] Pure mapping tests cover standalone variants, allowed composite contexts, out-of-stock, missing content, invalid SKU, and price/media mismatches.
- [ ] Feed candidate counts reconcile with M1 audit categories.

**Dependencies:** M1, M2, O2, O3.

**Files likely touched:**
- `src/integrations/merchant/product-data.ts`
- `src/integrations/merchant/catalog-repository.ts`
- `tests/integrations/merchant-product-data.test.ts`
- focused database test

**Estimated scope:** Medium.

## Task M4: Serialize and expose the bounded public Merchant data source

**Description:** Add a standards-aware serializer and GET-only Next.js Route Handler. The route returns current feed data without arbitrary query-driven fetch behavior and without exposing diagnostic internals/secrets.

**Acceptance criteria:**
- [ ] Supported Merchant file output is deterministic, parseable, correctly escaped, length-bounded, and uses an appropriate XML/text content type; no external text is manually interpolated without the serializer contract.
- [ ] Endpoint is public GET-only, bounded to the configured shop/catalog, cannot become SSRF/arbitrary query execution, and contains no credentials.
- [ ] Route reads current canonical catalog data; stable input gives stable IDs/output ordering, while price/stock changes appear on the next fetch.

**Verification:**
- [ ] Generated output is parsed again in tests and covers XML-reserved chars, Unicode, illegal controls, malformed URLs, and oversized fields.
- [ ] Real Next runtime smoke fetches the route and validates status/content type/body; standard `pnpm build` remains green.

**Dependencies:** M3.

**Files likely touched:**
- `src/integrations/merchant/feed-serializer.ts`
- `src/app/feeds/google-merchant/route.ts`
- serializer/route integration tests
- lockfile/package manifest only if a reviewed serializer dependency is added

**Estimated scope:** Medium.

## Task M5: Configure Merchant Center Scheduled Fetch and safe initial Automations policy

**Description:** Activate the data source only after feed/runtime checks. Use the production HTTPS route, target market O2, shipping/returns, and Google Ads linkage. Keep unsafe automatic variant correction disabled until exact structured data is proven.

**Acceptance criteria:**
- [ ] Merchant can fetch the production route; data source language/currency/country, shipping/returns, and schedule are documented and correct.
- [ ] Initial schedule uses the highest practical regular frequency supported by the account (default file fetch is currently 24h); schedule timing is coordinated with catalog updates where practical.
- [ ] Price/availability/condition Automations are reviewed explicitly and remain off while the aggregate PDP JSON-LD cannot identify exact submitted variants; diagnostics are clean enough for controlled activation.

**Verification:**
- [ ] Merchant Latest update/Diagnostics evidence is recorded for representative in-stock, out-of-stock, and variant records.
- [ ] Submitted landing pages/images are fetchable by Google while `SEARCH_INDEXING_ENABLED=false` remains unchanged.

**Dependencies:** M4, O2, O3.

**Files likely touched:**
- `docs/integrations/google-merchant-launch.md`
- optionally a verification record under `docs/verification/`

**Estimated scope:** Small source-control work plus external-console verification.

---

## Task V1: Final convergence, security review, and rollback gate

**Description:** Run the project-wide quality gate only after tracking and Merchant slices converge. No production activation counts as complete until source, browser/vendor diagnostics, and rollback controls all agree.

**Acceptance criteria:**
- [ ] Existing Meta, checkout, catalog/composite, CSP, and search-exposure behavior remains compatible; no customer PII/secrets enter generic dataLayer/feed output.
- [ ] Browser/vendor diagnostics prove exactly-once page views/Purchase identities, preview isolation, Ads linker behavior, TikTok event IDs, and failure-safe commerce.
- [ ] Merchant feed/landing/diagnostics are consistent, and both GTM delivery and Merchant data source have documented disable/rollback procedures.

**Verification:**
- [ ] Run and record the relevant repository gates on the exact implementation head: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`, `pnpm build`, `pnpm release:check`.
- [ ] Run applicable browser/runtime suites and manually inspect Tag Assistant/GA4/Ads/TikTok + Merchant diagnostics on authorized test/production environments.
- [ ] Final code review prioritizes correctness → security → architecture → simplicity → performance and checks the repository Definition of Done.

**Dependencies:** T8, M5.

**Files likely touched:**
- verification/launch documentation only unless a verified defect is found

**Estimated scope:** Small source change, broad verification.

## 7. TDD sequence

For each behavior-changing implementation task:

1. Add the smallest discriminating test that fails for the missing behavior.
2. Implement only enough production code to make it pass.
3. Run the focused suite.
4. Refactor only inside the task scope.
5. At each checkpoint, run broader relevant suites before moving on.

Do not label existing already-green repository behavior as a new RED test.

## 8. Source-driven checks required during `/build`

Re-check current official documentation at implementation time for:

- Next.js 16 Route Handler and script/CSP behavior;
- GTM container/consent APIs and required origins;
- GA4 ecommerce/page-view parameters;
- Google Ads Purchase/conversion-linking setup;
- TikTok GTM template, event names/parameters, and dedup requirements;
- Merchant product-data attributes, current apparel requirements, ID limits, Scheduled Fetch, Automations, and crawler/landing-page rules.

Version-sensitive tag behavior must not be implemented from memory.

## 9. Explicitly not doing

- No Meta-to-GTM migration.
- No replacement of Meta CAPI.
- No TikTok Events API in this phase.
- No Google Enhanced Conversions or hashed customer PII.
- No Merchant API realtime sync.
- No automatic schema migration merely for tracking.
- No search-indexing enablement or permanent-domain decision.
- No unrelated SEO/catalog/admin refactor.
- No GTM business logic inferred from CSS selectors/button text/DOM prices.
- No synthetic `add_shipping_info`/`add_payment_info` event before the application has a real accepted milestone.

## 10. Human approval gate

Before `/build`, the reviewer should approve:

- this task/dependency split;
- the identity strategy (`pancakeVariationId` candidate + fail-closed audit);
- owner gates O1–O4 or the fact that affected activation will remain blocked until supplied;
- initial Merchant Automations-off policy;
- implementation PR slicing under ADR 0005.

Approval of this plan authorizes implementation tasks only; it is not approval to publish GTM tags, activate ad conversions, enable Merchant listings, change consent defaults, or alter search indexing without the stated activation gates.