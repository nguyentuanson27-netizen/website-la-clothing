# Merchant Center M5 activation runbook

Status: **PRE-ACTIVATION / BLOCKED ON MERCHANT CENTER ACCOUNT ACCESS**

Base repository truth reviewed from `main@f30fdb67d85c3d9ccb258df3dae1a60db5c7b7be` after PR #227. Owner operational decisions were refreshed on 2026-09-09 in `docs/specs/la-clothing-owner-approved-facts-and-decisions.md`.

This runbook executes the operational half of **U41 / #153 M5**. It does not enable organic search indexing, GTM, promotion activation, Merchant listings, or Google Ads campaigns. External account actions must be backed by observed Merchant Center / Google Ads state; repository documentation is not evidence that an external action succeeded.

## 1. Current repository authority

### Storefront and feed

- Temporary production storefront: `https://la.lanadesign.vn` (ADR 0004).
- Candidate production Merchant feed URL: `https://la.lanadesign.vn/feeds/google-merchant`.
- `APP_DOMAIN` is server-owned; request `Host`, query strings, headers and callers are not origin/market authority.
- `SEARCH_INDEXING_ENABLED=false` remains mandatory on `la.lanadesign.vn`.
- The temporary production hostname is allowed to serve real buyer traffic but is intentionally not an organic indexing launch domain.
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

This is **owner-provided production confirmation**, not an independent SSH/runtime observation by the coding agent. Do not expose or request production secrets to prove it.

Approved delivery facts:

- coverage: nationwide Vietnam
- carriers: GHN, GHTK
- inner-Hanoi estimate: 1–3 days
- outside inner Hanoi / other provinces and cities: 3–15 days
- these are estimates, not guaranteed SLAs
- no carrier tracking link/number is provided by default

The owner-approved geography for “inner Hanoi” is recorded in the owner-facts source as the current 48-ward operational footprint derived from the former 12 inner-city districts after Resolution 1656/NQ-UBTVQH15. It deliberately excludes Chương Mỹ, Sơn Tây and Tùng Thiện from the 1–3 day tier. The public `/shipping` page names the two scopes explicitly; the detailed ward list remains an operational mapping rather than page copy.

### Return / exchange authority

Owner-approved current policy states:

- return/exchange window: 15 days from customer receipt
- returned product must be new/unused, with tags and without damage/odor/use signs, and be the LA Clothing product purchased
- supported return methods: **in store** and **by mail / carrier**
- for mail returns, **customer responsibility** applies to sending / return label responsibility
- exchanges are accepted for shop fault, wrong model/color/size, and customer-initiated model/size/color changes
- customer-initiated exchange fee: `50,000 VND / product`
- customer-initiated case: customer pays two-way shipping
- shop/manufacturer fault: LA Clothing pays reasonable return/exchange shipping
- restocking fee: **0 VND / no cost**
- the `50,000 VND` exchange fee is not a restocking fee
- no separate excluded-category list
- website refund wording: 7–10 **working days** after LA Clothing receives, inspects and confirms eligibility
- COD refunds may use bank transfer or another method agreed with the customer

PR #228 also aligns the public `/returns` page with the newly approved return methods, customer label responsibility and zero restocking fee before any Merchant return policy is configured.

## 2. Current Google Merchant Center requirements checked

Official Google Merchant Center documentation reviewed on 2026-09-09:

- Website verification / claim: <https://support.google.com/merchants/answer/11586344>
- Scheduled product-data fetch: <https://support.google.com/merchants/answer/14991445>
- Product source from a file: <https://support.google.com/merchants/answer/12158380>
- Shipping settings: <https://support.google.com/merchants/answer/12577710>
- Estimated delivery time: <https://support.google.com/merchants/answer/14949917>
- Regions: <https://support.google.com/merchants/answer/15406457>
- Return policies: <https://support.google.com/merchants/answer/14011730>
- Return data specification: <https://support.google.com/merchants/answer/17081382>
- Merchant Center ↔ Google Ads linking: <https://support.google.com/merchants/answer/12499498>
- Inaccurate shipping-cost guidance: <https://support.google.com/merchants/answer/10248678>

