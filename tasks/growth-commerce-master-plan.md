# Growth + Commerce master implementation plan — PR #151 + #152 + #153

Status: **PLANNING ONLY — no runtime implementation is included in this PR.**

Planning baseline: `main@36ca06ccc57b89762069e8c0daab575fb6ef1421`, after PR #152, PR #153 and PR #151 were merged.

## 1. Source authority

This master plan coordinates three already-reviewed sources:

- **PR #151 — Promotions & Flash Sale v1**
  - `docs/specs/promotions-flash-sale-v1.md`
  - `tasks/promotions-flash-sale-v1-plan.md`
  - `tasks/promotions-flash-sale-v1-todo.md`
- **PR #152 — SEO/GEO audit + planning handoff**
  - `docs/audits/seo-geo-audit.md`
- **PR #153 — Marketing analytics, GTM and Google Shopping**
  - `docs/specs/marketing-analytics-shopping.md`
  - `tasks/marketing-analytics-shopping-plan.md`
  - `tasks/marketing-analytics-shopping-todo.md`

This document owns only:

- cross-plan dependency order;
- shared-contract ownership;
- implementation PR boundaries;
- safe parallelization/checkpoints;
- separate launch gates.

It **does not duplicate or supersede** the detailed business/security acceptance criteria in the source documents.

Precedence rule:

1. Source spec/audit/plan owns domain behavior.
2. This master plan owns sequencing and cross-feature seams.
3. Each implementation PR re-reads then-current `main` to locate actual modules without redefining reviewed contracts.
4. A material source-contract conflict stops implementation at that dependency; it is resolved in planning/review, not invented inside `/build`.

## 2. Shared contracts — implement once

### Pricing
Owner: **#151 P2**, with **#152 W3 evidence gate**.

- Website campaign state + central TypeScript resolver own effective promotion price.
- One sanctioned SQL projection may mirror the contract where pre-pagination behavior requires it; SQL↔TS parity remains mandatory.
- Cart, checkout, analytics, Merchant, structured data and Pancake consume authoritative quote/snapshot facts; none owns a second promotion formula.

### Identity
Owner: **#153 T4**.

- unselected product-level upper funnel → `pancakeProductId`;
- concrete selected/committed variant → `pancakeVariationId`;
- internal mutation/authorization → `VariantMirror.id`;
- Purchase transaction/event identity → `OrderMirror.publicCode`.

No consumer may fabricate a selected variant or substitute slug/local CUID/presentation key for the reviewed external identity.

### Cart/checkout truth
Owner: **#153 T5/T6**, consumed by **#151 P8–P10**.

- PDP AddToCart = one atomic committed `+1`;
- update/remove returns committed transition + server-authoritative bounded item snapshot;
- `view_cart` / `begin_checkout` use one complete all-or-nothing canonical projection;
- promotion pricing plugs into this API instead of creating a second cart path.

Whichever implementation stream reaches this seam first builds the canonical API once; the other consumes it.

### Variant URL / canonical query
Owner: **#153 M2**, satisfying **#152 W4a–W4c** after identity evidence.

```text
/shop/<slug>?variant=<pancakeVariationId>
```

The URL preselects only a valid public standalone option. Base PDP canonical/search policy remains authoritative. Variant-level structured data may not precede this contract.

### Merchant cache freshness
Owner: **#153 M4**, extended by **#151 durable promotion-pricing revision**.

- one fixed success-cache/single-flight/failure-backoff domain;
- 300s is maximum normal success TTL, not permission to cross known promotion boundaries;
- effective promotion mutations advance durable pricing revision in the same DB transaction;
- cache decisions/in-flight publication validate that revision;
- no post-commit `after()`/fire-and-forget callback is correctness authority.

### Tracking / consent
Owner: **#153**.

- GA4 + Google Ads + TikTok Pixel through GTM;
- existing Meta Pixel + CAPI stay direct;
- T1–T3 may prepare canonical events/dataLayer/consent/page-view authority but load **no GTM**;
- T8 owns the first actual GTM loader/CSP opening after exact immutable saved-version review;
- no customer PII in generic commerce dataLayer;
- tracking failure never changes commerce success.

