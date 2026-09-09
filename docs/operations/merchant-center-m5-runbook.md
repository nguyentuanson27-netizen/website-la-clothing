# Merchant Center M5 activation runbook

Status: **PRE-ACTIVATION / BLOCKED ON MERCHANT CENTER ACCOUNT ACCESS**

Repository authority: PR #228 branch after PR #227. Owner decisions are recorded in `docs/specs/la-clothing-owner-approved-facts-and-decisions.md`.

This runbook executes the operational half of **U41 / #153 M5**. It does not enable organic search indexing, GTM, promotion activation, Merchant listings, or Google Ads campaigns. External account actions must be backed by observed Merchant Center / Google Ads state; repository documentation is not evidence that an external action succeeded.

## 1. Current repository authority

### Storefront and feed

- Temporary production storefront: `https://la.lanadesign.vn`.
- Candidate production Merchant feed URL: `https://la.lanadesign.vn/feeds/google-merchant`.
- `APP_DOMAIN` is server-owned; request `Host`, query strings, headers and callers are not origin/market authority.
- `SEARCH_INDEXING_ENABLED=false` remains mandatory on `la.lanadesign.vn`.
- `/robots.txt` allows public crawling except `/api`; Merchant feed delivery is not under `/api`.

A future permanent-domain cutover is a separate reviewed operation. Do not change Gate S while executing M5.

### Merchant market

PR #226 wired and verified the reviewed server-owned O2 market authority:

- target country: `VN`
- content language: `vi`
- currency: `VND`

Missing, malformed or unapproved runtime values fail closed. Merchant Center configuration must not introduce a second market authority.

### Shipping price authority

The website shipping price is controlled by `readGuestShippingPolicy()` and may be overridden by production environment variables:

- `LA_SHIPPING_FEE_VND`
- `LA_FREE_SHIPPING_SUBTOTAL_VND`
- `LA_FREE_SHIPPING_MIN_QUANTITY`

Owner production confirmation on 2026-09-09 says the VPS currently matches repository values:

- standard shipping fee: `30,000 VND`
- free shipping when subtotal is **greater than** `1,000,000 VND`
- or free shipping from `3` items

This is **owner-provided production confirmation**, not an independent SSH/runtime observation by the coding agent.

### Delivery authority

Approved customer-facing delivery facts:

- coverage: nationwide Vietnam
- carriers: GHN, GHTK
- LA Clothing inner-Hanoi business zone: 1–3 day end-to-end estimate
- outside that zone / other provinces and cities: 3–15 day end-to-end estimate
- these are estimates, not guaranteed SLAs
- no carrier tracking link/number is provided by default

The detailed 48-ward list is an **LA Clothing business delivery zone**, not a formal post-2025 administrative classification and not an exact boundary-preserving conversion of the former 12 districts.

Owner-approved fulfillment handling input:

- handling business days: **Monday–Saturday**
- minimum handling time: **1 business day**
- maximum handling time: **1 business day**
- carrier handoff: within that one handling business day
- shipping order cut-off: **not separately approved**; do not invent one

The website 1–3 / 3–15 ranges are end-to-end delivery estimates and are **not** Merchant transit-time values.

### Return / exchange authority

Owner-approved current policy states:

- return/exchange window: 15 days from customer receipt
- product must satisfy the published new/unused/tag/no-damage conditions
- return methods: **in store + by mail / carrier**
- for by-mail returns, customer is responsible for sending / return label
- restocking fee: **0 VND**
- customer-initiated exchange fee: `50,000 VND / product`
- customer-initiated exchange shipping: customer pays two-way shipping
- shop/manufacturer fault: LA Clothing pays reasonable return/exchange shipping
- correct, non-defective products **cannot be returned for refund merely because the customer changes their mind**
- customer-change cases remain **exchange-only** under the approved model / size / color exchange policy
- defective / wrong-item cases remain eligible for return under the published policy
- website refund wording: 7–10 **working days** after LA Clothing receives, inspects and confirms eligibility
- COD refunds may use bank transfer or another method agreed with the customer

Merchant return mapping therefore separates the two vendor decisions:

- return acceptance: **defective products only**
- exchanges: **enabled** for the approved exchange cases

Do not map customer-change exchange permission into non-defective return-for-refund permission.

## 2. Current Google Merchant Center requirements checked

Official Google Merchant Center documentation reviewed on 2026-09-09:

- Website verification / claim: <https://support.google.com/merchants/answer/11586344>
- Scheduled product-data fetch: <https://support.google.com/merchants/answer/14991445>
- Product source from a file: <https://support.google.com/merchants/answer/12158380>
- Shipping settings: <https://support.google.com/merchants/answer/12577710>
- Shipping information required: <https://support.google.com/merchants/answer/12578516>
- Estimated delivery time: <https://support.google.com/merchants/answer/14949917>
- Regions: <https://support.google.com/merchants/answer/15406457>
- Return policies: <https://support.google.com/merchants/answer/14011730>
- Return data specification: <https://support.google.com/merchants/answer/17081382>
- Merchant Center ↔ Google Ads linking: <https://support.google.com/merchants/answer/12499498>
- Inaccurate shipping-cost guidance: <https://support.google.com/merchants/answer/10248678>

