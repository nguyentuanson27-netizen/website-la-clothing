# Pancake confirmed-purchase live acceptance evidence (U24 / #153 T7)

Status: **controlled live acceptance test PASSED. Pancake POS confirmed order flow produces immutable snapshot facts from which canonical Purchase is constructed, with transactionId === eventId === publicCode and immediate status=7 cleanup.**

## Purpose

Under task **U24 = #153 T7 (Canonical confirmed Purchase from immutable order snapshot)**, this evidence proves that:
1. A legitimate real Pancake POS test order created via Pancake API on product `a132` (variation `A132-M`) successfully creates an immutable finalized order state.
2. The vendor-neutral canonical Purchase snapshot derives its transaction and event identity strictly from `OrderMirror.publicCode`:
   `transactionId === eventId === publicCode`
3. Canonical item facts (`item_id`, `item_name`, `price`, `quantity`) derive strictly from the finalized immutable `OrderLineSnapshot` without recalculating promotions or falling back to mutable current catalog base prices.
4. The controlled test order is immediately and safely canceled via `PUT /shops/1635185058/orders/{orderId}` with `{ status: 7 }`, leaving zero pending customer orders on Pancake POS.

## Command

In a trusted non-CI environment with server-only credentials configured (`PANCAKE_API_KEY` and `PANCAKE_SHOP_ID=1635185058`), execute:

```bash
T7_ACCEPTANCE_APPROVED=a132 pnpm pancake:t7:accept
```

The script:
- Deliberately refuses execution when `CI` or `GITHUB_ACTIONS` is set;
- Requires explicit operator approval via `T7_ACCEPTANCE_APPROVED=a132`;
- Asserts configured shop ID matches `1635185058`;
- Performs preflight stock and base price verification on product `a132` (variation `A132-M`);
- Submits exactly one create-order request to Pancake POS with test customer info;
- Extracts the created Pancake order ID;
- Verifies local finalized immutable `OrderMirror` and `OrderLineSnapshot` facts;
- Proves `readCanonicalPurchaseSnapshot` returns a valid canonical Purchase event with `transactionId === eventId === publicCode`;
- Proves item facts in the canonical Purchase event match snapshot `quantity`, `unitPriceVnd`, and `pancakeVariationId`;
- Safely cancels the order via Pancake status update (`status = 7`);
- Emits bounded, sanitized JSON audit output with no secrets or customer PII.

## Live API Findings

1. **Target Product & Variation**:
   - Product code: `a132`
   - Variation ID: `9ea76227-51f0-45a2-b5cc-f6b42e5ec3da` (`A132-M`)
   - Catalog base retail price: `429,000 VND`
   - Real sellable stock confirmed > 0 in preflight check.

2. **Created Order & Identity Invariant**:
   - Pancake order reference: `#23258`
   - Local public code: `T7-A132-1788517016275`
   - Finalized local order state: `CONFIRMED`
   - Canonical Purchase `transaction_id`: `T7-A132-1788517016275`
   - Canonical Purchase `event_id`: `T7-A132-1788517016275`
   - **Identity Invariant verified**: `transactionId === eventId === publicCode` (no random UUIDs, no internal database CUIDs).

3. **Immutable Snapshot Money & Item Authority**:
   - Snapshot line quantity: `1`
   - Snapshot line unit price: `429,000 VND`
   - Canonical `item_id`: `9ea76227-51f0-45a2-b5cc-f6b42e5ec3da`
   - Canonical item price: `429,000 VND`
   - Canonical item quantity: `1`
   - Canonical merchandise value: `429,000 VND`
   - Canonical shipping fee: `30,000 VND`
   - Canonical order total: `459,000 VND`
   - **Item Facts Invariant verified**: item facts match the immutable finalized order snapshot.

4. **Safe Cleanup**:
   - The created test order was immediately canceled via `PUT /shops/1635185058/orders/23258` with `{ status: 7 }`.
   - Cleanup result: `CANCELED_STATUS_7`.

## Sanitized Machine Evidence

```json
PANCAKE_T7_CONFIRMED_PURCHASE_ACCEPTANCE_BEGIN
{
  "timestamp": "2026-09-04T10:16:57.251Z",
  "shopId": 1635185058,
  "productCode": "a132",
  "variationId": "9ea76227-51f0-45a2-b5cc-f6b42e5ec3da",
  "variationDisplayId": "A132-M",
  "publicCode": "T7-A132-1788517016275",
  "catalogBasePriceVnd": 429000,
  "createdPancakeOrderId": "23258",
  "finalizedLocalState": "CONFIRMED",
  "persistedSnapshotQuantity": 1,
  "persistedSnapshotUnitPriceVnd": 429000,
  "canonicalTransactionId": "T7-A132-1788517016275",
  "canonicalEventId": "T7-A132-1788517016275",
  "canonicalMerchandiseValueVnd": 429000,
  "canonicalShippingVnd": 30000,
  "canonicalTotalVnd": 459000,
  "canonicalItemId": "9ea76227-51f0-45a2-b5cc-f6b42e5ec3da",
  "canonicalItemPrice": 429000,
  "canonicalItemQuantity": 1,
  "identityInvariantVerified": true,
  "itemFactsInvariantVerified": true,
  "cleanupResult": "CANCELED_STATUS_7"
}
PANCAKE_T7_CONFIRMED_PURCHASE_ACCEPTANCE_END
```
