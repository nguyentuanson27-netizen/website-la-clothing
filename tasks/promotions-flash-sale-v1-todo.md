# Promotions & Flash Sale v1 — execution checklist

Status: **PLANNED / NOT IMPLEMENTED**

Source spec: `docs/specs/promotions-flash-sale-v1.md`

Execution plan: `tasks/promotions-flash-sale-v1-plan.md`

Planning base: `main@323c07cf25c834e36e4a43952df3f0ee7321d756` with PR #152 + PR #153 merged.

This checklist is feature-local. PR #153 owns canonical marketing/analytics/Merchant contracts; PR #152 owns SEO/GEO planning input. Promotion implementation consumes those contracts and must not create parallel pricing, identity, cart or deep-link authorities.

## P0 — planning reconciliation
- [x] Refresh #151 against `main` containing #152 + #153.
- [x] Replace “rediscover GTM/TikTok later” with explicit #153 dependencies.
- [x] Lock product external ID = `pancakeProductId` for unselected upper funnel.
- [x] Lock selected/committed external variant ID = `pancakeVariationId`.
- [x] Lock `VariantMirror.id` as internal mutation/auth identity only.
- [x] Lock Purchase transaction/event ID = `OrderMirror.publicCode`.
- [x] Lock promotion pricing as a consumer/source for analytics/Merchant/SEO, never duplicated there.
- [ ] Fresh review on latest head has 0 Critical / 0 Required.
- [ ] Exact-head CI is green.
- [ ] Human approves plan before `/build`.

## P1 — persistence + additive order audit
- [ ] Add campaign kind/discount/publish-state/target enums and models.
- [ ] Enforce target shape: exactly one PRODUCT or VARIANT reference.
- [ ] Prevent duplicate explicit targets and PRODUCT + own-covered VARIANT duplication.
- [ ] Store website money as integer/BigInt VND; keep Pancake mirrors `Float?`.
- [ ] Add immutable order-line fields for base price, final price and nullable promotion snapshot metadata.
- [ ] Preserve purchased `pancakeVariationId`, name/options/quantity facts required by #153 Purchase.
- [ ] Keep migration additive and historical rows readable.
- [ ] Do not add campaign delete.

Verification:
- [ ] RED/GREEN schema/DB tests.
- [ ] Prisma validate/generate/migration deploy checks.
- [ ] Historical compatibility test.
- [ ] Review migration rollback/forward compatibility.

## P2 — central pricing domain + evidence
- [ ] Implement one pure TypeScript effective-price resolver with explicit `now`.
- [ ] Enforce positive safe-integer base-price boundary.
- [ ] Percentage uses exact BigInt rational arithmetic.
- [ ] Fixed price is final customer unit price and requires `0 < fixed < base`.
- [ ] Return base/effective price, discounted flag, promotion snapshot, typed invalid/conflict reason, transition fact.
- [ ] More than one active candidate => conflict/no promotion; never choose arbitrary winner.
- [ ] Invalid promotion falls back only affected variant when base remains usable.
- [ ] Unusable base => `BASE_PRICE_UNAVAILABLE` / non-purchasable.
- [ ] Add read-only mirrored-money audit for null/zero/negative/non-integer/unsafe values.
- [ ] Run `pnpm pancake:catalog:audit` in approved real-catalog context before equality-gate removal.
- [ ] Record sanitized `pancakeRetailPrice` vs `pancakeRetailPriceAfterDiscount` mismatch evidence.
- [ ] If evidence materially contradicts approved pricing ownership, stop for product review.

Mandatory domain fixtures:
- [ ] `150 @ 1% -> 149`.
- [ ] `350 @ 1% -> 347`.
- [ ] `110 @ 5% -> 105`.
- [ ] `9007199254740989 @ 1% -> 8917127262193579`.
- [ ] low-price no-discount invalidation, e.g. `50 @ 1%`.
- [ ] fixed-price valid/invalid and fresher-base drift/recovery.
- [ ] malformed external values and conflict cases.

## P3 — repository + lifecycle + runtime health
- [ ] Batch lookup direct VARIANT + actual owning PRODUCT campaigns for real variant IDs.
- [ ] Composite pricing follows selected real component variant and actual owning product, not parent PDP presentation owner.
- [ ] PRODUCT targets dynamically include new/restored variants; no frozen membership table.
- [ ] Derive Draft/Scheduled/Active/Ended/Disabled using durable fields + explicit `now`.
- [ ] Zero-traffic scheduled active window still produces correct terminal history semantics.
- [ ] Legal never-Active re-enable writes fresh `enabledAt` and clears `disabledAt` atomically.
- [ ] Prior-Active Disabled and Ended remain terminal except Copy.
- [ ] Runtime invalidity/conflict is affected-variant fail-closed; healthy siblings continue.
- [ ] Auto-recover health when variant validity/conflict recovers.
- [ ] Copy reads campaign + explicit targets only; no PRODUCT expansion.
- [ ] Copy naming uses exact bounded deterministic suffix algorithm.

