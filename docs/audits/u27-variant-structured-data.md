# U27 — ProductGroup / variant structured-data implementation audit

Status: **IMPLEMENTED IN PR #196; exact-head CI remains the merge gate.**

Scope: #152 W4d + the variant-level portion of W5 only. This document records the focused
implementation contract after reconciling PR #196 with `main@c3f050807a95c1f3f43db2f2c053e0007b9e598a`.
It does not reopen Merchant M3/M4, product-level U32 attributes, search-index activation, composite
Merchant support, or unrelated SEO work.

## Source authorities

U27 does not create a second authority for any commerce fact:

- variant addressability: U12 `/shop/<slug>?variant=<pancakeVariationId>` resolver/builder;
- variant external address identity: `pancakeVariationId`;
- manufacturer MPN: ADR 0008, Pancake variation `display_id` mirrored as
  `VariantMirror.pancakeDisplayId`;
- product family identity: `pancakeProductId`;
- variant name specificity: existing product family `name` plus factual storefront `color` / `size`
  values already published for that variant; no merchandising attribute is inferred;
- price: the same promotion-aware PDP projection rendered to the shopper;
- availability: the same projection's `purchasable` / `unavailableReason` state;
- media: trusted storefront gallery + server-resolved `galleryIndexByVariantId`;
- canonical/search exposure: existing W4c / ADR 0004 policy, unchanged by U27.

Local `VariantMirror.sku`, barcode, local CUID, kind key, array position, and color/size concatenation
are not substitutes for the reviewed manufacturer MPN or public variation identity. Color/size are
used only as factual variant-identifying text when making each nested `Product.name` more specific
than the shared `ProductGroup.name`.

## ProductGroup contract

A standalone family may publish `ProductGroup` only when:

1. `pancakeProductId` is bounded and publishable;
2. at least two surviving variants genuinely differ on `color` and/or `size` under the storefront
   option identity rule;
3. each surviving variant round-trips through the U12 resolver to the same option;
4. each surviving variant has a current, bounded, valid and unique ADR-0008 manufacturer MPN;
5. each surviving variant has an exact resolved price and either is purchasable or is unavailable
   specifically because it is out of stock;
6. each surviving variant has at least one factual `color` / `size` value so its nested `Product.name`
   can be more specific than the common group name without invented copy.

Each published variant is a nested `Product` with:

- `name` deterministically composed as product family name followed by present factual `color` then
  `size`, separated by ` — ` (for example `Áo Oxford Relaxed — Đen — M`);
- `url` / `@id` derived from the exact U12 query URL;
- `mpn = pancakeDisplayId`;
- truthful `color` / `size` when present;
- trusted variant image when the resolved gallery mapping exists;
- one exact `Offer` with VND price and `InStock` / `OutOfStock` availability.

The formatter does not infer category, gender, material, description, SKU, GTIN, MPN text, or other
merchandising copy into the variant name. The group carries no `offers`, `AggregateOffer`,
`lowPrice`, `highPrice`, or `offerCount`. `ProductGroup` replaces the old product-level `Product` at
the graph position rather than joining it, so the page has one product-schema authority.

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
guidance also requires each nested variant `Product.name` to be more specific than the common
`ProductGroup.name`, based on variant-identifying properties. U27 therefore keeps the reviewed U12/W4c
query contract and makes variant names specific from factual color/size values rather than inventing
new catalog copy.

Current project search exposure is also unchanged: the temporary production domain remains globally
noindex by ADR 0004/enforcement, and non-canonical query requests remain fail-closed under the
existing search-exposure policy. U27 does not activate organic indexing. Permanent-domain/index
launch still follows the independent search launch gates and runtime verification.

Official sources re-checked for this correction on 2026-09-05:

- https://developers.google.com/search/docs/appearance/structured-data/product-variants
- https://schema.org/ProductGroup
- https://schema.org/Product
- https://schema.org/mpn

Google Search Central's Product Variant page reported `Last updated 2026-05-20 UTC` at review time.

## Regression / HTTP evidence required on the PR head

The PR test contract covers:

- ProductGroup + exact nested Product/Offer shape;
- variant-specific nested `Product.name` values derived only from family name + factual color/size;
- unique ADR-0008 MPN on every published variant;
- missing/invalid/duplicate MPN fail-closed behavior;
- U12 builder/resolver URL round trip;
- exact promotion-aware per-variant prices with no range collapse;
- stock-only `OutOfStock` and unresolved-price/unexplained-unavailability exclusion;
- `variesBy` using the storefront option identity rule;
- trusted media mapping and invalid gallery-index omission;
- composite non-remodelling and product-level fallback;
- no internal ids, local SKU, inferred GTIN, AggregateOffer, rating/review, shipping or return-policy
  claims;
- JSON-LD script-breakout escaping;
- real HTTP reopening of every published variant URL and parity with nested variant name, rendered
  option, and rendered price.

`scripts/structured-data-http-smoke.ts` seeds distinct manufacturer MPNs, parses the served JSON-LD,
asserts factual variant-specific names, those MPNs and exact Offers, excludes unpriceable/inactive
variants and their MPNs, then requests each published variant URL to prove it preselects the same
variant and renders the same price.

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
addressability, and W4c/ADR 0004 own canonical/search exposure.