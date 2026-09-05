# Merchant feed ↔ U27 variant JSON-LD parity (Wave 5 convergence gate)

Two public consumers describe the same standalone variant to two different audiences. This audit
records that they do not publish two different truths about the facts they share, and names the one
place where they deliberately differ.

- **Base SHA:** `2d5ea84045f61fc1249076379dd0816d37499546` (`main` after PR #198).
- **Final implementation/test SHA:** recorded in the parity PR's description; this audit adds tests
  and documentation only and changes no runtime behaviour.
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
| G — unresolved availability | See "Known difference" below |
| H — unresolved price | COMPATIBLE FAIL-CLOSED; no `0`, no minimum, no base-price stand-in |
| I — unaddressable variation identity | COMPATIBLE FAIL-CLOSED on both sides |
| J — composite | COMPATIBLE FAIL-CLOSED: Merchant reports `COMPOSITE_DEFERRED`, U27 publishes no `ProductGroup` |
| Grouping | MATCH: every emitted sibling groups under `pancakeProductId`, never a slug, local id, kind key, MPN or index |
| Publishable set | MATCH across a mixed fixture of eligible and ineligible variants |

## Known difference — negative mirrored warehouse quantity

One eligibility difference exists and is recorded rather than equalized.

The two consumers reduce the same warehouse rows identically wherever the quantity is usable — no
rows and an explicit zero both sum to `0` (out of stock), and a positive sum is in stock. They part
on a **negative** mirrored quantity:

| Warehouse rows | Merchant (M1 `aggregateWarehouseStock`) | Storefront / U27 |
| --- | --- | --- |
| `[]`, `[0]`, `[5]` | `0`, `0`, `5` | same |
| `[-3]` | `NaN` → `AVAILABILITY_UNRESOLVED`, offer excluded | `-3` → `<= 0` → sold out → exact `OutOfStock` Offer published |
| `[NaN]` | `NaN` → excluded | the PDP repository throws before a projection exists → no JSON-LD at all |

Only the negative row is a live difference; a non-finite quantity already fails closed on both sides.
`WarehouseStock.quantity` is a `Float` with no non-negative constraint, and the mirror reflects
whatever the vendor reports, so it is reachable rather than theoretical.

Neither consumer is violating its own contract. M1 chose the strictest reading for a machine feed,
where publishing an offer whose availability is uncertain is an account-level risk. U27's stated
availability authority is the PDP projection, and markup that disagreed with the page it sits on
would be its own defect. The feed is simply stricter than the page.

Closing it would require U27 to gain an availability-resolution signal it does not have today — the
projection cannot distinguish "stock is zero" from "stock is corrupt" — which means plumbing a new
per-variant signal out of the shared storefront catalog read that the whole PDP depends on, and
changing published U27 output. That is an owner decision and its own scoped unit, not something to
smuggle into a verification PR.

`tests/domain/merchant-structured-data-parity.test.ts` pins the current behaviour explicitly so the
difference cannot drift unnoticed in either direction.

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
business-fact parity        = GREEN (one documented availability difference)
production feed activation  = BLOCKED by O2
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

## Remaining gate

`U28 / T8` is next. `O2` and `M5 / U41` stay blocked.
