# Growth + Commerce master execution checklist — PR #151 + #152 + #153

Status: **WAVE 0 IN PROGRESS — U5/U6 delivered; U0–U4 land in sibling PRs; Wave 1 onward planned**

Source plan: `tasks/growth-commerce-master-plan.md`

Baseline: `main@36ca06ccc57b89762069e8c0daab575fb6ef1421`.

This checklist tracks orchestration only. Detailed acceptance criteria remain in the source #151/#152/#153 artifacts.

## Program rules

- [ ] Start each implementation PR from latest reviewed `main` and record exact base SHA.
- [ ] Re-read the owning source task/spec before coding.
- [ ] Keep one authority for pricing, cart truth, identity, variant URL, Purchase, Merchant cache and variant structured data.
- [ ] Split by atomicity/risk/reviewability per ADR 0005; no unrelated refactor.
- [ ] Focused behavior tests first; major checkpoints require 0 Critical / 0 Required.

## Wave 0 — baseline and safety

Wave 0 is being delivered from base `main@be1dd63735af358ca6d44c0ad669da2cfd7beb66`. Per ADR 0005 it
was split into five focused pull requests rather than one: **PR-A1** (U0+U1), **PR-A2** (U2),
**PR-A3** (U3), **PR-A4** (U4) and **PR-A5** (U5+U6, and this checklist update). They share one base
and own disjoint subsystems.

**Only the units this PR actually delivers are ticked.** U0–U4 stay unticked here even though their
PRs are open, because a merge of this PR alone must not make `main` claim work whose code and
evidence are not on `main`. A small reconciliation change ticks them once all five have merged and
one integrated exact-head run is green.

- [ ] **U0** Master + #151 P0 — reconcile latest `main`; confirm shared ownership unchanged. *(PR-A1, open)*
- [ ] **U1** #152 P0/G1 — hard-block indexing on `la.lanadesign.vn`; permanent-domain enablement stays separate. *(PR-A1, open)*
- [ ] **U2** #153 T1–T3 — canonical events/config/dataLayer/consent/page views; requested preview/live still loads no GTM. *(PR-A2, open)*
- [ ] **U3** #151 P1 — campaign/target persistence + order audit + bounded durable promotion-pricing revision. *(PR-A3, open)*
- [ ] **U4** #152 W2a — prove collision-safe metadata uniqueness replacement before slug/path cleanup. *(PR-A4, open.)* **Verdict: BLOCKED** — U29/W2b waits on owner decision **B5** below.
- [x] **U5** #152 W15a — inventory dedicated SEO smoke coverage vs existing tests/P18/runtime jobs. See `docs/audits/seo-runtime-coverage-w15a.md`; all five smokes already run through `pnpm test`, and U13 has two genuinely missing signals to wire.
- [x] **U6** #152 W13A — inventory owner-approved/missing About/Returns/Shipping/Size/Contact facts; missing policy = BLOCKED. See `docs/audits/first-party-content-facts-w13a.md`.

## Wave 1 — commerce truth and identity

- [ ] **U7** #151 P2 + #152 W3 — central exact pricing resolver + approved real-catalog `pnpm pancake:catalog:audit` evidence.
- [ ] **U8** #153 T4 — propagate `pancakeProductId` / `pancakeVariationId`; keep `VariantMirror.id` internal-only.
- [ ] **U9** #153 M1 + #152 W4a — read-only identity/durability/SKU-MPN audit; may run in parallel with U8; no GTIN inference; composites deferred.
- [ ] **U10** #151 P3 — repository/lifecycle/runtime health, real component ownership and affected-variant recovery.
- [ ] **U11** #151 P4 — race-safe admin domain + default-off activation gate + transactional durable revision.

### Checkpoint A

- [ ] #151 P1–P4 verification green; price evidence accepted; activation gate off.
- [ ] Identity ready before consumers depend on it.
- [ ] Authz/bounds/concurrency/external-data security review green.
- [ ] Fresh review 0 Critical / 0 Required.

## Wave 2 — addressability and storefront

