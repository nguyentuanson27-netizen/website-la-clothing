# M1 / W4a — Merchant identity and durability audit

Updated for PR #194 after review comment `5542421957`.

## Status

**PARTIAL / BLOCKED.** M1 is not closed and Checkpoint D must remain open until both of these are evidenced:

1. a stable manufacturer-owned SKU/MPN authority for LA Clothing's standalone launch set; and
2. a fresh real-catalog media audit after the product-level storefront media parity fix in PR #194.

No `identifier_exists=false` omission contract is approved for the current LA Clothing catalog. Pancake not exposing a `sku` field does not prove that manufacturer MPNs do not exist. `display_id`, barcode, local CUIDs, slugs and Pancake opaque IDs must not be re-labelled as MPN without manufacturer authority.

## Evidence that remains valid

The latest authorized catalog run before the media-parity correction established these facts, which are unaffected by the media projection fix:

- 149 emittable standalone variations;
- 35 standalone product families;
- 149/149 variation IDs present;
- 35/35 product IDs present;
- current Pancake IDs are UUID-shaped ASCII values within the 50-character Merchant limit;
- 0 duplicate emitted variation IDs;
- 116 composite records classified `COMPOSITE_DEFERRED`;
- availability: 77 `IN_STOCK`, 71 `OUT_OF_STOCK`, 1 `AVAILABILITY_UNRESOLVED`;
- SKU/MPN mirror readiness: 0 present / 149 missing, so `mpnReady=false`;
- title XML readiness: 149 ready;
- published description readiness: 0 ready / 149 missing;
- apparel policy resolved by ADR 0007, runtime override persistence/validation/admin/effective projection still blocked under M3.

External-ID durability remains **PROVEN via §3.3 Option B** from PR #175: the controlled reversible `a132` experiment plus repeated full-catalog observations and repository reconciliation tests established stable `pancakeProductId` / `pancakeVariationId` identity for the same upstream objects.

## Identifier validation in PR #194

Merchant-facing `id` / `item_group_id` validation is fail-closed and uses the reviewed 50-character limit. Candidate MPN validation uses the reviewed 70-character limit. Invalid Unicode categories and malformed UTF-16 are rejected.

Length is counted as Unicode code points rather than JavaScript UTF-16 code units. LA Clothing additionally rejects whitespace in Merchant `id` / `item_group_id` as a stricter project hardening policy.

This proves format eligibility of the current ASCII Pancake IDs; it does **not** supply an MPN.

## Media authority in PR #194

The previous `145 READY / 4 MISSING` media result is **superseded and must not be used as current evidence**. That run evaluated product primary + each row's own variant images and could false-negative a variation when a sibling variation supplied the storefront product image.

The corrected repository now assembles the same product-level candidate scope used by the storefront:

1. `ProductMirror.primaryImageUrl`;
2. all `isPresent=true` + `isActive=true` variants for the same product;
3. variants ordered by `pancakeVariationId ASC`;
4. each variant image array kept in source order;
5. trusted selection delegated to `resolveStorefrontProductMedia`.

A trusted sibling image therefore makes the product media available to every active standalone variation of that product, while media that exists only on an inactive sibling does not.

**Fresh production/current-mirror counts are pending.** Run the authorized M1 audit again after this code reaches the environment that contains the real catalog, then replace the stale media count with exact current evidence.

## MPN gate

LA Clothing is the manufacturer/brand owner for this catalog. The current mirror result (`VariantMirror.sku = null` on the audited standalone set) is evidence only that the website mirror currently lacks a manufacturer SKU value. It is not evidence that an MPN should be omitted.

Before Checkpoint D can pass, establish the manufacturer-owned SKU/MPN authority and prove, for every intended standalone emitted variation:

- present;
- unique where required;
- stable across normal catalog sync;
- within Merchant bounds;
- not derived from barcode, `display_id`, local IDs or other unapproved proxies.

If Pancake cannot expose the manufacturer SKU, a separate reviewed website-owned persistence/source decision is required; M1 must not invent one.

## Gate result

- Identifier format: **PROVEN for current audited IDs**.
- Identifier durability: **PROVEN via PR #175 / `a132`**.
- Composite exclusion: **PROVEN**.
- MPN: **BLOCKED / `mpnReady=false`**.
- Media implementation parity: **FIXED IN PR #194; real-catalog rerun pending**.
- Availability: **PARTIAL / NOT READY** because one record remains unresolved.
- Apparel runtime: **BLOCKED under M3**.

Therefore **M1 / Checkpoint D is not complete yet**. Do not start Merchant feed activation from this evidence.
