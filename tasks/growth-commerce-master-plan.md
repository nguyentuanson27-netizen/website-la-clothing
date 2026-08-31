# Growth + Commerce master implementation plan — PR #151 + #152 + #153

Status: **PLANNING ONLY — no runtime implementation is included in this PR.**

Planning baseline: `main@36ca06ccc57b89762069e8c0daab575fb6ef1421`, after PR #152, PR #153 and PR #151 were merged.

This document coordinates three already-reviewed planning sources:

- PR #151: `docs/specs/promotions-flash-sale-v1.md`, `tasks/promotions-flash-sale-v1-plan.md`, `tasks/promotions-flash-sale-v1-todo.md`;
- PR #152: `docs/audits/seo-geo-audit.md` and its Planning handoff P0–P7;
- PR #153: `docs/specs/marketing-analytics-shopping.md`, `tasks/marketing-analytics-shopping-plan.md`, `tasks/marketing-analytics-shopping-todo.md`.

## 1. Authority and scope

This master plan owns **sequencing, shared seams, implementation-PR boundaries, checkpoints and launch gates only**. It does not replace the domain contracts above.

Precedence:

1. The source spec/audit/plan that owns a domain remains normative for its business/security behavior.
2. This master plan is normative only when deciding which reviewed task lands first, which shared API is implemented once, and what must be green before another workstream may consume it.
3. Runtime module/file ownership must be re-read from then-current `main` before each implementation PR. Moving a module does not authorize changing a reviewed contract.
4. If two source documents become materially inconsistent after future edits, stop at the affected dependency and resolve the source contract in review. Do not let an implementation PR invent a reconciliation.
5. Every implementation PR starts from latest reviewed `main`, stays focused, and carries its own focused tests plus the project Definition of Done.

## 2. Program outcome

Deliver one coherent commerce/search/marketing foundation in which:

- website-owned promotion state produces one authoritative effective/final price;
- product/variant/order external identity is stable and consistent across storefront, cart, checkout, analytics, Merchant and structured data;
- SEO variant addressability, Merchant landing URLs and PDP preselection share one URL contract;
- cart and checkout expose one server-authoritative mutation/read projection rather than separate promotion/tracking implementations;
- Purchase analytics, Pancake submission and order audit use immutable finalized order facts;
- GTM routes reviewed application facts but does not own commerce truth;
- Merchant consumes the same price/identity/availability facts as the storefront;
- organic indexing stays fail-closed on the temporary domain and is activated only through its own permanent-domain/human gate.

## 3. Cross-program contracts that must be implemented once

### 3.1 Pricing authority

Source: PR #151 + PR #152 W3.

- `pancakeRetailPrice` is the website promotion base only after the required Pancake/catalog evidence gate.
- Website-owned campaign state + the central TypeScript resolver own effective promotion pricing.
- The sanctioned storefront SQL projection may mirror the same semantics only where before-pagination behavior requires it and must remain SQL↔TS parity-tested.
- UI, cart, checkout, analytics, Merchant, structured data and Pancake submission consume authoritative quote/snapshot facts; none may implement promotion arithmetic independently.
- `pancakeRetailPriceAfterDiscount` remains mirrored evidence, not promotion authority under the approved #151 contract.

### 3.2 Identity authority

Source: PR #153, consumed by #151/#152.

- product-level unselected upper funnel: `pancakeProductId`;
- concrete selected/committed variant: `pancakeVariationId`;
- local `VariantMirror.id`: internal authorization/mutation identity only;
- Purchase transaction/event identity: `OrderMirror.publicCode`.

No consumer may substitute slug, presentation key, local CUID, array position or guessed variant for these reviewed identity levels.

### 3.3 Cart and checkout truth

Source: PR #153 T5/T6 + PR #151 shared cart checkpoint/P8–P10.

- PDP AddToCart is an atomic committed `+1` mutation.
- Absolute cart update/remove returns committed quantity transition plus a bounded server-authoritative item snapshot.
- Cart/checkout analytics uses one complete all-or-nothing canonical projection.
- When promotion pricing exists, the current unit price in those facts comes from the central promotion resolver.
- Browser-rendered/client-cached price, identity, name or quantity is not authoritative.

Whichever workstream reaches this seam first implements the shared API once. The other workstream consumes it; no temporary duplicate cart path is allowed.

### 3.4 Variant URL and search contract

Source: PR #153 M2 + PR #152 W4a–W4c.

Standalone variant URL:

```text
/shop/<slug>?variant=<pancakeVariationId>
```

It must preselect only a valid current public standalone option and show matching price/color/size/image/availability. Forged, stale, inactive, private or composite variant queries fail closed. Organic canonical remains the base PDP unless a separately reviewed search contract changes it.

This contract must exist before variant-level ProductGroup/Offer structured data uses variant URLs.

### 3.5 Merchant cache freshness

