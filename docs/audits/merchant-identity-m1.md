# M1 / W4a — Merchant identity, MPN, media and durability audit

Canonical audit document for **#153 M1 — Merchant read-only identity/durability/catalog audit** and **Checkpoint D**. Manufacturer-MPN ownership/lifecycle is governed by **ADR 0008**.

## Status

- **M1 implementation:** **GREEN** for the reviewed read-only audit behavior, ownership boundaries, validation, media parity and regressions.
- **M1 operational real-catalog closure:** **PENDING** one authorized rerun on an exact committed post-fix SHA with clean/dirty worktree state recorded.
- **Checkpoint D:** **OPEN / BLOCKED on attributable real-catalog rerun evidence**. The older catalog counts below remain useful observations but are not relabelled as proof produced by the final implementation tree.
- **Downstream Merchant Feed Activation:** Remains **PENDING** under M3 (O3 runtime + offer mapper), M4 (bounded feed route/cache), and later activation gates. M1 implementation does not authorize feed activation.

---

## 1. Executive summary

| Criteria | Status | Evidence |
|---|---|---|
| **Offer ID (`id`)** | **IMPLEMENTATION GREEN / OPERATIONAL RERUN PENDING** | Recorded observation: 149/149 intended standalone variation IDs present, within the 50-character bound, no rejected invalid Unicode/whitespace, 0 duplicates. Final gate requires the same audit on an attributable post-fix SHA. |
| **Product Group ID (`item_group_id`)** | **IMPLEMENTATION GREEN / OPERATIONAL RERUN PENDING** | Recorded observation: 35/35 standalone product IDs present and within the 50-character bound. Final gate requires an attributable post-fix rerun. |
| **External-ID durability** | **PROVEN via §3.3 Option B** | PR #175 controlled live experiment on `a132` + repository external-ID reconciliation tests. |
| **Manufacturer SKU / MPN** | **IMPLEMENTATION GREEN / OPERATIONAL RERUN PENDING** | Owner-confirmed authority is Pancake variation `display_id`, mirrored as `VariantMirror.pancakeDisplayId` per ADR 0008. Recorded observation: 149/149 PRESENT, 0 MISSING/BLANK/UNTRIMMED/TOO_LONG/INVALID_FORMAT, 0 duplicates. Immediate T0/T1/T2 reads prove consistency; time-separated `a132` observations from 2026-09-02 → 2026-09-04 provide representative lifecycle evidence. Final Checkpoint D still needs an attributable post-fix catalog run. |
| **Local `VariantMirror.sku` ownership** | **UNCHANGED / GREEN** | Website-owned/local field remains preserved across Pancake resync. M1 does not read it as MPN and Pancake sync does not overwrite it. |
| **Media parity** | **IMPLEMENTATION GREEN / OPERATIONAL RERUN PENDING** | Product primary + all active/present sibling variant images in storefront order, delegated to `resolveStorefrontProductMedia`. Recorded observation: 149/149 READY. The post-query per-product candidate list is capped at the shared 100-candidate budget before resolver scanning; raw Prisma JSON materialization occurs before that cap. |
| **Composite isolation** | **IMPLEMENTATION GREEN / OPERATIONAL RERUN PENDING** | Recorded observation: 116 composite members classified `COMPOSITE_DEFERRED`; 0 standalone leakage. Final gate requires attributable current-catalog confirmation. |
| **Price readiness** | **RECORDED OBSERVATION** | 149/149 resolved by the storefront pricing authority in the recorded run. |
| **Availability** | **PARTIAL / NOT READY** | 77 `IN_STOCK`, 69 `OUT_OF_STOCK`, 3 `AVAILABILITY_UNRESOLVED`. M3 must exclude unresolved rows fail-closed. |
| **Editorial descriptions** | **NOT READY** | 0 published descriptions, 149 draft/missing in the recorded run. |
| **Apparel facts (O3)** | **Policy RESOLVED / Runtime BLOCKED** | ADR 0007 settles defaults/override policy; persistence/admin/effective resolution remains M3 scope. |

