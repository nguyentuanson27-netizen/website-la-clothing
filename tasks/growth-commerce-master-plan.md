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
- implementation/operations unit boundaries;
- safe parallelization and checkpoints;
- independent launch gates.

It does **not** replace detailed acceptance criteria in the source documents.

Precedence:

1. The owning source spec/audit/plan remains normative for domain behavior and security.
2. This master plan is normative for sequencing and cross-feature seams after the three source PRs are combined.
3. Every implementation PR starts from latest reviewed `main` and re-reads its owning source task.
4. A later material source-contract conflict stops the affected dependency and returns to planning/review; `/build` must not invent a reconciliation.
5. Directly affected tests stay with the behavior they prove; ADR 0005 governs split/reviewability by atomicity and risk, not file count.

## 2. Shared contracts — implement once

### Pricing
Owner: **#151 P2**, with **#152 W3** as the Pancake evidence gate.

Website promotion state + the central TypeScript resolver own promotional effective price. The sanctioned SQL storefront projection may mirror that contract where pre-pagination behavior requires it and must stay parity-tested. Cart, checkout, analytics, Merchant, structured data and Pancake submission consume authoritative quote/snapshot facts; none owns a second promotion formula.

### Identity
Owner: **#153 T4**.

- product-level upper funnel → `pancakeProductId`;
- concrete selected/committed variant → `pancakeVariationId`;
- internal authorization/mutation → `VariantMirror.id`;
- Purchase transaction/event identity → `OrderMirror.publicCode`.

No consumer may fabricate a selected variant or substitute slug/local CUID/presentation key for a reviewed external identity.

### Cart/checkout truth
Owner: **#153 T5/T6**, consumed by **#151 P8–P10**.

PDP AddToCart is one committed `+1`; update/remove return committed transitions plus bounded server-authoritative item facts; `view_cart` and `begin_checkout` use one complete all-or-nothing canonical projection. Promotion pricing plugs into this shared API instead of creating another cart path.

### Variant URL / canonical query
Owner: **#153 M2**, satisfying **#152 W4a–W4c** after identity evidence.

```text
/shop/<slug>?variant=<pancakeVariationId>
```

The URL preselects only a valid public standalone option. Base PDP canonical/search policy remains authoritative. #151 P6 may land before M2, but it must use the T4-selected concrete variant state and must not invent a competing query/canonical contract; M2 later binds its deep link to that same state.

### Merchant cache freshness
Owner: **#153 M4**, extended by **#151's durable promotion-pricing revision**.

There is one fixed success-cache/single-flight/failure-backoff domain. The 300-second success TTL is a maximum normal TTL, not permission to cross known promotion boundaries. Effective promotion mutations advance the durable pricing revision in the same DB transaction; cache decisions and in-flight publication validate that revision. No post-commit `after()`/fire-and-forget callback is correctness authority.

### Product structured-data ownership
Owner split from **#152 W4/W5/W6**:

- **U27** owns `ProductGroup` + variant `Product`/`Offer` shape, variant-level price/availability/URL parity, and the variant-level portion of W5 that is inseparable from W4d.
- **U32** owns only additional verified **product-level** identifiers/attributes plus W6 Organization enrichment; it must not redefine `ProductGroup` or variant `Offer` behavior.

This split prevents two implementation PRs from both claiming `buildOffer`/variant-schema authority.

### Tracking / consent
Owner: **#153**.

GA4 + Google Ads + TikTok Pixel route through GTM; existing Meta Pixel + CAPI stay direct. T1–T3 prepare canonical events/dataLayer/consent/page-view authority with **zero GTM load**. T8 owns the first actual GTM loader/CSP opening after exact saved-version review. Generic commerce dataLayer carries no customer PII and tracking failure never changes commerce success.

### Search exposure
Owner: **#152 / ADR 0004**.

`SEARCH_INDEXING_ENABLED=false` remains intentional on `la.lanadesign.vn`; temporary production gets a hard enforcement block. Promotion/GTM/Merchant activation never implies organic indexing. Permanent domain + explicit human approval remain prerequisites for index enablement.

## 3. Explicit cross-plan sequencing decisions

The source documents were reviewed independently, so this master plan names the few sequencing changes introduced by combining them.