### Search exposure
Owner: **#152 / ADR 0004**.

- `SEARCH_INDEXING_ENABLED=false` remains intentional on `la.lanadesign.vn`;
- temporary production host gets a hard enforcement block;
- promotion/GTM/Merchant activation never implies organic indexing;
- permanent domain + explicit human approval remain prerequisites for index enablement.

## 3. Security boundaries carried across the program

Apply source security requirements at every relevant PR:

- admin promotions: authn + authz + finite bounds + concurrency safety;
- browser price/quote/cart/tracking input: untrusted;
- Stage-1 checkout acknowledgement: bounded stateless server-MAC proof; raw HttpOnly cart UUID remains server-only context;
- Pancake catalog/order data: external untrusted input;
- Merchant route: public DoS/resource-abuse boundary with offer/byte/DB limits, fixed-key cache, single-flight and failure backoff;
- Merchant/XML/JSON-LD text: standards-aware escaping/serialization;
- GTM workspace/config: mutable external control plane until exact saved version is reviewed;
- CSP origins stay closed until required by the reviewed integration;
- no secrets/PII/raw external payloads in logs;
- search index config is deployment-owned, never Host/query/client-controlled.

## 4. Dependency graph

```text
main@36ca06c
 |
 +-- SEO P0 temporary-host enforcement
 +-- #153 T1-T3 tracking foundation (NO GTM)
 +-- #151 P1 persistence + durable pricing revision
 +-- #153 T4 canonical identity -----------------------------+
 +-- #153 M1 identity/durability audit ----------------------+--> #153 M2 variant deep-link
 +-- #152 W2a metadata uniqueness contract
 +-- #152 W15a coverage inventory
 +-- #152 W13A first-party fact inventory

#151 P1 -> #151 P2 + #152 W3 pricing/evidence -> #151 P3 -> #151 P4
                                                     |
                                                     +-> #151 P5 admin UX

#151 P4 + #151 P2 + #153 T4 + #153 M2 -> #151 P6 PDP
                                               |
                                               +-> #151 P7a /shop -> #151 P7b /flash-sale
                                               |
                                               +-> #153 T5 PDP add -> #153 T6 cart/checkout

#151 P7b + #153 T6 -> #151 P8 -> P9a -> P9b -> P10 -> #153 T7 Purchase

#153 M1 + M2 + #151 P7b -> #153 M3 Merchant mapper
#153 M3 + #151 P4 durable revision -> #153 M4 Merchant route/cache

#153 M2 + #151 P7b + verified identifiers -> #152 W4d ProductGroup/variant Offer
#153 T1-T7 -> #153 T8 exact saved-version review -> actual GTM loader/live mapping

#152 W2a -> W2b metadata cleanup
#152 W15a -> W15b missing HTTP/runtime gates
#152 P3-P7 continue independently as their factual/domain prerequisites become available.
```

Important parallelization rule: **#153 M1 and T4 are independent prerequisites of M2.** M1 is a read-only catalog/provider/repository evidence task and can run in parallel with T4; M2 waits for both reviewed application identity propagation and accepted durability evidence.

## 5. Implementation PR train

Each unit below is normally one focused implementation PR. Detailed acceptance criteria/verification are inherited from the named source task. Split further when the source task or actual diff crosses a focused review/revert boundary.

### Wave 0 — baseline and safety

#### U0 — Reconcile latest main
Source: master plan.

- Re-read #151/#152/#153 sources on latest `main` before implementation starts.
- Confirm no later reviewed PR superseded pricing, identity, cart, variant-URL or Merchant-cache ownership.
- Record exact base SHA for the first implementation wave.

#### U1 — Temporary production host hard block
Source: **#152 P0 / G1**.

Purpose: make temporary-domain noindex policy mechanically fail closed in release readiness without changing the permanent-domain approval gate.

#### U2 — Tracking foundation, still no GTM
Source: **#153 T1–T3 / PR-A**.

