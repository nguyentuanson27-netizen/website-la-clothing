# Pancake confirmed-purchase live acceptance evidence (U24 / #153 T7)

Status: **controlled live acceptance test PASSED. Real Pancake POS create/cancellation flow verified on product `a132` with immediate verified status=7 cleanup, combined with in-memory canonical Purchase builder verification (`transactionId === eventId === publicCode`, item facts matched to immutable snapshot shape). Database persistence and finalized order mirror state are separately verified by database regression tests.**

## Purpose

Under task **U24 = #153 T7 (Canonical confirmed Purchase from immutable order snapshot)**, this acceptance evidence proves that:
1. **Real Pancake Preflight**: Live catalog stock (>0) and base retail price (`429,000 VND`) are verified for product `a132` (variation `A132-M`).
2. **Real Pancake Order Creation**: Exactly one controlled test order is placed via Pancake POS API with test customer details.
3. **Real Pancake Safe Cleanup**: The created test order is immediately canceled via `PUT /shops/1635185058/orders/{orderId}` with `{ status: 7 }` and verified as status 7, leaving zero pending test orders on Pancake POS.
4. **Canonical Purchase Builder Invariant Verification**: Using an in-memory client conforming to `CanonicalPurchaseClient` with the exact immutable fact shape, `readCanonicalPurchaseSnapshot` proves:
   - Identity invariant: `transactionId === eventId === publicCode` (no random UUIDs, no internal database CUIDs).
   - Item facts invariant: `item_id`, price, and quantity derive strictly from immutable snapshot facts without promotion recalculation or mutable catalog fallbacks.
5. **Separate Database Persistence Verification**: Actual local persistence and retrieval from `OrderMirror` and `OrderLineSnapshot` in PostgreSQL are separately and comprehensively verified by database regression tests in [`tests/database/canonical-confirmed-purchase.test.ts`](../../tests/database/canonical-confirmed-purchase.test.ts).

## Command

In a trusted non-CI environment with server-only credentials configured (`PANCAKE_API_KEY` and `PANCAKE_SHOP_ID=1635185058`), execute:

```bash
T7_ACCEPTANCE_APPROVED=a132 pnpm pancake:t7:accept
```

The script:
- Deliberately refuses execution when `CI` or `GITHUB_ACTIONS` is set;
- Requires explicit operator approval via `T7_ACCEPTANCE_APPROVED=a132`;
- Asserts configured shop ID matches `1635185058`;
- Performs real preflight stock and base price verification on product `a132` (variation `A132-M`);
- Submits exactly one real create-order request to Pancake POS with test customer info;
- Extracts the created Pancake order ID;
- Verifies canonical Purchase builder invariants (`transactionId === eventId === publicCode`, immutable item facts);
- Safely cancels the real order via Pancake status update (`status = 7`) and confirms cancellation;
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
   - Verified order state: `CONFIRMED`
   - Canonical Purchase `transaction_id`: `T7-A132-1788517016275`
   - Canonical Purchase `event_id`: `T7-A132-1788517016275`
   - **Identity Invariant verified**: `transactionId === eventId === publicCode` (no random UUIDs, no internal database CUIDs).

3. **Immutable Snapshot Money & Item Authority**:
   - Snapshot fact line quantity: `1`
   - Snapshot fact line unit price: `429,000 VND`
   - Canonical `item_id`: `9ea76227-51f0-45a2-b5cc-f6b42e5ec3da`
   - Canonical item price: `429,000 VND`
   - Canonical item quantity: `1`
   - Canonical merchandise value: `429,000 VND`
   - Canonical shipping fee: `30,000 VND`
   - Canonical order total: `459,000 VND`
   - **Item Facts Invariant verified**: item facts match the immutable snapshot fact shape.

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
  "verifiedOrderState": "CONFIRMED",
  "snapshotFactQuantity": 1,
  "snapshotFactUnitPriceVnd": 429000,
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

