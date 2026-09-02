# Wave 1 — Checkpoint A integrated verification record

Owning sources: `tasks/growth-commerce-master-plan.md` §Wave 1 / Checkpoint A,
`tasks/promotions-flash-sale-v1-plan.md` P2–P4, `tasks/marketing-analytics-shopping-plan.md` T4,
`docs/audits/seo-geo-audit.md` W3.

Master-plan units: **U7**, **U8**, **U10**, **U11**.

Verification head: `main@d8b1a6696f03bdd683e15577b493e5cf46fa51e0` (merge of PR #175).

Status: **CHECKPOINT A PASS — integrated Wave 1 commerce foundation verified at exact head.**

Activation remains **off**. This record verifies a foundation; it enables no promotion, no
storefront behaviour change, and no launch gate.

---

## 1. Why this is a reconciliation, not an implementation

Wave 1's four units were implemented and merged before this record was written. Re-implementing
them would have created exactly the duplicate pricing and identity authorities the master plan
forbids, so this change records integrated evidence and reconciles the master checklist instead.

| Unit | Source | Delivered by | Merge head |
|---|---|---|---|
| **U7** — central pricing resolver | #151 P2 | PR #162 (resolver), PR #163 (mirrored money audit) | `356a693`, `42a903d` |
| **U7** — real-catalog price evidence | #152 W3 | PR #174 | `d9828ad` |
| **U8** — canonical Pancake identity | #153 T4 | PR #164 (cart lines), PR #165 (product/option facts) | `74b1b5c`, `4ccad87` |
| **U10** — repository / lifecycle / health | #151 P3 | PR #167, PR #168, PR #169 | `de01a7e`, `c331efe`, `3a87f11` |
| **U11** — admin domain / activation / revision | #151 P4 | PR #170, PR #171, PR #172 | `8470bef`, `8851fca`, `b001451` |

The dependency order the master plan requires was respected by that merge sequence:
`U3 → U7 → U10 → U11`, with `U8` landing independently from the reviewed baseline.

---

## 2. Unit verification against source acceptance criteria

### U7 — central exact pricing resolver (#151 P2)

`src/commerce/promotion-pricing.ts` is the single semantic pricing authority.

- Pure, explicit `now`; the module reads no wall clock, so one request resolves storefront, cart and
  checkout against one instant.
- Result carries `basePriceVnd`, `effectivePriceVnd`, `isDiscounted`, `promotion` snapshot, typed
  `reason` and `nextTransitionAt` — the full conceptual output the spec names.
- Money rules: `isUsableBasePriceVnd` enforces positive safe-integer VND; percentage uses exact
  `BigInt` rational arithmetic with half-up rounding and returns to `number` only after a safe-integer
  assertion; `FIXED_PRICE` is a final unit price requiring `0 < fixed < base`. No float promotion
  arithmetic exists in the module.
- Mandated fixtures are pinned in `tests/domain/promotion-pricing.test.ts`: `150 @ 1% → 149`,
  `350 @ 1% → 347`, `110 @ 5% → 105`, and the upper-safe fixture
  `9007199254740989 @ 1% → 8917127262193579`.
- Fail-closed semantics: unusable base → `BASE_PRICE_UNAVAILABLE` with no price at all; more than one
  applicable campaign → `PROMOTION_CONFLICT` and no promotion for that variant; a campaign that cannot
  produce a discount for a variant → `PROMOTION_INVALID` for that variant only. No "pick first" and no
  "latest wins" path exists.
- `pancakeRetailPriceAfterDiscount` is deliberately absent from the resolver, matching the approved
  v1 ownership decision.

Reuse is single-authority: `src/commerce/mirrored-money-audit.ts` imports `isUsableBasePriceVnd`
rather than restating the rule.

### W3 — real Pancake catalog evidence (#152 W3)

Recorded in `docs/audits/pricing-evidence-w3.md`; verdict **PASS**.

- `pnpm pancake:catalog:audit` was executed against the approved real catalog on the production VPS
  (shop `1635185058`) at base SHA `42a903da5ae0a5827ca5e650e8842e2794fd70f2`, with sanitized counts,
  distributions, representative examples, timestamps and provenance. No token or raw secret is
  recorded.
- The audit path is read-only: `src/integrations/pancake/catalog-audit.ts` issues only
  `client.getJson` calls and mutates no Pancake product or catalog data.
- Evidence: 356/356 mirrored variants carry positive-safe-integer VND base prices; 0 currently visible
  variants become unavailable under that rule; 356/356 observed
  `retail_price === retail_price_after_discount`.
- A controlled, fully rolled-back live experiment on product `a132` established that Pancake evaluates
  `promotion_advance` as dynamic order/cart rules rather than static catalog price mutations.

**W3 verdict: evidence does not contradict the approved `retailPrice` ownership assumption.** The
U7 stop rule is therefore not triggered and U10/U11 were free to proceed.

Removal of the `retailPrice === retailPriceAfterDiscount` availability gate in
`src/commerce/storefront-product.ts` remains **U15 / #151 P6** work and has not happened.

### U8 — canonical product/variant identity (#153 T4)

- Product-level facts expose stable `pancakeProductId` (`src/commerce/storefront-catalog.ts`,
  `src/commerce/storefront-cart-repository.ts`). One card stays one product impression; no card is
  exploded into its variants and no selected variant is invented.
- Concrete selectable options carry `pancakeVariationId` alongside the internal `id`
  (`src/commerce/storefront-product.ts`). Presentation `kindKey`, colour, size, slug, array index and
  `VariantMirror.id` are never used as external vendor identity.
- Server cart mutation resolution selects `pancakeVariationId`, while `VariantMirror.id` remains the
  authorization/mutation key. The security boundary is unchanged; no client-supplied Pancake ID
  becomes an authorization input.
- Resolved cart/checkout lines carry the actual purchased `pancakeVariationId`; a composite component
  line carries its own component variation ID rather than a presentation parent's.
- Unresolvable and private lines fail closed to `null` external identity rather than fabricating a
  fallback (`src/commerce/storefront-cart.ts`).
- Coverage: `tests/domain/storefront-identity.test.ts` (3 cases) and
  `tests/domain/storefront-cart-identity.test.ts` (8 cases), including an explicit assertion that
  existing price, availability and privacy behaviour is unchanged.

### U10 — repository / lifecycle / runtime health (#151 P3)

- `src/commerce/promotion-candidate-repository.ts` resolves direct `VARIANT` targets and the actual
  owning `PRODUCT` in **two bounded queries**, capped at `MAX_CANDIDATE_VARIANTS_PER_LOOKUP = 200`.
  Coverage is a join, never a materialized membership table, so variants synced or restored later are
  covered with no campaign write. A composite component follows its real owning product rather than the
  presentation parent it is sold through. An N+1 guard test pins the query count.
- `src/commerce/promotion-campaign-lifecycle.ts` derives `Draft`/`Scheduled`/`Active`/`Ended`/`Disabled`
  from persisted intent plus an explicit `now`. Nothing is written back, so "ever active" is correct
  after a restart and for a window that opened and closed with zero traffic — the lazy-observation-write
  failure the spec names cannot occur. Legal never-Active re-enable writes a fresh `enabledAt` and
  clears `disabledAt` atomically in `publishPromotionCampaign`.
- `src/commerce/promotion-runtime-health.ts` computes health per affected variant, reports typed
  reasons and conflicting campaign IDs, keeps `PARTIALLY_INVALID` siblings running, and bounds its
  payload at `MAX_REPORTED_AFFECTED_VARIANTS = 50` with an explicit `affectedTruncated` flag. Nothing is
  stored, so recovery is automatic and no stale invalid flag can outlive its cause. No money and no raw
  external payload appear in the report.
- Copy snapshots explicit target rows only, never expands `PRODUCT` coverage, and is deterministic and
  surrogate-pair safe within the 120-code-unit bound. Regressions cover 119/120 code units, trailing-space
  normalization, a surrogate boundary, Copy-of-Copy, and a source whose dynamic expansion exceeds 2000.

### U11 — concurrency-safe admin domain (#151 P4)

`src/commerce/promotion-activation-service.ts` owns every effective mutation.

- **Authorization:** every write path calls `requireAdminSession` before the activation gate and before
  any transaction opens. No client UI is trusted.
- **Bounds:** `validateDraftInput` enforces name, target-count (`MAX_TARGETS_PER_CAMPAIGN = 200`) and
  identifier (`MAX_PROMOTION_IDENTIFIER_LENGTH = 128`) bounds on **every** write including Draft, and
  `refuseUnboundedCampaignId` bounds the campaign identifier before it reaches the database as a query
  parameter.
  Two bounds the spec names, `MAX_ADMIN_PROMOTION_PAGE_SIZE = 50` and `ADMIN_TARGET_SEARCH_LIMIT = 50`,
  are deliberately absent: they govern admin listing and search, there is no such operation in the
  service yet, and `tasks/promotions-flash-sale-v1-todo.md` assigns "List/search bounded 50" to
  **P5**. Their max/max+1 tests belong to U14 with the operations they bound.
- **Activation gate:** `isPromotionActivationEnabled` defaults **off** and matches
  `LA_PROMOTION_ACTIVATION_ENABLED === "true"` exactly, so no `NEXT_PUBLIC_` value, header or casual
  `1`/`TRUE` can switch real discounted pricing on. While off, publish, re-enable and Scheduled material
  edit fail typed `ACTIVATION_DISABLED` with no partial mutation. **This change does not turn the gate on.**
- **Deterministic lock order:** pricing revision row (`FOR UPDATE`) → campaign row → owning product rows
  → bounded expansion probe → required variant rows, each set taken `ORDER BY "id"`. Taking the singleton
  revision lock first serializes every effective mutation globally, which is what makes the overlap
  decision trustworthy: two concurrent publishes cannot both read a conflict-free world and both commit.
  All facts the decision rests on are re-read after the locks are held, closing the TOCTOU window between
  validation and commit.
- **Coverage races fail closed:** same-campaign lost update (a Draft edit cannot land on a campaign a
  concurrent publish has enabled), cross-campaign `PRODUCT`↔`VARIANT` overlap, concurrent publish, and
  concurrent Scheduled material edit are all covered by database-backed tests.
- **Expansion bound:** publish, re-enable and Scheduled material edit probe one row past
  `MAX_EXPANDED_VARIANTS_PER_CAMPAIGN = 2000` and fail with `TARGET_EXPANSION_LIMIT_EXCEEDED` before the
  expensive coverage and lock-set work. The `2000` / `2001` boundary is pinned.
- **Rollback stays available:** `disablePromotionCampaign` and `endPromotionCampaignEarly` are bounded to
  the campaign row, do not expand coverage, and do **not** consult the activation gate — so a campaign
  whose `PRODUCT` coverage has since grown past 2000 can still be switched off. Copy is likewise
  non-expanding from every lifecycle state.
- **Transactional pricing revision:** every successful publish, re-enable, disable, end-early and
  Scheduled material edit advances the durable revision with `advanceRevision` **inside the same
  transaction** as the campaign mutation. There is no `after()`, no fire-and-forget task and no external
  event anywhere in the correctness path. Draft-only edits and Copy read the revision without a lock and
  do not advance it.

The migration seeds the singleton and constrains it: `PromotionPricingRevision_singleton_check`
(`id = 'current'`) and `PromotionPricingRevision_non_negative_check` (`revision >= 0`), initialized
by an idempotent `ON CONFLICT DO NOTHING` insert.

Known and documented boundary: `FOR UPDATE` cannot lock a row that does not yet exist, so a variant
inserted for an already-locked product during validation is not covered by the lock. Locking the
owning product row is the mitigation, and per-variant runtime health catches the remainder.

---

## 3. Verification actually executed

Executed on `main@d8b1a6696f03bdd683e15577b493e5cf46fa51e0` against PostgreSQL 16 with migrations
deployed.

| Command | Result |
|---|---|
| `pnpm prisma:validate` | pass — schema valid |
| `pnpm prisma:generate` | pass |
| `pnpm prisma:migrate:deploy` | pass — all migrations applied, revision singleton seeded |
| `pnpm lint` | pass — 0 errors, 6 warnings (see note below) |
| `pnpm typecheck` | pass |
| `pnpm test` | pass — 752/752 |
| `pnpm test:db` | pass — 292/292 |
| `pnpm build` | pass |

Lint warnings, stated precisely: all six are advisory, none is an error, and none is a defect.
Five predate Wave 1. **One is Wave 1 code** — `tests/database/mirrored-money-audit.test.ts:169`,
added by PR #163 (U7 part 2), where `const { PANCAKE_API_KEY: _removed, ...inherited } = process.env`
deliberately omits the key to prove the mirror-only audit needs no API key. The `_`-prefixed
rest-destructuring omit is the idiomatic way to express that and the warning is the linter's
standing opinion of the pattern, not a finding against the test.

`pnpm release:check` requires a configured `PANCAKE_API_KEY` and is not runnable outside an approved
credential context; it is covered at exact head by the CI **Release environment preflight** step.

`pnpm pancake:catalog:audit` requires the approved real-catalog context and was **not** re-run here.
Its accepted evidence is the recorded production-VPS execution at SHA `42a903d` in
`docs/audits/pricing-evidence-w3.md`.

### Exact-head GitHub workflow status — `main@d8b1a66`

| Workflow | Run | Conclusion |
|---|---|---|
| CI — `verify` | [33641589839](https://github.com/nguyentuanson27-netizen/website-la-clothing/actions/runs/33641589839) | success |
| CI — `admin-a11y-runtime` | same run | success |
| VPS container verification | [33641589798](https://github.com/nguyentuanson27-netizen/website-la-clothing/actions/runs/33641589798) | success |
| Catalog indexation runtime | [33641589852](https://github.com/nguyentuanson27-netizen/website-la-clothing/actions/runs/33641589852) | success |

`P18 final QA runtime` is configured for `pull_request` and `workflow_dispatch` only, so it has no
push run at this head; it ran on the contributing pull requests.

---

## 4. Security review

Reviewed in priority order: correctness → security → architecture → simplicity → performance.

**External Pancake data — treated as untrusted.** Mirrored prices arrive as `Float?` and every
consumer passes them through `isUsableBasePriceVnd`, so null, NaN, infinity, fractional, non-positive
and beyond-safe-integer values all fail closed to `BASE_PRICE_UNAVAILABLE` rather than becoming
money. The catalog audit is read-only and its recorded evidence is sanitized.

**Admin APIs.** Every mutation calls `requireAdminSession` first; a non-admin session raises
`AuthorizationError` rather than a business outcome a screen could render as recoverable. Identifier,
name and target-array bounds are enforced before any lookup. No lifecycle authority is delegated to
the client. No promotion mutation is reachable from an HTTP route or Server Action yet — the admin
surface is **U14 / #151 P5** — so there is no new CSRF or request-boundary surface in this wave.

**Concurrency.** Locking is deterministic and never ordered by request-controlled input; all facts
are re-read under the locks before commit; rollback paths (disable, end-early, Copy) stay bounded to
the campaign row and cannot be starved by the expansion cap.

**Money.** One authority, integer/`BigInt` throughout, no float promotion formula anywhere, and no
browser or client input is price authority.

**Logs.** The promotion modules emit no logging at all — no tokens, cookies, customer PII, raw
external payloads or unbounded target sets.

### Findings

**0 Critical / 0 Required.**

Observations carried forward, none blocking:

1. *(Nice-to-have, → U14/P5)* Saving a Draft whose explicit targets contain a duplicate is rejected by
   the database unique constraint and surfaces as a raw `PrismaClientKnownRequestError` rather than a
   typed `DUPLICATE_TARGET` failure. Verified behaviour: the transaction rolls back, **0** target rows
   persist and the pricing revision is unchanged, so it fails closed and matches the spec's requirement
   that database invariants enforce duplicate prevention. The admin UX unit should map it to a typed
   form error.
2. *(Nice-to-have, → U14/P5)* `findOverlappingCampaigns` reads every enabled campaign and expands each
   candidate whose window overlaps. Work is proportional to the number of enabled campaigns, bounded per
   campaign by the 2000-row probe, and serialized behind the revision lock. Acceptable for a rare
   administrative action at v1 catalog scale; revisit if enabled-campaign count grows materially.
3. *(Observation)* Effective mutations lock `VariantMirror` rows in `id` order, which catalog sync does
   not necessarily follow. A lock-order inversion would surface as a PostgreSQL deadlock abort, which
   rolls the mutation back safely rather than corrupting state.

---

## 5. Checkpoint A verdict

**PASS.**

- #151 P1–P4 focused suites green at exact head; migrations clean.
- Central pricing resolver accepted as the single money authority.
- Real-catalog price evidence accepted; W3 gate cleared without contradiction.
- Repository and lifecycle deterministic across restart and zero traffic; runtime health bounded and typed.
- Race-safe admin writes with deterministic lock order and re-read-before-commit.
- Activation gate default-off and still off.
- Pricing revision advances transactionally with every effective mutation.
- U8/T4 identity ready before any consumer depends on it; `VariantMirror.id` remains internal.
- Security review green for authz, bounds, concurrency, external-data handling, money correctness and
  secret/PII logging: **0 Critical / 0 Required**.

## 6. Explicitly not done in Wave 1

U12 variant deep link; U13 SEO runtime additions; U14 promotion admin UX; U15 PDP sale UI; U16 `/shop`
effective-price discovery; U17 `/flash-sale`; T5/T6 analytics and cart contract; checkout pricing
handshake; Merchant mapper or feed; `ProductGroup` JSON-LD; GTM loader; promotion activation in
production; search index enablement.

The `retailPrice === retailPriceAfterDiscount` availability gate is deliberately still in place.

## 7. Next unit after Checkpoint A

**U14 (#151 P5)** — promotion admin UX over the P4 service boundary — is the lowest-risk next step: its
dependency (U11) is now accepted, it adds no pricing or overlap authority of its own, and it is where
the two nice-to-have observations above are naturally resolved. Wave 2's storefront train
(U15 → U16 → U17) and U12 may proceed in parallel from their own satisfied prerequisites.
