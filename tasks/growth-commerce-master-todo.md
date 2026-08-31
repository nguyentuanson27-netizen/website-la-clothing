# Growth + Commerce master execution checklist — PR #151 + #152 + #153

Status: **PLANNED / NOT IMPLEMENTED**

Source plan: `tasks/growth-commerce-master-plan.md`

Planning baseline: `main@36ca06ccc57b89762069e8c0daab575fb6ef1421`.

This checklist coordinates implementation only. Domain acceptance criteria remain authoritative in the source #151/#152/#153 artifacts referenced by the master plan.

## Program rules

- [ ] Start every implementation PR from latest reviewed `main`.
- [ ] Re-read affected source task/spec before coding; do not rely on this checklist as a replacement contract.
- [ ] Keep one authority for pricing, identity, cart truth, variant URL, Purchase and Merchant cache.
- [ ] Split any task that exceeds a focused review/revert boundary; avoid XL implementation PRs.
- [ ] Focused behavior tests first; then applicable repo-wide checks.
- [ ] No unrelated refactor.
- [ ] Fresh review at each major checkpoint: 0 Critical / 0 Required.

## U0 — baseline reconciliation
- [ ] Confirm latest `main` still contains #151/#152/#153 source artifacts.
- [ ] Confirm shared pricing/identity/cart/URL/cache ownership is unchanged or explicitly superseded.
- [ ] Record exact base SHA for the first implementation wave.

## U1 — temporary production host indexing hard block (#152 P0/G1)
- [ ] `la.lanadesign.vn` fails release readiness when indexing is requested on.
- [ ] Existing staging/local fail-closed behavior remains green.
- [ ] Permanent-domain migration remains a separate reviewed change.
- [ ] Focused tests + `pnpm release:check` representative cases + `pnpm test`.

## U2 — tracking foundation, no GTM load (#153 T1–T3)
- [ ] Typed product-level and selected-variant event facts.
- [ ] No customer PII in generic commerce events/dataLayer.
- [ ] Desired `disabled|preview|live` config is server/deployment-owned and fail-closed.
- [ ] Requested preview/live still loads no GTM before T8.
- [ ] Consent defaults/policy queued before eventual measurement.
- [ ] Exactly one application-owned initial/navigation `page_view`.
- [ ] No new Google/TikTok CSP/network path yet.
- [ ] `pnpm test` + `pnpm typecheck` + `pnpm lint` + security review.

## U3 — promotion persistence + order audit + durable pricing revision (#151 P1)
- [ ] Campaign/target shape/uniqueness and integer website money.
- [ ] Add base/final/promotion audit to `OrderLineSnapshot` while preserving `pancakeVariationId`.
- [ ] Add one bounded durable monotonic promotion-pricing revision.
- [ ] Migration additive/historical rows readable; mirrored Pancake prices stay `Float?`.
- [ ] Revision initialization/transaction/concurrency tests.
- [ ] `pnpm prisma:validate` + `pnpm prisma:generate` + approved migration verification.

## U4 — metadata uniqueness replacement contract (#152 W2a)
- [ ] Collision-safe human-readable uniqueness mechanism selected/proved.
- [ ] Existing uniqueness test remains at least as strong.
- [ ] No slug/path cleanup until this gate is green.
- [ ] Focused metadata tests + `pnpm test`.

## U5 — central pricing + Pancake/catalog evidence (#151 P2 + #152 W3)
- [ ] One pure explicit-`now` pricing resolver.
- [ ] Positive safe-integer base rule.
- [ ] Exact BigInt percentage arithmetic.
- [ ] Fixed price = final customer unit price with required validity.
- [ ] Conflict/invalid affected-variant behavior matches #151.
- [ ] Mandatory fixtures: `150@1%=149`, `350@1%=347`, `110@5%=105`, upper-safe fixture, low-price invalidation.
- [ ] Run approved `pnpm pancake:catalog:audit` against real catalog.
- [ ] Record sanitized retail vs after-discount evidence.
- [ ] Material contradiction => stop for product review.