Source: PR #153 M4 extended by PR #151.

- Keep one fixed Merchant success-cache/single-flight/negative-backoff domain.
- `MERCHANT_FEED_CACHE_TTL_SECONDS=300` is a maximum normal success TTL, not permission to cross a known promotion transition.
- Promotion owns one bounded durable promotion-pricing revision.
- Every effective promotion mutation named by #151 advances that revision in the same DB transaction.
- Cache-hit decisions and in-flight success publication validate the durable revision; no `after()`/fire-and-forget/post-commit callback is correctness authority.

### 3.6 Tracking and consent boundary

Source: PR #153.

- Direct Meta Pixel + CAPI remain direct.
- GA4 + Google Ads + TikTok Pixel route through GTM only after the exact immutable reviewed GTM version gate.
- PR-A/T1–T3 may prepare `dataLayer`, consent defaults and page-view authority but must not load GTM.
- No customer PII enters the generic commerce `dataLayer`.
- Tracking failure never changes commerce success.
- Current owner policy may grant tracking immediately while visible consent UI stays deferred; the abstraction must remain replaceable later.

### 3.7 Search/indexing boundary

Source: PR #152 / ADR 0004.

- `SEARCH_INDEXING_ENABLED=false` remains intentional on `la.lanadesign.vn`.
- A code-level hard block for the temporary production host must be added before index-launch readiness can be claimed.
- Merchant crawlability, GTM activation, promotion activation and structured-data work do not implicitly enable organic indexing.
- Permanent domain + human approval remain external prerequisites for organic index activation.

## 4. Security model for the combined program

Trust boundaries:

- admin promotion mutations: authenticated + authorized, bounded inputs, concurrency-safe;
- browser checkout/cart/tracking input: untrusted;
- Pancake catalog/order responses: external untrusted data;
- GTM/Google/TikTok configuration: external mutable control plane until exact saved version is reviewed;
- Merchant public feed route: unauthenticated public resource with DoS/resource-abuse exposure;
- editorial/catalog text serialized to XML/JSON-LD: untrusted output input;
- search/index config: deployment-controlled, never Host/query/client-controlled.

Required abuse protections inherited from source plans:

- no browser price authority;
- stateless bounded server-MAC quote proof for rendered-checkout acknowledgement;
- no raw HttpOnly cart UUID in browser-readable proof bytes/logs;
- promotion mutation/overlap lost-update and lock-order tests;
- Merchant offer/byte/DB-round-trip bounds, fixed cache key, single-flight and failure backoff;
- no request-controlled Merchant cache dimensions;
- safe XML/JSON-LD serialization;
- no GTIN inference from Pancake barcode naming;
- no PII/secrets/raw external payloads in logs;
- CSP origins remain closed until the reviewed integration actually needs them;
- temporary search host cannot become indexable through config error.

## 5. Dependency graph

```text
main@36ca06c
   |
   +--> S0 SEO temporary-host enforcement (#152 P0)
   |
   +--> A0 Tracking foundation, NO GTM (#153 T1-T3)
   |
   +--> P1 Promotion persistence + durable pricing revision (#151 P1)
   |
   +--> S1 Metadata uniqueness contract (#152 W2a)
             |
             +------------------------------+
                                            |
P1 --> P2 pricing + W3 evidence             |
 |          |                               |
 |          +--> T4 canonical identity -----+--> M1 identity/durability audit
 |                         |                         |
 |                         |                         +--> M2 variant deep-link (#152 W4b/W4c)
 |                         |
 +--> P3 lifecycle --> P4 concurrency/gate/revision
                           |
                           +--> P5 admin UX
                           +--> P6 PDP pricing <----- T4 + M2
                                      |
                                      +--> P7a /shop
                                      |       |
                                      |       +--> P7b /flash-sale
                                      |
                                      +--> T5 atomic PDP add
                                               |
                                               +--> T6 cart/checkout projection
                                                        |
P7b + T6 --> P8 DRAFT --> P9a render proof --> P9b fresh Pancake --> P10 final Pancake
                                                                        |
                                                                        +--> T7 Purchase

M1 + M2 + P7b + P4 durable revision --> M3 Merchant mapper --> M4 Merchant route/cache
M2 + P7b + M3 ------------------------> W4d ProductGroup/variant Offer
T1-T7 + exact reviewed container ------> T8 GTM loader/live mapping

S1 --> W2b metadata cleanup
#152 P2 regression inventory/wiring can run in parallel after baseline.
#152 P3-P7 continue after commerce correctness/addressability gates as listed below.
```

## 6. Implementation units / PR train

The default is **one focused PR per unit**. If a unit exceeds roughly five touched files or mixes independent subsystems, split it while preserving the dependency gate.

### U0 — Master-baseline reconciliation

**Source:** this master plan.

**Description:** At implementation start, confirm current `main` still contains the reviewed #151/#152/#153 contracts and no later PR silently superseded a shared seam.

