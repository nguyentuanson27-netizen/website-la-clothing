# Promotions & Flash Sale v1 — implementation plan

Status: **PLANNING ONLY — implementation has not started.**

Source of truth: `docs/specs/promotions-flash-sale-v1.md`.

Planning review base: `main@31f88b3cc1517a8c2123f41924e3d5e65361d6df` and PR #151 spec head `e2b7eed57311d7c0aa8ce02f11a0b5a485bf8704` before this plan commit.

This plan follows the project lifecycle and `planning-and-task-breakdown` contract: dependency-first, tests with the behavior they prove, verification checkpoints every few tasks, no implementation mixed into the planning PR, and implementation slices kept reviewable rather than forcing the entire feature into one code PR.

## Self-review gate before planning

Fresh review order: correctness → security → architecture → simplicity → performance.

Verdict before writing this plan: **0 Critical, 2 Required planning clarifications, 0 unresolved security blockers.** The two clarifications below are consequences of the already-approved pricing/target contracts; they do not reopen product scope.

### R1 — Storefront discovery must use effective price

Current `/shop` discovery has `minPriceVnd`, `maxPriceVnd`, `price-asc`, and `price-desc`, and the current SQL CTE filters/sorts on the old `resolvedPrice` before pagination. Promotion implementation must not render a sale price on the card while filtering/sorting the same product by raw/base price.

Plan lock:
- price filter/sort uses the **current authoritative effective price** of eligible variants;
- existing color/size/availability predicates continue to constrain the same candidate-variant set used for price filtering/sorting;
- runtime overlap/invalid promotion falls back exactly as the central resolver does;
- this path requires one sanctioned SQL projection because filtering/sorting must remain bounded before pagination; it therefore receives mandatory parity tests against the TypeScript pricing authority.

### R2 — Composite component pricing follows the real variant owner

Current parent PDP projection can render a component `VariantMirror` whose `productId` belongs to another `ProductMirror`.

Plan lock:
- pricing/campaign lookup follows the **actual selected `VariantMirror.id` and its owning `productId`**;
- a `PRODUCT` campaign on the display parent covers only variants actually owned by that ProductMirror;
- a separately owned composite component is discounted only by a campaign targeting that component variant or its owning child product;
- rendering a child/component option inside the parent PDP does not silently rewrite promotion ownership;
- the same selected variant therefore gets the same effective price in parent PDP → cart → checkout → order snapshot.

## High-level dependency graph

```text
P0 planning closeout
  ↓
P1 persistence + migration
  ↓
P2 pricing domain + price-readiness audit
  ↓
P3 campaign repository + lifecycle/runtime health
  ↓
P4 publish/overlap concurrency + admin mutation boundary
  ↓
Checkpoint A
  ├──────────────→ P5 admin UX + product-admin linkage
  └──────────────→ P6 storefront/PDP quote projection
                       ↓
                    P7 discovery + cards + /flash-sale + boundary refresh
                       ↓
                    Checkpoint B
                       ↓
                    P8 cart + mutable DRAFT pricing/audit snapshot
                       ↓
                    P9 checkout PRICE_CHANGED reconfirmation
                       ↓
                    P10 Pancake submission convergence + semantic acceptance
                       ↓
                    P11 analytics/SEO + final convergence/rollout
```

Implementation branches must start from the then-current `main` after PR #151 is reviewed/merged. Do not start production code from the mutable planning branch.

## Architecture decisions locked by this plan

### A. Persistence shape

Prefer the minimum explicit website-owned model:

- `PromotionCampaign`
  - `id`
  - `name`
  - `kind: PROMOTION | FLASH_SALE`
  - `discountType: PERCENTAGE | FIXED_PRICE`
  - `discountPercent Int?`
  - `fixedPriceVnd BigInt?`
  - `publishState: DRAFT | ENABLED | DISABLED`
  - `enabledAt DateTime?`
  - `disabledAt DateTime?`
  - `startsAt DateTime?`
  - `endsAt DateTime?`
  - timestamps
- `PromotionTarget`
  - `id`
  - `campaignId`
  - `targetType: PRODUCT | VARIANT`
  - `productId String?`
  - `variantId String?`
  - timestamps only if implementation needs them for audit; do not add them mechanically
- `OrderLineSnapshot` additive audit fields from the spec.

Do **not** add a materialized product→variant promotion membership table in v1. Product targets are semantic/dynamic and are expanded against current `VariantMirror.productId` facts.

Migration SQL must add check/unique constraints that Prisma alone cannot express safely:
- target row matches target type and populates exactly one FK;
- percentage/fixed columns have a mutually valid shape for the campaign discount type where DB-level enforcement is practical;
- duplicate target identity within one campaign is impossible;
- product target + separately targeted child variant of the same product is rejected server-side transactionally because that cross-row invariant is not a simple row CHECK.

