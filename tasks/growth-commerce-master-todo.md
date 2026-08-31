# Growth + Commerce master execution checklist — PR #151 + #152 + #153

Status: **PLANNED / NOT IMPLEMENTED**

Source plan: `tasks/growth-commerce-master-plan.md`

Baseline: `main@36ca06ccc57b89762069e8c0daab575fb6ef1421`.

This checklist tracks orchestration only. Detailed acceptance criteria remain in the source #151/#152/#153 artifacts.

## Program rules
- [ ] Start each implementation PR from latest reviewed `main`.
- [ ] Re-read the owning source task/spec before coding.
- [ ] Keep one authority for pricing, cart truth, identity, variant URL, Purchase and Merchant cache.
- [ ] Split by atomicity/risk/reviewability per ADR 0005; no unrelated refactor.
- [ ] Focused behavior tests first; major checkpoints require 0 Critical / 0 Required.

## Wave 0 — baseline and safety
- [ ] **U0** Reconcile latest `main`; record exact base SHA and confirm shared ownership unchanged.
- [ ] **U1** #152 P0/G1 — hard-block indexing on `la.lanadesign.vn`; permanent-domain enablement stays separate.
- [ ] **U2** #153 T1–T3 — canonical events/config/dataLayer/consent/page views; requested preview/live still loads no GTM.
- [ ] **U3** #151 P1 — campaign/target persistence + order audit + bounded durable promotion-pricing revision.
- [ ] **U4** #152 W2a — prove collision-safe metadata uniqueness replacement before slug/path cleanup.
- [ ] **U5** #152 W15a — inventory dedicated SEO smoke coverage vs existing tests/P18/runtime jobs.
- [ ] **U6** #152 W13A — inventory owner-approved/missing About/Returns/Shipping/Size/Contact facts; missing policy = BLOCKED.

## Wave 1 — commerce truth and identity
- [ ] **U7** #151 P2 + #152 W3 — central exact pricing resolver + approved real-catalog `pnpm pancake:catalog:audit` evidence.
- [ ] **U8** #153 T4 — propagate `pancakeProductId` / `pancakeVariationId`; keep `VariantMirror.id` internal-only.
- [ ] **U9** #153 M1 + #152 W4a — run read-only identity/durability/SKU-MPN audit; no GTIN inference; composites deferred.
- [ ] **U10** #151 P3 — repository/lifecycle/runtime health, real component ownership and affected-variant recovery.
- [ ] **U11** #151 P4 — race-safe admin domain + default-off activation gate + transactional durable revision.

### Checkpoint A
- [ ] #151 P1–P4 verification green; price evidence accepted; activation gate off.
- [ ] Identity ready before consumers depend on it.
- [ ] Authz/bounds/concurrency/external-data security review green.
- [ ] Fresh review 0 Critical / 0 Required.

## Wave 2 — addressability and storefront
- [ ] **U12** #153 M2 + #152 W4b/W4c — exact standalone variant deep link; requires U8 + accepted U9 evidence.
- [ ] **U13** #152 W15b — wire only missing SEO HTTP/runtime signals from U5 coverage map.
- [ ] **U14** #151 P5 — promotion admin UX over P4 service boundary; no pricing/overlap authority in React.
- [ ] **U15** #151 P6 — PDP promotion projection using central pricing + canonical U12 variant state.
- [ ] **U16** #151 P7a — `/shop` effective-price discovery; SQL↔TS parity and product-level analytics identity preserved.
- [ ] **U17** #151 P7b — `/flash-sale` via same projection; bounded pagination and ≤60s server-relative freshness.

### Checkpoint B
- [ ] PDP/cards/shop/Flash share one pricing authority.
- [ ] T4/M2 identity/addressability regressions green.
- [ ] SQL↔TS parity + browser freshness/a11y green where applicable.
- [ ] Activation remains off; fresh review 0 Critical / 0 Required.

## Wave 3 — canonical cart/checkout APIs
- [ ] **U18** #153 T5 — atomic PDP `+1` + authoritative committed event snapshot; no stale-browser fallback.
- [ ] **U19** #153 T6 + #151 shared checkpoint — authoritative update/remove facts + complete all-or-nothing cart/checkout projection; one shared API only.

## Wave 4 — checkout/order convergence
- [ ] **U20** #151 P8 — mutable DRAFT quote/audit after U17 + U19.
- [ ] **U21** #151 P9a — bounded stateless server-MAC rendered-quote proof; raw HttpOnly cart UUID remains server-only context.
- [ ] **U22** #151 P9b — fresh Pancake reconfirmation through central resolver; mismatch => refreshed DRAFT + `PRICE_CHANGED`, no create.
- [ ] **U23** #151 P10 — final Pancake convergence; all three raw-`livePrice` regressions + controlled custom-price acceptance.
- [ ] **U24** #153 T7 — confirmed Purchase from immutable order snapshot; `publicCode` remains transaction/event ID.

