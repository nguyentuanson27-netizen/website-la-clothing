# Growth + Commerce master execution checklist — PR #151 + #152 + #153

Status: **PLANNED / NOT IMPLEMENTED**

Source plan: `tasks/growth-commerce-master-plan.md`

Planning baseline: `main@36ca06ccc57b89762069e8c0daab575fb6ef1421`.

This checklist tracks orchestration only. Detailed acceptance criteria remain authoritative in the source #151/#152/#153 documents named by the master plan.

## Program rules

- [ ] Every implementation PR starts from latest reviewed `main`.
- [ ] Re-read the owning source task/spec before coding.
- [ ] Do not create duplicate pricing/cart/identity/variant-URL/Purchase/Merchant-cache authority.
- [ ] Split oversized/multi-concern implementation PRs.
- [ ] Focused behavior tests first; then applicable repo checks.
- [ ] No unrelated refactor.
- [ ] Major checkpoints require fresh review: 0 Critical / 0 Required.

## Wave 0 — baseline and safety

### U0 — latest-main reconciliation
- [ ] Confirm #151/#152/#153 source artifacts still exist on latest `main`.
- [ ] Confirm shared contract ownership is unchanged or explicitly superseded.
- [ ] Record exact implementation-wave base SHA.

### U1 — temporary production host hard block — #152 P0/G1
- [ ] Implement source task.
- [ ] `la.lanadesign.vn` cannot pass release readiness with indexing enabled.
- [ ] Permanent-domain enablement remains a separate reviewed/human gate.

### U2 — tracking foundation, no GTM — #153 T1–T3
- [ ] Implement T1 canonical event contracts.
- [ ] Implement T2 fail-closed desired tracking config.
- [ ] Implement T3 dataLayer/consent/page-view authority.
- [ ] Requested preview/live still causes zero GTM load before T8.
- [ ] No customer PII in generic commerce dataLayer.

### U3 — promotion persistence + durable pricing revision — #151 P1
- [ ] Implement P1 persistence/order-audit contract.
- [ ] Preserve `pancakeVariationId` required by #153 Purchase.
- [ ] Add bounded durable promotion-pricing revision.
- [ ] Migration remains additive/backward-compatible.

### U4 — metadata uniqueness replacement — #152 W2a
- [ ] Prove collision-safe replacement before removing slug/path metadata copy.
- [ ] Keep uniqueness regression at least as strong as current coverage.

### U5 — SEO runtime coverage inventory — #152 W15a
- [ ] Map five dedicated SEO smoke scripts against existing test/P18/runtime coverage.
- [ ] Record overlap vs missing HTTP/runtime signals.

### U6 — first-party content fact inventory — #152 W13A
- [ ] Inventory About facts.
- [ ] Inventory Returns facts/policy.
- [ ] Inventory Shipping/Payment facts.
- [ ] Inventory Size Guide facts/policy.
- [ ] Inventory Contact/address facts.
- [ ] Missing owner facts are marked BLOCKED, not inferred.

## Wave 1 — commerce truth and identity

### U7 — central pricing + Pancake evidence — #151 P2 + #152 W3
- [ ] Implement #151 P2 exact pricing contract/tests.
- [ ] Run approved `pnpm pancake:catalog:audit` against real catalog context.
- [ ] Record sanitized evidence.
- [ ] Material contradiction stops rollout and returns to product review.

### U8 — canonical external identity propagation — #153 T4
- [ ] Implement T4 product/variant identity propagation.
- [ ] `pancakeProductId` remains product-level upper-funnel identity.
- [ ] `pancakeVariationId` remains concrete selected/committed identity.
- [ ] `VariantMirror.id` remains internal-only.

### U9 — Merchant identity/durability/catalog audit — #153 M1 + #152 W4a
- [ ] Run M1 read-only audit independently of T4 implementation timing.
- [ ] Accept durability/format evidence for product/variation IDs.
- [ ] Audit SKU-as-MPN.
- [ ] Never infer GTIN from Pancake barcode naming.
- [ ] Composite records remain `COMPOSITE_DEFERRED`.

