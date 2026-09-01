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
| Does every emittable record have a price the website would publish? | **Runnable** — `PRICE_UNRESOLVED` counted |
| Is stock status known? | **Runnable** — `IN_STOCK` / `OUT_OF_STOCK`; out-of-stock is a fact, not an exclusion |
| Does every emittable record have a trusted image? | **Runnable** — `MISSING` / `UNTRUSTED` counted |
| Is title and published description text serializable into a feed? | **Runnable** — `MALFORMED` counted |
| Is a GTIN available? | **Not asserted, by design** |
| Are `gender` / `age_group` / `condition` known? | **BLOCKED — owner gate O3**, reported as `OWNER_BLOCKED` rather than omitted |

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

### Catalog facts

Beyond identity, the audit counts the facts an offer needs, for emittable records only:

| Fact | Source of truth | Why it is not re-derived here |
|---|---|---|
| Price | `resolveStorefrontPrice` | An audit with its own definition of a usable price would report a readiness the storefront does not share. That rule is still equality-gated on the mirrored Pancake fields pending **W3**, so `PRICE_UNRESOLVED` is exactly the number that decides whether the gate can move. |
| Media | `parseTrustedProductImageUrl` | An untrusted host is not a Merchant image, however well-formed the URL. |
| Description | `ProductContent.status === "PUBLISHED"` | A Draft is work in progress; auditing it would overstate readiness. |
| Availability | Summed `WarehouseStock.quantity` | Reported, never an exclusion: an out-of-stock offer is valid and simply carries `out_of_stock`. A non-finite or negative mirrored quantity is not evidence of stock. |
| Title / description text | Serializability | `MALFORMED` means a control character or lone surrogate — text that cannot be escaped into valid XML, so one record would break every record after it. Not a style judgement. |

`merchantFactsReady` counts emittable records with a publishable price, a trusted image, and
serializable title and description. Availability is excluded from it on purpose.

### What the report may echo

Counts and verdicts, plus **one deliberate exception**: the duplicate diagnostics name the colliding
`pancakeVariationId` or SKU. A duplicate report an admin cannot act on is not worth producing, and a
catalog identifier is not personal data.

Everything else is a count. **Catalog free text — a product title, a description — never reaches the
summary**, because that is where a person's name or phone number ends up and an audit report gets
pasted into issues. A malformed title is counted, never reproduced.

The boundary is pinned in both directions by test: a colliding SKU must appear, and free text must
not. A one-sided assertion would be satisfied by a report that echoes nothing useful just as easily
as by one that echoes too much.

### What it deliberately does not do

- **No apparel fact is inferred.** `gender`, `age_group` and `condition` are reported as
  `OWNER_BLOCKED` constants. A product name, a category or a size chart is not evidence of who a
  garment is for, and guessing puts wrong data in front of shoppers. They stay blocked until a human
  supplies the approved source of truth (**O3**).
- **No vendor format is asserted.** Which shape a Pancake identifier takes is an observation to
  record, not a rule to enforce. Encoding a guessed format would turn the audit into the assumption
  it exists to replace.
- **`pancakeBarcode` is not read at all.** A field name is not proof of a GTIN. Not selecting it is
  a stronger guard than selecting and ignoring it, because it removes the temptation later.

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