**Acceptance criteria:**
- [ ] latest `main` reviewed;
- [ ] source spec/plan paths still present;
- [ ] shared pricing/identity/cart/variant-URL/Merchant-cache ownership unchanged or explicitly superseded;
- [ ] implementation branch starts from latest reviewed `main`.

**Verification:** branch compare + targeted source read; no code changes.

**Dependencies:** none.

**Estimated scope:** XS.

---

### U1 — Temporary production host indexing hard block

**Source:** #152 P0 / G1.

**Description:** Make the ADR 0004 temporary-domain noindex policy mechanically fail closed in release configuration.

**Acceptance criteria:**
- [ ] `la.lanadesign.vn` cannot pass release readiness with `SEARCH_INDEXING_ENABLED=true`;
- [ ] staging/local existing blocks remain intact;
- [ ] permanent-domain migration remains an explicit later reviewed change.

**Verification:** focused search-exposure/release-readiness tests + `pnpm release:check` in representative safe/unsafe config fixtures; `pnpm test`.

**Dependencies:** U0.

**Likely files:** search exposure config/release-readiness tests/scripts.

**Estimated scope:** S/M.

---

### U2 — Tracking foundation with zero GTM load

**Source:** #153 T1–T3 / PR-A.

**Description:** Add typed canonical event contracts, desired tracking config, `dataLayer`, consent defaults and app-owned page views while mechanically preventing GTM loading in every requested mode.

**Acceptance criteria:**
- [ ] upper funnel supports product-level identity without guessed variant;
- [ ] no customer PII in canonical events;
- [ ] requested `preview`/`live` still produces zero GTM loader/network path before T8;
- [ ] one canonical initial/navigation `page_view` authority.

**Verification:** focused mapping/config/page-view tests; `pnpm test`; `pnpm typecheck`; `pnpm lint`; security review of CSP and no-loader interlock.

**Dependencies:** U0.

**Likely files:** canonical analytics domain/publisher, app layout/navigation tracking, config tests.

**Estimated scope:** M slices; keep PR-A coherent as defined by #153.

---

### U3 — Promotion persistence + order audit + durable pricing revision

**Source:** #151 P1.

**Description:** Add additive campaign/target persistence, final order promotion audit facts and the bounded durable pricing revision used later by Merchant freshness.

**Acceptance criteria:** inherit #151 P1 in full, especially integer website money, preserved `pancakeVariationId`, additive migration and bounded durable revision.

**Verification:** RED/GREEN DB tests; `pnpm prisma:validate`; `pnpm prisma:generate`; migration deploy against approved test DB; historical compatibility.

**Dependencies:** U0.

**Likely files:** Prisma schema/migration, database/domain tests.

**Estimated scope:** M; split migration/domain if needed.

---

### U4 — Metadata collision-safe replacement contract

**Source:** #152 P1/W2a.

**Description:** Prove a human-readable collision-safe uniqueness mechanism before removing technical slug/path text from PDP metadata.

**Acceptance criteria:**
- [ ] collision cases remain unique without relying on unproven color/collection uniqueness;
- [ ] no metadata cleanup is merged until this contract is proven;
- [ ] existing uniqueness regression is replaced, not weakened.

**Verification:** `tests/domain/product-metadata.test.ts` focused cases + `pnpm test`.

**Dependencies:** U0.

**Estimated scope:** S.

---

### U5 — Central pricing resolver + Pancake/catalog evidence

**Source:** #151 P2 + #152 W3.

**Description:** Establish the one effective-price authority and collect the required real-catalog evidence before removing the equality gate.

**Acceptance criteria:** inherit #151 P2, including exact BigInt percentage arithmetic, fixed-final-price rules, conflict/invalid fallback and upper-safe fixture; sanitized `pnpm pancake:catalog:audit` evidence must be accepted before resolver rollout.

**Verification:** domain pricing table tests; `pnpm pancake:catalog:audit` in approved real-catalog context; `pnpm test`; evidence review.

**Dependencies:** U3.

**Likely files:** pricing domain/tests + bounded audit evidence.

**Estimated scope:** M.

**Stop condition:** materially contradictory Pancake evidence returns to product review; implementation does not silently change authority.

---

### U6 — Canonical external identity propagation

**Source:** #153 T4.

**Description:** Propagate `pancakeProductId` and real `pancakeVariationId` through list/PDP/options/cart/checkout facts while retaining local IDs for authorization.

**Acceptance criteria:** inherit T4; composite component lines preserve the purchased component variation external identity; no fallback to local ID/presentation key.

**Verification:** list/PDP/cart/checkout identity tests for standalone, composite and unresolvable/private cases; `pnpm test`; `pnpm typecheck`.

**Dependencies:** U0. Can run parallel with U5 after shared field shapes are checked.

**Estimated scope:** M slices.

---

