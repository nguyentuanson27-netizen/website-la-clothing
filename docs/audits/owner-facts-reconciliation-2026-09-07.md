# Owner-facts reconciliation — 2026-09-07

**Status:** CURRENT-TRUTH RECONCILIATION — docs/source-of-truth only  
**Reconciled from:** `main@c90b8e14b874c5eb0ce4b802d70177f1d2a9aa68`  
**Owner authority:** `@nguyentuanson27-netizen`  
**Normative owner source:** `docs/specs/la-clothing-owner-approved-facts-and-decisions.md`

This record reconciles owner decisions that arrived after the historical SEO/GEO and marketing
planning artifacts were written. It changes **owner-decision status only**. It does not implement
runtime behavior, does not satisfy any implementation acceptance criterion by itself, and does not
turn a resolved owner decision into a launch approval.

## Precedence

For the owner-controlled facts/decisions listed below:

1. `docs/specs/la-clothing-owner-approved-facts-and-decisions.md` is the current source of truth.
2. Earlier `BLOCKED — OWNER FACT/APPROVAL REQUIRED`, `proposed`, or unchecked owner-gate wording in
   historical audits/plans/checklists is superseded **only for that owner decision**.
3. The owning audit/spec/plan remains authoritative for technical behavior, implementation order,
   acceptance criteria, tests, security, compatibility, and launch gates.
4. A unit marked `UNBLOCKED` here is **not implemented** and must still follow its owning task/spec
   from latest reviewed `main`.
5. Items explicitly `OPEN` in the owner source remain fail-closed and must not be inferred.

This preserves historical planning evidence without forcing every old document to be rewritten as
if the owner facts had existed when it was authored.

## Reconciled owner gates

| Gate / unit | Previous roadmap state | Current owner decision | Execution consequence |
|---|---|---|---|
| **B1 / U33 Returns** | Blocked on complete return policy | **RESOLVED** — 15-day window; approved exchange/refund/shipping responsibility rules; no separate excluded category list | U33 Returns work is owner-unblocked; implementation remains open |
| **B2 / U32b + U33 Contact** | Blocked on phone/email/address/hours/social | **RESOLVED** — hotline/Zalo, email, address, support hours and Facebook Fanpage approved | U32b Organization enrichment and U33 Contact work are owner-unblocked |
| **B3 / U33 Size Guide** | Blocked on size measurements/semantics/tolerance | **RESOLVED** — two approved charts, centimetres, circumference semantics, ±3 cm tolerance | U33 Size Guide is owner-unblocked |
| **B4 / U33 Shipping/Payment** | Blocked on coverage/carrier/ETA/tracking/phone-confirmation policy | **RESOLVED** — nationwide, GHN/GHTK, 1–3 day inner-city and 3–15 day other-province estimates, no default carrier tracking, optional verification call | U33 Shipping/Payment is owner-unblocked; current server-owned shipping-price policy stays authoritative |
| **B5 / U29 W2b** | Blocked on discriminator-vs-enforcement and pair-vs-field uniqueness | **RESOLVED** — enforce **pair-level** `(seoTitle, seoDescription)` uniqueness for published products; missing/duplicate copy allowed in draft; collision blocks publish | U29 may plan/build enforcement and real-catalog verification; slug/path copy must remain until enforcement + verification pass |
| **B6 / U33 About** | Blocked on legal/brand facts | **RESOLVED FOR MINIMAL PAGE** — legal entity, address, MST and current positioning may be public; founding year/founder/story/values must not be invented | Minimal About work is owner-unblocked; optional story/values remain open |
| **U36 / W19 crawler governance** | Awaiting owner distribution/data-use policy | **RESOLVED — ALLOW ALL** crawler categories | U36 implementation/documentation is owner-unblocked; this does not enable indexing |
| **O1 Google Ads Purchase value** | Owner decision open | **RESOLVED — merchandise-only** | T8/Ads mapping may use canonical immutable merchandise value once O4 and T8 technical gates are satisfied |
| **O2 Merchant market** | Owner decision open | **RESOLVED — Vietnam / `vi` / `VND`** | M3/M4 may be reconciled to a trusted server-owned market authority; request/caller data still may not self-approve the market |

## Items that remain open

### U35 / Gate S — permanent domain

Still `OPEN / DEFERRED`.

- `la.lanadesign.vn` remains the temporary production domain.
- `SEARCH_INDEXING_ENABLED` remains independently gated.
- Permanent domain, DNS/TLS/routing, Search Console/Bing verification, fresh activation-time sitemap
  capacity evidence, and explicit human approval are still required.

This reconciliation is **not** permission to enable organic indexing.

### O4 / Gate T — real vendor configuration

Still `OPEN`.

Missing reviewed real values:

- GTM Container ID;
- GA4 Measurement ID;
- Google Ads Conversion ID;
- Google Ads Conversion Label;
- TikTok Pixel ID.

Fail-closed config/schema/placeholders may be prepared, but no dummy value may become production
configuration, no actual GTM load may bypass the existing T8 export audit, and no unnecessary CSP
origin may be opened.

### Merchant ↔ JSON-LD family-collapse contract

Still `OPEN — ENGINEERING PROPOSAL REQUIRED`.

The current known divergence remains: when filtering leaves one publishable standalone sibling,
Merchant can publish the exact surviving variant while U27 structured data can collapse to a
product-level `Product` without exact variant identity. This reconciliation chooses neither
structured-data nor Merchant behavior. A focused engineering proposal/review must settle the
contract before the parity launch gate can close.

## Roadmap consequences

The following units are now **owner-unblocked, not complete**:

- U29 / W2b — metadata uniqueness enforcement + real-catalog proof before slug/path cleanup;
- U32b / W6 — Organization enrichment from approved contact/legal facts;
- U33 / W13 — evergreen About/Returns/Shipping/Size/Contact/policy work from one shared approved fact authority;
- U36 / W19 — crawler governance matrix;
- O1/O2-dependent Ads/Merchant planning and implementation slices.

The following remain blocked/deferred by independent gates:

- U35 / Gate S — permanent domain and explicit indexing approval;
- Gate T live — O4 real vendor IDs/access + exact reviewed GTM saved version/export/preview evidence;
- Merchant feed ↔ JSON-LD final parity — family-collapse contract;
- Merchant activation / U41 — still requires Gate M technical/account/site/shipping/returns prerequisites and explicit human activation; O2 resolution alone is not activation;
- optional brand story/values — owner has not approved them.

## No runtime claim

This reconciliation intentionally changes no application code, database schema, environment
configuration, GTM container, Merchant Center account, search-exposure flag, or public page.

No test/build/runtime/browser result is claimed by this document. Any downstream implementation PR
must establish its own RED/GREEN or otherwise appropriate verification and pass the project
Definition of Done.
