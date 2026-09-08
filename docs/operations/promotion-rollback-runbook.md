# Promotion Incident Response & Rollback Runbook (U40 / #151 G2)

Owning Specifications: `docs/specs/promotions-flash-sale-v1.md` §Observability & §Rollback, `tasks/growth-commerce-master-plan.md` (§U40 / G2).  
Parent Runbook: `docs/operations/release-and-rollback.md`.  
Status: **ACTIVE OPERATIONAL TRUTH — TESTED & VERIFIED**.

---

## 1. Purpose & Guarantees

This runbook establishes the operational procedure for diagnosing, containing, and rolling back promotion campaigns (Flash Sale and regular discounts) on `website-la-clothing`.

### Core Rollback Invariants
1. **Gate-Independent Rollback:** Turning off the activation gate (`LA_PROMOTION_ACTIVATION_ENABLED=false`) or encountering invalid campaign states never blocks or strands campaign disablement. Disablement succeeds regardless of gate state.
2. **Scale Resilience (>2,000 Variants):** Disabling a campaign operates strictly $O(1)$ on the `PromotionCampaign` row. It does **not** expand product targets or enumerate variant coverage, ensuring instant rollback even for massive campaigns exceeding normal expansion bounds (`TARGET_EXPANSION_LIMIT_EXCEEDED`).
3. **Transactional Revision Linearization:** Disablement advances the durable `PromotionPricingRevision` row **within the exact same database transaction**. Downstream consumers (Storefront, Cart, Checkout, Merchant feed) linearize against this revision immediately without depending on best-effort asynchronous callbacks.
4. **Strict PII and Secret Redaction:** All telemetry emitted on stdout follows the structured single JSON line format. Zero customer PII (names, phones, shipping addresses), secrets, raw quote proofs, or cart UUIDs are ever logged.

---

## 2. Incident Triggers

Initiate immediate containment and rollback under any of the following conditions:

- **Pricing Anomaly:** Runaway discounts, unexpected campaign stacking, or miscalculated discount percentages observed on storefront cards or PDP.
- **Catalog Drift / Unusable Base:** Upstream catalog price changes in Pancake POS causing base prices to fall below promo fixed prices (`PROMOTION_INVALID`) or invalidating base prices (`UNUSABLE_BASE_PRICE`).
- **Quote Proof Rejection Storm:** Elevated rate of `checkout.quote_proof_rejected` telemetry indicating checkout reconfirmation failures or price race conditions.
- **Merchant Feed Pricing Discrepancy:** Stale sale prices lingering in Google Merchant Center feed after a scheduled promotion ends.
- **Pancake POS Submission Discrepancy:** Order creation failing with `PRICE_CHANGED` repeatedly during the P9b submission handshake.

---

## 3. Two-Tier Rollback Execution Procedure

### Tier 1: Emergency Kill Switch (Global Activation Gate)

To immediately freeze all promotion publishing and prevent any new or modified promotional pricing from taking effect:

1. In the deployment environment (e.g. `deploy/vps/.env.production` or systemd / Docker environment), set:
   ```bash
   LA_PROMOTION_ACTIVATION_ENABLED=false
   ```
2. From `deploy/vps`, reload or restart the application container:
   ```bash
   docker compose restart app
   ```
3. **Verified Effect:**
   - Any attempt to publish or update scheduled campaigns is immediately blocked with `ACTIVATION_DISABLED`.
   - Emits structured telemetry:
     ```json
     {"name":"promotion.activation_gate","operation":"publish","enabled":false}
     {"name":"promotion.activation_rejected","operation":"publish","reason":"ACTIVATION_DISABLED"}
     ```

### Tier 2: Targeted Campaign Disablement (`disablePromotionCampaign`)

To revert an active campaign back to base pricing:

1. **Via Admin Dashboard:**
   - Navigate to `/admin/promotions`.
   - Locate the offending campaign.
   - Click **Disable** (Vô hiệu hóa).
2. **Via Server Command (if Admin UI is inaccessible):**
   Run the command from the deployed repository checkout's `deploy/vps` directory. Use the source-capable `ops` Compose profile: the production `app` runner image intentionally contains only the Next.js runtime plus generated Prisma files and cannot import `src/commerce/promotion-activation-service.ts`. The synthetic session below satisfies the same server-side admin session shape used by the activation service; trusted VPS/Compose access is itself an operator privilege and this command must not be exposed through a public endpoint.
   ```bash
   docker compose --profile ops run --rm --build ops node --experimental-strip-types --input-type=module -e '
     const { disablePromotionCampaign } = await import("./src/commerce/promotion-activation-service.ts");
     const result = await disablePromotionCampaign({
       campaignId: process.argv[1],
       now: new Date(),
       session: {
         user: { id: "emergency-ops", role: "ADMIN" },
         session: { id: "emergency-ops" },
       },
     });
     console.log("Disable outcome:", result);
   ' "<CAMPAIGN_ID>"
   ```