- [ ] **U12** #153 M2 + #152 W4b/W4c — exact standalone variant deep link; requires U8 + accepted U9 evidence.
- [ ] **U13** #152 W15b — wire only missing SEO HTTP/runtime signals from U5 coverage map: a negative `release:check` case for the temporary-host indexing block, and an HTTP case proving that host stays noindex when a deployment requests indexing. Do not re-invoke the five smokes that already run in `pnpm test`.
- [ ] **U14** #151 P5 — promotion admin UX over P4 service boundary; no pricing/overlap authority in React.
- [ ] **U15** #151 P6 — PDP promotion projection using central pricing + **U8/T4 selected-variant state (`pancakeVariationId`)**; do not define a query/canonical contract. If U12 has landed, consume it directly.
- [ ] **U16** #151 P7a — `/shop` effective-price discovery; SQL↔TS parity and product-level analytics identity preserved.
- [ ] **U17** #151 P7b — `/flash-sale` via same projection; bounded pagination and ≤60s server-relative freshness.

### Checkpoint B

- [ ] **Blocker:** U20/P8 and later promotion checkout/order convergence must not start before Checkpoint B passes; U18/U19 canonical analytics/cart work may proceed from their own prerequisites.
- [ ] PDP/cards/shop/Flash share one pricing authority.
- [ ] T4 identity regressions green; **if U12/M2 has landed, its addressability regressions are also green**.
- [ ] SQL↔TS parity + required browser freshness/a11y green.
- [ ] Activation remains off; fresh review 0 Critical / 0 Required.

## Wave 3 — canonical analytics/cart APIs

- [ ] **U18** #153 T5 — upper-funnel `view_item_list` / `select_item` / initial product-level `view_item` + product-vs-selected-variant semantics + atomic PDP `+1` with authoritative committed event snapshot. Depends U7 + U8; may run in parallel with U15–U17.
- [ ] **U19** #153 T6 + #151 shared checkpoint — authoritative update/remove facts + complete all-or-nothing cart/checkout projection; one shared API only.

## Wave 4 — checkout/order convergence

- [ ] **U20** #151 P8 — mutable DRAFT quote/audit after U17 + U19.
- [ ] **U21** #151 P9a — bounded stateless server-MAC rendered-quote proof; raw HttpOnly cart UUID remains server-only context.
- [ ] **U22** #151 P9b — fresh Pancake reconfirmation through central resolver; mismatch => refreshed DRAFT + `PRICE_CHANGED`, no create.
- [ ] **U23** #151 P10 — final Pancake convergence; all three raw-`livePrice` regressions + controlled custom-price acceptance.
- [ ] **U24** #153 T7 — confirmed Purchase from immutable order snapshot; `publicCode` remains transaction/event ID.

### Checkpoint C

- [ ] **Blocker:** real discounted promotion activation and live enabling/publishing of price-bearing downstream destinations that rely on finalized transaction truth must wait for Checkpoint C; U25-U27 implementation may proceed from their own prerequisites.
- [ ] Two-stage `PRICE_CHANGED` and three Pancake regressions green.
- [ ] Custom-price acceptance succeeds or promotion activation remains blocked.
- [ ] Immutable Purchase identity/value + direct Meta compatibility green.
- [ ] Fresh review 0 Critical / 0 Required.

## Wave 5 — downstream consumers

- [ ] **U25** #153 M3 — standalone Merchant mapper from audited IDs + canonical effective price + exact U12 URL.
- [ ] **U26** #153 M4 + #151 — bounded public feed/cache/single-flight/backoff + durable promotion revision; no request-controlled cache dimensions.
- [ ] **U27** #152 W4d + **variant-level portion of W5 only** — ProductGroup/variant Product+Offer after U12/U17; no `AggregateOffer`; own focused HTTP/structured-data verification; do not wait for U13.
- [ ] Before Merchant/index launch, prove feed vs JSON-LD identity/price/availability consistency.
- [ ] **U28** #153 T8 — exact saved GTM version/export/checksum; preview isolation; only then actual loader/CSP; live publishes the same reviewed version.

## Wave 6 — SEO/search follow-through