No campaign delete action in v1. Historical campaigns remain available for order audit/reference.

### B. Lifecycle derivation without traffic-dependent writes

Persist publication intent/history, derive user-visible time status.

For each ENABLED interval define the actual effective start as:

```text
effectiveStart = max(enabledAt, startsAt ?? enabledAt)
```

This prevents a campaign enabled after its configured start from pretending it was active before publication.

Derived status:
- `DRAFT` publishState → Draft;
- `DISABLED` publishState → Disabled;
- `ENABLED` and `now < effectiveStart` → Scheduled;
- `ENABLED` and `effectiveStart <= now < endsAt` (or no end) → Active;
- `ENABLED` and `endsAt <= now`, after a non-empty enabled active interval → Ended.

A fully expired interval must not be newly enabled: publish/re-enable validation requires an effective interval that can still become Active (`endsAt === null || endsAt > effectiveStart`).

For a disabled campaign, “ever Active” is derived from durable enable/disable/time facts; it is never written only because a request happened to observe Active state. If `disabledAt <= effectiveStart`, it never became Active and may be edited/re-enabled. If it had a non-empty active interval before disable, it is terminal.

Exact helper names are implementation choices, but status and terminality tests must use explicit `now`.

### C. Central pricing authority

Create a pure TypeScript pricing function, conceptually:

```ts
type EffectivePriceQuote = {
  basePriceVnd: number;
  effectivePriceVnd: number;
  isDiscounted: boolean;
  promotion: PromotionSnapshot | null;
  reason: null | "BASE_PRICE_UNAVAILABLE" | "PROMOTION_INVALID" | "PROMOTION_CONFLICT";
  nextTransitionAt: Date | null;
};
```

Rules:
- validate external Float mirror/live price at the boundary (`safe integer && > 0`);
- integer-safe percentage rounding;
- fixed final price validation;
- one promotion candidate only;
- >1 effective candidates means conflict and **no website promotion**;
- invalid promotion means base-price fallback when base is usable;
- unusable base means not purchasable;
- explicit `now` everywhere.

`nextTransitionAt` is the earliest known campaign start/end that could change the variant quote. It supports boundary-aware refresh without making the client clock pricing authority.

### D. Active campaign batch lookup

Repository lookup is batch-oriented by requested variant IDs. For each real variant it resolves:
- direct `VARIANT` targets;
- `PRODUCT` targets on the variant's owning `productId`;
- enabled campaigns relevant at `now` plus the nearest future transition needed for refresh;
- enough campaign metadata for pricing/audit.

The lookup returns candidate facts; the TypeScript resolver decides valid/invalid/conflict pricing. Do not hide conflicts by arbitrary `first()` ordering.

### E. Publish/update concurrency strategy

Use a PostgreSQL transaction and existing-row locks rather than introducing a new dependency or a global application mutex.

Before publish/re-enable/Scheduled mutation:
1. canonicalize targets;
2. resolve all involved owning ProductMirror IDs;
3. lock those product rows in deterministic ID order with `FOR UPDATE`;
4. lock explicitly targeted/current product variants in deterministic ID order where needed for a stable activation validation read;
5. re-read current target/base-price facts while locks are held;
6. evaluate duplicate coverage, price validity, time validity, and overlapping enabled campaign intervals;
7. commit all campaign/target changes atomically or write nothing.

Locking owning products for **all** target types intentionally serializes two admin writes touching different variants of the same product. Admin publication is low-frequency, and this simpler lock scope guarantees PRODUCT↔VARIANT races serialize without advisory-lock hash complexity.

Catalog sync is not required to take these admin locks. If catalog mutation introduces a new conflict/invalid variant after commit, runtime resolver health fails closed per spec.

### F. Sanctioned SQL projection for discovery only

The plan demonstrates a real need for one SQL-side projection: current `/shop` price filtering/sorting occurs before pagination. Fetching every candidate variant into TypeScript first would violate bounded-query requirements.

Therefore `storefront-catalog.ts` may replace/extend the current `variant_stock` CTE with a sanctioned current-effective-price projection that:
- enforces the same usable integer-VND base predicate;
- matches direct variant and owning-product campaign targets;
- applies time interval `[start,end)` using server-supplied `now`;
- applies percentage/fixed rules with PostgreSQL integer/numeric operations that are parity-tested against the TS resolver;
- counts applicable promotion candidates and falls back to base when conflict/invalid;
- exposes current effective price for `minPrice`, `maxPrice`, `price-asc`, `price-desc`;
- preserves existing color/size/availability filtering semantics.

This SQL is a projection, not a second business authority. If parity cannot be demonstrated, stop and revise the query approach before shipping.

### G. Boundary refresh strategy