### U10 — promotion repository/lifecycle/runtime health — #151 P3
- [ ] Implement P3.
- [ ] Preserve actual composite component ownership semantics.
- [ ] Preserve zero-traffic/restart lifecycle correctness.
- [ ] Preserve affected-variant runtime fallback/recovery.

### U11 — promotion concurrency/admin domain + activation gate + atomic revision — #151 P4
- [ ] Implement P4.
- [ ] Activation gate defaults off.
- [ ] Overlap/lost-update/lock-order regressions green.
- [ ] Disable remains bounded after dynamic coverage >2000.
- [ ] Effective mutation + durable revision commit atomically.
- [ ] No best-effort post-commit correctness dependency.

### Checkpoint A — commerce foundation
- [ ] #151 P1–P4 focused verification green.
- [ ] Price/catalog evidence accepted.
- [ ] Activation gate confirmed off.
- [ ] Identity contract ready before consumers rely on external IDs.
- [ ] Security review complete for authz/bounds/concurrency/external data.
- [ ] 0 Critical / 0 Required.

## Wave 2 — addressability and storefront

### U12 — standalone variant deep link — #153 M2 + #152 W4b/W4c
- [ ] U8 application identity is green.
- [ ] U9 durability evidence is accepted.
- [ ] Implement exact `/shop/<slug>?variant=<pancakeVariationId>` preselection.
- [ ] Forged/stale/private/composite values fail closed.
- [ ] Base PDP canonical/search policy remains authoritative.

### U13 — wire only missing SEO runtime gates — #152 W15b
- [ ] Start from U5 coverage map.
- [ ] Add only missing HTTP/runtime signals.
- [ ] Avoid duplicate expensive smoke work without extra evidence.

### U14 — promotion admin UX — #151 P5
- [ ] Implement P5 over P4 service boundary.
- [ ] No promotion math/overlap authority in React.

### U15 — PDP promotion projection — #151 P6
- [ ] Depends on U11 + U7 + U8 + U12.
- [ ] Implement P6 using central pricing and canonical variant URL/state.
- [ ] No competing PDP variant-state model.

### U16 — `/shop` effective-price discovery — #151 P7a
- [ ] Implement P7a.
- [ ] SQL↔TS parity remains mandatory.
- [ ] Product-level analytics identity is not fabricated as a selected variant.

### U17 — `/flash-sale` + freshness — #151 P7b
- [ ] Implement P7b through the same pricing/membership projection.
- [ ] Keep page/offset bounds and relative ≤60s freshness/resume guards.

### Checkpoint B — storefront truth
- [ ] PDP/cards/shop/Flash share one pricing authority.
- [ ] T4/M2 identity/addressability regressions green.
- [ ] SQL↔TS parity green.
- [ ] Browser freshness/a11y verification green where applicable.
- [ ] Activation remains off.
- [ ] 0 Critical / 0 Required.

## Wave 3 — canonical cart/checkout APIs

### U18 — atomic PDP AddToCart — #153 T5
- [ ] Implement T5 after promotion-aware PDP pricing exists.
- [ ] Server commits exact `+1` and returns authoritative item snapshot.
- [ ] Canonical event uses committed server facts only.
- [ ] Tracking failure never rolls back commerce.

### U19 — cart update/remove + complete cart/checkout projection — #153 T6 + #151 shared checkpoint
- [ ] Implement T6 using central promotion-aware price where applicable.
- [ ] Update/remove uses committed transaction facts.
- [ ] `view_cart` / `begin_checkout` use one complete all-or-nothing projection.
- [ ] No browser/local-ID fallback.
- [ ] #151 checkout consumes this same API; no duplicate cart path.

## Wave 4 — checkout/order convergence

### U20 — mutable DRAFT quote/audit — #151 P8
- [ ] Implement P8 after U17 + U19.

### U21 — stateless rendered-quote proof — #151 P9a
- [ ] Implement P9a bounded stateless server-MAC contract.
- [ ] Raw HttpOnly cart UUID remains server-only context.
- [ ] No quote-proof persistence state.

### U22 — fresh Pancake reconfirmation — #151 P9b
- [ ] Implement P9b through central pricing resolver.
- [ ] Mismatch returns refreshed DRAFT + `PRICE_CHANGED`, no Pancake create.