## U6 — canonical external identity propagation (#153 T4)
- [ ] Product/list/PDP facts expose `pancakeProductId` at product level.
- [ ] Concrete options/cart/checkout facts expose real `pancakeVariationId`.
- [ ] Composite component lines retain component external variation ID.
- [ ] Local `VariantMirror.id` remains internal-only.
- [ ] No `kindKey`/slug/array position fallback.
- [ ] Standalone/composite/unresolvable/private regressions green.

## U7 — Merchant identity/durability/catalog audit (#153 M1 + #152 W4a)
- [ ] `pancakeVariationId` format/length/durability evidence accepted.
- [ ] `pancakeProductId` format/length/durability evidence accepted.
- [ ] SKU-as-MPN presence/uniqueness/stability audited.
- [ ] Pancake barcode not treated as GTIN without proof.
- [ ] Composite records classified `COMPOSITE_DEFERRED`.
- [ ] Price/media/content/apparel source facts audited without PII.

## U8 — promotion repository/lifecycle/runtime health (#151 P3)
- [ ] Batch VARIANT + actual owning PRODUCT candidate lookup.
- [ ] Composite follows actual component owner.
- [ ] Restart/zero-traffic lifecycle correctness.
- [ ] Legal never-Active re-enable clears `disabledAt=null` atomically.
- [ ] Affected-variant invalid/conflict/recovery + `PARTIALLY_INVALID`.
- [ ] Copy explicit targets only; 119/120/surrogate/Copy-of-Copy/>2000 regressions.
- [ ] Bounded queries/no N+1.

## U9 — promotion concurrency/admin domain + activation gate + atomic revision (#151 P4)
- [ ] Admin authz + all named bounds.
- [ ] Deterministic lock order for coverage-validating writes.
- [ ] Same-campaign lost update prevented.
- [ ] PRODUCT↔PRODUCT / PRODUCT↔VARIANT / VARIANT↔VARIANT overlap races fail closed.
- [ ] 2000 allowed / 2001 rejected where coverage validation requires it.
- [ ] 1900→2001 dynamic growth still allows Disable.
- [ ] Copy remains non-expanding.
- [ ] Activation gate defaults off; publish/re-enable => `ACTIVATION_DISABLED` while off.
- [ ] Effective mutation + durable revision advance commit atomically.
- [ ] Failed/rolled-back/Draft-only/Copy does not advance revision incorrectly.
- [ ] Concurrent revision increments do not deadlock/lose update.
- [ ] No `after()`/fire-and-forget correctness dependency.

### Checkpoint A — commerce foundation
- [ ] U3/U5/U8/U9 focused suites green.
- [ ] Activation gate verified default-off.
- [ ] U6 identity contract green before consumers depend on it.
- [ ] Security review: authz/bounds/external data/no PII or secrets.
- [ ] 0 Critical / 0 Required.

## U10 — standalone variant deep link (#153 M2 + #152 W4b/W4c)
- [ ] `/shop/<slug>?variant=<pancakeVariationId>` preselects exact valid standalone option.
- [ ] Visible price/color/size/image/availability match selected option.
- [ ] Forged/stale/inactive/private/composite query fails closed.
- [ ] Base PDP canonical remains authoritative.
- [ ] Variant query does not independently enable indexing.
- [ ] Route/server/client + canonical-query + browser tests green.

## U11 — SEO HTTP/runtime coverage inventory + gaps (#152 P2/W15)
- [ ] Inventory all five dedicated SEO smoke scripts against existing test/P18/runtime coverage.
- [ ] Mark overlap vs missing signal explicitly.
- [ ] Wire only uncovered HTTP/runtime cases.
- [ ] Avoid duplicate expensive smoke execution without added evidence.
- [ ] Verify noindex/indexable state, canonical behavior, redirect, metadata, robots and structured data where coverage map requires it.

## U12 — promotion admin UX (#151 P5)
- [ ] Protected `/admin/promotions`.
- [ ] Bounded list/search.
- [ ] Lifecycle-valid create/edit/publish/re-enable/disable/copy.
- [ ] Typed overlap/validation/expansion/activation feedback.
- [ ] Product admin links/summary only; no duplicate editor.
- [ ] No pricing/overlap math in React.
- [ ] Keyboard/Axe/mobile + non-admin rejection.