Current `/shop` and PDP explicitly call Next.js `connection()`, so each server request already reads dynamic data. Do not add a new persistent promotion cache in v1.

For an already-open page, add one small client boundary refresher fed only by server-computed `nextTransitionAt`. At the boundary it calls App Router `router.refresh()` so Server Components are re-fetched. `router.refresh()` behavior was checked against the current Next.js App Router documentation for the repository's Next 16.2 line.

Rules:
- server-provided transition time controls scheduling;
- client countdown/refresher never computes sale eligibility itself;
- if a timer cannot safely span an extreme future timestamp, reschedule locally in bounded chunks without changing price state;
- Flash Sale countdown may share the same boundary event but remains presentation-only;
- admin campaign mutations continue to call `revalidatePath` for affected admin/storefront route families where useful.

### H. Checkout repricing handshake

Keep `OrderMirror(DRAFT)` as the mutable checkout attempt.

Initial snapshot:
- resolves current mirror-based effective quote;
- stores base/final/promotion audit facts on each DRAFT line;
- computes subtotal/shipping/total from final line prices.

Fresh Pancake validation during submission:
- recomputes effective quote from fresh trusted Pancake base facts + current website campaigns;
- if unchanged, continue final validation;
- if changed, atomically refresh that attempt's DRAFT line/audit/totals from the fresh quote, return typed `PRICE_CHANGED` + refreshed totals, and **do not** enter `POS_SUBMITTING`;
- buyer must submit again; second submit may proceed only if fresh recomputation still matches the refreshed DRAFT;
- if price changes again, refresh again and require another confirmation.

This keeps the freshest quote durable without requiring checkout-time catalog responses to mutate the Pancake mirror and avoids an infinite stale-mirror loop.

Final pricing becomes immutable when leaving DRAFT for successful final validation/submission.

## P0 — Planning closeout and implementation split checkpoint

**Description:** Land the reviewed spec + plan only. Treat the two self-review clarifications above as implementation constraints and keep production work out of PR #151.

**Acceptance criteria:**
- [ ] PR #151 contains docs/tasks only;
- [ ] spec remains the product source of truth;
- [ ] plan and todo reference the current repo architecture, not guessed greenfield modules;
- [ ] R1 discovery effective-price semantics are covered by the implementation plan/tests;
- [ ] R2 composite real-owner semantics are covered by the implementation plan/tests;
- [ ] human approves PR #151 before implementation branches start;
- [ ] implementation branches start from then-current `main`.

**Verification:**
- [ ] compare PR #151 against `main` and confirm no production/test/migration file changes;
- [ ] final planning review: correctness → security → architecture → simplicity → performance;
- [ ] record exact PR head and CI state in PR body.

**Dependencies:** none.

**Files likely touched:**
- `docs/specs/promotions-flash-sale-v1.md` only if a later review finds a true product-contract correction;
- `tasks/promotions-flash-sale-v1-plan.md`;
- `tasks/promotions-flash-sale-v1-todo.md`.

**Estimated scope:** Small, docs only.

---

## P1 — Add additive promotion persistence and immutable order-audit columns

**Implementation PR suggestion:** `promo-A1-persistence`, target ≤5 files.

**Description:** Add the smallest Prisma/PostgreSQL persistence needed for campaign/target lifecycle and mutable-DRAFT/final-order promotion audit. No pricing behavior yet.

**Acceptance criteria:**
- [ ] additive campaign/target models and enums exist;
- [ ] `fixedPriceVnd` and website-owned monetary audit values use BigInt/integer VND;
- [ ] mirrored Pancake price fields remain `Float?`;
- [ ] target row shape is DB-guarded;
- [ ] duplicate identical targets are impossible;
- [ ] OrderLineSnapshot gains nullable additive base/promotion snapshot columns compatible with historical rows;
- [ ] no existing order money is rewritten;
- [ ] no campaign delete endpoint is introduced.

**Verification:**
- [ ] first migration/schema tests fail before migration and pass after;
- [ ] `pnpm prisma:validate`;
- [ ] `pnpm prisma:generate`;
- [ ] `pnpm prisma:migrate:deploy` against clean/test DB;
- [ ] DB test creates old-style non-promotion order line and promotion-aware new line;
- [ ] migration rollback review confirms old application can ignore additive tables/columns.

**Dependencies:** P0 approved/merged.

**Files likely touched:**
- `prisma/schema.prisma`;
- `prisma/migrations/<timestamp>_promotions_flash_sale_v1/migration.sql`;
- `tests/database/schema-smoke.test.ts`;
- `tests/database/website-owned-persistence.test.ts` or one focused new promotion schema test.

**Estimated scope:** Medium, 4 files plus migration directory.

---

## P2 — Build pure promotion/effective-price domain and readiness audit