1. **M1 may run in parallel with T4.** #153 §5 draws `T4 → M1`; this master intentionally relaxes that edge because M1 is a read-only audit over already mirrored `pancakeVariationId`/`pancakeProductId`/SKU/catalog facts and does not require T4 application-layer propagation. **M2 still waits for both T4 and accepted M1 durability evidence.**
2. **P6 does not wait for M1/M2.** P6 waits for P4 + P2 evidence + T4 and uses the T4 selected-variant state. M2 later attaches the reviewed deep link to that state.
3. **T5/T6 are not semantically owned by P6.** #153 allows T5/T6 from T4; this combined train additionally requires the central pricing foundation U7 before their server-authoritative money snapshots are considered promotion-aware. They may run in parallel with P6/P7 once U7 + T4 are green. G1 later proves rendered/current-event convergence after storefront promotion projection lands.
4. **W15b is not a hard prerequisite for W4d implementation.** U27 carries its own focused HTTP/structured-data verification; U13/W15b remains required before organic-index launch where its coverage map says the signal is missing.

## 4. Security boundaries carried across the program

- promotion admin: authn/authz, finite bounds, deterministic concurrency safety;
- browser price/quote/cart/tracking input: untrusted;
- Stage-1 checkout acknowledgement: bounded stateless server-MAC proof; raw HttpOnly cart UUID stays server-only context;
- Pancake catalog/order data: external untrusted input;
- Merchant public route: DoS/resource-abuse boundary with offer/byte/DB limits, fixed-key cache, single-flight and failure backoff;
- Merchant/XML/JSON-LD text: standards-aware escaping/serialization;
- GTM workspace/config: mutable external control plane until exact saved version is reviewed;
- CSP origins stay closed until required by the reviewed integration;
- no secrets/PII/raw external payloads in logs;
- search-index configuration is deployment-owned, never Host/query/client-controlled.

## 5. Dependency graph

```text
main@36ca06c
 |
 +-- U1  #152 P0 temporary-host enforcement
 +-- U2  #153 T1-T3 tracking foundation (NO GTM)
 +-- U3  #151 P1 persistence + durable pricing revision
 +-- U4  #152 W2a metadata uniqueness contract
 +-- U5  #152 W15a coverage inventory
 +-- U6  #152 W13A first-party fact inventory
 +-- U8  #153 T4 canonical identity -------------------+
 +-- U9  #153 M1 durability/catalog audit ------------+--> U12 #153 M2 deep-link

U3 -> U7 (#151 P2 + #152 W3) -> U10 (#151 P3) -> U11 (#151 P4)
                                                    |
                                                    +-> U14 #151 P5 admin UX

U11 + U7 + U8 -> U15 #151 P6 PDP
                       |\
                       | +-> U16 #151 P7a /shop -> U17 #151 P7b /flash-sale
                       |
                       +---- selected-variant state keyed by pancakeVariationId

U7 + U8 -> U18 #153 T5 upper-funnel + atomic PDP AddToCart -> U19 #153 T6 cart/update projection

U17 + U19 -> U20 #151 P8 -> U21 P9a -> U22 P9b -> U23 P10 -> U24 #153 T7 Purchase

U9 + U12 + U17 -> U25 #153 M3 -> U26 #153 M4
U12 + U17 + verified identifiers -> U27 #152 W4d + variant-level W5
U2 + U18 + U19 + U24 -> U28 #153 T8

U4 -> U29 #152 W2b
U5 -> U13 #152 W15b
U6 -> U33 #152 W13

U24 + enabled consumers -> U39 #151 G1 convergence
U23 -> U40 #151 G2 observability/readiness/rollback
U25 + U26 + owner/account gates -> U41 #153 M5 Merchant activation
U28 + U41 -> U42 #153 V1 final convergence/rollback
U39 + U40 -> U43 #151 G3 integrated DoD
```

## 6. Implementation / operations train

Each unit is normally one focused implementation or operations PR/change set. If the owning source task is larger than a reviewable/revertable concern, split it further without changing the unit's contract.

### Wave 0 — baseline and safety

- **U0 — Reconcile latest `main`**  
  Source: this master plan + **#151 P0** reconciliation pattern. Re-read all three source artifacts, confirm no later reviewed PR superseded shared ownership, and record exact base SHA.
- **U1 — Temporary production host hard block**  
  Source: **#152 P0/G1**.
- **U2 — Tracking foundation, still no GTM**  
  Source: **#153 T1–T3 / PR-A**.
- **U3 — Promotion persistence + durable pricing revision**  
  Source: **#151 P1**.
- **U4 — Metadata uniqueness replacement contract**  
  Source: **#152 P1/W2a**.
- **U5 — SEO runtime coverage inventory**  
  Source: **#152 P2/W15a**.