## U13 — PDP promotion projection (#151 P6)
- [ ] Equality gate removed only after U5 evidence acceptance.
- [ ] Selected option uses central quote.
- [ ] Real `pancakeVariationId` retained.
- [ ] Composite campaign owner follows real component owner.
- [ ] No client promotion formula / no per-option N+1.
- [ ] U10 deep-link compatibility green.
- [ ] Standalone/composite/invalid-base/browser/a11y tests green.

## U14 — `/shop` effective-price cards/filter/sort (#151 P7a)
- [ ] Effective price applied before pagination/filter/sort.
- [ ] One `requestNow` spans query/hydration/card/transition facts.
- [ ] SQL casts validated base to `numeric` before percentage arithmetic.
- [ ] SQL↔TS parity includes all mandatory pricing fixtures.
- [ ] Product upper-funnel analytics identity remains product-level.
- [ ] Off-page transition/page membership regression.
- [ ] Existing page/offset guards + no N+1.

## U15 — `/flash-sale` + freshness (#151 P7b)
- [ ] Same sanctioned pricing/membership projection; no duplicate Flash predicate.
- [ ] page ≤10000, size ≤48, offset ≤50000.
- [ ] page 1042@48 allowed; 1043@48 rejected before expensive query.
- [ ] Empty route knows next enabled Flash boundary.
- [ ] Server-relative refresh ≤60s.
- [ ] Browser wall clock not authority.
- [ ] `visibilitychange`/`pageshow` resume guard.
- [ ] Empty→active/end/clock-skew/background/pagination tests green.

### Checkpoint B — storefront truth
- [ ] PDP/cards/shop/Flash share one price authority.
- [ ] U6/U10 identity/addressability regressions green.
- [ ] SQL↔TS parity green.
- [ ] Browser freshness/a11y green.
- [ ] Activation still off.
- [ ] 0 Critical / 0 Required.

## U16 — atomic PDP AddToCart + event snapshot (#153 T5)
- [ ] Dedicated serialized `+1` mutation; never absolute set-to-1.
- [ ] Return `previousQuantity`, committed `quantity`, `addedQuantity=1`.
- [ ] Snapshot uses real `pancakeVariationId` + current central-resolver price + item facts.
- [ ] Browser event uses only committed success payload.
- [ ] Snapshot failure emits no canonical event but does not roll back commerce.
- [ ] absent→1 / 1→2 / >1 increment / stock-bound / concurrent clicks / stale-browser-price regressions.
- [ ] Direct Meta compatibility green.

## U17 — cart update/remove + complete cart/checkout projection (#153 T6)
- [ ] Absolute update/remove re-resolves current eligibility inside serialized mutation.
- [ ] Update returns old/new quantity + authoritative item snapshot.
- [ ] Remove captures removed quantity + item snapshot before delete.
- [ ] Every analytics-safe line has real `pancakeVariationId` + current central-resolver price.
- [ ] `view_cart` / `begin_checkout` are complete all-or-nothing projections.
- [ ] No local-ID/browser fallback.
- [ ] Event merchandise value equals full emitted line sum.
- [ ] Tracking failure never changes commerce result.

## U18 — mutable DRAFT promotion quote/audit (#151 P8)
- [ ] Preserve purchased `pancakeVariationId`, quantity/name/options.
- [ ] Persist base/final/promotion audit.
- [ ] Raw browser quote facts cannot authorize submit-capable DRAFT.
- [ ] DRAFT mutable/retryable until guarded finalization.
- [ ] No-promo/%/fixed/composite/invalid-base/retry tests.

## U19 — stateless rendered-quote proof (#151 P9a)
- [ ] Stateless standard-library server HMAC/MAC only; no proof DB state.
- [ ] Deterministic canonical payload/version.
- [ ] Raw HttpOnly `la_cart` UUID used only as server-side MAC context; never serialized to browser.
- [ ] `MAX_RENDERED_QUOTE_PROOF_BYTES = 16 KiB`; max+1 rejected before decode/MAC.
- [ ] Constant-time comparison where supported.
- [ ] Missing/malformed/forged/wrong-cart proof fails closed with refreshed quote/proof and zero POS write.
- [ ] Client edits hidden quote to current price cannot bypass reconfirmation.
- [ ] Proof never becomes pricing authority.

