# Merchant Center M5 activation runbook

Status: **PRE-ACTIVATION / BLOCKED ON ACCOUNT ACCESS + OWNER FACTS**

Base repository truth reviewed on `main@f30fdb67d85c3d9ccb258df3dae1a60db5c7b7be` after PR #227.

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

Repository defaults / `deploy/vps/env.example` currently describe:

- standard shipping fee: `30,000 VND`
- free shipping when subtotal is **greater than** `1,000,000 VND`
- or free shipping from `3` items

**Do not copy these values into Merchant Center until the actual production runtime configuration has been observed.** The production environment is the authority.

Approved delivery facts:

- coverage: nationwide Vietnam
- carriers: GHN, GHTK
- inner-city estimate: 1–3 days
- other-province estimate: 3–15 days
- these are estimates, not guaranteed SLAs
- no carrier tracking link/number is provided by default

### Return / exchange authority

Approved public policy currently states:

- return/exchange window: 15 days from customer receipt
- returned product must be new/unused, with tags and without damage/odor/use signs, and be the LA Clothing product purchased
- returns are sent according to support guidance
- exchanges are accepted for shop fault, wrong model/color/size, and customer-initiated model/size/color changes
- customer-initiated exchange fee: `50,000 VND / product`
- customer-initiated case: customer pays two-way shipping
- shop/manufacturer fault: LA Clothing pays reasonable return/exchange shipping
- no separate excluded-category list
- refund: 7–10 **working days** after LA Clothing receives, inspects and confirms eligibility
- COD refunds may use bank transfer or another method agreed with the customer

## 2. Current Google Merchant Center requirements checked

Official Google Merchant Center documentation reviewed on 2026-09-09:

- Website verification / claim: <https://support.google.com/merchants/answer/11586344>
- Scheduled product-data fetch: <https://support.google.com/merchants/answer/14991445>
- Product source from a file: <https://support.google.com/merchants/answer/12158380>
- Shipping settings: <https://support.google.com/merchants/answer/12577710>
- Return policies: <https://support.google.com/merchants/answer/14011730>
- Merchant Center ↔ Google Ads linking: <https://support.google.com/merchants/answer/12499498>

Important current requirements:

1. Merchant Center website verification/claim must be completed against a store URL owned and maintained by the merchant.
2. Scheduled fetch must point directly to the product-data file URL; Googlebot and AdsBot-Google must not be blocked from the directory containing it.
3. Shipping information submitted to Merchant Center should match the website as closely as possible.
4. Merchant Center return-policy setup requires explicit choices for return acceptance, exchanges, product condition, return window, return method, currency, restocking fee, and refund processing time.
5. Google Ads linking requires the appropriate account ID/access and, depending on ownership, admin approval.

## 3. Stop conditions found during preflight

### BLOCKER M5-ACCOUNT — Merchant Center account access not available in this execution context

No connected Merchant Center account/tool is currently available to observe or modify:

- account/business identity
- website verification/claim status
- shipping/returns state
- product data sources
- Scheduled Fetch schedule/latest update
- Merchant Automations
- Diagnostics
- Ads linkage

Do not claim any of these are configured until observed in the actual account.

### BLOCKER M5-R1 — Return method is not owner-approved precisely enough for Merchant Center

Google requires at least one explicit return method such as in-store, drop-off, or by mail. The repository only states that products are sent back according to support guidance.

Do not infer `by mail`, `drop-off`, or `in store` from that sentence.

Owner decision required: the exact supported return method(s), and for mail returns, how the return label is provided (`download/print`, `in the box`, or `customer responsibility`) if the current Merchant Center flow asks for it.

### BLOCKER M5-R2 — Merchant restocking-fee field has no approved mapping

The approved `50,000 VND / product` amount is explicitly a **customer-initiated exchange fee**. Google separately asks for a return-policy restocking fee (`no cost`, fixed cost, or percentage).

Do not reinterpret the exchange fee as a restocking fee.

Owner decision required: Merchant restocking fee semantics for ordinary returns.

### BLOCKER M5-R3 — Refund processing field is calendar-like while owner policy is working days

The repository policy is `7–10 working days` after receipt/inspection/eligibility confirmation. Merchant Center asks for a number of days for refund processing.

Do not silently convert working days into calendar days or choose `10` as an approximation without an owner-approved mapping.

### BLOCKER M5-S1 — "inner-city" has no precise Merchant region mapping

The owner-approved delivery facts distinguish `1–3 days inner-city` from `3–15 days other-province`, but the repository does not define which provinces/cities/postcodes constitute `inner-city` for Merchant Center configuration.

Google supports destination-based shipping configuration, including state/postal-code regions for Vietnam. Do not invent a geographic mapping.

Owner decision required: exact region definition for the 1–3 day tier, or explicit approval to use one conservative nationwide delivery estimate instead.

### BLOCKER M5-S2 — Actual production shipping price config must be observed

The repository defaults and env example are not proof of the current VPS `.env.production` values. Before Merchant shipping setup, record the live non-secret policy values from the production app/release environment and confirm they match storefront behavior.

## 4. External execution sequence once blockers are resolved

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

Never record secrets, database URLs, auth secrets, Pancake keys/tokens, or raw customer data.

### B. Website verification / claim

In Merchant Center:

1. Settings → Business info → online store.
2. Enter the actual production store URL.
3. Use a supported verification method available to the account (automatic/Search Console, HTML tag/file, email, GA, or GTM where appropriate).
4. Observe and record `verified` / `claimed` state.

Do not create a dependency on GTM merely to verify the site; T8/O4 remains independent.

### C. Shipping configuration

Only after M5-S1/M5-S2 are resolved:

1. Products & store → Shipping and returns → Shipping policies.
2. Country: Vietnam.
3. Products: all Merchant v1 standalone products unless a reviewed label policy exists.
4. Configure delivery regions/times only from owner-approved geography.
5. Configure cost table from the **observed production runtime policy**, preserving the website condition exactly; do not replace `subtotal > threshold OR quantity >= threshold` with a different rule.
6. Record the resulting policy and compare it against storefront checkout behavior.

### D. Return policy

Only after M5-R1/R2/R3 are resolved:

1. Return policy URL: `https://<APP_DOMAIN>/returns`.
2. Country: Vietnam.
3. Accept returns for the owner-approved cases, including non-defective/customer-change cases already present in the policy.
4. Exchanges: enabled, matching the public policy.
5. Product condition: map only the approved new/unused condition.
6. Return window: 15 days.
7. Return method / label responsibility: use the newly approved owner facts only.
8. Currency: VND.
9. Restocking fee: use the newly approved owner fact only; do not substitute the exchange fee.
10. Refund processing time: use the newly approved Merchant mapping for the `7–10 working days` policy.
11. Save and wait for Merchant verification status; record `Verified`, `Pending`, or `Rejected` truthfully.

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
Observed production shipping policy:
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