- **U6 — First-party content fact inventory**  
  Source: **#152 P5/W13A**; missing owner facts remain BLOCKED, never inferred.

U1–U6 are a safe parallel set when file ownership does not collide. U8/U9 may also begin early from the reviewed baseline.

### Wave 1 — commerce truth and identity

- **U7 — Central pricing + Pancake evidence** — **#151 P2 + #152 W3**; depends U3. Material contradiction in real Pancake evidence returns to product review.
- **U8 — Canonical external identity propagation** — **#153 T4**; may run from baseline.
- **U9 — Merchant identity/durability/catalog audit** — **#153 M1 + #152 W4a caution**; read-only and may run in parallel with U8.
- **U10 — Promotion repository/lifecycle/runtime health** — **#151 P3**; depends U7.
- **U11 — Promotion concurrency/admin domain + activation gate + atomic revision** — **#151 P4**; depends U10 + U3 revision persistence.

#### Checkpoint A — commerce foundation

Before promotion storefront or Merchant cache work: #151 P1–P4 focused verification green; activation gate default-off; pricing evidence accepted; authz/bounds/concurrency/external-data security review green; identity ready before consumers rely on it; fresh review **0 Critical / 0 Required**.

### Wave 2 — addressability and storefront

- **U12 — Standalone variant deep link** — **#153 M2 + #152 W4b/W4c**; depends U8 + accepted U9 evidence.
- **U13 — Wire only missing SEO HTTP/runtime gates** — **#152 P2/W15b**; depends U5 coverage inventory. Avoid duplicate expensive smoke work.
- **U14 — Promotion admin UX** — **#151 P5**; depends U11.
- **U15 — PDP promotion projection** — **#151 P6**; depends U11 + U7 evidence + U8. Uses T4 selected-variant state; consumes U12 only if already landed and never invents URL/canonical semantics.
- **U16 — `/shop` effective-price discovery** — **#151 P7a**; depends U15.
- **U17 — `/flash-sale` + freshness** — **#151 P7b**; depends U16.

#### Checkpoint B — storefront truth

PDP/cards/shop/Flash share one price authority; T4 regressions green; **if U12/M2 has landed**, its addressability regressions also green; SQL↔TS parity and required browser freshness/a11y checks green; activation remains off; fresh review **0 Critical / 0 Required**.

### Wave 3 — canonical analytics/cart APIs

- **U18 — T5 upper-funnel events + atomic PDP AddToCart** — **#153 T5**; depends U7 + U8. Covers `view_item_list`, `select_item`, initial product-level `view_item`, product-vs-selected-variant semantics, and the serialized `+1` mutation with authoritative event snapshot. It may run in parallel with U15–U17 after shared prerequisites are green.
- **U19 — Cart update/remove + complete cart/checkout projection** — **#153 T6 + #151 shared cart checkpoint**; depends U18 + U7 + U8. One authoritative API only; no temporary duplicate path.

### Wave 4 — checkout/order convergence

Strict sequence:

```text
U17 + U19
  -> U20 #151 P8 mutable DRAFT quote/audit
  -> U21 #151 P9a stateless rendered-quote proof
  -> U22 #151 P9b fresh Pancake reconfirmation
  -> U23 #151 P10 final Pancake convergence
  -> U24 #153 T7 confirmed Purchase
```

Real promotion activation remains off while P8–P10 are partial.

#### Checkpoint C — transaction truth

Two-stage `PRICE_CHANGED`, three Pancake raw-live-price regressions, controlled custom-price semantic acceptance, immutable Purchase identity/value and direct Meta compatibility are green; fresh review **0 Critical / 0 Required**.

### Wave 5 — downstream consumers

- **U25 — Merchant standalone mapper** — **#153 M3**; depends accepted U9 + U12 + U17 + U7.
- **U26 — Merchant cached public route + promotion revision integration** — **#153 M4 + #151 Merchant freshness**; depends U25 + U11.
- **U27 — Variant ProductGroup/Offer structured data** — **#152 W4d + variant-level portion of W5 only**; depends U12 + U17 + verified identifier semantics. It owns variant ProductGroup/Product/Offer behavior and carries its own focused HTTP/structured-data verification. It does **not** wait for U13, though missing W15b coverage still must be wired before Gate S.
- **U28 — Exact GTM saved version + actual loader/CSP + destination mapping** — **#153 T8**; depends U2 + U18/U19 + U24. Only this unit may introduce the first GTM load after exact saved-version export/checksum review.