**Implementation PR suggestion:** `promo-A2-pricing-domain`.

**Description:** Establish the one semantic pricing authority before any admin/storefront integration.

**Acceptance criteria:**
- [ ] typed campaign/target/lifecycle/validation domain exists;
- [ ] central pure resolver accepts explicit `now`, base price, candidate campaigns;
- [ ] usable base = positive safe integer VND;
- [ ] percentage `1..99` and rounding parity with `Math.round` for positive VND;
- [ ] fixed price is final price and validates `0 < fixed < base`;
- [ ] conflict returns base-price fallback + conflict fact, not arbitrary winner;
- [ ] invalid campaign on one variant falls back only that variant;
- [ ] quote includes immutable promotion snapshot facts and `nextTransitionAt`;
- [ ] read-only current mirror price-readiness diagnostic reports incompatible price categories without leaking unrelated catalog data.

**Verification:**
- [ ] RED/GREEN domain table tests for all pricing/time boundaries in spec;
- [ ] explicit `base=50`, `1%` rounds to base and becomes invalid only for that variant;
- [ ] fixed-price drift/recovery test;
- [ ] multiple candidate conflict test;
- [ ] null/zero/fractional/NaN/infinite/unsafe base tests;
- [ ] price-readiness diagnostic test uses fixtures and remains read-only.

**Dependencies:** P1.

**Files likely touched:**
- `src/commerce/promotion.ts`;
- `src/commerce/effective-price.ts`;
- `tests/domain/promotion.test.ts`;
- `tests/domain/effective-price.test.ts`;
- `scripts/promotion-price-readiness.ts` or an equivalent narrowly named read-only diagnostic.

If adding a package script would make this >5 files, add it in P11 rather than expanding P2.

**Estimated scope:** Medium, 5 files.

---

## P3 — Add batch campaign repository, lifecycle derivation, target health

**Implementation PR suggestion:** `promo-B1-repository`.

**Description:** Persist/read campaigns and resolve dynamic target coverage without publication concurrency yet.

**Acceptance criteria:**
- [ ] CRUD supports Draft, Scheduled-read, Active-read, Ended-read, Disabled-read and Copy → Draft;
- [ ] user-visible status/terminality is deterministic with explicit `now` and zero traffic;
- [ ] PRODUCT target expands current variants dynamically;
- [ ] new/restored variants are included without rewriting target rows;
- [ ] batch variant lookup returns direct + owning-product candidates without N+1;
- [ ] runtime invalid target health is affected-variant granular and can be `PARTIALLY_INVALID`;
- [ ] runtime overlap candidate count is surfaced as conflict/no promotion;
- [ ] copy resets publication/history identity but preserves approved configuration;
- [ ] no browser/admin input reaches repository without domain parsing in later admin layer.

**Verification:**
- [ ] DB tests for status around `[start,end)`;
- [ ] zero-traffic Scheduled → Ended derivation;
- [ ] Disabled-before-Active vs Disabled-after-Active;
- [ ] copy semantics;
- [ ] product target picks up a newly inserted/restored variant;
- [ ] product partial invalidity leaves valid sibling candidate facts intact;
- [ ] batched candidate lookup query count is bounded for many variants.

**Dependencies:** P2.

**Files likely touched:**
- `src/commerce/promotion-repository.ts`;
- `src/commerce/promotion.ts`;
- `tests/database/promotion-repository.test.ts`;
- `tests/domain/promotion.test.ts`.

**Estimated scope:** Medium, 4 files.

---

## P4 — Add race-safe publish/Scheduled-edit boundary and admin service

**Implementation PR suggestion:** `promo-B2-admin-domain`.

**Description:** Implement privileged campaign mutations, full activation validation, deterministic row locking, and typed admin errors. This is the first task that can move a campaign into enabled pricing state.

**Acceptance criteria:**
- [ ] existing ADMIN authorization boundary is required server-side;
- [ ] ids/names/target arrays/enums/money/time fields have explicit finite bounds;
- [ ] Draft save may persist invalid config without storefront effect;
- [ ] publish/re-enable validates all current affected variants atomically;
- [ ] Scheduled edit validates atomically and leaves old effective config unchanged on failure;
- [ ] Active pricing/targets/time mutation is rejected;
- [ ] Disabled-before-Active may edit/re-enable; terminal Disabled/Ended cannot;
- [ ] duplicate PRODUCT + covered VARIANT in one campaign is rejected;
- [ ] PRODUCT↔VARIANT, PRODUCT↔PRODUCT, VARIANT↔VARIANT overlap is rejected using `[start,end)`;
- [ ] two concurrent conflicting publishes cannot both commit;
- [ ] runtime catalog mutation remains handled by P3 resolver rather than sync-side auto-disable.

