# U27 — ProductGroup / variant structured-data implementation audit

Status: **IMPLEMENTED IN PR #196; exact-head CI remains the merge gate.**

Scope: #152 W4d + the variant-level portion of W5 only. This document records the focused
implementation contract after reconciling PR #196 with `main@d1053139cdaca467cab14d4affe8a8127d609e0b`.
It does not reopen Merchant M3/M4, product-level U32 attributes, search-index activation, composite
Merchant support, or unrelated SEO work.

## Source authorities

U27 does not create a second authority for any commerce fact:

- variant addressability: U12 `buildStandaloneVariantDeepLinkPath` + deep-link resolver for
  `/shop/<slug>?variant=<pancakeVariationId>`;
- variant external address identity: `pancakeVariationId`;
- manufacturer MPN: ADR 0008, Pancake variation `display_id` mirrored as
  `VariantMirror.pancakeDisplayId`;
- product family identity: `pancakeProductId`;
- variant-name specificity: existing product `name` plus factual storefront `color` / `size` only;
- price: the same promotion-aware PDP projection rendered to the shopper;
- availability: the same projection's `purchasable` / `unavailableReason` state;
- media: trusted storefront gallery + server-resolved `galleryIndexByVariantId`;
- canonical/search exposure: existing W4c / ADR 0004 policy, unchanged by U27.

Local `VariantMirror.sku`, barcode, local CUID, kind key, array position, and color/size concatenation
are not substitutes for the reviewed manufacturer MPN or public variation identity.

## ProductGroup contract

A standalone family may publish `ProductGroup` only when:

1. `pancakeProductId` is bounded and publishable;
2. at least two surviving variants genuinely differ on `color` and/or `size` under the storefront
   option identity rule;
3. each surviving variant round-trips through the U12 resolver to the same option and the latest U12
   standalone path builder accepts its slug/variation identity;
4. each surviving variant has a current, bounded, valid and unique ADR-0008 manufacturer MPN;
5. each surviving variant has an exact resolved price and either is purchasable or is unavailable
   specifically because it is out of stock;
6. each nested variant can carry a `Product.name` more specific than the group using only factual
   color/size values.

Each published variant is a nested `Product` with:

- `name = product.name — <color?> — <size?>`, using only present factual option values;
- `url` / `@id` derived from the exact U12 query URL;
- `mpn = pancakeDisplayId`;
- truthful `color` / `size` when present;
- trusted variant image when the resolved gallery mapping exists;
- one exact `Offer` with VND price and `InStock` / `OutOfStock` availability.

The variant-name formatter is deterministic: family name, then factual color, then factual size,
separated by ` — `. It does not infer category, audience, material, description, SKU, GTIN, MPN or
other merchandising copy. If no factual option dimension can make a nested name more specific than
the group, serialization fails closed to the product-level fallback.

The group carries no `offers`, `AggregateOffer`, `lowPrice`, `highPrice`, or `offerCount`.
`ProductGroup` replaces the old product-level `Product` at the graph position rather than joining it,
so the page has one product-schema authority.

If a truthful variant family cannot be established, U27 falls back to the existing product-level
`Product` shape. Composite products are never remodelled as normal sibling variants; their fallback
offer continues to be derived only from parent-set options.

## Identifier fail-closed boundary

M1 / ADR 0008 already established the operational source-of-truth: the authoritative catalog run
found 149/149 intended standalone manufacturer MPNs present, valid and unique. U27 still validates
at serialization time because a historical green audit must not authorize a later malformed mirror
value forever.

The public JSON-LD boundary therefore refuses missing, blank/untrimmed, over-70-code-point, malformed
Unicode, supplementary-plane, or duplicate MPN values. It does not manufacture a replacement.

`src/commerce/storefront-product-detail.ts` exposes the MPNs as a **server-only map keyed by internal
variant id**. They are deliberately not added to `projection.options`, so the client purchase-panel
contract does not grow a Merchant/SEO-only field. Internal ids are used only to join server-resolved
facts and are never serialized.

## URL and canonical policy

Google Search Central's current single-page product-variant guidance explicitly uses URL query
parameters for distinct variant URLs and a single canonical base `ProductGroup` URL. The same current
guidance says the common title may live on `ProductGroup`, while nested variant `Product.name` should
be more specific based on variant-identifying properties. U27 satisfies both contracts from existing
U12 addressability plus already-owned product/color/size facts.

After PR #197 advanced U12, U27 was reconciled against latest `main` and now consumes
`buildStandaloneVariantDeepLinkPath` rather than restoring the older branch-local URL helper. This
keeps the latest U12 slug/variation validation as the single writer for standalone variant paths.

Current project search exposure is also unchanged: the temporary production domain remains globally
noindex by ADR 0004/enforcement, and non-canonical query requests remain fail-closed under the
existing search-exposure policy. U27 does not activate organic indexing. Permanent-domain/index
launch still follows the independent search launch gates and runtime verification.

Official sources re-checked on 2026-09-05:

- https://developers.google.com/search/docs/appearance/structured-data/product-variants
- https://schema.org/ProductGroup
- https://schema.org/Product
- https://schema.org/mpn

Google's Product Variant page reported **Last updated 2026-05-20 UTC** at that check.

## Regression / HTTP evidence required on the PR head

The PR test contract covers:

- ProductGroup + exact nested Product/Offer shape;
- nested variant names are more specific than the group and deterministically match factual
  color/size;
- unique ADR-0008 MPN on every published variant;
- missing/invalid/duplicate MPN fail-closed behavior;
- latest U12 standalone path builder + resolver URL round trip;
- exact promotion-aware per-variant prices with no range collapse;
- stock-only `OutOfStock` and unresolved-price/unexplained-unavailability exclusion;
- `variesBy` using the storefront option identity rule;
- trusted media mapping and invalid gallery-index omission;
- composite non-remodelling and product-level fallback;
- no internal ids, local SKU, inferred GTIN, AggregateOffer, rating/review, shipping or return-policy
  claims;
- JSON-LD script-breakout escaping;
- real HTTP reopening of every published variant URL and parity with rendered option/name/price.

`scripts/structured-data-http-smoke.ts` seeds distinct manufacturer MPNs, parses the served JSON-LD,
asserts variant-specific names, those MPNs and exact Offers, excludes unpriceable/inactive variants
and their MPNs, then requests each published variant URL to prove it preselects the same variant and
renders the same price.

## Known exclusions

- No GTIN inference from Pancake barcode.
- No website-local `VariantMirror.sku` use as manufacturer MPN.
- No product-level U32 identifier/Organization enrichment.
- No `itemCondition`, `shippingDetails`, `hasMerchantReturnPolicy`, ratings or reviews.
- No composite variant family design.
- No Merchant feed activation or M3/M4 implementation.
- No change to search indexing/canonical activation policy.
- The pre-existing PDP casing/dedup selection behavior is outside U27 and is not refactored here.

No new ADR is required: ADR 0008 already owns manufacturer-MPN/SKU semantics, U12 owns variant URL
addressability, and W4c/ADR 0004 own canonical/search exposure. Variant-name formatting is a
structured-data correctness detail derived from existing product/option facts, not a new architecture
authority.