- [ ] **U29** #152 W2b — metadata cleanup only after U4 uniqueness proof. **Blocked by B5.** Stop at U29 and report; do not remove the discriminator, substitute one, or narrow the collision definition to make the verdict pass.
- [ ] **U30** #152 P3 — W8 OG/Twitter, W10 static canonical, W14 branded/HTML 404 work in focused PRs.
- [ ] **U31** #152 W9 — sitemap `lastModified` only after significant public-change timestamp semantics exist.
- [ ] **U32** product-level remainder of #152 W5 + W6 — verified product-level identifiers/attributes + Organization only; **do not redefine ProductGroup/variant Offer owned by U27**. Organization enrichment (address, contact point, social profiles) is **blocked by B2**; the product-level identifier work is not, and proceeds independently.
- [ ] **U33** #152 P5/W13 — evergreen pages only after U6 human-approved facts; no invented policies. **Blocked by B1–B4.** Stop at U33 and report; build no page from inferred policy.
- [ ] **U34** #152 P6/W16/W17 — SEO admin/operational readiness; advisory UI does not become hard unreviewed policy.
- [ ] **U35** #152 P6/W18 — permanent-domain Search Console/Bing/Merchant verification; does not itself enable indexing.
- [ ] **U36** #152 P6/W19 — owner-approved crawler governance matrix.
- [ ] **U37** #152 P6/W21 — catalog URL-volume trigger before sitemap hard cliff; shard only when evidence warrants it.
- [ ] **U38** #152 P7 — representative mobile/desktop runtime performance measurement after promotion/tag costs are materially present.

## Wave 7 — convergence, readiness and final operations

- [ ] **U39** #151 G1 — prove monetary convergence for every currently enabled price-bearing consumer; use focused consumer-specific fixes/evidence, not one mega PR. Disabled/fail-closed future consumers remain non-blocking.
- [ ] **U40** #151 G2 — bounded/redacted observability + readiness/runbook + rollback rehearsal for activation rejection, invalid/recovery/conflict/`PARTIALLY_INVALID`, `PRICE_CHANGED`/quote-proof, Merchant revision mismatch/rebuild, Pancake semantic validation and activation-gate state; no PII/secrets/raw quote proofs/cart UUIDs.
- [ ] **U41** #153 M5 — after Gate M preconditions, execute Merchant Center Scheduled Fetch activation, account/site/data-source/market/shipping/returns/Ads linkage and collect Diagnostics/crawler evidence without implicitly enabling search indexing.
- [ ] **U42** #153 V1 — final marketing convergence/rollback verification after U28 + U41; code only for a focused verified launch defect.
- [ ] **U43** #151 G3 — exact-head final integrated DoD after U39 + U40; verify **applicable #153 identity/cart/Purchase/Merchant-cache regressions for slices actually implemented** plus unchanged #152 indexing policy unless separately approved. Disabled/fail-closed future consumers are not prerequisites.

## Conditional — not on default critical path

- [ ] **#152 W12** remains unscheduled unless target-market/consumer/search evidence justifies listing `ItemList`/`CollectionPage`.
- [ ] **#152 W20** `llms.txt` remains unscheduled for Google SEO/GEO; add only for a named non-Google consumer with owner-approved value.
- [ ] TikTok Events API remains future scope.
- [ ] Meta-to-GTM migration / Enhanced Conversions / customer PII remain out of scope.
- [ ] Composite Merchant offers remain out of v1.
- [ ] Coupons/stacking/BXGY/personalized promotion expansion remains out of #151 v1.

# Owner decision gates

These are **human decisions, not code work.** No unit may infer them from catalog data, UI copy,
naming conventions or existing components, and no unit may work around one by narrowing a contract
until it passes. Each gate names what is missing, who decides, what stays blocked, and where the
blocked unit must stop.

Everything not listed as blocked continues normally. A gate blocks the units named in its row and
nothing else.

| Gate | Missing fact or decision | Owner | Blocks | Stop rule |
|---|---|---|---|---|
| **B1** | Returns policy: whether returns are accepted and on what conditions, the window in days, size/colour exchanges, how a COD order is refunded, who pays return shipping, any non-returnable categories | Repository owner / brand authority | U33 (Returns page) | Stop at U33's Returns page and report. Do not author a policy, and do not imply one from checkout copy. |
| **B2** | Contact channels: phone, email, physical or registered address, business hours, any messaging/social channel intended for support | Repository owner / brand authority | U33 (Contact page); **U32** Organization enrichment only | Stop at U33's Contact page and at `Organization` address/contactPoint/sameAs. U32's product-level identifier work is not blocked and proceeds. |
| **B3** | Size chart: measurements per size, how to measure, fit vocabulary and what each fit means, units and tolerance | Repository owner / brand authority | U33 (Size Guide page) | Stop at U33's Size Guide and report. Do not derive measurements from product names or per-product editorial free text. |
| **B4** | Shipping terms: delivery estimate, delivery coverage or areas not served, carrier and whether orders are carrier-trackable, whether phone confirmation before delivery is policy or current practice | Repository owner / brand authority | U33 (Shipping/Payment page) | Build no Shipping page from the A-class base alone. Pancake province/district/commune data is a geography reference, **never** a statement of where LA Clothing delivers. |
| **B5** | Metadata uniqueness: enforce unique published `seoTitle`/`seoDescription` across products (and decide publish-time behaviour on collision), **or** supply an owner-approved human-readable per-product discriminator. Also settle whether uniqueness is pair-level or per-field. | Repository owner / brand authority | U29 / W2b | Stop at U29 and report. Do not remove the slug/path discriminator, substitute a discriminator of your own, or narrow the collision definition to make the verdict pass. |

