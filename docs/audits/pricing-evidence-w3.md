# W3 — pricing evidence gate

Owning sources: `docs/specs/promotions-flash-sale-v1.md` §Pricing contract, `docs/audits/seo-geo-audit.md`
finding **W3**. Master-plan unit: **U7** (#151 P2 + #152 W3). Consumer: **U15 / #151 P6**.

Status: **PARTIALLY BLOCKED.** The mirrored money-data audit is implemented and runnable. The
real-catalog Pancake evidence is blocked on an approved context, and the existing audit script
cannot produce it even with one — see [Blocker 2](#blocker-2--the-existing-catalog-audit-reports-no-price-fields).

## What the gate is for

`resolveStorefrontPrice` currently returns `null` whenever
`pancakeRetailPrice !== pancakeRetailPriceAfterDiscount`, so a variant Pancake reports as discounted
becomes `PRICE_UNRESOLVED`: not purchasable, "Giá đang cập nhật" on the card, no offer in JSON-LD.

Removing that equality gate is **P6/U15's** change, not U7's, and the spec forbids doing it on a
guess. This document records the evidence that has to exist first.

## Two independent audits

They are often conflated. They read different sources and answer different questions.

| | Mirrored money-data audit | Real-catalog Pancake audit |
|---|---|---|
| Source | The website's own `VariantMirror` rows | The live Pancake API |
| Question | How much of the mirrored catalog fails the positive-safe-integer money rule, and how many visible variants would stop being purchasable? | What does Pancake actually mean by `retailPriceAfterDiscount`, and how often is it lower? |
| Needs credentials | No | **Yes — approved real-catalog context** |
| Status | **Implemented** (`pnpm money:audit`) | **Blocked** |

## Audit 1 — mirrored money data (implemented)

```bash
DATABASE_URL=... PANCAKE_SHOP_ID=... pnpm money:audit
```

Read-only, scoped to the configured shop, bounded at 50,000 variants, and it changes nothing. It
reports complete counts with capped examples for every class the spec names — `NULL`, `ZERO`,
`NEGATIVE`, `NON_FINITE`, `NON_INTEGER`, `UNSAFE_INTEGER` — plus:

- `visibleVariantsBecomingUnavailable`: the spec's explicit requirement to account for currently
  visible variants that the positive-safe-integer rule would remove. Visibility mirrors the
  storefront's own filter (variant and product both present and active, correct shop);
- `discountField`: how often the mirrored discount field equals, is lower than, or is higher than
  base, with examples of the lower cases.

`classifyMirroredBasePrice` defers to `isUsableBasePriceVnd` rather than restating it, so the audit
cannot drift from what the resolver accepts. Examples carry catalog identity and the offending
values only.

**Evidence still to record:** a run against the production mirror. Not done here — this environment
has no production data, and inventing counts would defeat the purpose of the gate.

## Audit 2 — real-catalog Pancake evidence (blocked)

The spec requires, before the equality gate is removed:

1. run `pnpm pancake:catalog:audit` against the approved real catalog context;
2. record sanitized counts/examples where `pancakeRetailPriceAfterDiscount` differs from
   `pancakeRetailPrice`, including lower values;
3. verify and document Pancake's semantics for those fields from approved integration evidence;
4. verify the impact of the website-owned pricing decision on currently visible/purchasable variants;
5. **if evidence materially contradicts the approved ownership assumptions, stop and return to
   product review** rather than silently changing pricing authority.

### Blocker 1 — no approved real-catalog context

`pnpm pancake:catalog:audit` requires a real `PANCAKE_API_KEY` and shop scope. This environment has
a placeholder. The audit was **not run**, and no evidence is recorded from it.

`BLOCKED — APPROVED REAL-CATALOG CONTEXT REQUIRED`

### Blocker 2 — the existing catalog audit reports no price fields

Independent of credentials, the script as written **cannot** produce the step-2 evidence.
`CurrentPancakeCatalogAuditReport` covers `products`, `variations.total`, `images` and `categories`.
No price field appears anywhere in the report.

So the gate needs the audit extended to report, per variation and in bounded sanitized form:

- counts where `retailPriceAfterDiscount` differs from `retailPrice`;
- of those, how many are lower and how many higher;
- examples of each, and whether the affected variations are currently visible.

That extension is a change to the Pancake integration surface and is deliberately **not** bundled
into the pricing resolver. It should be its own reviewable change, run only in the approved context.

## What is decided, and what is not

**Decided and unchanged by U7:** website pricing is `pancakeRetailPrice` plus website campaign
state. `pancakeRetailPriceAfterDiscount` must not determine the storefront effective price, must not
cause `PRICE_UNRESOLVED` merely by differing from base, must not override campaign state, and must
not become final order authority.

A visible consequence follows and is deliberate: **with no active website promotion, the website may
display and charge `pancakeRetailPrice` even where Pancake reports a lower
`pancakeRetailPriceAfterDiscount`.** That must stay visible in rollout evidence rather than being
quietly smoothed over. Downstream Pancake repricing risk is covered separately by the controlled
custom-price acceptance gate.

**Not decided, and not U7's to decide:** whether, and under what conditions,
`retailPriceAfterDiscount < retailPrice` is a legitimate sale price. That needs Audit 2.

## Stop rule for U15 / P6

Do not remove the `retailPrice === retailPriceAfterDiscount` availability gate until both audits
have been run in an approved context and recorded here. Do not substitute reasoning about what
Pancake probably means, and do not narrow the gate incrementally to make a subset pass. If Audit 2
materially contradicts the approved ownership assumption, stop and return to product review rather
than changing pricing authority in code.