Important current requirements / constraints:

1. Merchant Center website verification/claim must be completed against a store URL owned and maintained by the merchant.
2. Scheduled fetch must point directly to the product-data file URL; Googlebot and AdsBot-Google must not be blocked from the directory containing it.
3. Shipping information submitted to Merchant Center should match the website as closely as possible; if exact cost rules cannot be represented, Google permits a slight overestimate rather than understating checkout shipping.
4. Merchant Center return-policy setup requires explicit choices for return acceptance, exchanges, product condition, return window, return method, currency, restocking fee, and refund processing time.
5. Google Ads linking requires the appropriate account ID/access and, depending on ownership, admin approval.
6. Current Google region documentation lists Vietnam for regional availability/pricing, but **does not list Vietnam as supporting shipping cost/transit-time custom areas**. Do not infer support from the generic “destination by zone” UI documentation when the country-availability table leaves Vietnam blank for shipping cost/transit-time custom areas.

## 3. Preflight resolution state

### RESOLVED M5-R1 — return method / label responsibility

Owner decision 2026-09-09:

- allow **in-store** returns;
- allow **by-mail / carrier** returns;
- for by-mail returns, return-label / sending responsibility is **customer responsibility**.

Do not claim prepaid labels.

### RESOLVED M5-R2 — restocking fee

Owner decision 2026-09-09:

- Merchant restocking fee = **0 VND / no cost**.

The existing `50,000 VND / product` customer-initiated exchange fee remains a separate exchange-policy fact.

### DEFERRED M5-R3 — exact Merchant refund-processing field representation

Owner keeps the public policy at `7–10 working days` after receipt/inspection/eligibility confirmation.

Do **not** treat `10 calendar days` as owner-approved merely because 10 is the upper bound of the working-day range. When Merchant Center access is connected:

1. inspect the current field wording, units and allowed range;
2. choose a representation that does not shorten or contradict the website policy;
3. if the vendor field cannot represent the policy truthfully, stop and surface the mismatch rather than changing the public policy silently.

This is an account/UI observation dependency, not a missing public-policy fact.

### RESOLVED M5-S1 — inner-Hanoi policy geography

Owner decision 2026-09-09:

- 1–3 day tier = inner Hanoi;
- operational current mapping is the 48 wards recorded in `docs/specs/la-clothing-owner-approved-facts-and-decisions.md`, preserving continuity with the former 12 inner-city districts under the 2025 administrative reorganization.

However, **this does not imply Merchant Center can configure a Vietnam shipping-speed custom region**. Current Google country-availability docs do not expose that capability for Vietnam.

Merchant execution rule:

- keep website/checkout policy unchanged;
- if Merchant UI still cannot express a Vietnam regional transit-time split, use a single conservative nationwide delivery-time representation, with **3–15 days** as the initial target range;
- do not advertise a Merchant speed faster than the website can meet;
- if the UI requires handling time + transit time separately, observe the exact controls and operational handling facts before final save rather than inventing handling days.

### RESOLVED M5-S2 — production shipping values owner-confirmed

Owner confirmation 2026-09-09:

- VPS production shipping values match repository policy: `30,000 VND`, free over `1,000,000 VND`, or free from `3` items.

Evidence class: **owner-confirmed**, not independently runtime-observed by this agent.

Merchant cost execution rule:

- represent the exact order-value and item-count logic if the actual account UI supports it;
- if the `>= 3 items` free-shipping condition cannot be represented, do not understate shipping cost;
- use a conservative overestimate such as retaining `30,000 VND` for the unrepresentable case rather than falsely advertising free shipping. This follows Google's current inaccurate-shipping-cost guidance.

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

Do not claim any of these are configured until observed in the actual account.