### U7 — Merchant identity/durability/catalog audit

**Source:** #153 M1 + #152 W4a/W5 identifier caution.

**Description:** Prove lifecycle durability/format of Pancake product/variation IDs and audit SKU-as-MPN, media/content/apparel facts; never infer GTIN from barcode naming.

**Acceptance criteria:** inherit M1; composites classified `COMPOSITE_DEFERRED`; intended Merchant records have reviewed durability evidence.

**Verification:** bounded read-only audit + authorized real-catalog evidence; missing/duplicate/overlong ID and SKU cases.

**Dependencies:** U6 for application propagation evidence; repository/upstream durability evidence may be collected in parallel.

**Estimated scope:** S/M.

---

### U8 — Promotion repository/lifecycle/runtime health

**Source:** #151 P3.

**Description:** Add candidate resolution, durable lifecycle and affected-variant health around the central resolver.

**Acceptance criteria/verification:** inherit #151 P3 exactly, including composite actual-owner semantics, zero-traffic lifecycle, `disabledAt=null` on legal re-enable, bounded Copy behavior and `PARTIALLY_INVALID` recovery.

**Dependencies:** U5.

**Estimated scope:** M; split lifecycle vs candidate repository if needed.

---

### U9 — Promotion concurrency/admin domain + activation gate + atomic revision

**Source:** #151 P4.

**Description:** Make publish/re-enable/Scheduled edits race-safe, keep Disable/Copy bounded, and advance the durable pricing revision transactionally.

**Acceptance criteria/verification:** inherit #151 P4 in full, including deterministic lock order, 2000/2001 expansion, 1900→2001 Disable, same-campaign lost-update, overlap races, default-off `ACTIVATION_DISABLED`, revision commit/rollback/deadlock tests.

**Dependencies:** U8 + U3 revision persistence.

**Estimated scope:** M slices.

### Checkpoint A — commerce foundation

Required before promotion-facing UI or Merchant cache implementation:

- U3/U5/U8/U9 green;
- activation gate confirmed default-off;
- U6 identity contract green before consumers depend on external IDs;
- security review: authz, bounds, external data, no secrets/PII;
- 0 Critical / 0 Required in fresh review.

---

### U10 — Standalone variant deep link + canonical-query contract

**Source:** #153 M2 + #152 W4b/W4c.

**Description:** Implement the one variant addressability contract used by Merchant and later structured data.

**Acceptance criteria:** exact standalone preselection and matching price/color/size/image; forged/stale/private/composite values fail closed; base PDP canonical/search exposure remains authoritative.

**Verification:** route/server/client preselection tests + canonical-query tests + browser PDP checks.

**Dependencies:** U6 + U7 durability/identity gate.

**Estimated scope:** M.

---

### U11 — SEO HTTP/runtime coverage inventory and missing gates

**Source:** #152 P2/W15a/W15b.

**Description:** Map the five dedicated SEO smoke scripts against existing `pnpm test`, P18/runtime CI and wire only uncovered signals.

**Acceptance criteria:**
- [ ] coverage map names overlapping vs missing signals;
- [ ] only real HTTP/runtime gaps are added to CI;
- [ ] no duplicate expensive smoke suite without added evidence.

**Verification:** run the newly-owned focused smoke path plus existing applicable CI/runtime jobs.

**Dependencies:** U0. May run in parallel with U3–U10.

**Estimated scope:** S/M.

---

### U12 — Promotion admin UX

**Source:** #151 P5.

**Description:** Build `/admin/promotions` strictly over the U9 service boundary.

**Acceptance criteria/verification:** inherit #151 P5; no price/overlap math in React; bounded list/search; typed lifecycle feedback; keyboard/Axe/mobile and non-admin rejection.

**Dependencies:** U9.

**Estimated scope:** M slices.

---

### U13 — PDP promotion projection

**Source:** #151 P6; consumes #153 identity and M2 URL.

**Description:** Switch exact selected-option PDP pricing to the central resolver while preserving real owner/variant identity and the shared variant deep link.

**Acceptance criteria/verification:** inherit #151 P6; no local discount formula; no per-option N+1; standalone/composite actual-owner cases; M2 preselection compatibility.

**Dependencies:** U9 + U5 evidence + U6 + U10.

**Estimated scope:** M.

---

### U14 — `/shop` cards/filter/sort on effective price

**Source:** #151 P7a.

**Description:** Apply authoritative promotion pricing before bounded discovery pagination.

**Acceptance criteria/verification:** inherit P7a, including one `requestNow`, SQL `numeric` before percentage arithmetic, SQL↔TS parity, off-page transitions, existing page/offset guards and product-level upper-funnel identity.

**Dependencies:** U13.

**Estimated scope:** M.

---

### U15 — `/flash-sale` + route freshness

**Source:** #151 P7b.

**Description:** Add Flash membership through the same sanctioned projection and enforce query-wide boundary freshness.