## U20 — fresh Pancake reconfirmation (#151 P9b)
- [ ] Fetch fresh trusted Pancake facts.
- [ ] Feed fresh base into central resolver.
- [ ] Compare DRAFT to fresh effective quote, never raw retail.
- [ ] Mismatch refreshes DRAFT + typed `PRICE_CHANGED` atomically.
- [ ] No Pancake create on mismatch.
- [ ] % / fixed / start-end / invalid-recovery drift regressions.

## U21 — final Pancake convergence (#151 P10)
- [ ] Fresh effective quote used for final price-change comparison.
- [ ] Effective/final price used for totals integrity.
- [ ] Outbound `variation_info.retail_price` from finalized immutable order snapshot.
- [ ] Fresh stock/identity checks retained.
- [ ] No blind retry; ambiguous outcome semantics retained.
- [ ] Three independent raw-`livePrice` regressions green.
- [ ] Controlled authorized Pancake non-base price acceptance evidence recorded.
- [ ] Failed/unavailable semantic acceptance keeps discounted activation blocked.

## U22 — confirmed Purchase analytics (#153 T7)
- [ ] Purchase only for `CONFIRMED`.
- [ ] `transactionId/eventId = publicCode`.
- [ ] Items use immutable snapshot `pancakeVariationId`, price and quantity.
- [ ] Catalog enrichment optional/non-authoritative.
- [ ] Repeat success visit keeps same identity.
- [ ] Tracking failure never alters checkout success.
- [ ] Existing direct Meta browser/CAPI regressions green.

### Checkpoint C — transaction truth
- [ ] U16–U22 focused suites green.
- [ ] Two-stage `PRICE_CHANGED` proved.
- [ ] Three Pancake raw-live-price regressions green.
- [ ] Immutable Purchase identity/value green.
- [ ] Activation still off until final launch gate.
- [ ] 0 Critical / 0 Required.

## U23 — Merchant standalone mapper (#153 M3)
- [ ] Audited stable ID/grouping.
- [ ] `brand=LA Clothing`.
- [ ] Audited SKU-as-MPN; no inferred GTIN.
- [ ] Central effective price + trusted image + exact U10 deep link.
- [ ] Required standalone color/size/apparel facts truthful.
- [ ] Structurally valid zero stock => `out_of_stock`.
- [ ] Unsafe/unresolved/composite records excluded with bounded diagnostic.
- [ ] Counts reconcile with U7.

## U24 — Merchant public route/cache + promotion revision (#153 M4 + #151)
- [ ] Public GET route uses standards-aware serialization.
- [ ] Offer/byte/DB-round-trip caps enforced.
- [ ] One fixed success cache domain.
- [ ] 300s normal TTL treated as maximum; known promotion boundary expires sooner.
- [ ] Concurrent cold requests collapsed by proved single-flight.
- [ ] Persistent generation failure protected by fixed-key 60s backoff.
- [ ] Cache entries tagged with durable promotion revision.
- [ ] Cache-hit decision that reads newer revision cannot serve old bytes.
- [ ] In-flight old-revision generation cannot publish as current after revision change.
- [ ] No request-controlled cache dimensions.
- [ ] Malformed external text/URL/XML fails safely; serialized output parses in tests.
- [ ] Multi-replica topology => shared cache/single-flight/backoff prerequisite before activation.

## U25 — variant ProductGroup/Offer structured data (#152 W4d/W5)
- [ ] U10 variant URL/preselection contract is green first.
- [ ] No `AggregateOffer` shortcut for variants.
- [ ] ProductGroup/variant Product+Offer uses verified identifiers only.
- [ ] Variant Offer uses current effective price only when truthfully representable.
- [ ] Variant URL opens matching option/price/availability/purchasability.
- [ ] Unknown identifier semantics fail closed.
- [ ] Base PDP canonical remains correct.
- [ ] Domain + HTTP structured-data parsing/parity tests green.

