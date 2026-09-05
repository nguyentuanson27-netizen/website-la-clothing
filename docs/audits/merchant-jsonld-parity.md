# Merchant feed ↔ U27 variant JSON-LD parity (Wave 5 convergence gate)

Two public consumers describe the same standalone variant to two different audiences. This audit
records that they publish the same truth about the facts they share.

PR #199 proved the parity and left one reachable divergence open. **U27a closed it**, and this audit
now records both the finding and its reconciliation.

- **Base SHA:** `2d5ea84045f61fc1249076379dd0816d37499546` (`main` after PR #198).
- **Final implementation/test SHA:** the head of PR #199, recorded in that PR's description and
  shown on its exact-head checks. This audit adds tests and documentation only; no `src/` file is
  changed, so the runtime behaviour it describes is the behaviour already on the base SHA.
- **Pancake API used:** NO. **Production database used:** NO. Every case is reproducible from
  repository fixtures.

## Authorities

Neither consumer re-derives a fact it publishes, and this audit introduces no third authority.

| Fact | Merchant (U25/M3 → U26/M4) | Variant JSON-LD (U27) |
| --- | --- | --- |
| Variation identity | `MerchantOffer.id` = `pancakeVariationId` | the U12 `?variant=` parameter of the published URL |
| Family identity | `MerchantOffer.itemGroupId` = `pancakeProductId` | `ProductGroup.productGroupID` = `pancakeProductId` |
| Manufacturer MPN | `VariantMirror.pancakeDisplayId` (ADR 0008) | `VariantMirror.pancakeDisplayId` (ADR 0008) |
| Variant URL | `buildStandaloneVariantDeepLinkPath` (U12) | `buildStandaloneVariantDeepLinkPath` (U12) |
| Price | storefront projection, promotion-aware | storefront projection, promotion-aware |
| Availability | M1 `classifyMerchantAvailability` over mirrored stock | PDP projection `purchasable` / `unavailableReason` |

Merchant paths: `src/commerce/merchant-offer-mapper.ts`, `merchant-offer-repository.ts`,
`merchant-feed-serializer.ts`, `merchant-feed-service.ts`, `merchant-feed-http.ts`,
`src/app/feeds/google-merchant/route.ts`.

JSON-LD paths: `src/seo/storefront-product-structured-data.ts`, `src/seo/structured-data.ts`.

Shared addressing authority: `src/commerce/storefront-variant-deep-link.ts`.

## Method

`tests/domain/merchant-structured-data-parity.test.ts` starts every case from **one** catalog
fixture and **one** storefront projection built by the production projection builder with the
production promotion pricing rule, then hands that single source to each consumer's own entry point:

```
catalog facts → buildStorefrontProductProjection (real promotion pricing)
              ├→ mapMerchantOffers → serializeMerchantFeed → parsed RSS <item> elements
              └→ buildStorefrontProductStructuredData → ProductGroup.hasVariant
```

Neither side can be tuned independently to make a case pass. The Merchant side is read back from the
serialized bytes a vendor would actually fetch, not from the mapper's in-memory result.

### Normalization rules

The two formats are compared on meaning, never on literal strings.

- Availability: `in_stock`/`out_of_stock` and `schema.org/InStock`/`OutOfStock` both normalize to
  `IN_STOCK`/`OUT_OF_STOCK`.
- Price: `<g:price>` is split into amount and currency token; the amount is compared with
  `Offer.price`, and the currency token is asserted separately.
- Variation identity: read out of the published URL through the reviewed `VARIANT_QUERY_PARAM`
  rather than by slicing the string, so the comparison stays inside the U12 contract.
- XML entities are decoded before comparison, so an escaped `&amp;` in a link cannot read as a
  different URL from the JSON-LD one.
- Exclusion diagnostics are deliberately **not** compared: Merchant's bounded reason vocabulary is
  its own contract, and JSON-LD has no equivalent. Only the shared negative invariant — no
  standalone-variant publication — is asserted.

## Parity matrix

| Case | Result |
| --- | --- |
| A — ordinary in-stock standalone variant | MATCH (identity, group, MPN, URL, price, availability) |
| B — zero stock | MATCH: a valid offer on both sides, `out_of_stock` / `OutOfStock`, exact price retained |
| C — active promotion | MATCH: both publish 712,000 against a 890,000 base; a base-price regression fails the test |
| D — variant URL | MATCH byte-for-byte, and the published identity reopens the same option through the U12 resolver |
| E — manufacturer MPN | MATCH: `pancakeDisplayId` only; never the website-local SKU, the internal CUID, or the variation id |
| F — missing / blank / untrimmed / duplicate MPN | COMPATIBLE FAIL-CLOSED on both sides |
| G — unresolved availability | COMPATIBLE FAIL-CLOSED on both sides since U27a — see below |
| H — unresolved price | COMPATIBLE FAIL-CLOSED; no `0`, no minimum, no base-price stand-in |
| I — unaddressable variation identity | COMPATIBLE FAIL-CLOSED on both sides |
| J — composite | COMPATIBLE FAIL-CLOSED: Merchant reports `COMPOSITE_DEFERRED`, U27 publishes no `ProductGroup` |
| Grouping | MATCH: every emitted sibling groups under `pancakeProductId`, never a slug, local id, kind key, MPN or index |
| Publishable set | MATCH across a mixed fixture of eligible and ineligible variants, except the family-collapse state below |

## Closed divergence — negative mirrored warehouse quantity (U27a)

### What PR #199 found

The two consumers reduce the same warehouse rows identically wherever every quantity is usable — no
rows and an explicit zero both sum to `0` (out of stock), and a positive sum is in stock. They parted
on a **negative** mirrored quantity, and the rule is per row rather than on the total:

| Warehouse rows | Merchant (M1 `aggregateWarehouseStock`) | Storefront total | U27 before U27a |
| --- | --- | --- | --- |
| `[-3]` | `NaN` → `AVAILABILITY_UNRESOLVED`, omitted | `-3` | exact `OutOfStock` Offer |
| `[5, -3]` | `NaN` → omitted | `2` | exact **`InStock`** Offer |
| `[3, -3]` | `NaN` → omitted | `0` | exact `OutOfStock` Offer |
| `[100, -1]` | `NaN` → omitted | `99` | exact **`InStock`** Offer |

`[5, -3]` is why the total cannot decide this: it sums to an unremarkable `2`, and a fix keyed on
"the total went negative" would have closed `[-3]` while still publishing a false `InStock`.
`WarehouseStock.quantity` is a `Float` with no non-negative constraint and the mirror reflects
whatever the vendor reports, so the class was reachable rather than theoretical.

### Root cause

M1 treats any malformed row as making the whole variant's availability unstatable. The storefront
absorbs the same row into ordinary arithmetic, because for a shopper "how many can I buy" has a
usable answer either way. U27 consumed that shopper-facing verdict and published it as an exact
machine-readable claim — a claim the feed had already declined to make.

### Reconciliation

A server-only per-variant availability-resolution signal, carried the same way U27 already receives
`variantMpnById` and `galleryIndexByVariantId`:

```
storefront catalog read (still holds raw warehouse rows)
        │  resolveVariantAvailabilityFromWarehouseStocks
        ↓
variantAvailabilityResolvedById   (keyed by internal VariantMirror.id, never published)
        ↓
PDP detail repository → U27 serialization boundary
```

- The rule lives in `src/commerce/storefront-product.ts` beside the variant-fact semantics it
  belongs to, so it stays free of Prisma and usable from pure domain tests.
- It is resolved in `src/commerce/storefront-catalog.ts`, the last place holding the raw rows: one
  pass over rows already in memory, **no additional database query** and no N+1.
- `src/seo/storefront-product-structured-data.ts` gates publication on it. Unresolved is an
  **omission**, never a substitute claim — not `OutOfStock`, `InStock`, pre-order or back-order. A
  variant missing from the map is unresolved too, so a caller that forgets it publishes nothing
  rather than something unverified.
- The same filter narrows the **product-level fallback** offer. Suppressing the exact per-variant
  claim alone would have been half a fix: the fallback aggregates the standalone options, so a
  family collapsing to one sold-out survivor would still have advertised `InStock` on the strength
  of a sibling whose inventory the catalog cannot read. The filter matters in both directions — an
  unresolved sibling must not manufacture stock, and must not drag the offer into the
  price-disagreement refusal and withhold one the survivor fully supports.
- U27 still reads no database, imports nothing from the Merchant modules, and keeps the PDP
  projection as its price/addressability/resolved-availability authority. The two consumers converge
  on upstream facts; neither calls the other.
- The rule matches M1's by value, deliberately not by import, and the parity suite proves the two
  agree rather than trusting the comment.

### What did not change

- **Shopper-facing PDP behaviour is untouched.** `sumWarehouseStocks` still sums finite rows, so
  `[5, -3]` is still two units, still priced, still purchasable, and the option/cart/checkout paths
  are unchanged. `resolveVariantAvailabilityFromWarehouseStocks` answers a separate question and
  introduces no app-wide throw for a finite negative quantity.
- **Merchant was not weakened and not modified.** `merchant-offer-mapper.ts`,
  `merchant-offer-repository.ts`, `merchant-identity-audit.ts`, `merchant-feed-serializer.ts` and
  `merchant-feed-service.ts` carry no diff in U27a.
- **No client contract widening.** The signal never reaches `StorefrontSelectableOption` or the
  browser; the purchase panel has no use for it.
- **No database constraint and no sync normalization.** How the mirror should represent malformed
  upstream data is a separate design question, deliberately untouched.

### ProductGroup behaviour after exclusion

An excluded variant leaves nothing behind: no `hasVariant` entry, no `offers`, no MPN, no dangling
URL. `variesBy` is recomputed from the survivors, so dropping the only other colour leaves a
size-only family rather than a claimed colour axis. When exclusion leaves no real family, U27's
existing rules collapse the group to the product-level `Product` rather than publishing a one-member
`ProductGroup`.

### Open contract — the family-collapse state

U27a closed the availability divergence in both the exact-variant and product-level paths. One
question remains, and it is a granularity question rather than a contradiction.

When exclusion leaves a single publishable sibling, U27's existing rules collapse the family to a
product-level `Product`, because a one-member `ProductGroup` is not a variant family. In that state:

- Merchant publishes an exact offer for the surviving variant, carrying its variation identity;
- U27 publishes a product-level `Product` with the same price and the same availability, now derived
  only from resolved inventory, but no exact *variant* identity for it.

Neither statement is false and they agree on product, price and availability — but the publishable
exact-variant sets are not equal, so the launch gate does not close on this evidence.

This is the pre-existing single-variant-family rule, not something U27a introduced: it applies to any
product with one variant, and PR #199 already recorded it as a format-specific eligibility
difference. Reconciling it means one of:

1. **Change U27 ProductGroup eligibility** so a single publishable variant still publishes an exact
   variant `Product`/`Offer` — a change to U27's own design, and arguably wrong against schema.org,
   where a `ProductGroup` describes a family.
2. **Omit the survivor from Merchant** under the same condition — which weakens a feed that is
   currently correct, to match a presentation rule of the other consumer.
3. **Accept the granularity difference** and say so normatively in the gate's wording: a
   product-level statement that agrees on product, price and availability satisfies "consistency"
   even without variant-level identity.

Each is an authority decision about what the gate means, not a defect to fix inside this unit.

### Non-finite quantities

Unchanged and still fail closed. The PDP repository throws on a non-finite quantity before a
projection exists, so no JSON-LD is published at all; the resolution rule also refuses them as
defence in depth. U27a did not broaden that behaviour.

## Checkpoint E evidence

PR #198's final exact head is `1d003dc4d917c138a2c12f93c98b4a38be487754`. All five relevant
workflows concluded `success` on that exact SHA — no stale-head evidence:

| Workflow | Run | Conclusion |
| --- | --- | --- |
| CI | #1964 | success |
| Merchant feed runtime | #27 | success |
| Catalog indexation runtime | #952 | success |
| P18 final QA runtime | #746 | success |
| VPS container verification | #889 | success |

## Runtime verification

Business-fact parity and production feed activation are separate questions, and this audit keeps
them separate.

- **U27 over real HTTP:** `scripts/structured-data-http-smoke.ts` (run from
  `tests/integrations/product-slug-http.test.ts`, inside `pnpm test`) starts the built app, requests
  a seeded PDP, parses the served JSON-LD, and asserts one `ProductGroup` with variant-specific
  names, unique manufacturer MPNs, exact per-variant `Product`/`Offer` facts, and published URLs
  that reopen the same variants at the same prices.
- **Merchant over real HTTP:** the `Merchant feed runtime` workflow requests
  `/feeds/google-merchant` on the built app and requires a bounded `503` with `retry-after: 60`,
  `x-la-merchant-feed-failure: MARKET_UNRESOLVED`, exactly one `cold_generation`, and identical
  behaviour under request query noise.

Therefore:

```
business-fact parity
  identity / grouping / MPN / URL / price  = GREEN
  availability, resolvable stock domain    = GREEN
  availability, any negative row           = COMPATIBLE FAIL-CLOSED (U27a)
  exact-variant set, family-collapse state = OPEN CONTRACT (authority decision)

feed <-> JSON-LD consistency launch gate   = OPEN
production feed activation                 = BLOCKED by O2
```

## O2 status

**O2 remains unresolved.** `APPROVED_MERCHANT_MARKET` is still `null`, `resolveMerchantMarket()`
still reports `MERCHANT_MARKET_UNRESOLVED`, and the production route still fails closed with a
bounded `503`. That is expected behaviour, not a parity failure.

The parity suite needs a currency token to render `<g:price>`, so it passes a clearly named
`TEST_ONLY_MERCHANT_MARKET` straight to the serializer. It is scoped to that one test file, nothing
under `src/` imports it, it configures nothing, and it cannot make `/feeds/google-merchant` answer
`200`. It is not an approved Vietnam market and grants no approval.

This audit approves no country, language or currency, activates no Merchant Center data source, and
changes no activation gate.

## Topology

Unchanged since PR #198: one app service, and U26's process-local cache/single-flight/backoff makes
no multi-replica claim. Nothing here adds Redis, replicas, or a deployment change.

## Remaining gates

- **Feed ↔ JSON-LD consistency launch gate:** OPEN, on the family-collapse contract below.
- **O2:** OPEN. **M5 / U41:** BLOCKED.
- Next unit: `U28 / T8`.