**Acceptance criteria/verification:** inherit P7b: no second predicate, bounded page/offset, empty→active, end boundary, relative refresh ≤60s, clock-skew and background-resume tests.

**Dependencies:** U14.

**Estimated scope:** M.

### Checkpoint B — storefront truth

Required before checkout promotion state is persisted:

- PDP/cards/shop/Flash share one pricing authority;
- U6/U10 identity/addressability remain green;
- SQL↔TS parity and browser freshness/a11y green;
- activation remains off;
- fresh review 0 Critical / 0 Required.

---

### U16 — Atomic PDP AddToCart + canonical event snapshot

**Source:** #153 T5; consumes #151 pricing.

**Description:** Implement the distinct server-authoritative `+1` mutation and emit canonical AddToCart only from committed success facts.

**Acceptance criteria:** inherit T5; authoritative `pancakeVariationId`, current central-resolver unit price and committed quantity transition; analytics failure does not roll back commerce; no stale browser fallback.

**Verification:** absent→1, existing1→2, stock-bound, concurrent repeated clicks, stale-browser-price/current-server-price, snapshot failure, Meta compatibility; `pnpm test`.

**Dependencies:** U13 + U6 + U5.

**Estimated scope:** M.

---

### U17 — Cart update/remove snapshots + complete cart/checkout analytics projection

**Source:** #153 T6 + #151 shared cart checkpoint.

**Description:** Extend serialized absolute update/remove mutations with authoritative committed facts and add the complete all-or-nothing read projection used by ViewCart/BeginCheckout and promotion checkout.

**Acceptance criteria:** inherit T6; every analytics-safe line has real `pancakeVariationId` and central-resolver price; mixed/unresolvable cart suppresses the whole analytics event without changing commerce.

**Verification:** update/remove delta, pre-delete snapshot, price/stock race, standalone/composite external ID, partial-projection failure, exact merchandise sum.

**Dependencies:** U16 + U6 + U5.

**Estimated scope:** M slices.

---

### U18 — Mutable DRAFT promotion quote/audit

**Source:** #151 P8.

**Description:** Persist retryable current quote/audit while preserving #153 Purchase identity and keeping browser quote fields non-authoritative.

**Acceptance criteria/verification:** inherit P8; DRAFT contains purchased `pancakeVariationId`, base/final/promotion audit; unsigned quote facts cannot create submit-capable DRAFT.

**Dependencies:** U15 + U17.

**Estimated scope:** M.

---

### U19 — Stage-1 stateless rendered-quote proof

**Source:** #151 P9a.

**Description:** Bind the price actually rendered to the current anonymous cart via bounded stateless server HMAC/MAC without exposing raw `la_cart` UUID.

**Acceptance criteria/verification:** inherit P9a including 16 KiB/max+1, deterministic canonicalization, wrong-cart/forged proof fail-closed, no proof persistence rows/state, client-edited hidden quote cannot bypass `PRICE_CHANGED`.

**Dependencies:** U18.

**Estimated scope:** M.

---

### U20 — Stage-2 fresh Pancake reconfirmation

**Source:** #151 P9b.

**Description:** Re-resolve fresh trusted Pancake base through the same central pricing resolver before final submission.

**Acceptance criteria/verification:** inherit P9b; mismatch atomically refreshes DRAFT + `PRICE_CHANGED`; no Pancake create; percentage/fixed drift/recovery tests.

**Dependencies:** U19.

**Estimated scope:** M.

---

### U21 — Final Pancake price convergence

**Source:** #151 P10.

**Description:** Remove all three raw-live-price assumptions from final order submission and send immutable finalized unit price.

**Acceptance criteria/verification:** inherit P10; independent regressions for price-change comparison, totals and outbound `variation_info.retail_price`; controlled Pancake custom-price semantic acceptance remains mandatory before discounted activation.

**Dependencies:** U20.

**Estimated scope:** M.

---

### U22 — Canonical confirmed Purchase analytics

**Source:** #153 T7.

**Description:** Emit vendor-neutral Purchase only from immutable confirmed-order truth after promotion/order convergence.

**Acceptance criteria:** only `CONFIRMED`; `transactionId/eventId=publicCode`; item price/quantity/`pancakeVariationId` from immutable snapshots; repeat visit preserves identity; tracking failure never alters checkout success.

**Verification:** non-confirmed states, catalog deletion/enrichment loss, repeat identity, money bounds, existing Meta browser/CAPI tests.

**Dependencies:** U21 + U6.

**Estimated scope:** S/M.

### Checkpoint C — transaction truth

- U16–U22 green;
- two-stage `PRICE_CHANGED` proved;
- all three Pancake raw-live-price regressions green;
- immutable Purchase identity/value green;
- activation gate still off until controlled Pancake acceptance + enabled-consumer convergence;
- fresh review 0 Critical / 0 Required.