## U26 — exact GTM saved version + loader/CSP + destinations (#153 T8)
- [ ] Exact GTM container ID + saved version ID recorded.
- [ ] Export exact saved version committed with checksum/Git identity.
- [ ] Every production GA4/Ads/TikTok tag requires `la_tracking_mode == live`.
- [ ] GA4 automatic/history duplicate page views disabled.
- [ ] Google Ads Purchase uses approved value semantics + `publicCode` + linker.
- [ ] TikTok Purchase/CompletePayment uses `event_id=publicCode`.
- [ ] Preview exact saved version; zero traffic to production destinations proved.
- [ ] App loader/CSP opened only after export/version review.
- [ ] Live publishes the same reviewed version.
- [ ] Later console edit requires new version/export/review.

## U27 — PDP metadata cleanup (#152 W2b)
- [ ] U4 collision-safe replacement proven first.
- [ ] Remove technical slug/path copy without losing uniqueness.
- [ ] Metadata/canonical/slug regressions green.

## U28 — search/social fundamentals (#152 P3)
- [ ] W8 root OG/Twitter fallback in focused PR.
- [ ] W10 static self-canonical behavior in focused PR.
- [ ] W14a branded route-level 404 recovery.
- [ ] W14b unknown product slug returns HTML 404 while current slug/historical 301 remain correct.
- [ ] No concern enables indexing on temporary domain.
- [ ] U11 runtime coverage green.

## U29 — significant sitemap `lastModified` (#152 W9)
- [ ] Public significant-change timestamp contract approved.
- [ ] Do not use raw mirror/internal `updatedAt` blindly.
- [ ] `lastModified` changes only for significant public updates.
- [ ] Sitemap domain/runtime tests green.

## U30 — Product/Organization discovery enrichment (#152 P4/W5/W6)
- [ ] Only verified identifier semantics emitted.
- [ ] No fabricated GTIN/contact/address/policy.
- [ ] Merchant + JSON-LD catalog/price/availability identity stay consistent.
- [ ] Split product vs Organization changes if review boundary grows.

## U31 — first-party evergreen content fact inventory (#152 P5/W13A)
- [ ] About facts inventoried.
- [ ] Returns policy facts inventoried.
- [ ] Shipping/Payment facts inventoried.
- [ ] Size Guide facts inventoried.
- [ ] Contact/address facts inventoried.
- [ ] Missing owner facts explicitly marked BLOCKED.
- [ ] Human factual/policy approval recorded before public page implementation.

## U32 — evergreen pages from approved facts (#152 P5/W13)
- [ ] Build only from approved facts.
- [ ] Reuse canonical fact source instead of copy-pasting conflicting policy.
- [ ] Add useful internal links; no thin-page generation at scale.
- [ ] Route metadata/canonical/index behavior correct.
- [ ] Accessibility/browser/runtime search checks green.

## U33 — SEO admin/operational readiness (#152 P6/W16/W17)
- [ ] Implement reviewed admin preview/counter/warning/health capabilities only over protected boundaries.
- [ ] UI does not become policy authority.
- [ ] Authz + bounded-input checks green.

## U34 — permanent-domain verification (#152 P6/W18)
- [ ] Permanent branded domain confirmed.
- [ ] Search Console verification evidence recorded.
- [ ] Bing Webmaster verification evidence recorded.
- [ ] Merchant verification evidence recorded if applicable.
- [ ] Temporary domain remains hard-blocked for indexing.
- [ ] Secrets/verification values handled according to reviewed config ownership.

## U35 — crawler governance matrix (#152 P6/W19)
- [ ] Owner approves allow/deny matrix and rationale.
- [ ] Robots behavior implements reviewed policy.
- [ ] Required Search/Merchant verification paths not accidentally blocked.

## U36 — sitemap scale/URL-volume trigger (#152 P6/W21)
- [ ] Catalog URL volume is measured.
- [ ] Trigger is defined before current hard failure threshold.
- [ ] Sitemap index/sharding implemented only when evidence justifies it.
- [ ] Boundary/runtime tests green when triggered.