Important constraints:

1. Website verification/claim must use a store URL owned and maintained by the merchant.
2. Scheduled Fetch must point directly to the public product-data file URL.
3. Googlebot / AdsBot-Google must not be blocked from the feed directory.
4. Shipping settings should match checkout as closely as the current Merchant UI allows; where an exact cost rule cannot be represented, do not understate checkout cost.
5. Manual delivery speed uses separate **handling** and **transit** inputs; website end-to-end ranges must not be copied blindly into transit fields.
6. Return acceptance and exchange acceptance are separate Merchant decisions.
7. Google Ads linkage requires the appropriate account ID/access and may require admin approval.
8. Current Google region documentation does not list Vietnam as supporting shipping cost/transit-time custom areas; do not invent a Vietnam custom shipping-speed region.

## 3. Preflight resolution state

### RESOLVED M5-R1 — return method / label responsibility

- in-store returns: allowed
- by-mail/carrier returns: allowed
- by-mail sending / return-label responsibility: customer
- do not claim prepaid labels

### RESOLVED M5-R2 — restocking fee

- restocking fee: **0 VND / no cost**
- the existing `50,000 VND / product` customer-initiated exchange fee remains separate

### DEFERRED M5-R3 — exact Merchant refund-processing field representation

Public policy remains `7–10 working days` after receipt/inspection/eligibility confirmation.

When Merchant Center access is connected:

1. inspect the current refund-processing field wording, units and allowed range;
2. choose a representation that does not shorten or contradict the website policy;
3. if the vendor field cannot represent the policy truthfully, stop and surface the mismatch rather than changing public policy silently.

Do not assume `10 calendar days`.

### RESOLVED M5-R4 — non-defective return-for-refund acceptance

Owner decision 2026-09-09:

- a correct, non-defective product cannot be returned for refund merely because the customer changes their mind;
- customer-change cases are exchange-only under the approved model / size / color policy;
- Merchant return acceptance maps to **defective products only**;
- Merchant exchanges remain enabled for the approved exchange cases.

### RESOLVED M5-S1 — LA Clothing inner-Hanoi business delivery zone

- 1–3 day buyer-facing tier = the reviewed 48-ward LA Clothing business zone
- this is a business delivery zone, not a formal administrative classification
- Merchant must not infer Vietnam custom shipping-speed-region support from this website policy

### RESOLVED M5-S2 — production shipping values owner-confirmed

Owner confirmation:

- standard fee `30,000 VND`
- free above `1,000,000 VND`
- or free from `3` items

Evidence class: **owner-confirmed**, not independently runtime-observed by this agent.

Merchant cost rule:

- represent exact order-value and item-count logic if the actual account UI supports it;
- if `>=3 items` cannot be represented, do not understate checkout shipping cost;
- a conservative retained `30,000 VND` is safer than falsely advertising free shipping.

### RESOLVED M5-S3 — Merchant handling-time authority

Owner decision 2026-09-09:

- minimum handling time: **1 business day**
- maximum handling time: **1 business day**
- handling business days: **Monday–Saturday**
- handoff to GHN/GHTK occurs within that handling business day
- cut-off time is not separately approved

Rules:

- use `1–1 business day` for Merchant handling when the actual UI supports that representation;
- do not invent a cut-off time;
- do not copy website 1–3 / 3–15 end-to-end estimates directly into Merchant transit-time fields;
- observe current account controls and choose transit inputs that do not promise faster delivery than the website can meet.

### BLOCKER M5-ACCOUNT — Merchant Center account access deferred

The owner explicitly deferred Merchant Center connection/access until later.

No connected Merchant Center account/tool is currently available to observe or modify:

- account/business identity
- website verification/claim status
- shipping/returns state
- product data sources
- Scheduled Fetch schedule/latest update
- Merchant Automations
- Diagnostics
- Ads linkage
- exact current refund-processing-field semantics
- exact current transit-time controls for Vietnam

Do not claim any of these are configured until observed in the actual account.

## 4. External execution sequence once Merchant Center access is connected

### A. Observe production before touching Merchant Center

Record sanitized evidence for:

- actual production `APP_DOMAIN`
- `SEARCH_INDEXING_ENABLED=false`
- Merchant market status `APPROVED`
- actual shipping fee / free-shipping subtotal / free-shipping quantity thresholds
- production app topology still matches expected Merchant cache/single-flight assumptions
- `GET https://<APP_DOMAIN>/feeds/google-merchant` returns complete RSS over HTTPS
- representative landing page and image are publicly fetchable
- `/robots.txt` does not block feed/product/image paths