### Checkpoint C
- [ ] Two-stage `PRICE_CHANGED` and three Pancake regressions green.
- [ ] Custom-price acceptance succeeds or promotion activation remains blocked.
- [ ] Immutable Purchase identity/value + direct Meta compatibility green.
- [ ] Fresh review 0 Critical / 0 Required.

## Wave 5 — downstream consumers
- [ ] **U25** #153 M3 — standalone Merchant mapper from audited IDs + canonical effective price + exact U12 URL.
- [ ] **U26** #153 M4 + #151 — bounded public feed/cache/single-flight/backoff + durable promotion revision; no request-controlled cache dimensions.
- [ ] **U27** #152 W4d/W5 — ProductGroup/variant Offer only after U12; no `AggregateOffer`; U25/U27 may run in parallel from the same canonical facts.
- [ ] Before Merchant/index launch, prove feed vs JSON-LD identity/price/availability consistency.
- [ ] **U28** #153 T8 — exact saved GTM version/export/checksum; preview isolation; only then actual loader/CSP; live publishes same reviewed version.

## Wave 6 — SEO/search follow-through
- [ ] **U29** #152 W2b — metadata cleanup only after U4 uniqueness proof.
- [ ] **U30** #152 P3 — W8 OG/Twitter, W10 static canonical, W14 branded/HTML 404 work in focused PRs.
- [ ] **U31** #152 W9 — sitemap `lastModified` only after significant public-change timestamp semantics exist.
- [ ] **U32** #152 P4/W5/W6 — Product/Organization enrichment from verified public facts only; Merchant/schema contract stays consistent.
- [ ] **U33** #152 P5/W13 — evergreen pages only after U6 human-approved facts; no invented policies.
- [ ] **U34** #152 P6/W16/W17 — SEO admin/operational readiness; advisory UI does not become unreviewed hard policy.
- [ ] **U35** #152 P6/W18 — permanent-domain Search Console/Bing/Merchant verification; does not itself enable indexing.
- [ ] **U36** #152 P6/W19 — owner-approved crawler governance matrix.
- [ ] **U37** #152 P6/W21 — catalog URL-volume trigger before sitemap hard cliff; shard only when evidence warrants it.
- [ ] **U38** #152 P7 — representative mobile/desktop runtime performance measurement after promotion/tag costs are materially present.

## Conditional — not on default critical path
- [ ] **#152 W12** remains unscheduled unless target-market/consumer/search evidence justifies listing `ItemList`/`CollectionPage`.
- [ ] **#152 W20** `llms.txt` remains unscheduled for Google SEO/GEO; add only for a named non-Google consumer with owner-approved value.
- [ ] TikTok Events API remains future scope.
- [ ] Meta-to-GTM migration / Enhanced Conversions / customer PII remain out of scope.
- [ ] Composite Merchant offers remain out of v1.
- [ ] Coupons/stacking/BXGY/personalized promotion expansion remains out of #151 v1.

# Separate launch gates

## Gate P — Promotion activation
- [ ] #151 P1–P10 accepted; price/catalog evidence + controlled Pancake custom-price acceptance green.
- [ ] Enabled monetary consumers are promotion-aware; disabled/fail-closed future consumers do not block.
- [ ] Readiness/rollback/observability/final DoD accepted; human explicitly enables activation.

## Gate T — GTM live
- [ ] T1–T7 canonical facts green; exact immutable GTM version/export/checksum reviewed.
- [ ] Preview/test proves zero production-destination traffic; reviewed same version is published live with human approval.

## Gate M — Merchant activation
- [ ] M1–M4 + exact variant URL + audited IDs/MPN + canonical promotion-aware price green.
- [ ] Cache/single-flight/backoff/topology proof accepted; composites remain excluded; account/market/apparel owner gates satisfied.

## Gate S — Organic indexing
- [ ] Temporary-domain hard block green; permanent branded domain confirmed.
- [ ] Applicable #152 Required correctness/regression/operational gates + permanent-domain verification accepted.
- [ ] Human explicitly approves indexing on permanent domain; promotion/GTM/Merchant activation is not implicit approval.

# Major checkpoint verification

Run only when applicable; never claim execution unless actually run:

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

- [ ] `pnpm pancake:catalog:audit` only in approved real-catalog context with sanitized evidence.
- [ ] Browser/runtime/a11y/SEO checks run where the owning source task requires them.
- [ ] GTM/Merchant/Pancake external acceptance uses approved credentials/context only.

# Final program Definition of Done
- [ ] Implemented source-task acceptance criteria met.
- [ ] No duplicate pricing/cart/identity/variant-URL/Purchase/Merchant-cache authority.
- [ ] Focused regressions + existing relevant suites green; lint/typecheck/build green.
- [ ] Applicable DB/runtime/browser/a11y verification green.
- [ ] Security review covers authz, untrusted input, quote proof, Merchant public route, serialization, GTM/CSP/secrets and PII.
- [ ] Migration/backward compatibility/rollback + observability reviewed.
- [ ] Docs describe current truth; no unrelated refactor/dead code/debug output.
- [ ] Launch gates remain independent with explicit owner/rollback trigger.
- [ ] Human final review: **0 Critical / 0 Required**.
