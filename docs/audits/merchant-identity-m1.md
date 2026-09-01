# M1 / W4a — Merchant identity and durability audit

Owning sources: `docs/specs/marketing-analytics-shopping.md` §6.2, `tasks/marketing-analytics-shopping-plan.md`
§3.3 and M1, `docs/audits/seo-geo-audit.md` finding **W4a**. Master-plan unit: **U9**.
Consumers: **U12 / M2**, **U25 / M3**, **Gate M**.

Status: **DURABILITY BLOCKED.** The audit is implemented and runnable, and it proves what the mirror
can prove. The identifier lifetime evidence Merchant activation requires does not exist yet.

## Verdict summary

| Question | Status |
|---|---|
| Are `pancakeVariationId` / `pancakeProductId` present, bounded and well-formed in the mirror? | **Runnable** — `pnpm merchant:identity:audit` |
| Are emitted variation ids unique? | **Runnable** |
| Is SKU usable as MPN (present, unique across emitted variations)? | **Runnable** |
| Are composites excluded? | **Proven** — either side of the composite graph (a set, or a member of one) is classified `COMPOSITE_DEFERRED` |
| Does the mirror reconcile rows by external id rather than slug/position/local id? | **Proven** — see below |
| Do upstream objects keep those ids for their lifetime? | **BLOCKED** |
| Is a GTIN available? | **Not asserted, by design** |
| Are `gender` / `age_group` / `condition` known? | **BLOCKED — owner gate O3** |

## What the audit does

```bash
DATABASE_URL=... PANCAKE_SHOP_ID=... pnpm merchant:identity:audit
```

Read-only, scoped to the configured shop, bounded at 50,000 variations, and it refuses rather than
truncating if the catalog exceeds that.

It audits only what would actually be **emitted**: standalone, storefront-visible variations. A
hidden variation's missing SKU is not a Merchant problem, and counting it would produce a verdict
nobody can act on. Composites are counted separately as `COMPOSITE_DEFERRED` and excluded, so a
component's missing SKU never drags down the standalone MPN verdict.

`mpnReady` is true only when **every** emittable variation has a present SKU and no SKU is shared.
SKU is nullable and not database-unique, which is precisely why this needs measuring rather than
assuming.

### What it deliberately does not do

- **No vendor format is asserted.** Which shape a Pancake identifier takes is an observation to
  record, not a rule to enforce. Encoding a guessed format would turn the audit into the assumption
  it exists to replace.
- **`pancakeBarcode` is not read at all.** A field name is not proof of a GTIN. Not selecting it is
  a stronger guard than selecting and ignoring it, because it removes the temptation later.
- **No apparel facts.** `gender`, `age_group` and `condition` are owner-approved facts under **O3**.
  A test asserts none of those words can appear in the audit output.

## Durability gate — the blocker

§3.3 requires at least one of:

1. **provider/API contract evidence** that ids are stable for the upstream object's lifetime;
2. **controlled repeated full-catalog resync evidence** showing the same upstream objects retain the
   same ids, **combined with repository tests proving mirror rows are reconciled by those ids**;
3. equivalent historical evidence approved in review.

### What is proven here

The second half of option 2. `tests/database/merchant-identity-audit.test.ts` proves that
`ProductMirror` and `VariantMirror` rows are reconciled by `pancakeProductId` and
`pancakeVariationId`: a product renamed with a new slug and a variant whose colour and size change
both resolve to the **same rows**. The mirror upserts on those keys, not on slug, array position or
the local cuid.

### What is not proven, and cannot be here

- **Option 1** is unmet: no reviewed document in this repository states that Pancake identifiers are
  stable for the upstream object's lifetime. `docs/integrations/pancake*.md` records order, geo and
  catalog shape contracts; none makes a lifetime claim about identifiers.
- **Option 2's first half** needs repeated full-catalog resyncs against the real catalog, which
  requires an approved context this environment does not have.
- **Option 3** is an owner/review decision, not something code can produce.

`summarizeMerchantIdentity` therefore reports `durability.upstreamLifetimeProven: false` and
`verdict: "BLOCKED"` as constants rather than computed values. There is no input to this audit that
could make them true, and a test pins that.

`BLOCKED — APPROVED REAL-CATALOG CONTEXT OR PROVIDER CONTRACT EVIDENCE REQUIRED`

## Consequences for downstream units

- **U12 / M2** may not treat this as accepted M1 evidence. The deep link depends on a variation id
  being a durable public address; that is exactly what is unproven.
- **U25 / M3** must not emit offers built on these identifiers until the gate clears.
- **Gate M** stays blocked independently of anything else on the Merchant path.
- **U32** must not read `pancakeBarcode` as a GTIN on the strength of this audit.

## To clear the gate

1. Obtain provider contract evidence of identifier lifetime stability, **or** run controlled repeated
   full-catalog resyncs in the approved context and record sanitized before/after id sets.
2. Run `pnpm merchant:identity:audit` against the production mirror and record the output here.
3. If `mpnReady` is false, decide with the owner whether to fix SKU data or omit MPN from emitted
   offers — do not emit a duplicate or invented MPN.
4. Re-review this document before any Merchant activation step proceeds.