**Verification:**
- [ ] first RED concurrent publish test demonstrates the race before locking logic;
- [ ] DB concurrency test proves at most one conflicting publish succeeds;
- [ ] same-product disjoint variants may serialize but both succeed when not semantically overlapping;
- [ ] exact-boundary A.end == B.start succeeds;
- [ ] forged/stale target IDs fail closed;
- [ ] authorization/malformed/oversized input domain tests;
- [ ] transaction failure leaves no partially enabled targets.

**Dependencies:** P3.

**Files likely touched:**
- `src/commerce/promotion-admin.ts`;
- `src/commerce/promotion-repository.ts`;
- `tests/domain/promotion-admin.test.ts`;
- `tests/database/promotion-concurrency.test.ts`.

**Estimated scope:** Medium, 4 files.

---

## Checkpoint A — Domain/persistence quality gate

Before UI/storefront work:
- [ ] P1–P4 focused tests green;
- [ ] migration applies cleanly;
- [ ] concurrency test green repeatedly;
- [ ] pricing resolver has no UI/framework dependencies;
- [ ] repository batch lookup is bounded;
- [ ] review P1–P4 for 0 Critical / 0 Required findings;
- [ ] do not proceed if lifecycle or overlap semantics still require interpretation.

---

## P5 — Build `/admin/promotions` management UX and product-admin linkage

**Implementation PR suggestion:** split `promo-C1-admin-campaigns` and `promo-C2-product-linkage` if the first slice would exceed 5 files.

**Description:** Expose the approved admin workflow on top of P4 without moving business logic into React/server actions.

**Acceptance criteria:**
- [ ] `/admin/promotions` is protected by current admin layout/auth boundary;
- [ ] list shows name, kind, discount, time, target count, derived status, health;
- [ ] create/edit form supports multi PRODUCT/VARIANT targeting with bounded search/selection;
- [ ] lifecycle-allowed actions only: save Draft/Scheduled, publish/re-enable, disable/end early, copy;
- [ ] terminal campaigns are read-only except Copy;
- [ ] validation errors identify product/variant and typed reason;
- [ ] admin mutation action calls P4 and revalidates affected admin/storefront paths;
- [ ] product admin page shows current/upcoming related campaign summary + link, not a duplicate editor;
- [ ] no price, target or auth fact supplied by browser is trusted.

**Verification:**
- [ ] domain/server-action tests for action→service mapping;
- [ ] admin Playwright: create Draft → publish Scheduled/Active → disable/copy path;
- [ ] invalid fixed/overlap target error is visible and accessible;
- [ ] keyboard operation, Axe, mobile/no horizontal overflow;
- [ ] forged non-admin mutation rejected by HTTP/authz smoke or focused browser/server test.

**Dependencies:** Checkpoint A.

**Files likely touched, campaign slice:**
- `src/app/admin/promotions/page.tsx`;
- `src/app/admin/promotions/[promotionId]/page.tsx`;
- `src/app/admin/promotions/actions.ts`;
- `src/components/admin/promotion-form.tsx`;
- `tests/a11y-runtime/admin-promotions.spec.ts`.

**Files likely touched, product-linkage slice:**
- `src/app/admin/products/[productId]/page.tsx`;
- `src/components/admin/product-commerce-panel.tsx` if that remains the correct ownership surface;
- `src/commerce/promotion-repository.ts` for a bounded related-campaign read;
- focused existing admin browser/database test.

**Estimated scope:** Medium + Small, pre-split before implementation if >5 files.

---

## P6 — Integrate effective quotes into PDP/variant projection, including composites

**Implementation PR suggestion:** `promo-D1-storefront-projection`.

**Description:** Replace the old equality-gated price with central effective quotes in product detail and selection, while preserving option-mapping/stock/composite behavior.

**Acceptance criteria:**
- [ ] `pancakeRetailPriceAfterDiscount` mismatch no longer causes price unresolved by itself;
- [ ] unusable base maps to non-purchasable `BASE_PRICE_UNAVAILABLE`/appropriate storefront reason;
- [ ] standalone selected variant shows exact base/effective price and promotion metadata;
- [ ] changing selection updates price/badge/countdown metadata;
- [ ] selected variant without promotion shows base/no sale UI;
- [ ] composite selected component resolves campaign by **its own variant ID/owning product ID**;
- [ ] parent PRODUCT promotion does not bleed onto separately owned child component;
- [ ] same child component effective price is identical when reconstructed later by cart/checkout;
- [ ] no per-option promotion DB query.

**Verification:**
- [ ] RED/GREEN storefront product/projection tests for regular/fixed/flash and invalidity;
- [ ] composite ownership regression: parent campaign vs child-target campaign;
- [ ] selected variant countdown metadata uses server campaign end;
- [ ] current composite availability/mapping regressions remain green.