U25 and U27 may run in parallel from the same canonical storefront facts. Before Merchant or index launch, verify feed and JSON-LD do not disagree on identity/price/availability.

### Wave 6 — SEO/search follow-through

- **U29 — PDP metadata cleanup** — **#152 W2b**; depends U4.
- **U30 — Search/social fundamentals** — **#152 P3 / W8, W10, W14a, W14b**; split into focused PRs where review/revert boundaries are cleaner.
- **U31 — Significant sitemap `lastModified`** — **#152 W9**; blocked until significant public-change timestamp semantics exist.
- **U32 — Product-level discovery + Organization enrichment** — **product-level remainder of #152 W5 + W6**. Add only verified product-level identifiers/attributes/public facts; **do not modify ProductGroup/variant Offer ownership assigned to U27**.
- **U33 — Evergreen public pages** — **#152 P5/W13**; depends owner-approved facts from U6.
- **U34 — SEO admin/operational readiness** — **#152 P6/W16/W17**; soft editorial guidance stays advisory.
- **U35 — Permanent-domain verification** — **#152 P6/W18**; blocked on permanent branded domain + owner approval and does not itself enable indexing.
- **U36 — Crawler governance matrix** — **#152 P6/W19**; blocked on owner distribution/data-use policy.
- **U37 — Sitemap scale trigger** — **#152 P6/W21**; implement index/sharding only when measured URL volume approaches the current cliff.
- **U38 — Runtime performance verification** — **#152 P7**; measure representative pages after promotion and third-party script costs are materially present; create budgets only from measured evidence.

### Wave 7 — convergence, readiness and final operations

- **U39 — Enabled-consumer monetary convergence** — **#151 G1**. G1 is satisfied incrementally by the consumer-specific work above and any focused residual fixes; **do not bundle analytics/Meta, Merchant and SEO into one mega PR**. This unit records integration evidence that every currently enabled price-bearing consumer uses effective/final authoritative money, while disabled/fail-closed consumers remain non-blocking.
- **U40 — Promotion observability, readiness and rollback** — **#151 G2**; depends U23 and closes real implementation/ops work: bounded/redacted telemetry, activation/invalid/conflict/`PARTIALLY_INVALID`/`PRICE_CHANGED`/quote-proof/Merchant-revision/Pancake-semantic signals, runbook and rollback rehearsal. No PII, secrets, raw quote proofs or cart UUIDs in telemetry.
- **U41 — Merchant Center Scheduled Fetch activation** — **#153 M5**; operational activation after U25/U26/U12 and Gate M preconditions. Verify/claim site, configure approved data source/market/shipping/returns/Ads linkage, point Scheduled Fetch at production HTTPS feed, and collect Merchant diagnostics/crawler evidence while search indexing remains independently off unless Gate S is approved.
- **U42 — Marketing final convergence / rollback verification** — **#153 V1**; depends U28 + U41. This is primarily verification/ops evidence unless a focused launch defect requires code.
- **U43 — Promotion final integrated DoD** — **#151 G3**; depends U39 + U40 and verifies exact-head integrated current truth, including **applicable #153 identity/cart/Purchase/Merchant-cache regressions for slices that are actually implemented** and unchanged #152 indexing policy unless separately approved. A mechanically disabled/fail-closed future consumer does not become a prerequisite merely because G3 names its regression family.

## 7. Conditional items not on the default critical path

- **#152 W12** listing `ItemList`/`CollectionPage`: schedule only if target-market/consumer/search evidence justifies it.
- **#152 W20** `llms.txt`: not a Google SEO/GEO requirement; schedule only for a named non-Google consumer with owner-approved value.
- TikTok Events API, Meta-to-GTM migration, Enhanced Conversions/customer PII, composite Merchant offers, coupons/stacking/BXGY/personalized promotion expansion remain future source-contract work.

## 8. Owner/account gates from #153

These do not block pure foundations; they block the affected live destination:

- **O1 — Google Ads Purchase value:** owner chooses merchandise-only vs `OrderMirror.totalVnd` before Ads Purchase publish. GA4 remains merchandise value with shipping separate.
- **O2 — Merchant market:** confirm target market/language/currency before Merchant activation.
- **O3 — Apparel facts:** confirm truthful `gender`/`age_group`/`condition` semantics for emitted standalone offers or add product-owned facts first.
- **O4 — Vendor configuration:** provide/review GTM container, GA4 Measurement ID, Ads conversion ID/label and TikTok Pixel ID through proper account owners.

