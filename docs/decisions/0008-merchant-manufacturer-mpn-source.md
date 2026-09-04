# ADR 0008 — Merchant manufacturer MPN source and SKU ownership

- Status: **Accepted**
- Date: 2026-09-04
- Scope: Google Merchant v1 standalone offers / M1 → M3

## Context

LA Clothing is the manufacturer and brand owner. The repository needs one truthful manufacturer part number (MPN) source for Merchant offers without changing unrelated catalog ownership semantics.

The owner confirmed that codes such as `A132-S`, `A132-M`, `A132-L`, `A132-XL` and `A132-XXL` are official manufacturer-assigned LA Clothing SKUs/MPNs. In Pancake these values are exposed on each variation as `display_id` and are mirrored by the website as `VariantMirror.pancakeDisplayId`.

`VariantMirror.sku` predates Merchant work as a website-owned/local field. The reviewed catalog-mirror contract preserves that field across Pancake resyncs. M1 is defined by the growth-commerce master plan as a read-only audit, so M1 must not silently repurpose or overwrite that local field.

## Decision

1. **Merchant manufacturer MPN authority** is the owner-confirmed Pancake variation `display_id` value.
2. The website mirrors that upstream value in **`VariantMirror.pancakeDisplayId`**. M1 audits `pancakeDisplayId` directly; M3 will consume the audited value as `mpn` for eligible standalone offers.
3. **`VariantMirror.sku` remains website-owned/local.** Pancake catalog sync does not create, overwrite, clear, or otherwise derive `VariantMirror.sku` from `display_id`, barcode, UUID, slug, or any other Pancake field.
4. Barcode, `pancakeVariationId`, local CUID, slug, option labels and array position are never MPN fallbacks.
5. Missing, blank, malformed, overlong or duplicate `pancakeDisplayId` values fail the MPN readiness audit; M1/M3 do not generate a replacement.
6. Merchant offer identity remains `pancakeVariationId`; MPN is product metadata and is not an identity reconciliation key.

## Manufacturer-SKU lifecycle contract

A manufacturer SKU/MPN is expected to remain stable across ordinary catalog reads, resyncs, and unrelated product/variation edits when the owner has not intentionally changed the SKU.

An intentional owner reassignment of `display_id` is allowed as an explicit catalog-data change. It changes the MPN observed by future Merchant projections but **does not** remap the offer or mirror row: reconciliation continues by `pancakeVariationId`. Such a deliberate edit is not treated as random identifier instability, and downstream consumers must not cache the old MPN as immutable identity.

## Evidence

- PR #175 controlled production experiment, executed 2026-09-02, recorded and then freshly verified exact restoration of the five `a132` variation `display_id` values (`A132-S` through `A132-XXL`) on the same five `pancakeVariationId` values.
- PR #194 live read-only observation on 2026-09-04 observed those same five `display_id` values on the same variation IDs. This is a time-separated representative lifecycle observation across two days, not merely an immediate repeated read.
- PR #194 full current-catalog read found 149/149 intended standalone MPN candidates present, Merchant-bounded and unique. T0/T1/T2 full-catalog reads (356/356 stable between immediate observations) are retained only as consistency evidence, not as the lifecycle proof by themselves.
- Repository regressions preserve local `VariantMirror.sku` across Pancake `display_id` changes and separately prove that M1 reads the manufacturer MPN from `pancakeDisplayId` rather than falling back to local `sku`.

## Consequences

- M1 remains read-only and compatible with the master-plan U9 boundary.
- No schema migration is required.
- Existing local `VariantMirror.sku` values remain intact across resyncs.
- M3 has one reviewed MPN source: `VariantMirror.pancakeDisplayId`.
- If LA Clothing later changes the authoritative SKU system or wants Pancake sync to own `VariantMirror.sku`, that is a separate reviewed source-of-truth/migration decision and must include backward-compatibility evidence.