**Dependencies:** Checkpoint A.

**Files likely touched:**
- `src/commerce/storefront-product.ts`;
- `src/commerce/storefront-product-detail.ts`;
- `src/commerce/storefront-projection.ts`;
- `src/components/commerce/product-purchase-panel.tsx`;
- focused `tests/domain/storefront-projection.test.ts` / existing composite DB test (choose one test file to stay ≤5).

**Estimated scope:** Medium, 5 files.

---

## P7 — Make cards/discovery/Flash Sale effective-price aware and boundary-refreshable

**Implementation PR suggestion:** pre-split `promo-D2-discovery` and `promo-D3-flash-refresh` if >5 files.

**Description:** Converge listing/card behavior, implement R1 effective-price discovery semantics, add `/flash-sale`, and keep already-open storefronts fresh at campaign boundaries.

### P7a discovery/card projection

**Acceptance criteria:**
- [ ] card representative sale variant follows spec, including same-variant struck base price;
- [ ] cheaper unpromoted variant uses non-misleading `Sale từ` wording;
- [ ] normal `/shop` min/max and price sort use current effective price for the same eligible candidate set;
- [ ] one sanctioned SQL projection is parity-tested against TS resolver;
- [ ] safe-integer base predicate replaces the current looser/equality SQL predicate;
- [ ] conflict/invalid promotion falls back exactly like central resolver;
- [ ] pagination/count stay bounded and stable.

**Verification:**
- [ ] DB table tests compare SQL projected price with TS resolver across no-promo, %, fixed, invalid, conflict, boundaries;
- [ ] discovery max/min includes/excludes a product by sale price rather than raw base;
- [ ] price ascending/descending order uses sale price;
- [ ] color/size filter + promotion price filter combination behaves deterministically;
- [ ] query count remains bounded.

**Files likely touched:**
- `src/commerce/storefront-catalog.ts`;
- `src/commerce/storefront-catalog-runtime.ts`;
- `src/components/commerce/storefront-product-card.tsx`;
- `tests/database/storefront-catalog.test.ts`;
- `tests/domain/storefront-product.test.ts` if needed.

### P7b `/flash-sale` + boundary refresh

**Acceptance criteria:**
- [ ] `/flash-sale` is paginated/bounded and includes only active valid Flash Sale variants/products;
- [ ] representative selection on this route considers Flash Sale variants only;
- [ ] server projection returns earliest relevant `nextTransitionAt` for shown products;
- [ ] a client boundary refresher invokes `router.refresh()` at the server-provided transition;
- [ ] Flash Sale countdown hits expiry without continuing to present stale transaction authority;
- [ ] current `/shop`/PDP dynamic `connection()` behavior is preserved; no new persistent price cache.

**Verification:**
- [ ] browser start/end boundary test with controlled clock/fixture where practical;
- [ ] active→ended route refresh removes Flash Sale badge/price;
- [ ] scheduled→active refresh introduces sale state;
- [ ] no 60s-or-longer stale promotional display path remains;
- [ ] `/flash-sale` membership excludes regular/invalid/conflicted variants.

**Files likely touched:**
- `src/app/flash-sale/page.tsx`;
- `src/components/commerce/promotion-boundary-refresh.tsx`;
- `src/app/shop/page.tsx`;
- `src/app/shop/[slug]/page.tsx`;
- `tests/a11y-runtime/storefront-commerce.spec.ts` or a focused flash-sale spec.

**Dependencies:** P6 for shared storefront quote shape; P3/P4 for repository behavior.

**Estimated scope:** two Medium slices if necessary.

---

## Checkpoint B — Storefront convergence gate

Before cart/checkout money mutation:
- [ ] PDP/card/discovery prices agree for the same variant/time;
- [ ] composite ownership regression green;
- [ ] SQL↔TS pricing parity green;
- [ ] `/flash-sale` active membership/boundary refresh green;
- [ ] no N+1 introduced;
- [ ] 0 Critical / 0 Required review findings on storefront slices.

---

## P8 — Make cart and DRAFT checkout snapshot promotion-aware

**Implementation PR suggestion:** `promo-E1-cart-snapshot`.

**Description:** Reconstruct authoritative current cart prices and persist mutable DRAFT audit facts using the central quote before fresh Pancake validation.

**Acceptance criteria:**
- [ ] cart price is current effective quote, never locked old sale price;
- [ ] cart reconstructs by real variant/owning product, preserving composite R2 semantics;
- [ ] unavailable base blocks purchase; invalid promotion falls back to usable base;
- [ ] initial DRAFT snapshot stores `baseUnitPriceVnd`, final `unitPriceVnd`, line total, campaign ID/name/kind/type/value;
- [ ] shipping subtotal uses effective final line prices;
- [ ] existing historical non-promotion orders remain readable;
- [ ] no browser price metadata is used as authority.