---

## 2. Recorded pre-final real-catalog run — supporting observation, not Checkpoint D closure evidence

Command:

```bash
DATABASE_URL=... PANCAKE_SHOP_ID=1635185058 pnpm merchant:identity:audit
```

Recorded environment/evidence:

- production VPS / Pancake shop `1635185058`;
- isolated PostgreSQL mirror clone `la_clothing_m1_audit`; production DB was not intentionally mutated by the M1 branch;
- timestamp: `2026-09-04T15:59:15Z`;
- the committed PR branch head at that timestamp was `ee98bd10e04e73df3d9bf1183d0c38eddf687c5d`; the run record did **not** capture worktree dirty state;
- therefore the run cannot be attributed to an immutable exact execution tree and is **not** sufficient to close the final post-fix M1/Checkpoint D operational gate;
- later PR #194 tests/CI verify the corrected read-only ownership/media/Unicode implementation separately, but CI fixtures do not substitute for the required authorized real-catalog rerun;
- the required closure rerun must record exact committed SHA, clean/dirty worktree state, command/context, timestamp and refreshed counts.

Recorded summary:

```json
{
  "pancakeShopId": 1635185058,
  "totalVariations": 356,
  "compositeDeferred": 116,
  "emittableStandaloneVariations": 149,
  "variationIdentifiers": {
    "PRESENT": 149,
    "MISSING": 0,
    "BLANK": 0,
    "UNTRIMMED": 0,
    "TOO_LONG": 0,
    "INVALID_FORMAT": 0
  },
  "productIdentifiers": {
    "PRESENT": 35,
    "MISSING": 0,
    "BLANK": 0,
    "UNTRIMMED": 0,
    "TOO_LONG": 0,
    "INVALID_FORMAT": 0
  },
  "sku": {
    "PRESENT": 149,
    "MISSING": 0,
    "BLANK": 0,
    "UNTRIMMED": 0,
    "TOO_LONG": 0,
    "INVALID_FORMAT": 0
  },
  "duplicateVariationIds": [],
  "duplicateSkus": [],
  "mpnReady": true,
  "price": {
    "READY": 149,
    "PRICE_UNRESOLVED": 0
  },
  "availability": {
    "IN_STOCK": 77,
    "OUT_OF_STOCK": 69,
    "AVAILABILITY_UNRESOLVED": 3
  },
  "media": {
    "READY": 149,
    "MISSING": 0,
    "UNTRUSTED": 0
  },
  "title": {
    "READY": 149,
    "MISSING": 0,
    "MALFORMED": 0
  },
  "description": {
    "READY": 0,
    "MISSING": 149,
    "MALFORMED": 0
  },
  "merchantFactsReady": 0,
  "apparelFacts": {
    "policy": "RESOLVED",
    "productOverrides": "NOT_IMPLEMENTED",
    "verdict": "BLOCKED"
  },
  "durability": {
    "mirrorReconcilesByExternalId": true,
    "upstreamLifetimeProven": false,
    "verdict": "BLOCKED"
  }
}
```

The JSON key `sku` is historical report compatibility: after the Review `5115581893` remediation, the M1 repository populates that candidate-MPN field from mirrored **`pancakeDisplayId`**, not from website-owned `VariantMirror.sku`.

The script's local `durability.verdict: "BLOCKED"` is also intentional: a DB-only process cannot independently prove upstream lifetime semantics. External-ID durability is established by §3.3 Option B evidence below.

---

## 3. Manufacturer SKU / MPN source-of-truth

ADR 0008 records the reviewed ownership boundary:

- LA Clothing is the manufacturer/brand owner.
- Codes such as `A132-S`, `A132-M`, `A132-L`, `A132-XL`, `A132-XXL` are manufacturer-assigned LA Clothing SKUs/MPNs.
- Pancake exposes them as variation `display_id`.
- The mirror stores that external fact as `VariantMirror.pancakeDisplayId`.
- **`VariantMirror.sku` remains website-owned/local and is preserved across Pancake resync.** M1 remains read-only and does not repurpose that field.
- MPN never falls back to barcode, Pancake UUID, local CUID, slug, option label or array position.
- `identifier_exists=false` is not an approved escape path for this catalog because manufacturer identifiers exist.

The external adapter now treats missing/null `display_id` as null and fails closed when a present value is a non-string. Dedicated parser-level regressions pin that trust boundary.

### Current full-catalog MPN observation

The authorized read-only Pancake traversal observed 356 total variations over 4 pages and 149 intended standalone launch records:

- `PRESENT`: **149**
- `MISSING`: **0**
- `BLANK`: **0**
- `UNTRIMMED`: **0**
- `TOO_LONG`: **0**
- `INVALID_FORMAT`: **0**
- duplicate manufacturer MPNs: **0**

These counts are retained as supporting observation. Because that run did not capture exact immutable execution-tree provenance after the final implementation corrections, they do not by themselves close Checkpoint D.

Representative `a132` values:

| Size | Pancake Variation ID | Manufacturer MPN (`display_id`) | Barcode |
|---|---|---|---|
| S | `5fb045fa-af8a-4fc9-95f8-8c30d02027b4` | `A132-S` | `145-5` |
| M | `9ea76227-51f0-45a2-b5cc-f6b42e5ec3da` | `A132-M` | `145-1` |
| L | `fc45eab8-ed4e-4f25-87d1-70944026d655` | `A132-L` | `145-2` |
| XL | `b185e908-caf3-4394-8c6a-692e5cf4c51a` | `A132-XL` | `145-3` |
| XXL | `9c2657ae-1de0-4037-86a0-26cc5d4949b9` | `A132-XXL` | `145-4` |

Barcode and variation UUID are therefore distinct from the manufacturer MPN and are not used as fallbacks.

---

## 4. Manufacturer-MPN lifecycle evidence

### Immediate consistency: T0 / T1 / T2

Full-catalog repeated reads recorded:

- T0: `2026-09-04T15:50:38.351Z` — 356 variations;
- T1: `2026-09-04T15:50:39.946Z` — 356 variations;
- T2: `2026-09-04T15:50:50.790Z` — 356 variations;
- correlation key: `pancakeVariationId`;
- result: 356/356 retained the same `display_id` across these reads.

**Interpretation:** this is consistency evidence only. Seconds-apart reads are not described as a lifecycle proof.

### Time-separated representative lifecycle evidence

The `a132` production experiment in PR #175 ended on **2026-09-02** with a fresh GET proving exact restoration of `display_id = A132-S/M/L/XL/XXL` on the same five `pancakeVariationId` values. The PR #194 authorized live reads on **2026-09-04** observed the same five manufacturer MPN values on those same five variation IDs.

That two-day separation supplies representative evidence that ordinary time/resync activity does not randomly rewrite the manufacturer MPN. It supplements, rather than replaces, the stronger PR #175 controlled external-ID durability experiment.

### Lifecycle contract

- Manufacturer MPN is expected to remain stable across ordinary catalog reads/resyncs and unrelated product edits when the owner has not intentionally changed it.
- An intentional owner reassignment of `display_id` is an explicit catalog metadata change and may change future Merchant `mpn`.
- Such a deliberate reassignment does **not** remap offer/mirror identity; reconciliation remains keyed by `pancakeVariationId`.
- The repository test therefore correctly preserves local `VariantMirror.sku` across Pancake changes instead of turning the local field into a second copy of `display_id`.

---

## 5. Media authority and bounded storefront parity

M1 uses the same product-level candidate scope as the storefront:

1. `ProductMirror.primaryImageUrl`;
2. all `isPresent=true && isActive=true` sibling variant `pancakeImageUrls` for that product;
3. sibling order `pancakeVariationId ASC`;
4. source order preserved inside each variant image array;
5. trusted selection delegated to `resolveStorefrontProductMedia()`.

