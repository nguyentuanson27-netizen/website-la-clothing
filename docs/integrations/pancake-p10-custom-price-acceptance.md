# Pancake custom-price live acceptance evidence (U23 / #151 P10)

Status: **controlled live acceptance test PASSED. Pancake POS accepts and preserves requested line prices differing from catalog base price without resetting them to catalog base.**

## Purpose

Under task **U23 = #151 P10 (final Pancake convergence + controlled custom-price acceptance)**, this evidence proves that when the website submits an order containing a discounted or custom unit price in `items[].variation_info.retail_price` (derived from finalized immutable `OrderLineSnapshot.unitPriceVnd`), Pancake POS accepts and stores that custom price rather than overwriting it with the catalog base retail price.

## Command

In a trusted non-CI environment with server-only credentials configured (`PANCAKE_API_KEY` and `PANCAKE_SHOP_ID=1635185058`), execute:

```bash
P10_ACCEPTANCE_APPROVED=a132 pnpm pancake:price:accept
```

The script:
- Deliberately refuses execution when `CI` or `GITHUB_ACTIONS` is set;
- Requires explicit operator approval via `P10_ACCEPTANCE_APPROVED=a132`;
- Asserts configured shop ID matches `1635185058`;
- Performs preflight stock and base price verification on product `a132` (variation `A132-M`);
- Submits exactly one create-order request with custom line price `399,000 VND` (differing from catalog base `429,000 VND`);
- Reads back the created order to verify persisted line retail price;
- Safely cancels the order via Pancake status update (`status = 7`);
- Emits bounded, sanitized JSON audit output with no secrets or customer PII.

## Live API Findings

1. **Custom price persistence**:
   - Variation `A132-M` (`9ea76227-51f0-45a2-b5cc-f6b42e5ec3da`) has catalog base retail price `429,000 VND`.
   - The test requested `unitPriceVnd = 399,000 VND` (`-30,000 VND` custom price).
   - The read-back order confirmed `item.variation_info.retail_price = 399,000 VND`.
   - Pancake preserved the requested price exactly and did not overwrite it with catalog base `429,000 VND`.

2. **HTTP Status & Payload Envelope**:
   - The fingerprinted Pancake OpenAPI document (`docs/integrations/pancake-order-create-contract-observed.json`) documented HTTP `200` with top-level `{ id: integer }`.
   - The live Pancake POS API returns HTTP `201 Created` with envelope `{ success: true, data: { id: integer, ... } }`.
   - Production submit service treats unexpected/ambiguous create responses as `SYNC_UNKNOWN` with no blind retries, preserving safe state-machine semantics.

3. **Safe Cleanup**:
   - The created test order was immediately canceled via `PUT /shops/1635185058/orders/{orderId}` with `{ status: 7 }`.
   - Pancake confirmed `status: 7` (`status_name: "removed"`).

## Sanitized Machine Evidence

```json
PANCAKE_CUSTOM_PRICE_ACCEPTANCE_BEGIN
{
  "timestamp": "2026-09-04T09:17:42.053Z",
  "shopId": 1635185058,
  "productCode": "a132",
  "variationId": "9ea76227-51f0-45a2-b5cc-f6b42e5ec3da",
  "variationDisplayId": "A132-M",
  "catalogBasePriceVnd": 429000,
  "requestedCustomPriceVnd": 399000,
  "createdPancakeOrderId": "23257",
  "persistedLineRetailPriceVnd": 399000,
  "customPriceAcceptedAndPreserved": true,
  "orderTotalPriceVnd": 399000,
  "orderShippingFeeVnd": 30000,
  "cleanupResult": "CANCELED_STATUS_7"
}
PANCAKE_CUSTOM_PRICE_ACCEPTANCE_END
```