### U23 — final Pancake convergence — #151 P10
- [ ] Implement P10.
- [ ] Three independent raw-`livePrice` regressions green.
- [ ] Controlled Pancake custom-price semantic acceptance recorded before real discounts.

### U24 — confirmed Purchase — #153 T7
- [ ] Implement T7 only from `CONFIRMED` immutable order facts.
- [ ] `publicCode` remains transaction/event ID.
- [ ] Items use immutable `pancakeVariationId`, price and quantity.

### Checkpoint C — transaction truth
- [ ] Two-stage `PRICE_CHANGED` proved.
- [ ] Three Pancake raw-live-price regressions green.
- [ ] Controlled custom-price acceptance accepted or activation remains blocked.
- [ ] Immutable Purchase identity/value green.
- [ ] Direct Meta compatibility green.
- [ ] 0 Critical / 0 Required.

## Wave 5 — downstream consumers

### U25 — Merchant standalone mapper — #153 M3
- [ ] Depends on U9 + U12 + U17 + central pricing.
- [ ] Implement M3 standalone-only mapper.
- [ ] No inferred GTIN; audited MPN only.

### U26 — Merchant public route/cache + promotion revision — #153 M4 + #151
- [ ] Implement M4 bounded serializer/public route/cache/single-flight/failure backoff.
- [ ] Integrate #151 durable revision/transition-aware freshness.
- [ ] No request-controlled cache dimensions.
- [ ] Topology gate remains fail-closed for multi-replica deployment without shared protection.

### U27 — variant ProductGroup/Offer structured data — #152 W4d/W5
- [ ] Depends on U12 + U17 + verified identifier semantics + U13 coverage ownership.
- [ ] No `AggregateOffer` shortcut for variants.
- [ ] Offer price/availability/URL remain truthful.
- [ ] U25 and U27 may run in parallel from the same canonical storefront facts.
- [ ] Before Merchant/index launch, feed and JSON-LD consistency evidence is green.

### U28 — exact GTM saved version + loader/CSP/destinations — #153 T8
- [ ] Depends on U2 + U18/U19 canonical cart events + U24 Purchase.
- [ ] Review exact saved GTM version/export/checksum.
- [ ] Prove preview sends zero production-destination traffic.
- [ ] Only then add actual GTM loader/CSP openings.
- [ ] Live publishes the same reviewed saved version.

## Wave 6 — SEO/search follow-through

### U29 — PDP metadata cleanup — #152 W2b
- [ ] Implement only after U4 collision-safe contract is proven.

### U30 — search/social fundamentals — #152 P3
- [ ] W8 root OG/Twitter fallback.
- [ ] W10 static self-canonical.
- [ ] W14a branded route-level 404.
- [ ] W14b unknown product-slug HTML 404 while preserving current slug/historical 301.
- [ ] Split into focused PRs where appropriate.

### U31 — sitemap significant `lastModified` — #152 W9
- [ ] Do not implement until significant public-change timestamp semantics are approved.
- [ ] Do not use raw mirror/internal `updatedAt` blindly.

### U32 — Product/Organization discovery enrichment — #152 P4/W5/W6
- [ ] Emit only verified identifier/public first-party facts.
- [ ] Merchant and JSON-LD describe the same catalog/price/availability contract.
- [ ] Split Product vs Organization work when useful for review.

### U33 — evergreen pages — #152 P5/W13
- [ ] Start only after U6 human-approved facts.
- [ ] Do not invent return/contact/address/size policies.
- [ ] Build small focused page PRs with correct metadata/canonical/index behavior.

### U34 — SEO admin/operational readiness — #152 P6/W16/W17
- [ ] Implement reviewed preview/counter/warning/health features.
- [ ] Advisory UI does not become a new hard SEO policy unless source review says so.

### U35 — permanent-domain verification — #152 P6/W18
- [ ] Blocked until permanent branded domain + owner approval exist.
- [ ] Record Search Console/Bing/Merchant verification evidence as applicable.
- [ ] Verification does not itself enable organic indexing.

### U36 — crawler governance matrix — #152 P6/W19
- [ ] Blocked until owner approves distribution/data-use policy.
- [ ] Search discovery, user-triggered retrieval, training and vendor-specific controls remain distinct.

