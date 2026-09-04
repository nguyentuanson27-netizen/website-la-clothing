# Growth + Commerce master execution checklist — PR #151 + #152 + #153

Status: **WAVE 2 COMPLETE — Checkpoint A PASS; U12–U17 are merged and integrated; U14/P5 is delivered via P5a PR #184 + P5b PR #185; Wave 3 U18/U19 is merged; Checkpoint B PASS on `main@649e04c328353c016e4ba41831b6eec7d49d1d54`. U20/P8 is merged via PR #189 and U21/P9a via PR #190. U22/P9b is in progress; later launch gates remain independent.**

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

Wave 0 was delivered from base `main@be1dd63735af358ca6d44c0ad669da2cfd7beb66`. Per ADR 0005 it
was split into five focused pull requests rather than one: **PR-A1 / #156** (U0+U1),
**PR-A2 / #157** (U2), **PR-A3 / #158** (U3), **PR-A4 / #159** (U4) and
**PR-A5 / #160** (U5+U6). They shared one base and owned disjoint subsystems.

All five slices are merged. The post-merge integrated exact-head gate passed on
`main@fe05184518a55e00ba24049fa895c6a4fdc3639c`: CI push run `33413224530` completed both
`verify` and `admin-a11y-runtime` successfully, and Catalog indexation runtime run `33413225233`
(#670) completed successfully. This reconciliation records that merged/integrated state only; it does
not resolve downstream owner or launch gates.

- [x] **U0** Master + #151 P0 — reconcile latest `main`; confirm shared ownership unchanged. *(PR-A1 / #156, merged)*
- [x] **U1** #152 P0/G1 — hard-block indexing on `la.lanadesign.vn`; permanent-domain enablement stays separate. *(PR-A1 / #156, merged)*
- [x] **U2** #153 T1–T3 — canonical events/config/dataLayer/consent/page views; requested preview/live still loads no GTM. *(PR-A2 / #157, merged)*
- [x] **U3** #151 P1 — campaign/target persistence + order audit + bounded durable promotion-pricing revision. *(PR-A3 / #158, merged)*
- [x] **U4** #152 W2a — prove collision-safe metadata uniqueness replacement before slug/path cleanup. *(PR-A4 / #159, merged)* **U4 delivered; downstream U29/W2b remains BLOCKED** on owner decision **B5** below.
- [x] **U5** #152 W15a — inventory dedicated SEO smoke coverage vs existing tests/P18/runtime jobs. *(PR-A5 / #160, merged)* See `docs/audits/seo-runtime-coverage-w15a.md`; all five smokes already run through `pnpm test`, and U13 has two genuinely missing signals to wire.
- [x] **U6** #152 W13A — inventory owner-approved/missing About/Returns/Shipping/Size/Contact facts; missing policy = BLOCKED. *(PR-A5 / #160, merged)* See `docs/audits/first-party-content-facts-w13a.md`.

## Wave 1 — commerce truth and identity

- [x] **U7** #151 P2 + #152 W3 — central exact pricing resolver + approved real-catalog `pnpm pancake:catalog:audit` evidence. *(PR #162 resolver, PR #163 mirrored-money audit, PR #174 W3 evidence; merged)* W3 verdict **PASS** — real-catalog evidence does not contradict the approved `retailPrice` ownership assumption, so the U7 stop rule was not triggered. The `retailPrice === retailPriceAfterDiscount` availability gate is deliberately still in place and remains U15/P6 work.
- [x] **U8** #153 T4 — propagate `pancakeProductId` / `pancakeVariationId`; keep `VariantMirror.id` internal-only. *(PR #164 cart lines, PR #165 product/option facts; merged)* Composite lines carry the actual purchased component variation ID; unresolvable/private lines fail closed to no external identity.
- [x] **U9** #153 M1 + #152 W4a — read-only identity/durability/SKU-MPN audit (PR #175); M1 durability **PROVEN via §3.3 Option B** (controlled repeated upstream-object correlation evidence on `a132`); SKU-as-MPN and runtime apparel facts remain pending downstream decisions; no GTIN inference; composites deferred.
- [x] **U10** #151 P3 — repository/lifecycle/runtime health, real component ownership and affected-variant recovery. *(PR #167 lifecycle, PR #168 candidate repository, PR #169 runtime health; merged)* Candidate lookup is two bounded queries with an N+1 guard; lifecycle is derived, so it stays correct across restart and zero traffic.
- [x] **U11** #151 P4 — race-safe admin domain + default-off activation gate + transactional durable revision. *(PR #170 activation validation, PR #171 activation service, PR #172 admin operations; merged)* Activation gate remains **off**; disable/end-early stay campaign-row bounded so rollback survives coverage above 2000.

### Checkpoint A

**PASS** — integrated evidence recorded in `docs/audits/wave-1-checkpoint-a.md`, verified at exact head
`main@d8b1a6696f03bdd683e15577b493e5cf46fa51e0`.

At the Checkpoint A head, the owning source checklists were reconciled to the same then-current truth:
`tasks/promotions-flash-sale-v1-todo.md` recorded P1–P4 + Checkpoint A as delivered with P5 onward open, and
`tasks/marketing-analytics-shopping-todo.md` recorded T1–T3 + T4 as delivered with T5 onward open. Later Wave 2 delivery is tracked below.

- [x] #151 P1–P4 verification green; price evidence accepted; activation gate off. `pnpm lint`,
      `pnpm typecheck`, `pnpm test` (752/752), `pnpm test:db` (292/292) and `pnpm build` all pass;
      migrations deploy clean. Exact-head CI `verify` + `admin-a11y-runtime`, VPS container
      verification and Catalog indexation runtime all succeeded.
- [x] At the Checkpoint A head, identity was ready before consumers depended on it. No storefront, cart, checkout, analytics,
      Merchant or structured-data consumer read the promotion resolver yet; those switches belonged to
      Wave 2 onward.
- [x] Authz/bounds/concurrency/external-data security review green. Admin session required on every
      write before the gate and before any transaction; deterministic revision → campaign → product →
      variant lock order with re-read before commit; mirrored Pancake money treated as untrusted and
      failed closed; no logging of secrets, PII or raw external payloads.
- [x] Fresh review 0 Critical / 0 Required. Three non-blocking observations are carried to U14/P5.

## Wave 2 — addressability and storefront

- [x] **U12** #153 M2 + #152 W4b/W4c — exact standalone variant deep link. *(PR #180, merged; consumes U8 identity and accepted U9 evidence.)*
- [x] **U13** #152 W15b — wire only the two missing SEO HTTP/runtime signals from U5 coverage map. *(PR #179, merged; no duplicate smoke suite.)*
- [x] **U14** #151 P5 — promotion admin UX over P4 service boundary; no pricing/overlap authority in React. *(Delivered via P5a PR #184 + P5b PR #185; both merged.)*
- [x] **U15** #151 P6 — PDP promotion projection using central pricing + U8/T4 selected-variant state. *(PR #181, merged; consumes U12 deep-link state rather than defining a second query/canonical contract.)*
- [x] **U16** #151 P7a — `/shop` effective-price discovery; SQL↔TS parity and product-level analytics identity preserved. *(PR #182, merged.)*
- [x] **U17** #151 P7b — `/flash-sale` via same projection; bounded pagination and ≤60s server-relative freshness. *(PR #183, merged.)*

### Checkpoint B

**PASS** — integrated evidence recorded in `docs/audits/wave-2-checkpoint-b.md`, verified at exact head
`main@649e04c328353c016e4ba41831b6eec7d49d1d54` after PR #185 and PR #186 were merged in order.

- [x] P5b / PR #185 integrated on `main`; U18/U19 / PR #186 integrated afterward.
- [x] PDP/cards/shop/Flash share one pricing authority.
- [x] T4 identity regressions and merged U12/M2 addressability regressions are green.
- [x] SQL↔TS parity + required browser freshness/a11y are green.
- [x] Activation remains off.
- [x] Exact-head CI `33739762266`, Catalog runtime `33739762252`, and VPS verification `33739762271` succeeded.
- [x] Fresh integrated review: **0 Critical / 0 Required**.

Checkpoint B no longer blocks U20/P8, which is merged. Later promotion activation and downstream launch work remain gated by their own acceptance criteria and Checkpoint C.

## Wave 3 — canonical analytics/cart APIs

- [x] **U18** #153 T5 — upper-funnel `view_item_list` / `select_item` / initial product-level `view_item` + product-vs-selected-variant semantics + atomic PDP `+1` with authoritative committed event snapshot. Depends U7 + U8; may run in parallel with U15–U17.
- [x] **U19** #153 T6 + #151 shared checkpoint — authoritative update/remove facts + complete all-or-nothing cart/checkout projection; one shared API only.

Wave 3 also converged cart, checkout render and the order snapshot onto the central promotion
resolver, which the #151 shared cart checkpoint required. Before this, a promotion was visible on
the PDP and on `/shop` but the cart and the submitted order still quoted the undiscounted base
price. U20/P8 was unblocked by the master storefront Checkpoint B and is now merged via PR #189, having met its own DRAFT quote/audit acceptance criteria.

## Wave 4 — checkout/order convergence

- [x] **U20** #151 P8 — mutable DRAFT quote/audit after U17 + U19. Merged via PR #189.
- [x] **U21** #151 P9a — bounded stateless server-MAC rendered-quote proof; raw HttpOnly cart UUID remains server-only context. Merged via PR #190.
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
- [ ] **U33** #152 P5/W13 — evergreen pages only after U6 human-approved facts; no invented policies. **Blocked by B1–B4 and B6.** Stop at U33 and report; build no page from inferred policy.
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
| **B6** | About/brand/legal facts — founding story/year/values/people, registered entity name, and whether the tax identifier should be public | Repository owner / brand authority | U33 (About page) | Stop at U33's About page and report. Reuse `brandName`/`brandSummary` as A-class facts, but do not infer history, legal identity or public tax facts from editorial copy. |

Sources: B1–B4 and B6 come from the W13A first-party fact inventory; B5 from the W2a metadata uniqueness
contract. Both audits record the full per-fact classification behind these summaries.

When a gate is answered, record the approved facts in a reviewed source of truth first — for B1–B4
and B6 that means one authoritative fact source rather than copy pasted between footer, page and
structured data — and only then build the page or change the contract.

## Owner/account gates from #153

- [ ] **O1** Google Ads Purchase value: owner chooses merchandise-only vs `OrderMirror.totalVnd` before Ads Purchase publish.
- [ ] **O2** Merchant market/language/currency confirmed before Merchant activation.
- [x] **O3** Apparel facts — **policy decision resolved by ADR 0007**: shop defaults `gender=male`, `age_group=adult`, `condition=new` with local website-owned product overrides. Runtime persistence/validation/admin/effective-fact resolution stays open under M3/U25, and Merchant activation stays blocked until that implementation is verified.
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
- [ ] **O2** market approved and **O3** apparel-fact **runtime** implementation verified (ADR 0007 resolves the policy, not the runtime); Merchant site/account/shipping/returns prerequisites satisfied.
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
- [x] Browser/runtime/a11y/SEO checks required by Checkpoint B are green on `main@649e04c328353c016e4ba41831b6eec7d49d1d54`; see `docs/audits/wave-2-checkpoint-b.md`.
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