**Verification:**
- [ ] cart promo starts/ends and line reprices accordingly;
- [ ] component variant cart price equals PDP selected quote;
- [ ] checkout snapshot regular/flash/no-promo audit assertions;
- [ ] fixed/% partial invalid variant falls back to base;
- [ ] money overflow/unsupported base remains fail closed.

**Dependencies:** Checkpoint B, P1 audit columns.

**Files likely touched:**
- `src/commerce/storefront-cart.ts`;
- `src/commerce/storefront-cart-repository.ts`;
- `src/commerce/guest-checkout-snapshot.ts`;
- `tests/domain/storefront-cart.test.ts`;
- focused existing guest checkout snapshot DB test.

**Estimated scope:** Medium, 5 files.

---

## P9 — Implement typed `PRICE_CHANGED` DRAFT refresh + explicit buyer reconfirmation

**Implementation PR suggestion:** `promo-E2-price-reconfirm`.

**Description:** Make the existing checkout state machine support repeated fresh-price confirmation without creating a stale POS request or an infinite mirror/live-price loop.

**Chosen flow:** when fresh Pancake pricing changes the effective quote, refresh the same attempt back to mutable `DRAFT` with new authoritative line/audit/totals and a typed price-change marker; return refreshed totals to browser; require another submit.

**Acceptance criteria:**
- [ ] fresh quote mismatch never enters `POS_SUBMITTING`;
- [ ] stale DRAFT is atomically refreshed from fresh effective quotes, not raw base retail;
- [ ] browser result contains explicit `PRICE_CHANGED` and refreshed totals/lines needed for review;
- [ ] UI distinguishes price change from stock/cart unavailable;
- [ ] buyer must click submit again after refreshed totals render;
- [ ] second submit proceeds when quote is unchanged;
- [ ] repeated price drift causes another refresh/reconfirmation, not stale submission;
- [ ] two concurrent submit calls cannot both progress the same order beyond guarded state transitions;
- [ ] finalized price remains immutable after successful transition out of DRAFT.

**Verification:**
- [ ] domain state-machine test: 400k seen → promo ends → 500k refreshed → no Pancake write → second confirm succeeds;
- [ ] no infinite `PRICE_CHANGED` loop with stale mirror;
- [ ] feedback/UI displays refreshed total and permits explicit resubmit;
- [ ] concurrent submit test remains one-shot safe;
- [ ] existing SYNC_UNKNOWN/PROCESSING behavior is unchanged.

**Dependencies:** P8.

**Files likely touched:**
- `src/commerce/pancake-order-submit.ts` for guarded fresh validation/reprice result;
- `src/commerce/guest-checkout-submit.ts`;
- `src/commerce/checkout-submit-feedback.ts`;
- `src/components/commerce/guest-checkout-form.tsx`;
- focused checkout domain/browser test (split browser proof to P11 if needed to stay ≤5).

**Estimated scope:** Medium/High; split before implementation if test ownership pushes beyond 5 files.

---

## P10 — Close Pancake money-correctness assumptions and run semantic acceptance gate

**Implementation PR suggestion:** `promo-F-pancake-submit`.

**Description:** After P9 establishes price-confirmation semantics, make final POS request consume immutable final snapshot values and independently prove all three current raw-live-price assumptions are gone.

**Acceptance criteria:**
- [ ] fresh Pancake catalog still validates identity/stock and provides base facts to central resolver;
- [ ] `PRICE_CHANGED` comparison uses fresh **effective** quote;
- [ ] subtotal/shipping/total integrity is computed/validated from final effective snapshot values;
- [ ] request line `unitPriceVnd` comes from finalized `OrderLineSnapshot.unitPriceVnd` after safe conversion;
- [ ] `buildPancakeCreateOrderRequest` receives that value and maps it to `variation_info.retail_price`;
- [ ] no promoted order is rejected merely because final price differs from raw base;
- [ ] no blind retry behavior is introduced;
- [ ] ambiguous create outcome remains `SYNC_UNKNOWN` under existing one-shot rules.

**Verification:**
- [ ] three independent regression tests correspond to comparison / totals / request mapping;
- [ ] example base 500000 + fixed 100000 produces local snapshot 100000 and request `retail_price=100000`;
- [ ] fresh base drift causing new % quote returns price change before create;
- [ ] stock/variation failures remain fail closed;
- [ ] existing Pancake create-order integration contract tests green.

### Controlled semantic acceptance