Purpose: canonical event contracts, desired mode config, dataLayer, consent defaults and app-owned page views while preview/live remain operationally no-GTM.

#### U3 — Promotion persistence + durable pricing revision
Source: **#151 P1**.

Purpose: additive campaign/target persistence, order promotion audit and durable revision foundation required later by Merchant freshness.

#### U4 — Metadata uniqueness replacement contract
Source: **#152 P1/W2a**.

Purpose: prove collision-safe uniqueness before removing slug/path technical metadata copy.

#### U5 — SEO runtime coverage inventory
Source: **#152 P2/W15a**.

Purpose: map five dedicated SEO smoke scripts against existing tests/P18/runtime coverage before wiring anything new.

#### U6 — First-party content fact inventory
Source: **#152 P5/W13A**.

Purpose: identify owner-approved vs missing About/Returns/Shipping-Payment/Size/Contact facts; missing policy remains BLOCKED, not inferred.

**Safe parallel set:** U1–U6 may proceed independently from the same reviewed baseline, subject to normal file overlap coordination.

### Wave 1 — commerce truth and identity

#### U7 — Central pricing + Pancake evidence
Source: **#151 P2 + #152 W3**.

Depends on: U3.

Stop if real Pancake evidence materially contradicts the approved pricing ownership; return to product review.

#### U8 — Canonical external identity propagation
Source: **#153 T4**.

Can run from the reviewed baseline in parallel with U7/U9 when file overlap is controlled.

#### U9 — Merchant identity/durability/catalog audit
Source: **#153 M1 + #152 W4a identifier caution**.

Can begin from baseline in parallel with U8. Final M2 gate later requires U8 + accepted U9 evidence.

#### U10 — Promotion repository/lifecycle/runtime health
Source: **#151 P3**.

Depends on: U7.

#### U11 — Promotion concurrency/admin domain + activation gate + atomic revision
Source: **#151 P4**.

Depends on: U10 + U3 revision persistence.

### Checkpoint A — commerce foundation

Before promotion storefront/UI or Merchant cache work:

- #151 P1–P4 focused verification green;
- activation gate proved default-off;
- pricing evidence accepted;
- identity contract ready before consumers rely on external IDs;
- authz/bounds/concurrency/external-data security review complete;
- fresh review: 0 Critical / 0 Required.

### Wave 2 — addressability and storefront

#### U12 — Standalone variant deep link
Source: **#153 M2 + #152 W4b/W4c**.

Depends on: U8 + accepted U9 identity/durability evidence.

This is the single preselection/canonical-query contract for Merchant and later variant structured data.

#### U13 — Wire only missing SEO HTTP/runtime gates
Source: **#152 P2/W15b**.

Depends on: U5 coverage inventory.

Do not create duplicate expensive smoke work where existing CI already proves the same signal.

#### U14 — Promotion admin UX
Source: **#151 P5**.

Depends on: U11.

#### U15 — PDP promotion projection
Source: **#151 P6**.

Depends on: U11 + U7 evidence + U8 + U12.

Master-plan choice: land M2 first so promotion work consumes the canonical variant-selection URL/state instead of creating a temporary competing PDP state model.

#### U16 — `/shop` effective-price discovery
Source: **#151 P7a**.

Depends on: U15.

#### U17 — `/flash-sale` + freshness
Source: **#151 P7b**.

Depends on: U16.

### Checkpoint B — storefront truth

Before checkout promotion persistence:

- PDP/cards/shop/Flash share one pricing authority;
- T4/M2 identity and URL regressions green;
- SQL↔TS pricing parity green;
- browser freshness/a11y verification green where applicable;
- activation still off;
- fresh review: 0 Critical / 0 Required.

### Wave 3 — canonical cart/checkout APIs

#### U18 — Atomic PDP AddToCart
Source: **#153 T5**.

Depends on: U15 + U8 + U7.

Purpose: make the shared committed `+1` mutation/event snapshot promotion-aware from its first implementation.

#### U19 — Cart update/remove + complete cart/checkout projection
Source: **#153 T6 + #151 shared cart checkpoint**.