Sources: B1–B4 come from the W13A first-party fact inventory; B5 from the W2a metadata uniqueness
contract. Both audits record the full per-fact classification behind these summaries.

When a gate is answered, record the approved facts in a reviewed source of truth first — for B1–B4
that means one authoritative fact source rather than copy pasted between footer, page and structured
data — and only then build the page or change the contract.

## Owner/account gates from #153

- [ ] **O1** Google Ads Purchase value: owner chooses merchandise-only vs `OrderMirror.totalVnd` before Ads Purchase publish.
- [ ] **O2** Merchant market/language/currency confirmed before Merchant activation.
- [ ] **O3** Apparel facts (`gender`/`age_group`/`condition`) confirmed truthful for emitted standalone items or product-owned facts added first.
- [ ] **O4** GTM container, GA4 Measurement ID, Ads conversion ID/label and TikTok Pixel ID provided/reviewed by proper account owners.

# Separate launch gates

## Gate P — Promotion activation

- [ ] #151 P1–P10 accepted; price/catalog evidence + controlled Pancake custom-price acceptance green.
- [ ] **U39/G1** covers every currently enabled monetary consumer; disabled/fail-closed future consumers do not block.
- [ ] **U40/G2** readiness/rollback accepted and **U43/G3** exact-head DoD green.
- [ ] Human explicitly enables promotion activation.

## Gate T — GTM live

- [ ] T1–T8 through U28 green.
- [ ] **O1** Ads Purchase value and **O4** vendor configuration approved.
- [ ] Exact immutable GTM version/export/checksum reviewed; preview proves zero production-destination traffic; same reviewed version is published live.
- [ ] If promotions are active, U39/G1 covers analytics/Ads/TikTok monetary paths before publish.

## Gate M — Merchant activation

- [ ] **Pre-activation:** M1–M4 through U9/U12/U25/U26 + exact variant URL + audited IDs/MPN + canonical pricing + cache/single-flight/backoff/topology proof green.
- [ ] **O2** market and **O3** apparel facts approved; Merchant site/account/shipping/returns prerequisites satisfied.
- [ ] If promotions are active, U39/G1 covers Merchant monetary/cache behavior.
- [ ] Human approves activation, then **U41 executes M5**; Gate M completes only after Scheduled Fetch + Diagnostics/crawler verification succeeds.
- [ ] Composite remains excluded.

## Gate S — Organic indexing

- [ ] Temporary-domain hard block green; permanent branded domain confirmed.
- [ ] Applicable #152 Required correctness/regression/operational gates green, including U13 where U5 identifies missing signals.
- [ ] Permanent-domain verification accepted.
- [ ] Human explicitly approves indexing on permanent domain; promotion/GTM/Merchant activation is not implicit approval.

## Final combined program gate

- [ ] If both GTM live and Merchant activation are part of the release, **U42/#153 V1** final marketing convergence/rollback evidence is green.
- [ ] **U43/#151 G3** final promotion-integrated DoD is green for implemented scope.
- [ ] Intentionally disabled destinations remain explicitly disabled rather than silently treated as complete.

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
- [ ] No duplicate pricing/cart/identity/variant-URL/Purchase/Merchant-cache/variant-schema authority.
- [ ] Focused regressions + relevant existing suites green; lint/typecheck/build green.
- [ ] Applicable DB/runtime/browser/a11y verification green.
- [ ] Security review covers authz, untrusted input, quote proof, Merchant public route, serialization, GTM/CSP/secrets and PII.
- [ ] Migration/backward compatibility/rollback + observability reviewed.
- [ ] Docs describe current truth; no unrelated refactor/dead code/debug output.
- [ ] Launch gates remain independent with explicit owner/rollback trigger.
- [ ] Human final review: **0 Critical / 0 Required**.