Regression coverage:
- [ ] 119/120-code-unit Copy names.
- [ ] trailing-space normalization.
- [ ] surrogate-pair boundary.
- [ ] Copy-of-Copy.
- [ ] >2000 dynamic PRODUCT expansion source still copies to Draft.
- [ ] bounded query count / no N+1.

## P4 — concurrency-safe admin domain + activation gate
- [ ] Require admin authn/authz for all campaign mutations.
- [ ] Enforce name/ID/target/page/search bounds server-side.
- [ ] Coverage-validating path for publish/re-enable/Scheduled material edit:
  - [ ] lock campaign row when applicable;
  - [ ] lock owning ProductMirror rows deterministically;
  - [ ] bounded expansion probe at `MAX_EXPANDED_VARIANTS_PER_CAMPAIGN + 1`;
  - [ ] reject >2000 before variant lock set;
  - [ ] lock needed VariantMirror rows deterministically;
  - [ ] re-read lifecycle/base/targets/overlap under lock;
  - [ ] commit atomically or write nothing.
- [ ] Same-campaign writes cannot lost-update.
- [ ] PRODUCT↔PRODUCT, PRODUCT↔VARIANT and VARIANT↔VARIANT overlap races fail closed.
- [ ] Disable/end-early uses campaign-row bounded path only; no expansion gate.
- [ ] Active PRODUCT 1900 -> sync 2001 -> Disable still succeeds.
- [ ] Activation gate defaults off; publish/re-enable return typed `ACTIVATION_DISABLED` while off.
- [ ] Existing active campaigns require explicit Disable for rollback; switching gate off does not pretend they vanished.

Verification:
- [ ] repeated concurrency/race tests.
- [ ] 2000 allowed / 2001 rejected for coverage-validating writes.
- [ ] failed mutation preserves previous definition.
- [ ] no secrets/PII/external raw payloads logged.

### Checkpoint A
- [ ] P1-P4 focused suites green.
- [ ] migration clean.
- [ ] activation gate default-off verified.
- [ ] security review complete.
- [ ] 0 Critical / 0 Required.

## P5 — admin UX
- [ ] Protected `/admin/promotions` route.
- [ ] Bounded list/search (50).
- [ ] Create/edit/publish/re-enable/disable/copy per lifecycle.
- [ ] Typed feedback for invalid config, overlap, expansion cap and activation-disabled state.
- [ ] Product admin shows related-campaign summary/link only; no duplicate editor.
- [ ] No pricing/overlap formulas in React.
- [ ] Keyboard, Axe and mobile checks.
- [ ] Non-admin rejection tests.

## #153 shared identity/cart prerequisites
Before P6/P8 consume shared commerce facts:
- [ ] #153 T4 or equivalent shared slice propagates `pancakeProductId` for product-level facts.
- [ ] Concrete option/cart facts propagate real `pancakeVariationId`.
- [ ] Local variant CUID never becomes vendor item ID.
- [ ] PDP AddToCart shared API is atomic `+1`, not absolute set-to-1.
- [ ] Cart update/remove return committed quantity transition + bounded server-authoritative item snapshot.
- [ ] `view_cart` / `begin_checkout` use complete all-or-nothing canonical cart projection.
- [ ] Shared snapshot price is sourced from current central promotion resolver when promotion is present.
- [ ] If #151 reaches this boundary first, implement the shared API once and make #153 consume it; do not create a temporary duplicate path.

## P6 — PDP/composite promotion projection
- [ ] Remove retail/after-discount equality gate only after P2 evidence acceptance.
- [ ] Selected option uses central quote; no client discount formula.
- [ ] Preserve selected `pancakeVariationId` in storefront facts.
- [ ] Composite component uses its own real owner for campaign lookup.
- [ ] Sale UI: struck base + effective price + badge; Flash adds label/countdown.
- [ ] Countdown is presentation only; server decides eligibility.
- [ ] No per-option DB query.
- [ ] Compatible with #153 M2 standalone deep link `/shop/<slug>?variant=<pancakeVariationId>`; no promotion-specific competing variant URL.

Verification:
- [ ] standalone and composite real-owner cases.
- [ ] selected-variant exact price.
- [ ] invalid/unusable base.
- [ ] deep-link compatibility when M2 lands.
- [ ] browser/a11y PDP checks.