The audit performs one bounded variation query and groups candidates in memory; it does not issue a sibling query per row. Prisma has already materialized each selected row's raw `pancakeImageUrls` JSON before the grouping helper runs. **After that DB materialization boundary, the copied per-product candidate list is capped at `MAX_MEDIA_CANDIDATES_SCANNED = 100` before the storefront resolver scans it.** This bounds the post-query candidate list and resolver work; it does **not** claim a per-array cap on raw JSON materialization inside Prisma.

Regression coverage proves:

- variant A with no image + active sibling B with trusted image → product-level media is READY for A and B;
- image only on inactive sibling → does not make active variant READY;
- >100 untrusted candidates followed by a trusted image beyond the post-query candidate budget → only the first 100 copied candidates are passed to the resolver and the late candidate cannot alter the verdict.

Recorded real-catalog observation: **149 READY / 0 MISSING / 0 UNTRUSTED**. An attributable post-fix rerun is still required before this count closes Checkpoint D.

---

## 6. Google Merchant format validation

Official Google Merchant Center sources were checked on **2026-09-04**:

| Attribute | Source limit | Repository policy |
|---|---|---|
| `id` | 1–50 Unicode characters | max 50 code points; reject invalid Merchant Unicode; LA Clothing additionally rejects any whitespace instead of relying on Google normalization |
| `item_group_id` | 1–50 characters | same conservative identifier policy |
| `mpn` | 1–70 characters | max 70 code points; conservative invalid-Unicode rejection; no guessed/fallback value |

Sources:

- `id`: https://support.google.com/merchants/answer/6324405
- `item_group_id`: https://support.google.com/merchants/answer/6324507
- `mpn`: https://support.google.com/merchants/answer/6324482

Google's ID guidance says to **avoid whitespace** and may normalize it; “reject all whitespace” is therefore LA Clothing project hardening, not quoted as Google's exact normalization behavior.

The validator:

- counts length with `Array.from(value).length` (Unicode code points);
- rejects malformed UTF-16;
- rejects `Cc`, `Cf`, `Co`, `Cn` invalid-Unicode categories;
- additionally rejects supplementary-plane code points represented by UTF-16 surrogate pairs, matching the current Google ID invalid-Unicode example conservatively;
- keeps normal BMP Unicode letters such as Vietnamese `đ` valid within the length bound.

---

## 7. Read-only mirror integration and ownership regressions

M1 intentionally makes **no Pancake → local-SKU write**.

`catalog-mirror-repository.ts` continues to mirror:

```ts
pancakeDisplayId: variation.displayId
```

while leaving `VariantMirror.sku` untouched on create/update according to the pre-existing local ownership contract.

Tests prove both directions:

- a locally set `VariantMirror.sku = "LOCAL-SKU"` survives a Pancake resync even when `display_id` changes;
- M1 reads `pancakeDisplayId` as the manufacturer MPN candidate and does not let a populated/duplicate local `sku` rescue or contaminate a missing/unique MPN verdict;
- `display_id = null` does not fall back to barcode, UUID, slug or local SKU;
- identity reconciliation remains keyed by `pancakeVariationId`, not manufacturer MPN.

This keeps U9/M1 inside the master plan's **read-only audit** boundary and leaves any future ownership migration of `VariantMirror.sku` as a separate reviewed decision.

---

## 8. External-ID durability evidence preserved from PR #175

External identifier durability is proven under **§3.3 Option B** through controlled upstream mutation/restore evidence plus repository reconciliation.

### Controlled live experiment on production `a132`

- production VPS, Node.js v22.23.2, shop `1635185058`;
- **exact experiment execution SHA:** `847b4d49d76edd2939803002b27fc19d223e7236`;
- executed `2026-09-02T13:34:15Z`–`2026-09-02T13:34:28Z`;
- run ID `310af19f`;
- product ID `4b838ecb-6eb3-4e38-bc89-c1e6e8890a3d`;
- five variations S/M/L/XL/XXL.