## U37 — representative runtime performance verification (#152 P7)
- [ ] Measure `/`, `/shop`, collection and PDP on mobile + desktop.
- [ ] Record runtime baseline LCP/CLS/INP/lab diagnostics using chosen tooling.
- [ ] Distinguish runtime evidence from source-code inference.
- [ ] Prefer measurement after promotion/discovery and GTM changes are present.
- [ ] Create blocking budgets/optimization tasks only from defensible baseline evidence.
- [ ] Performance fixes retain correctness tests and include comparable before/after measurement.

# Separate launch gates

## Gate P — Promotion activation
- [ ] U3/U5/U8/U9/U13–U21 accepted.
- [ ] Price/catalog evidence accepted.
- [ ] Controlled Pancake custom-price semantic acceptance succeeds.
- [ ] Storefront/cart/checkout/Pancake monetary convergence accepted.
- [ ] Existing direct Meta money/value promotion-aware where applicable.
- [ ] Any **currently enabled** GTM/Merchant monetary consumer is promotion-aware; disabled/fail-closed consumers do not block.
- [ ] Rollback + observability + final DoD accepted.
- [ ] Human explicitly enables activation gate.

## Gate T — GTM live
- [ ] U2/U16/U17/U22/U26 accepted.
- [ ] Exact immutable GTM version/export/checksum reviewed.
- [ ] Preview/test sends zero production destination traffic.
- [ ] Duplicate GA4 page-view paths disabled.
- [ ] Ads/TikTok Purchase identity uses `publicCode`.
- [ ] Live publishes same reviewed saved version.
- [ ] Human approves destination IDs/value semantics.

## Gate M — Merchant activation
- [ ] U7 identity/MPN/durability evidence accepted.
- [ ] U10 exact standalone variant URL accepted.
- [ ] U23 mapper accepted.
- [ ] U24 route/cache/backoff/revision accepted.
- [ ] Promotion-aware price integrated if promotions are supported/enabled.
- [ ] Composite remains excluded/fail-closed.
- [ ] Runtime topology satisfies cache/single-flight/backoff proof.
- [ ] Merchant account/market/apparel/owner gates satisfied.

## Gate S — Organic indexing
- [ ] U1 hard block exists for temporary domain.
- [ ] Permanent branded domain confirmed.
- [ ] #152 Required index-launch gates complete for current scope.
- [ ] U11 regression coverage accepted.
- [ ] Metadata/variant/structured-data correctness accepted where applicable.
- [ ] Permanent-domain verification/operational readiness accepted.
- [ ] Human explicitly approves `SEARCH_INDEXING_ENABLED=true` on permanent domain.
- [ ] Promotion/GTM/Merchant activation has not been treated as implicit index approval.

# Major checkpoint commands

Run when applicable to the changed scope; do not claim execution unless actually run:

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
- [ ] Browser/runtime/a11y/SEO smoke verification performed for affected public routes.
- [ ] Production/external semantic acceptance performed only with approved credentials/context.

# Final program Definition of Done

- [ ] All implemented source-task acceptance criteria met.
- [ ] No duplicate pricing/business logic without reviewed reason.
- [ ] No duplicate cart/identity/variant-URL/Purchase/Merchant-cache authority.
- [ ] Focused regressions would fail without the change.
- [ ] Existing relevant suites green.
- [ ] Lint/typecheck/build green.
- [ ] Applicable DB migration/runtime/browser/a11y verification green.
- [ ] Security review complete for authz, untrusted browser/external input, quote proof, public Merchant route, serialization, GTM/CSP/secrets and PII.
- [ ] Migrations/backward compatibility/rollback reviewed.
- [ ] Observability covers new critical failure modes without secrets/PII.
- [ ] Docs describe current truth.
- [ ] No unrelated refactor/dead code/debug output.
- [ ] Launch gates remain independent and have explicit owners/rollback triggers.
- [ ] Human final review: **0 Critical / 0 Required**.