---

### U23 — Merchant standalone mapper

**Source:** #153 M3; consumes #151 pricing and #153 M2 identity/URL.

**Description:** Build pure standalone offer mapper from canonical storefront facts.

**Acceptance criteria:** stable audited IDs, `brand=LA Clothing`, audited MPN, no inferred GTIN, central effective price, trusted image, exact deep link, standalone-only; unsafe rows excluded with bounded reason; zero stock remains `out_of_stock` when structurally valid.

**Verification:** normal/out-of-stock/missing-content/invalid-SKU/price-media mismatch/composite exclusion; counts reconcile with U7.

**Dependencies:** U7 + U10 + U15 + U5.

**Estimated scope:** M.

---

### U24 — Merchant cached public route + promotion revision integration

**Source:** #153 M4 + #151 Merchant revision contract.

**Description:** Add standards-aware bounded serializer/public GET route using the single fixed cache domain, success TTL, single-flight, failure backoff and durable promotion revision.

**Acceptance criteria:** inherit M4 plus #151 revision semantics: known transition caps effective expiry; old-revision success bytes cannot be served by a cache decision that observed a newer committed revision; stale in-flight generation cannot publish as current; no request-controlled cache dimension.

**Verification:** cold/warm/concurrent GET, offer/byte/DB caps, persistent failure 60s backoff, Publish/Disable/Scheduled-edit revision races, in-flight generation race, malformed external text/XML parse, topology gate.

**Dependencies:** U23 + U9 durable revision.

**Estimated scope:** M slices.

---

### U25 — Variant ProductGroup/Offer structured data

**Source:** #152 W4d/W5; consumes U10 and U23.

**Description:** Only after variant URLs are truthful, add ProductGroup/variant Product+Offer markup using verified identifiers and current canonical price/availability semantics.

**Acceptance criteria:** no `AggregateOffer` shortcut for variants; each represented variant URL opens the exact option; Offer uses current effective price only when representable; unknown identifier semantics fail closed; base PDP remains canonical for single-page group.

**Verification:** domain + HTTP structured-data tests, variant URL/price/availability parity, generated JSON-LD parsing, Rich Results/manual evidence when available.

**Dependencies:** U10 + U15 + U23 + U11 coverage map.

**Estimated scope:** M.

---

### U26 — Immutable GTM version + actual loader/CSP + destinations

**Source:** #153 T8.

**Description:** Create/review an exact saved GTM version, commit its export identity/checksum, and only then add the first actual GTM loader/CSP openings.

**Acceptance criteria:** inherit T8; every production tag live-gated; GA4 duplicate page-view behavior disabled; Ads Purchase identity/value decision documented; TikTok `event_id=publicCode`; preview cannot send production destination traffic; live publishes the same reviewed saved version.

**Verification:** static export assertions, exact version ID, Tag Assistant exact-version preview, GA4 DebugView/test destination, Ads/TikTok diagnostics, zero preview traffic to production destinations.

**Dependencies:** U2 + U16 + U17 + U22. Promotion pricing must already flow through canonical event facts where monetary events are enabled.

**Estimated scope:** M; console artifact + app loader/CSP may be separate reviewed PRs if that improves rollback.

---

### U27 — PDP metadata cleanup after uniqueness proof

**Source:** #152 W2b.

**Description:** Remove technical slug/path copy only after U4 proves a replacement uniqueness contract.

**Acceptance criteria:** natural metadata copy + preserved collision safety; no regression in canonical/slug behavior.

**Verification:** metadata domain tests + applicable HTTP smoke from U11.

**Dependencies:** U4.

**Estimated scope:** S.

---

### U28 — Search/social fundamentals

**Source:** #152 P3/W8/W10/W14a/W14b.

**Description:** Land reviewable small PRs for root OG/Twitter fallback, static self-canonical behavior and branded HTML 404 recovery while preserving current slug/301/404 rules.

**Acceptance criteria:** each concern retains existing index/canonical policy and does not enable indexing on the temporary domain.

**Verification:** focused metadata/route tests + U11 HTTP/runtime gates.

**Dependencies:** U1 + U11. Split W8, W10 and W14 into separate PRs if combined diff exceeds a focused review boundary.

**Estimated scope:** S per concern.

---

### U29 — Sitemap significant `lastModified` contract

**Source:** #152 W9.

**Description:** Add sitemap `lastModified` only after a source of significant public-content change is defined; do not reuse raw mirror/internal timestamps blindly.

**Acceptance criteria:** timestamp semantics are explicit/tested and change only for significant public page updates.

**Verification:** sitemap domain/runtime tests.

**Dependencies:** approved public-change timestamp contract. May remain blocked.

**Estimated scope:** S/M.

---

### U30 — Organization/product discovery enrichment

**Source:** #152 P4/W5/W6.