Depends on: U18 + U8 + U7.

Purpose: one authoritative mutation/read projection for both analytics and promotion checkout; no duplicate temporary path.

### Wave 4 — checkout/order convergence

Strict transaction sequence:

```text
U17 + U19
   -> U20 #151 P8 mutable DRAFT quote/audit
   -> U21 #151 P9a stateless rendered-quote proof
   -> U22 #151 P9b fresh Pancake reconfirmation
   -> U23 #151 P10 final Pancake convergence
   -> U24 #153 T7 confirmed Purchase
```

Do not enable real promotions while P8–P10 are only partially landed. The #151 technical activation gate remains off.

### Checkpoint C — transaction truth

Before downstream live consumers/real discounted activation:

- two-stage `PRICE_CHANGED` proved;
- all three Pancake raw-live-price regressions green;
- controlled Pancake custom-price semantic acceptance recorded before real discounts;
- immutable Purchase identity/value uses finalized order snapshot;
- existing direct Meta compatibility green;
- fresh review: 0 Critical / 0 Required.

### Wave 5 — downstream consumers

#### U25 — Merchant standalone mapper
Source: **#153 M3**.

Depends on: accepted U9 audit + U12 + U17 + central pricing.

#### U26 — Merchant cached public route + promotion revision integration
Source: **#153 M4 + #151 Merchant freshness contract**.

Depends on: U25 + U11 durable revision behavior.

#### U27 — Variant ProductGroup/Offer structured data
Source: **#152 W4d/W5**.

Depends on: U12 + U17 + verified identifier semantics + U13 HTTP/runtime coverage ownership.

U27 does **not** require the Merchant mapper to land first. U25 and U27 may run in parallel once they share the same reviewed canonical storefront facts. Before Merchant or index launch, add integration evidence that feed and JSON-LD do not disagree on identity/price/availability.

#### U28 — Exact GTM saved version + actual loader/CSP + destination mapping
Source: **#153 T8**.

Depends on: U2 + U18/U19 canonical cart events + U24 Purchase.

Only this unit may introduce the first actual GTM load for the new integration, after exact saved-version export/checksum review.

### Wave 6 — SEO/search follow-through

#### U29 — PDP metadata cleanup
Source: **#152 W2b**.

Depends on: U4.

#### U30 — Search/social fundamentals
Source: **#152 P3 / W8, W10, W14a, W14b**.

Split into focused PRs where appropriate: root OG/Twitter fallback, static self-canonical, branded route-level 404, unknown product-slug HTML 404 while preserving current slug/historical 301 behavior.

#### U31 — Significant sitemap `lastModified`
Source: **#152 W9**.

Blocked until a timestamp contract for significant public-page change exists. Do not use raw mirror/internal `updatedAt` blindly.

#### U32 — Product/Organization discovery enrichment
Source: **#152 P4 / W5/W6**.

Use only verified identifier/public first-party facts. Merchant and JSON-LD must describe the same catalog/price/availability contract.

#### U33 — Evergreen public pages
Source: **#152 P5/W13**.

Depends on: owner approval from U6. Build from approved facts only; do not invent return/contact/address/size policy.

#### U34 — SEO admin/operational readiness
Source: **#152 P6/W16/W17**.

Keep UI advisory where the audit says guidance is soft; UI does not become a new SEO policy authority.

#### U35 — Permanent-domain verification
Source: **#152 P6/W18**.

Blocked on permanent branded domain + owner approval. Search Console/Bing/Merchant verification does not itself enable indexing.

#### U36 — Crawler governance matrix
Source: **#152 P6/W19**.

Blocked on owner distribution/data-use policy.

#### U37 — Sitemap scale trigger
Source: **#152 P6/W21**.

Measure catalog URL volume and add sitemap index/sharding before the current hard cliff only when evidence shows the trigger is approaching.

#### U38 — Runtime performance verification
Source: **#152 P7**.

Measure representative `/`, `/shop`, collection and PDP pages on mobile/desktop after promotion and third-party script changes are materially present. Create optimization/budget work only from measured evidence.