### U37 — sitemap scale trigger — #152 P6/W21
- [ ] Measure catalog URL volume.
- [ ] Define trigger before current hard failure cliff.
- [ ] Add sitemap index/sharding only when evidence warrants it.

### U38 — runtime performance verification — #152 P7
- [ ] Measure `/`, `/shop`, collection and PDP on mobile + desktop.
- [ ] Prefer measurement after promotion/discovery and GTM changes are materially present.
- [ ] Create optimization/budget tasks only from measured evidence.

## Conditional — not on default critical path

### #152 W12 — listing ItemList/CollectionPage
- [ ] Do **not** schedule unless new target-market/consumer/search evidence justifies it.

### #152 W20 — `llms.txt`
- [ ] Do **not** schedule for Google SEO/GEO.
- [ ] Add only for a named non-Google consumer/use case with owner-approved value.

### Deferred by source contracts
- [ ] TikTok Events API remains future scope.
- [ ] Meta-to-GTM migration remains out of scope.
- [ ] Enhanced Conversions/customer PII remains out of scope.
- [ ] Composite Merchant offers remain out of v1.
- [ ] Coupons/stacking/BXGY/personalized promotion expansion remains out of #151 v1.

# Separate launch gates

## Gate P — Promotion activation
- [ ] #151 P1–P10 accepted.
- [ ] Price/catalog evidence accepted.
- [ ] Controlled Pancake custom-price semantic acceptance succeeds.
- [ ] Enabled monetary consumers are promotion-aware; disabled/fail-closed future consumers do not block.
- [ ] Readiness/rollback/observability + final DoD accepted.
- [ ] Human explicitly enables promotion activation.

## Gate T — GTM live
- [ ] T1–T7 canonical facts green.
- [ ] Exact immutable saved GTM version/export/checksum reviewed.
- [ ] Preview/test sends zero production destination traffic.
- [ ] Destination semantics reviewed.
- [ ] Live publishes same reviewed saved version.
- [ ] Human approves live activation.

## Gate M — Merchant activation
- [ ] M1–M4 accepted.
- [ ] Exact standalone variant URL accepted.
- [ ] IDs/MPN/durability evidence accepted.
- [ ] Canonical promotion-aware pricing integrated where supported.
- [ ] Cache/single-flight/backoff/topology proof accepted.
- [ ] Composite remains excluded/fail-closed.
- [ ] Merchant account/market/apparel owner gates satisfied.

## Gate S — Organic indexing
- [ ] Temporary-domain hard block green.
- [ ] Permanent branded domain confirmed.
- [ ] Applicable #152 Required correctness/regression/operational gates complete.
- [ ] Permanent-domain verification accepted.
- [ ] Human explicitly approves indexing on permanent domain.
- [ ] Promotion/GTM/Merchant activation has not been treated as implicit index approval.

# Major checkpoint verification

Run only when applicable to the changed scope; do not claim execution unless actually run:

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

- [ ] `pnpm pancake:catalog:audit` only in approved real-catalog context; sanitized evidence recorded.
- [ ] Browser/runtime/a11y/SEO checks run where the owning source task requires them.
- [ ] GTM/Merchant/Pancake external acceptance performed only with approved credentials/context.

# Final program Definition of Done

- [ ] Implemented source-task acceptance criteria met.
- [ ] No duplicate pricing/cart/identity/variant-URL/Purchase/Merchant-cache authority.
- [ ] Focused regressions would fail without the behavior.
- [ ] Existing relevant suites green.
- [ ] Lint/typecheck/build green.
- [ ] Applicable DB/runtime/browser/a11y verification green.
- [ ] Security review covers admin authz, untrusted browser/external input, quote proof, Merchant public route, serialization, GTM/CSP/secrets and PII.
- [ ] Migration/backward compatibility/rollback reviewed.
- [ ] Observability covers new critical production failure modes without secrets/PII.
- [ ] Docs describe current truth.
- [ ] No unrelated refactor/dead code/debug output.
- [ ] Launch gates remain independent with explicit owner/rollback trigger.
- [ ] Human final review: **0 Critical / 0 Required**.