**Description:** Add only first-party/identifier/shipping/return facts whose semantics are verified and keep Merchant + JSON-LD consistent with the same catalog contract.

**Acceptance criteria:** no fabricated GTIN/contact/address/policy; Organization and product fields are backed by approved public facts; Merchant/schema price/availability/identity do not diverge.

**Verification:** structured-data domain/HTTP tests + Merchant mapper parity where relevant.

**Dependencies:** U25 plus approved factual sources.

**Estimated scope:** split Product and Organization enrichment into focused S/M PRs.

---

### U31 — First-party evergreen content fact inventory

**Source:** #152 P5/W13A.

**Description:** Inventory required About/Returns/Shipping-Payment/Size Guide/Contact facts and explicitly mark sourced vs missing owner policy.

**Acceptance criteria:** no coding agent invents missing return/contact/address/size policy; missing facts are recorded as blocked dependencies.

**Verification:** human content/fact review; no runtime implementation required.

**Dependencies:** none; can run in parallel.

**Estimated scope:** S docs/review.

---

### U32 — Evergreen pages from approved facts

**Source:** #152 P5/W13.

**Description:** Build public evergreen pages only from U31 owner-approved facts and add useful internal links without generating thin pages at scale.

**Acceptance criteria:** one canonical fact source where practical; content matches approved policy; routes have correct metadata/canonical/index behavior under the existing gate.

**Verification:** route/content tests + accessibility/browser checks + U11 search runtime coverage.

**Dependencies:** U31 approved facts.

**Estimated scope:** one or two pages per focused PR.

---

### U33 — SEO operational/admin readiness

**Source:** #152 P6/W16/W17.

**Description:** Add the reviewed admin preview/counter/warning/health capabilities that reduce accidental search exposure/content quality regressions.

**Acceptance criteria/verification:** follow #152 findings exactly; keep authz and bounded input; no new policy authority in UI.

**Dependencies:** relevant underlying SEO contracts landed.

**Estimated scope:** split by admin concern.

---

### U34 — Permanent-domain webmaster/Merchant verification

**Source:** #152 P6/W18.

**Description:** Configure Search Console/Bing Webmaster/Merchant verification only on the approved permanent domain and without coupling it to organic index enablement.

**Acceptance criteria:** verification evidence recorded; temporary domain remains blocked; ownership/config values are reviewed and secrets handled appropriately.

**Dependencies:** permanent domain available + human owner approval.

**Estimated scope:** operational/config task.

---

### U35 — Crawler governance matrix

**Source:** #152 P6/W19.

**Description:** Record owner-approved crawler policy rather than guessing bot access policy.

**Acceptance criteria:** explicit allow/deny rationale; robots behavior generated from reviewed policy; no accidental blocking of required Merchant/Search verification paths.

**Dependencies:** owner approval.

**Estimated scope:** S.

---

### U36 — Sitemap scale/URL-volume trigger

**Source:** #152 P6/W21.

**Description:** Monitor catalog URL volume and introduce sitemap index/sharding before current hard limits become a production failure.

**Acceptance criteria:** measurable trigger before failure threshold; no premature complexity without evidence.

**Verification:** volume boundary tests + sitemap runtime checks.

**Dependencies:** catalog volume evidence.

**Estimated scope:** S/M when triggered.

---

### U37 — Representative runtime performance verification

**Source:** #152 P7.

**Description:** Measure representative `/`, `/shop`, collection and PDP pages after promotion/third-party-script changes are materially present.

**Acceptance criteria:** mobile + desktop baseline recorded; LCP/CLS/INP/lab diagnostics distinguished from source-code inference; blocking budgets only after a defensible baseline exists.

**Verification:** chosen runtime performance tooling with reproducible environment; before/after evidence for any optimization PR.

**Dependencies:** preferably after U14/U15 and U26 so measurements include final promotion/discovery and tag costs.

**Estimated scope:** measurement first; optimization tasks created only from evidence.

## 7. Safe parallelization

### Wave 1 — independent safety/foundations
Can run in parallel from current `main`:

- U1 temporary-host enforcement;
- U2 tracking foundation, no GTM;
- U3 promotion persistence;
- U4 metadata uniqueness contract;
- U11 SEO coverage inventory;
- U31 first-party content fact inventory.

### Wave 2 — commerce truth and identity

- U5 pricing/evidence after U3;
- U6 identity propagation;
- U7 Merchant audit after/alongside U6 evidence;
- U8→U9 sequential after U5;
- U27 after U4.

### Wave 3 — addressability + storefront

- U10 after U6/U7;
- U12 after U9;
- U13 after U9/U5/U6/U10;
- U14→U15 sequential;
- U16 may begin after U13 while U14/U15 continue;
- U17 follows U16.

### Wave 4 — checkout/order

Strict sequence:

```text
U15 + U17 → U18 → U19 → U20 → U21 → U22
```