## 6. Conditional items not on the default critical path

### #152 W12 — listing `ItemList` / `CollectionPage`

Do not schedule by default. Promote into the plan only when target-market/consumer evidence shows value; current audit does not justify it for the Vietnam storefront.

### #152 W20 — `llms.txt`

Do not schedule for Google SEO/GEO. Add only if a named non-Google consumer/use case has enough owner-approved value to justify maintenance.

### Other deferred items inherited from #153/#151

- TikTok Events API;
- Meta-to-GTM migration;
- Enhanced Conversions/customer PII;
- composite Merchant offers;
- coupons/stacking/BXGY/personalized promotion expansion.

These require their own future source contract; they are not hidden substeps of this program.

## 7. Safe parallelization summary

### Can start together

- U1 SEO temporary-host enforcement;
- U2 tracking foundation/no GTM;
- U3 promotion persistence;
- U4 metadata uniqueness contract;
- U5 SEO coverage inventory;
- U6 content fact inventory;
- U8 identity propagation and U9 Merchant audit may also proceed early when file overlap is controlled.

### Must stay sequential

- promotion domain: U7 -> U10 -> U11;
- storefront promotion: U15 -> U16 -> U17;
- checkout/order: U20 -> U21 -> U22 -> U23 -> U24;
- SEO metadata: U4 -> U29;
- SEO coverage: U5 -> U13.

### Coordinate at shared interfaces

- U8/U9 -> U12 variant identity/URL;
- U15/U18/U19 shared selected variant/cart facts;
- U11 durable revision -> U26 Merchant cache;
- U12 + canonical storefront facts -> U25 Merchant and U27 structured data;
- U24 Purchase -> U28 GTM live mappings.

## 8. Separate launch gates

These are independent approvals, not one release switch.

### Gate P — Promotion activation

Requires #151 P1–P10 plus enabled-consumer convergence, price/catalog evidence, controlled Pancake custom-price semantic acceptance, readiness/rollback/observability and explicit human activation. GTM/Merchant still mechanically disabled/fail-closed do not block promotion; if enabled, they must already consume promotion-aware money.

### Gate T — GTM live

Requires T1–T7 canonical facts, exact immutable saved GTM version/export/checksum, preview isolation proving zero production-destination traffic, reviewed destination semantics and publication of the same reviewed saved version.

### Gate M — Merchant activation

Requires M1–M4, exact standalone variant landing URL, audited IDs/MPN, canonical pricing, bounded cache/single-flight/backoff, #151 promotion revision integration when promotions are supported, topology proof and Merchant account/market/apparel owner gates. Composite remains excluded.

### Gate S — Organic indexing

Requires temporary-host enforcement, permanent branded domain, applicable #152 Required correctness/regression/operational gates and explicit human approval to enable indexing on the permanent domain. Promotion/GTM/Merchant activation never implies this gate.

## 9. Verification baseline

Every implementation unit inherits source verification and uses focused RED/GREEN tests first. At major checkpoints run the applicable project commands:

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

`pnpm pancake:catalog:audit` is run only in an approved real-catalog context with sanitized evidence.

Browser/runtime/a11y/SEO/GTM/Merchant checks are required when the affected source task requires them. Never claim a command/browser/external acceptance check unless it was actually executed.

## 10. Program Definition of Done

Before calling the combined program complete:

- source-task acceptance criteria for implemented scope are met;
- no duplicate pricing/cart/identity/variant-URL/Purchase/Merchant-cache authority exists;
- focused regressions would fail without the new behavior;
- existing relevant tests + lint/typecheck/build + applicable DB/runtime/browser/a11y checks are green;
- security review covers admin authz, browser/external input, quote proof, Merchant public route, serialization, GTM/CSP/secrets and PII;
- migrations/backward compatibility and rollback are reviewed;
- observability exists for new critical production failure modes without leaking secrets/PII;
- docs describe current truth;
- unrelated refactors/dead code/debug output are absent;
- launch gates remain independent with explicit owner approval/rollback triggers;
- fresh final review has **0 Critical / 0 Required**.