3. **Verified Atomic Execution:**
   - Sets `isEnabled = false` and records `disabledAt = now`.
   - Atomically advances `PromotionPricingRevision.revision` from `N` to `N + 1`.
   - Disablement is an $O(1)$ single-row update on `PromotionCampaign` that never expands product targets or enumerates variants, guaranteeing it never hits the 2,000-variant expansion guard (`MAX_EXPANDED_VARIANTS_PER_CAMPAIGN`).

---

## 4. Downstream Linearization & State Reversion Verification

Following Tier 1 or Tier 2 rollback, verify that each subsystem converges to base pricing:

| Subsystem | Convergence Mechanism | Verification Check |
|---|---|---|
| **PDP & Storefront Cards** | Reads active campaigns at `requestNow`. With campaign disabled, `resolvePromotionPricing` immediately returns undiscounted base retail price. | Load `/shop` and product PDP; confirm base retail price is displayed and no "Sale" badges appear. |
| **Storefront Cart** | Recomputed on load via `buildStorefrontCartLines`. Undiscounted base prices used for all lines. | Inspect cart; confirm unit prices match base retail price. |
| **In-Flight Checkout Quotes (P9a)** | Rendered quote proof binds effective unit prices and totals. A proof minted under discounted price is rejected during snapshot verification with `QUOTE_UNPROVEN` / `PRICE_CHANGED`. | Submitting an unrefreshed checkout displays updated base price total with fresh proof prompt. |
| **Downstream POS Submit (P9b)** | Compares DRAFT quote against fresh Pancake base before POS order creation. Drift triggers `pancake_order.quote_repriced` and safely rolls back to DRAFT. | Check stdout logs for `pancake_order.quote_repriced` if in-flight submissions were pending. |
| **Google Merchant Feed (Gate M)** | Coordinator checks durable pricing revision before serving cached XML. Next request observes revision `N + 1`, marks revision `N` cache invalid, and regenerates feed with base prices. In-flight generation under revision `N` fails with `pricing_revision_changed`. | Inspect feed output; confirm all `<g:price>` fields match base retail prices. |

---

## 5. Telemetry & Observability Reference

All promotion and checkout signals are emitted as single-line JSON to stdout:

```json
{"name":"promotion.activation_gate","operation":"disable","enabled":false}
{"name":"promotion.activation_rejected","operation":"publish","campaignId":"camp-01","reason":"ACTIVATION_DISABLED"}
{"name":"promotion.runtime_health","campaignId":"camp-01","status":"PARTIALLY_INVALID","coveredVariants":50,"discountedVariants":48,"affectedVariants":2,"affectedTruncated":false,"affectedSample":[{"variantId":"var-1","reason":"PROMOTION_INVALID","conflictingCampaignIds":[]}]}
{"name":"checkout.quote_proof_rejected","phase":"rendered_quote_verification","reason":"PRICE_CHANGED"}
{"name":"pancake_order.quote_repriced","correlationId":"LA-2026-ORDER-01","state":"DRAFT","reason":"PRICE_CHANGED"}
```

### Signal Vocabulary
- **`promotion.activation_gate`**: Emitted when an admin operation enters a gate-governed branch. Reports boolean `enabled`.
- **`promotion.activation_rejected`**: Emitted when campaign creation, editing, publishing, or copying is refused. Includes bounded identifier samples (max 10).
- **`promotion.runtime_health`**: Emitted on-demand at request-time whenever campaign runtime health is assessed. Diagnoses `HEALTHY`, `PARTIALLY_INVALID`, or `FULLY_INVALID` with sampled variant reasons (max 5, no prices, no PII, NDJSON <1 KB).
- **`checkout.quote_proof_rejected`**: Emitted during checkout snapshot creation (P9a) when rendered quote proof fails verification (`PRICE_CHANGED`, `PROOF_MISSING`, `PROOF_OVERSIZED`, `PROOF_MALFORMED`, `PROOF_UNVERIFIED`).
- **`pancake_order.quote_repriced`**: Emitted during Pancake order submission (P9b) when fresh catalog price disagrees with DRAFT quote.
- **`[merchant-feed] pricing_revision_changed`**: Emitted when Merchant feed coordinator detects that durable promotion pricing revision advanced during in-flight generation.

---

## 6. Pre-Rollout Acceptance Evidence References

Rollout and rollback capabilities are proven by prior accepted evidence artifacts:

1. **Mirrored Money-Data Audit:**
   - Recorded in: `docs/audits/pricing-evidence-w3.md` (Finding W3, Unit U7).
   - Provenance: Executed on production VPS PostgreSQL database against shop `1635185058`.
   - Result: 356/356 (100%) variants satisfy positive-safe-integer VND money rules; zero unpriceable rows.
2. **Pancake POS Custom-Price Live Acceptance:**
   - Recorded in: `docs/integrations/pancake-p10-custom-price-acceptance.md` (Unit U23 / #151 P10).
   - Provenance: Executed live against Pancake POS API on product `a132` (variation `A132-M`).
   - Result: Pancake accepted custom requested unit price (`399,000 VND` vs catalog base `429,000 VND`), preserved price on read-back, and was safely cleaned up via remote cancellation (`status: 7`).