Do not enable real promotions during partial U18–U21 rollout; the #151 activation gate remains off.

### Wave 5 — downstream consumers

Can partially parallel after their prerequisites:

- U23→U24 Merchant;
- U25 structured data after U23 + variant/storefront prerequisites;
- U26 GTM after canonical event/Purchase prerequisites;
- U28/U29/U30 SEO fundamentals/enrichment as their facts become available.

### Wave 6 — operational/search readiness

U32–U37 proceed according to human facts, permanent-domain availability and measurement evidence. They must not delay unrelated promotion/analytics code that remains safely disabled, but they do gate organic indexing where #152 says they are required.

## 8. Separate launch gates

### Gate P — Promotion activation

Activation stays **off by default** until:

- #151 P1–P10/U3,U5,U8,U9,U13–U21 accepted;
- price/catalog evidence accepted;
- controlled Pancake custom-price semantic acceptance succeeds;
- storefront/cart/checkout/Pancake money paths converge;
- existing direct Meta monetary behavior is promotion-aware where it emits money;
- any currently enabled GTM/Merchant consumer is promotion-aware; consumers still mechanically disabled/fail-closed do not block activation;
- rollback runbook + observability + final DoD accepted;
- human explicitly enables the activation gate.

### Gate T — GTM live

GTM may load/publish live only when:

- T1–T7 canonical event contracts are green;
- exact immutable saved GTM version/export/checksum is reviewed;
- preview/test mode proves zero traffic to production destinations;
- GA4 duplicate page-view behavior is disabled;
- Ads/TikTok Purchase identities use the reviewed `publicCode` contract;
- production publishes the same reviewed saved version;
- human owner approves live destination IDs/value semantics.

### Gate M — Merchant activation

Merchant Scheduled Fetch/data source activates only when:

- U7 durability/MPN evidence accepted;
- U10 exact variant landing URL accepted;
- U23 mapper and U24 bounded cache/public route green;
- promotion-aware price + durable revision semantics are integrated if promotion support is present;
- composite offers remain excluded/fail-closed;
- current runtime topology satisfies the reviewed cache/single-flight/backoff proof or a shared cross-replica mechanism exists;
- feed/XML/identity/price/availability evidence accepted;
- Merchant account/market/apparel requirements and owner approvals are satisfied.

### Gate S — Organic indexing

Organic indexing is independent and last:

- U1 temporary-host enforcement is green;
- permanent branded domain is confirmed;
- #152 Required gates relevant to index launch are complete, including metadata/variant/structured-data/regression safety as applicable;
- permanent-domain verification/operational readiness is accepted;
- human explicitly approves `SEARCH_INDEXING_ENABLED=true` on the permanent domain.

Promotion, GTM or Merchant activation **must not** imply Gate S.

## 9. Checkpoint verification baseline

Each implementation PR uses focused RED/GREEN tests first, then the applicable repo checks. At major checkpoints run at minimum when relevant:

```bash
pnpm test
pnpm test:db
pnpm typecheck
pnpm lint
pnpm build
pnpm prisma:validate
pnpm prisma:generate
pnpm release:check
```

Use `pnpm pancake:catalog:audit` only in an approved real-catalog context and record sanitized evidence. Run browser/runtime/a11y/SEO smoke checks where the affected route/behavior requires them; do not claim those checks if the environment/tool was not actually used.

## 10. Program Definition of Done

The program is not complete merely because all source task IDs have code. Final review must prove:

- all source task acceptance criteria for implemented scope are met;
- no duplicate pricing, cart, identity, variant-URL, Purchase or Merchant-cache authority was introduced;
- focused new/regression tests would fail without the behavior;
- existing test suites, lint/typecheck/build and applicable DB/runtime/browser checks are green;
- security review covers admin authz, browser input, quote proof, Merchant public-route abuse, external Pancake data, XML/JSON-LD serialization, GTM/CSP/secrets and PII;
- migrations are additive/backward-compatible and rollback paths are documented;
- observability exists for promotion rejection/conflict/price drift, Pancake outcome ambiguity, Merchant generation/backoff and tracking failures where operationally useful;
- docs describe current truth, not only historical review decisions;
- unrelated refactors are absent;
- each launch gate has explicit owner approval and rollback trigger;
- fresh final review has **0 Critical / 0 Required**.

## 11. Explicitly out of scope for this master plan

- changing the approved business rules inside #151/#153 without reopening their source contracts;
- coupons/stacking/BXGY/personalized promotion expansion beyond #151 v1;
- TikTok Events API;
- Meta-to-GTM migration;
- Enhanced Conversions/customer PII tracking;
- composite Merchant offers;
- inventing GTIN from Pancake barcode;
- enabling organic indexing on `la.lanadesign.vn`;
- fabricating About/Returns/Shipping/Size/Contact policy facts;
- unrelated storefront/admin refactors;
- performance optimization without measured evidence.
