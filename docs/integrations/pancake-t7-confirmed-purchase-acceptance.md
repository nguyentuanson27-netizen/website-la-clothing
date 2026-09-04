# Pancake confirmed-purchase live acceptance evidence (U24 / #153 T7)

Status: **Controlled live acceptance test recorded. Real Pancake POS preflight, create, and cancellation PUT were exercised live on product `a132` (order `#23258`). Strict status-7 confirmation, bounded cleanup diagnostics, and PostgreSQL persistence are verified by automated regression and database test suites.**

---

## 1. Distinction Between Historical Live Run & Current Implementation

### Historical Live Run (`#23258` at `2026-09-04T10:16:57.251Z`)
- **Real Pancake Preflight**: Live catalog stock (>0) and base retail price (`429,000 VND`) were confirmed for product `a132` (variation `A132-M`).
- **Real Pancake Create**: Order `#23258` was successfully placed via Pancake POS API with test customer facts and `publicCode: T7-A132-1788517016275`.
- **Cancellation PUT Issued**: An update request (`PUT /shops/1635185058/orders/23258` with `{ status: 7 }`) was transmitted to Pancake.
- **Historical Harness Cleanup Result**: The archived harness reported `cleanupResult: "CANCELED_STATUS_7"` based on `cancelResponse.success === true`.
- **Important Historical Caveat**: Because the earlier harness accepted generic `success: true`, this historical archived run does **not** independently prove that status 7 was explicitly observed or read back live at runtime. No claim is made that strict status-7 verification was exercised live in that run.

### Current Implementation & Automated Verification
- **Strict Status-7 Confirmation in Code**: The current implementation of `attemptOrderCancellation()` requires explicit evidence that the order has reached status 7 (either directly via the PUT response `data.status === 7` / `status === 7` or via a bounded follow-up `GET /shops/{shopId}/orders/{orderId}` read-back). Generic `success: true` is rejected as unverified.
- **Strict Cleanup Failure Gate**: If cleanup cannot be confirmed as status 7, `runControlledT7Acceptance()` fails/rejects with non-zero exit code.
- **Bounded & Sanitized Diagnostics**: Any cleanup failure message is stripped of secrets/tokens and strictly truncated to `MAX_CLEANUP_DIAGNOSTIC_LENGTH = 128` characters before being attached to `cleanupContext`.
- **Dual-Failure Preservation**: If main canonical verification fails and cleanup also fails, the original verification error is preserved without being masked or replaced, and the bounded cleanup context is attached.
- **Automated Regression Proof**: These behaviors are comprehensively verified by automated unit regression tests in [`tests/domain/pancake-t7-confirmed-purchase-acceptance.test.ts`](../../tests/domain/pancake-t7-confirmed-purchase-acceptance.test.ts).
- **No Live Re-run Without Authorization**: Live re-verification under the strict implementation has intentionally **not** been re-run to avoid placing redundant live orders on Pancake POS without explicit operator authorization.

---

## 2. Synthetic State Wording for Canonical Builder Verification

- In the acceptance harness, the canonical Purchase builder verification is performed against an in-memory synthetic fixture:
  ```typescript
  localOrder.state = "CONFIRMED"
  ```
- The harness does **not** observe or read a `CONFIRMED` state for this test order from the Pancake API or from the production database.
- Therefore, the report field is truthfully designated as **`syntheticSnapshotState: "CONFIRMED"`** (rather than claiming a "verified" external state).
- This verification proves that given valid immutable snapshot facts, `readCanonicalPurchaseSnapshot` enforces:
  - Identity invariant: `transactionId === eventId === publicCode`
  - Money and item facts invariant: `item_id`, `price`, and `quantity` derive strictly from immutable snapshot facts without recalculating promotions or using mutable catalog prices.

---

## 3. PostgreSQL Database Persistence Proof

Real database persistence semantics for `OrderMirror` and `OrderLineSnapshot` (including state gates, price immutability across catalog changes, foreign key relations, and catalog enrichment fallbacks) are separately verified against PostgreSQL in:
[`tests/database/canonical-confirmed-purchase.test.ts`](../../tests/database/canonical-confirmed-purchase.test.ts)

---

## 4. Archived Machine Evidence (Historical Run `#23258`)

> [!NOTE]
> The following sanitized JSON block is the historical record produced by the pre-fix run at `2026-09-04T10:16:57.251Z`. It is preserved as historical evidence of the preflight, create, and PUT cancellation requests issued to Pancake POS API on product `a132`.

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