## P7a — cards + `/shop` effective-price discovery
- [ ] Card representative promoted variant is lowest effective promoted purchasable variant with deterministic tie.
- [ ] Struck base comes from the same representative variant.
- [ ] If cheaper unpromoted variant exists, use non-misleading `Sale từ ...` semantics.
- [ ] `minPrice`, `maxPrice`, `price-asc`, `price-desc` use authoritative effective price before pagination.
- [ ] One request `requestNow` spans count/order/SQL/hydration/card/transition aggregation.
- [ ] SQL casts validated base to PostgreSQL `numeric` before percentage arithmetic.
- [ ] SQL uses same target/time/conflict/invalid semantics as TypeScript.
- [ ] Product-level analytics identity remains product-level; do not fabricate a selected variation from card representative pricing.
- [ ] Query-wide transition aggregate includes off-page candidates that can enter current page/filter/sort.

Verification:
- [ ] SQL↔TS parity including mandatory P2 fixtures.
- [ ] filter/sort/pagination.
- [ ] off-page transition membership change.
- [ ] current page/offset guards.
- [ ] no N+1.

## P7b — `/flash-sale` + freshness
- [ ] Reuse same sanctioned SQL pricing/membership projection.
- [ ] Show active-valid Flash Sale variants only.
- [ ] Page parser max 10,000.
- [ ] Page size max 48.
- [ ] Offset max 50,000.
- [ ] page 1042 @48 => offset 49,968 allowed.
- [ ] page 1043 @48 => offset 50,016 rejected before expensive query.
- [ ] Empty Flash route still knows next enabled Flash boundary.
- [ ] Server emits relative `refreshAfterMs <= 60_000`.
- [ ] Client does not rely on browser wall-clock subtraction.
- [ ] `visibilitychange` / `pageshow` resume refresh if deadline elapsed while suspended.

Verification:
- [ ] empty -> first sale starts.
- [ ] end boundary.
- [ ] clock skew.
- [ ] background-tab resume.
- [ ] pagination/offset/query budget.

### Checkpoint B
- [ ] PDP/cards/shop/flash share one price authority.
- [ ] #153 identity contract still passes.
- [ ] SQL↔TS parity green.
- [ ] browser freshness/a11y checks pass.
- [ ] 0 Critical / 0 Required.

## P8 — DRAFT quote + promotion audit
- [ ] Initial DRAFT uses central effective quote, never browser price authority.
- [ ] DRAFT line keeps `pancakeVariationId`, product/name/options/quantity plus base/final/promotion audit facts.
- [ ] DRAFT remains mutable/retryable until guarded finalization.
- [ ] Final pricing/audit becomes immutable once leaving DRAFT for submission.
- [ ] Production activation remains blocked while P9/P10 are incomplete.

Verification:
- [ ] no promotion / percentage / fixed DRAFT snapshots.
- [ ] composite component identity.
- [ ] invalid base.
- [ ] retryable DRAFT replacement.

## P9a — rendered quote -> DRAFT reconfirmation
- [ ] Browser returns expected quote only for stale detection.
- [ ] Server recomputes current quote before accepting submit-capable DRAFT.
- [ ] Mismatch returns typed `PRICE_CHANGED` + refreshed totals.
- [ ] No `POS_SUBMITTING` and no Pancake create call on mismatch.
- [ ] Explicit resubmit required.

Mandatory regression:
- [ ] customer sees 400k -> sale ends -> first submit returns 500k `PRICE_CHANGED` with zero POS write -> second unchanged submit may proceed.

## P9b — DRAFT -> fresh Pancake reconfirmation
- [ ] Fetch fresh trusted Pancake catalog facts.
- [ ] Feed fresh base into central resolver.
- [ ] Compare DRAFT final quote to fresh effective website quote, not raw live retail.
- [ ] Mismatch atomically refreshes same DRAFT line/audit/totals and returns `PRICE_CHANGED`.
- [ ] No Pancake create call on mismatch.
- [ ] Percentage recalculates; fixed price revalidates.
- [ ] Repeated drift repeats reconfirmation without stale-loop behavior.

Verification:
- [ ] fresh base drift % and fixed.
- [ ] promotion start/end during checkout.
- [ ] invalid/recovery.
- [ ] no POS call on mismatch.

## P10 — Pancake final-price convergence
- [ ] Replace raw-live `PRICE_CHANGED` comparison with fresh effective quote.
- [ ] Recompute merchandise/shipping/total integrity from authoritative effective/final values.
- [ ] Build outbound request line price from finalized immutable `OrderLineSnapshot.unitPriceVnd`.
- [ ] Keep fresh stock/identity validation.
- [ ] Preserve no-blind-retry and `SYNC_UNKNOWN` semantics.
- [ ] Three separate regressions independently fail if comparison, totals or outbound price reverts to raw `livePrice`.
- [ ] Controlled authorized Pancake semantic acceptance submits a safe/test line price different from catalog base and verifies acceptance/preservation.
- [ ] Record sanitized evidence; clean up if safe.
- [ ] If acceptance cannot be proved, production discounted campaign activation remains blocked.