Owner confirmation may seed the checklist, but direct observation should replace it when production evidence becomes available.

Never record secrets, database URLs, auth secrets, Pancake keys/tokens, or raw customer data.

### B. Website verification / claim

In Merchant Center:

1. Open Business info / online store verification for the current account UI.
2. Enter the actual production store URL.
3. Use a supported verification method available to the account.
4. Observe and record `verified` / `claimed` state.

Do not create a dependency on GTM merely to verify the site; Gate T/O4 remains independent.

### C. Shipping configuration

1. Country: Vietnam.
2. Products: all Merchant v1 standalone products unless a reviewed label policy exists.
3. Handling:
   - minimum `1 business day`
   - maximum `1 business day`
   - business days Monday–Saturday
   - do not invent cut-off time
4. Transit / delivery representation:
   - inspect the current Vietnam controls;
   - do not assume custom-region shipping speed is supported;
   - do not copy website 1–3 / 3–15 directly into transit fields;
   - choose a broad truthful representation whose computed delivery estimate does not promise faster delivery than the website can meet.
5. Shipping cost:
   - `30,000 VND` standard;
   - free above `1,000,000 VND` where supported;
   - preserve `>=3 items` free shipping if supported;
   - otherwise overestimate rather than submit a rate lower than checkout.
6. Record the saved policy and compare it against storefront checkout behavior.

### D. Return policy

1. Return policy URL: `https://<APP_DOMAIN>/returns`.
2. Country: Vietnam.
3. Return acceptance: **defective products only**.
4. Exchanges: **enabled** for approved customer-change and fault cases.
5. Product condition: map only the published new/unused eligibility conditions.
6. Return window: 15 days.
7. Return methods: **in store + by mail**.
8. By-mail return label / sending responsibility: **customer**.
9. Currency: VND.
10. Restocking fee: **No cost / 0 VND**.
11. Refund processing: inspect the live field semantics and map public `7–10 working days` without shortening or changing its meaning.
12. Save only when the resulting policy matches the public `/returns` page; record `Verified`, `Pending`, or `Rejected` truthfully.

### E. Product data source / Scheduled Fetch

1. Add product source from a file using the current Merchant UI.
2. Use exact production HTTPS feed URL: `https://<APP_DOMAIN>/feeds/google-merchant`.
3. Do not add market/query parameters.
4. Configure the highest practical regular cadence the actual account supports.
5. Record schedule frequency, time and timezone.
6. Trigger/observe an update only when the feed URL is publicly verified.
7. Record Latest update / processing result and issue report.

### F. Merchant Automations

Review automatic price/availability/condition updates. Initial M5 posture remains **OFF unless separately approved**. Do not use automatic correction to hide feed/landing-page mismatches.

### G. Google Ads linkage

Only with the proper account owner/admin:

1. Open the current Merchant Center Apps/services linkage flow.
2. Link the exact approved Google Ads account or send the required request.
3. Record observed linkage state.

Linkage is not permission to create or enable a Shopping campaign.

### H. Diagnostics / crawler evidence

Collect sanitized evidence for at least:

- one in-stock standalone variant
- one out-of-stock standalone variant
- one variant-family record / item-group behavior
- VND price
- exact variant landing URL
- public image
- manufacturer MPN / identifier state
- Scheduled Fetch latest update
- landing/image crawler result

Composite products remain outside Merchant v1 scope.

## 5. Human activation gate

Stop at **READY FOR HUMAN MERCHANT ACTIVATION APPROVAL** when:

- account/site verification is complete
- shipping and return policies are configured and truthful
- production Scheduled Fetch succeeds
- representative Diagnostics/crawler evidence is acceptable
- Ads linkage state is known/approved as required
- Search indexing is still off
- no Critical/Required review finding remains

Do not independently enable Merchant listings, Shopping campaigns, search indexing, GTM live tags, or promotion activation.

## 6. Evidence record template

```text
Execution date/time:
Repository exact SHA:
Production APP_DOMAIN:
Search indexing state:
Merchant account ID (non-secret):
Website verified/claimed:
Production shipping evidence class: OWNER_CONFIRMED | DIRECTLY_OBSERVED
Observed/confirmed production shipping policy:
Merchant handling policy:
Merchant transit/delivery representation:
Merchant shipping cost policy:
Merchant return acceptance:
Merchant exchange acceptance:
Merchant refund-processing representation:
Product data source name:
Feed URL:
Scheduled Fetch cadence/timezone:
Latest update result/time:
Merchant Automations state:
Google Ads linkage state:
Representative Diagnostics:
Crawler/landing/image evidence:
Open blockers:
Gate M state: BLOCKED | READY FOR HUMAN APPROVAL | ACTIVATED
```

Owner inputs `M5-S3` and `M5-R4` are now resolved. The remaining execution blocker is **Merchant Center account access / observed external state**, plus live-field observation for refund-processing and transit representation before saving those vendor settings.