Before production readiness is declared, on an explicitly authorized Pancake testable context:
1. use a known test/safe shop + variation;
2. capture catalog base price without exposing credentials/private payloads;
3. submit one deliberately different allowed website line price through the reviewed create-order path;
4. verify Pancake accepts and preserves the requested line price rather than silently replacing/rejecting it;
5. clean up/cancel the test order if the authorized environment permits;
6. record sanitized evidence in the implementation PR/release record;
7. never run this write probe automatically in recurring CI.

If the semantic check fails or cannot be run, promotion code may merge only under an explicit non-production-ready decision; real discounted campaign activation must remain operationally blocked.

**Dependencies:** P9.

**Files likely touched:**
- `src/commerce/pancake-order-submit.ts`;
- `src/integrations/pancake/order-create.ts` only if mapper type/guard needs adjustment;
- `tests/database/pancake-order-submit.test.ts`;
- `tests/integrations/pancake-order-create.test.ts`;
- optional guarded acceptance script only if the authorized environment requires a reusable checked-in harness.

**Estimated scope:** Medium, 4–5 files.

---

## P11 — Converge analytics/SEO, observability, readiness audit, browser proof, and final DoD

**Implementation PR suggestion:** `promo-G-convergence` after prior slices are reviewed.

**Description:** Close remaining read/reporting surfaces and produce Definition-of-Done evidence without hiding production defects in a giant final refactor.

**Acceptance criteria:**
- [ ] structured Product/Offer price uses current effective customer price under existing indexing policy;
- [ ] ViewContent/AddToCart/InitiateCheckout values use current effective price;
- [ ] Purchase reporting uses immutable final order snapshot;
- [ ] promotion audit does not mutate historical order reporting;
- [ ] structured non-PII events cover activation rejection, partial invalidation/recovery, runtime conflict/recovery, checkout price change, Pancake validation rejection;
- [ ] price-readiness audit is runnable/documented for rollout;
- [ ] admin/storefront/checkout mobile + keyboard + Axe paths cover new UI;
- [ ] rollback steps from spec are executable and do not require destructive migration;
- [ ] no campaign is enabled in production until price-data audit and Pancake semantic gate are accepted.

**Verification:**
- [ ] `pnpm prisma:validate`;
- [ ] `pnpm prisma:generate`;
- [ ] `pnpm prisma:migrate:deploy`;
- [ ] `pnpm test:db`;
- [ ] cart Server Action HTTP smoke;
- [ ] guest checkout Server Action HTTP smoke;
- [ ] admin authz HTTP smoke;
- [ ] `pnpm lint`;
- [ ] `pnpm typecheck`;
- [ ] `pnpm test`;
- [ ] `pnpm build`;
- [ ] `pnpm release:check`;
- [ ] isolated Playwright/Axe runtime;
- [ ] CI / Catalog indexation runtime / P18 final QA runtime green on exact implementation head;
- [ ] read-only price-data audit evidence reviewed;
- [ ] controlled Pancake price-override evidence reviewed or production activation explicitly blocked;
- [ ] final review in order correctness → security → architecture → simplicity → performance;
- [ ] 0 Critical / 0 Required findings before merge/launch.

**Dependencies:** P5, P7, P10.

**Files likely touched:**
- `src/seo/storefront-product-structured-data.ts`;
- `src/commerce/meta-purchase-snapshot.ts` / `meta-purchase-reporting.ts` as current ownership requires;
- focused analytics/SEO tests;
- `package.json` only if adding the already-planned readiness script command;
- browser/a11y test file(s), split from reporting changes if >5 files.

**Estimated scope:** Medium; split reporting vs browser/ops before implementation if it grows.

## Implementation PR sizing / merge strategy

This feature spans persistence, privileged admin writes, storefront SQL, checkout money, and an external POS side effect. Do **not** implement it as one giant PR merely because one spec describes it.

Recommended dependency-safe slices:

```text
A1 persistence
A2 pricing domain
B1 repository/lifecycle
B2 concurrency/admin domain
C admin UX
D1 PDP/projection
D2 discovery/cards
D3 flash/boundary refresh
E1 cart/snapshot
E2 price reconfirmation
F Pancake submission
G convergence/rollout
```

Each slice:
- carries its directly affected tests;
- targets ~≤5 files where practical;
- gets its own correctness/security review;
- is mergeable/revertable without depending on unreviewed sibling code;
- may land dormant before campaign activation if it does not expose incomplete buyer behavior.

Do not split a test away from the behavior solely to reduce file count. If a slice crosses two independent subsystems or grows beyond the reviewable range, split **before** implementation.

## Human approval gate

Before `/build`:
- [ ] PR #151 plan/spec approved;
- [ ] no unresolved Critical/Required review comments;
- [ ] implementation start SHA refreshed from current `main`;
- [ ] first implementation slice and its acceptance tests selected;
- [ ] no production promotion is enabled until external semantic acceptance/rollout gates permit it.