The experiment independently correlated the product/variations with owner-controlled markers, verified the pre-mutation IDs before changing fields, performed controlled reversible mutations, and verified fresh GET restoration. The final evidence reported:

```text
setupPreservedIds: true
productMarkerStable: true
variationMarkersStable: true
allMarkersRetainedSameIds: true
remapDetected: false
duplicateMarkersDetected: false
missingMarkersDetected: false
unexpectedMarkersDetected: false
productionProductRestored: true
verdict: STABLE
```

The pre-mutation and restored manufacturer-facing values were also recorded separately from `custom_id`:

| Size | Stable variation ID | Pre/Restored `custom_id` | Pre/Restored `display_id` |
|---|---|---|---|
| S | `5fb045fa-af8a-4fc9-95f8-8c30d02027b4` | `null` | `A132-S` |
| M | `9ea76227-51f0-45a2-b5cc-f6b42e5ec3da` | `null` | `A132-M` |
| L | `fc45eab8-ed4e-4f25-87d1-70944026d655` | `null` | `A132-L` |
| XL | `b185e908-caf3-4394-8c6a-692e5cf4c51a` | `null` | `A132-XL` |
| XXL | `9c2657ae-1de0-4037-86a0-26cc5d4949b9` | `null` | `A132-XXL` |

Repository regressions separately prove that `ProductMirror` and `VariantMirror` reconcile by `pancakeProductId` / `pancakeVariationId`, not slug, position, option text or local row ID.

Historical supporting context also observed 356/356 stable variation IDs between the production mirror and later live Pancake reads, with 0 disappeared and 0 newly appeared IDs.

Known limitation: Pancake does not publish a perpetual identifier-lifetime SLA; the project therefore relies on reviewed §3.3 Option B empirical evidence rather than claiming a provider guarantee.

---

## 9. Gate result

- **Identifier implementation:** **GREEN**; recorded catalog counts support the expected result, but final current-catalog gate evidence awaits attributable rerun.
- **External-ID durability:** **PROVEN via PR #175 / §3.3 Option B**.
- **Manufacturer SKU / MPN implementation:** **GREEN** — authority `display_id` → mirrored `pancakeDisplayId`; local `VariantMirror.sku` remains separate. Recorded 149/149 presence/validity/uniqueness and lifecycle observations remain supporting evidence; operational closure awaits exact-SHA rerun.
- **Composite exclusion implementation:** **GREEN**; recorded observation 116 `COMPOSITE_DEFERRED`; operational confirmation awaits rerun.
- **Media implementation:** **GREEN** — product-level storefront parity with a bounded post-query 100-candidate list; recorded catalog observation 149/149 READY; operational confirmation awaits rerun.
- **Availability:** **PARTIAL / NOT READY** — 3 unresolved rows remain a downstream M3 exclusion concern.
- **Apparel runtime:** **BLOCKED under M3**.

### Checkpoint D verdict: OPEN / PENDING ATTRIBUTABLE REAL-CATALOG RERUN

Two requirements have accepted evidence and the third has implementation + supporting observations but not final attributable execution evidence:

1. **PENDING:** rerun the real-catalog identity/MPN/media/composite audit on an exact committed post-fix SHA and record SHA + clean/dirty state + refreshed counts;
2. **GREEN:** standalone deep-link/addressability contract via U12/M2 / PR #180;
3. **IMPLEMENTATION GREEN / CURRENT-CATALOG CONFIRMATION PENDING:** composite products remain intentionally absent (`COMPOSITE_DEFERRED`).

Until item 1 is satisfied, M1 operational closure and Checkpoint D remain open. This does **not** roll back the reviewed implementation fixes in PR #194; it prevents CI fixture evidence or an unattributable earlier catalog run from being overstated as the final operational gate.