## 9. Safe parallelization summary

Can start together from reviewed baseline when file ownership permits: U1–U6, U8 and U9.

Must stay sequential:

- promotion domain: U3 -> U7 -> U10 -> U11;
- storefront promotion: U15 -> U16 -> U17;
- checkout/order: U20 -> U21 -> U22 -> U23 -> U24;
- SEO metadata: U4 -> U29;
- SEO coverage: U5 -> U13;
- Merchant feed: U9/U12 -> U25 -> U26 -> U41;
- full marketing convergence: U28 + U41 -> U42.

Coordinate at shared interfaces:

- U8 -> U15 selected-variant state;
- U8/U9 -> U12 deep-link binding;
- U7/U8 -> U18/U19 authoritative event/cart money + identity;
- U11 durable revision -> U26 Merchant cache;
- U12 + canonical storefront facts -> U25 Merchant and U27 variant structured data;
- U27 variant schema ↔ U32 product-level enrichment: separate ownership, shared verified identifiers only;
- U24 Purchase -> U28 GTM live mapping;
- enabled consumers -> U39 G1 convergence.

## 10. Independent launch gates

These are independent approvals; no gate implies another.

### Gate P — Promotion activation

Requires #151 P1–P10, accepted price/catalog evidence, controlled Pancake custom-price semantic acceptance, **U39/G1 for currently enabled monetary consumers**, **U40/G2 readiness/rollback**, **U43/G3 exact-head DoD**, and explicit human activation. GTM/Merchant that remain mechanically disabled/fail-closed do not block promotion; if enabled, they must already be promotion-aware.

### Gate T — GTM live

Requires T1–T8 through U28, **O1 Ads Purchase value decision**, **O4 vendor configuration**, exact immutable GTM version/export/checksum, preview isolation proving zero production-destination traffic, reviewed destination semantics and publication of the same reviewed version. If promotions are active, the analytics/Ads/TikTok monetary paths must be covered by U39/G1 before live publish.

### Gate M — Merchant activation

**Pre-activation approval** requires M1–M4 through U9/U12/U25/U26, exact standalone variant URL, audited IDs/MPN, canonical pricing, bounded cache/single-flight/backoff/topology proof, **O2 market** and **O3 apparel-fact** approval, plus Merchant account/site/shipping/returns prerequisites. If promotions are active, Merchant monetary/cache behavior must be covered by U39/G1. **U41 executes M5** only after this approval; Gate M is complete only after U41 Scheduled Fetch + Diagnostics/crawler verification succeeds. Composite remains excluded.

### Gate S — Organic indexing

Requires temporary-host enforcement, permanent branded domain, applicable #152 Required correctness/regression/operational gates (including U13 where its coverage map identifies missing signals), permanent-domain verification and explicit human approval. Promotion/GTM/Merchant activation never implies this gate.

### Final combined program gate

When the intended combined program includes both GTM live and Merchant activation, **U42/#153 V1** records final marketing convergence/rollback evidence. **U43/#151 G3** records final promotion-integrated DoD. Program completion requires the applicable source-task acceptance criteria and every launch gate actually chosen for release; intentionally disabled destinations stay explicitly disabled rather than being silently treated as complete.

## 11. Verification baseline

Every implementation unit inherits source verification and uses the smallest discriminating RED/GREEN test first. At major checkpoints run applicable repository commands:

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

`pnpm pancake:catalog:audit` runs only in an approved real-catalog context with sanitized evidence. Browser/runtime/a11y/SEO/GTM/Merchant/Pancake external checks are required where the owning source task requires them. Never claim a command, browser check or external acceptance result unless it was actually executed.

## 12. Program Definition of Done

Before calling the combined program complete:

- implemented source-task acceptance criteria are met;
- no duplicate pricing/cart/identity/variant-URL/Purchase/Merchant-cache/variant-schema authority exists;
- focused regressions would fail without the new behavior and relevant existing tests pass;
- applicable lint/typecheck/build/DB/runtime/browser/a11y checks are green;
- security review covers admin authz, untrusted input, quote proof, Merchant public route/serialization, GTM/CSP/secrets and PII;
- migrations/backward compatibility and rollback are reviewed;
- observability exists for new critical production failure modes without leaking secrets/PII;
- docs describe current truth;
- unrelated refactors/dead code/debug output are absent;
- launch gates remain independent with explicit owner approval/rollback triggers;
- fresh final review has **0 Critical / 0 Required**.