## #153 T7 Purchase convergence
After P10 finalization contract exists:
- [ ] Confirmed Purchase consumes immutable final unit prices/quantities/`pancakeVariationId` from order snapshots.
- [ ] `publicCode` remains transaction/event ID.
- [ ] Promotion metadata may enrich internal audit but tracking does not calculate discount itself.
- [ ] Repeat success-page visit reuses identity; no duplicate logical transaction identity.
- [ ] Non-CONFIRMED states emit no Purchase.

## G1 — SEO + analytics + Merchant monetary convergence
Analytics:
- [ ] `view_item`/cart events use authoritative current effective price when exact price exists.
- [ ] product-level range does not masquerade as exact selected price.
- [ ] Purchase uses immutable final snapshot money.
- [ ] GTM only routes/maps events; no promotion formula in GTM.
- [ ] Existing direct Meta Pixel+CAPI ownership remains direct; no duplicate Meta GTM tag.

Merchant:
- [ ] #153 M2 owns standalone variant deep-link contract.
- [ ] #153 M3 mapper consumes current storefront effective price.
- [ ] No Merchant-specific promotion math.
- [ ] Composite Merchant offers remain deferred/fail-closed.
- [ ] Sale start/end changes feed price according to current storefront authority/cache freshness contract.

SEO/GEO:
- [ ] Structured Offer uses authoritative effective price only when current variant schema/deep-link contract can represent it truthfully.
- [ ] Do not introduce `AggregateOffer` for variants.
- [ ] ProductGroup/per-variant Offer remains behind #152 W4 + #153 M2 prerequisites.
- [ ] Inventory W15 existing SEO test/CI coverage before adding runtime gates; add only gaps.
- [ ] Promotion/Tracking/Merchant work does not enable organic indexing.

## G2 — observability + readiness + rollback
- [ ] Bounded/redacted telemetry for activation rejection.
- [ ] Bounded/redacted telemetry for runtime invalid/recovery and `PARTIALLY_INVALID`.
- [ ] Conflict telemetry identifies bounded campaign/target IDs without PII.
- [ ] `PRICE_CHANGED` reason/phase observable.
- [ ] Pancake semantic acceptance evidence recorded securely.
- [ ] Activation-gate state/change operationally visible without exposing secrets.
- [ ] No customer PII, credentials or raw external payloads logged.
- [ ] Rollback runbook: gate off + campaign Disable; Disable remains bounded even >2000 dynamic variants.
- [ ] Mirrored-money audit reviewed before rollout.

## G3 — final DoD
- [ ] Focused tests for every changed behavior and regression path.
- [ ] Relevant existing domain/DB suites green.
- [ ] Lint green.
- [ ] Typecheck green.
- [ ] Production build green.
- [ ] Applicable runtime/browser/a11y suites green.
- [ ] No duplicate pricing/business logic.
- [ ] No unrelated refactor.
- [ ] No N+1/unbounded query introduced.
- [ ] Security review complete for admin input/authz/external Pancake facts.
- [ ] Docs/runbooks match current truth.
- [ ] #153 identity/cart/Purchase contracts remain green.
- [ ] #152 indexing policy remains unchanged unless separately approved.
- [ ] Human final review has 0 Critical / 0 Required.

## Recommended implementation sequence
- [ ] PR A1 — P1 persistence.
- [ ] PR A2 — P2 pricing/evidence.
- [ ] PR B1 — P3 repository/lifecycle.
- [ ] PR B2 — P4 concurrency/admin domain.
- [ ] PR C — P5 admin UX.
- [ ] Converge #153 T4 shared identity facts.
- [ ] PR D1 — P6 PDP/composite.
- [ ] PR D2 — P7a shop/cards.
- [ ] PR D3 — P7b Flash/freshness.
- [ ] Converge one shared #153 T5/T6 cart mutation/projection API.
- [ ] PR E1 — P8 DRAFT quote/audit.
- [ ] PR E2 — P9a rendered-quote reconfirmation.
- [ ] PR E3 — P9b fresh-Pancake reconfirmation.
- [ ] PR F — P10 Pancake final-price convergence.
- [ ] #153 T7 Purchase on finalized snapshot.
- [ ] G1 split into focused analytics / Merchant / SEO consumer PRs.
- [ ] G2 ops/readiness.
- [ ] G3 final integrated verification.

## Separate launch gates
Promotion activation:
- [ ] P1-P10 accepted.
- [ ] mirrored-money + Pancake catalog evidence accepted.
- [ ] Pancake custom-price semantic acceptance succeeds.
- [ ] G1/G2/G3 accepted.
- [ ] human explicitly enables promotion activation gate.

GTM live, Merchant activation and organic indexing remain separately owned launch gates from #153/#152 and are **not** implied by promotion readiness.