## 4. External execution sequence once Merchant Center access is connected

### A. Observe production before touching Merchant Center

Record sanitized evidence for:

- actual production `APP_DOMAIN`
- `SEARCH_INDEXING_ENABLED=false`
- Merchant market status `APPROVED`
- actual shipping fee / free-shipping subtotal / free-shipping quantity thresholds
- production app topology still matches one app service for process-local Merchant cache/single-flight/backoff
- `GET https://<APP_DOMAIN>/feeds/google-merchant` returns complete RSS over HTTPS
- representative landing page and image are publicly fetchable
- `/robots.txt` does not block the feed/product/image paths

Owner confirmation may seed the checklist, but direct observation should replace it when access to production/runtime evidence is available.

Never record secrets, database URLs, auth secrets, Pancake keys/tokens, or raw customer data.

### B. Website verification / claim

In Merchant Center:

1. Settings → Business info → online store.
2. Enter the actual production store URL.
3. Use a supported verification method available to the account (automatic/Search Console, HTML tag/file, email, GA, or GTM where appropriate).
4. Observe and record `verified` / `claimed` state.

Do not create a dependency on GTM merely to verify the site; T8/O4 remains independent.

### C. Shipping configuration

1. Products & store → Shipping and returns → Shipping policies.
2. Country: Vietnam.
3. Products: all Merchant v1 standalone products unless a reviewed label policy exists.
4. Delivery-time configuration:
   - first inspect the current account UI;
   - do not assume custom-region speed is supported for Vietnam;
   - if no truthful regional split is available, use the conservative nationwide target `3–15 days` rather than inventing unsupported regions;
   - if handling/transit split is mandatory, record the actual UI semantics and operational handling facts before final save.
5. Shipping cost:
   - `30,000 VND` standard;
   - free for order value above `1,000,000 VND` where supported;
   - preserve the `>=3 items` free-shipping rule if supported;
   - otherwise overestimate rather than submit a rate lower than checkout.
6. Record the resulting policy and compare it against storefront checkout behavior.

### D. Return policy

1. Return policy URL: `https://<APP_DOMAIN>/returns`.
2. Country: Vietnam.
3. Accept returns for the owner-approved cases, including non-defective/customer-change cases already present in the policy.
4. Exchanges: enabled, matching the public policy.
5. Product condition: map only the approved new/unused condition.
6. Return window: 15 days.
7. Return methods: **in store + by mail**.
8. By-mail return label: **customer responsibility**.
9. Currency: VND.
10. Restocking fee: **No cost / 0 VND**.
11. Refund processing time: inspect the account's current field semantics and map the public `7–10 working days` policy without shortening or changing its meaning; do not assume `10 calendar days`.
12. Save and wait for Merchant verification status; record `Verified`, `Pending`, or `Rejected` truthfully.

### E. Product data source / Scheduled Fetch

1. Settings → Data sources → Add product source → Add products from a file.
2. Use the exact production HTTPS feed URL: `https://<APP_DOMAIN>/feeds/google-merchant`.
3. Do not add market/query parameters.
4. Configure the highest practical regular cadence the actual account UI supports, coordinated with website/catalog update timing.
5. Record schedule frequency, time and timezone.
6. Trigger/observe an update only when the feed URL is publicly verified.
7. Record Latest update / processing result and any issue report.

### F. Merchant Automations

Review automatic price/availability/condition updates. Initial M5 posture remains **OFF unless separately approved**. Do not use automatic correction to hide feed/landing-page mismatches.

### G. Google Ads linkage

Only with the proper account owner/admin:

1. Merchant Center → Settings → Access and services → Apps and services → Add service → Google Ads.
2. Link the approved Google Ads account or send a request to the exact approved customer ID.
3. Record observed linkage state.

Linkage is not permission to create/enable a Shopping campaign.

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
- production feed Scheduled Fetch succeeds
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
Merchant shipping policy:
Merchant return policy status:
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
