# Pancake product source content contract

Status: **P1 reviewed source contract implemented; live reviewed-contract verification remains a final gate.**

This document covers only the Pancake product-level source fields introduced by FINAL PLAN V2 P1. Persistence belongs to P2 and render trust belongs to P3.

## Source mapping

The production catalog adapter maps these documented Pancake fields from the nested product object returned with product variations:

- `product.note_product` → `product.sourceDescription`
- `product.image` → `product.primaryImageUrl`

Both internal fields are source-owned, read-only inputs for later productization work. Missing, `null`, empty, or whitespace-only values normalize to `null`. Nonblank strings are preserved rather than rewritten.

`product.note` is an internal/private Pancake note and is deliberately not read or exposed by the mapped catalog contract. Tests assert that a private-note sentinel cannot cross the adapter output boundary.

## Boundary validation

Pancake responses are untrusted external input. The P1 adapter therefore fails closed when either mapped source field is not a string/nullish or exceeds the reviewed processing bound:

- `sourceDescription`: maximum 100,000 characters
- `primaryImageUrl`: maximum 4,096 characters

For `primaryImageUrl`, P1 also validates the documented URI syntax after the type/length/blank checks. Before absolute-URI parsing, the raw source value must contain only the RFC3986 raw ASCII URI character set, and each percent sign must begin a valid `%HH` triplet. Raw non-ASCII, whitespace/control characters, backslashes, angle brackets, backticks, braces, and malformed percent-encoding therefore fail closed instead of being accepted because WHATWG URL parsing can normalize them. A bounded nonblank value that fails these syntax checks is rejected with the existing fixed `variation-product-image` reason. The original external scalar is never normalized into an accepted value merely because the URL parser could rewrite it.

This validation remains syntax-only: a syntactically valid non-HTTPS URI may still cross the P1 source adapter because scheme/origin/path render trust is deliberately deferred to P3.

Failures use fixed internal reason codes (`variation-product-description` and `variation-product-image`) and do not echo the external value.

P1 does **not** decide whether an image URI is renderable. HTTPS/origin/path allowlisting, deduplication, primary/gallery selection, and SSRF/open-proxy review belong to P3. P1 does not fetch image URIs.

## P0 live evidence carried forward

The reviewed trusted-local P0 aggregate for the current website publication scope established:

- current products: 1
- current variations: 1
- `note_product` coverage: 0/1 (0%), malformed 0
- current media references: 1
- exact reviewed media origin: `https://content.pancake.vn`
- exact reviewed media path shape: `/:segment/:id/:id/:id/:file.jpg`

Therefore P1 maps `note_product` because it is part of the documented source contract, but current live evidence does not justify assuming product-description coverage. P3 must not broaden the reviewed image origin/path evidence.

## Compatibility

`PancakeCatalogVariation.product` exposes the new source properties additively so existing internal synthetic/fake consumers that construct catalog variations do not need unrelated P1 edits. The production parser itself always emits explicit `string | null` values for both fields.

No database schema, catalog mirror persistence, storefront rendering, SEO field, or editorial field is changed by P1.

## Verification

Repository verification covers:

- RED/GREEN parser tests for source mapping;
- null/blank normalization;
- wrong-type and oversized fail-closed behavior;
- invalid URI-syntax rejection for `product.image`;
- malformed percent-encoding plus raw non-RFC3986 ASCII/non-ASCII rejection before URL-parser normalization;
- focused regressions for raw whitespace/control, non-ASCII, backslash, angle bracket, backtick, and brace syntax;
- a syntactically valid non-HTTPS URI case to preserve the P1/P3 responsibility split;
- private `product.note` non-exposure;
- sanitized reviewed fixture compatibility;
- existing domain/integration/build gates.

Final P1 acceptance also requires the trusted reviewed-contract verifier against the live shop:

```bash
pnpm pancake:contract:verify
```

Only sanitized verifier output should be retained. Do not commit or paste API credentials or raw Pancake payloads.
