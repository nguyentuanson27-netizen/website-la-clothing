/**
 * The product page's promotional pricing rule.
 *
 * This is the seam where the storefront starts pricing through the central authority. It computes
 * nothing itself: it hands each variant's mirrored base price and its applicable campaigns to
 * `resolvePromotionPricing` and passes the answer back. A second formula here — even a "simple"
 * percentage — is exactly the divergence the central resolver exists to prevent.
 *
 * Two deliberate consequences.
 *
 * The base price is `pancakeRetailPrice` alone. The equality gate on
 * `pancakeRetailPriceAfterDiscount` is not applied, because W3's accepted real-catalog evidence
 * established that Pancake evaluates promotions as dynamic order rules rather than catalog price
 * mutations, so a differing after-discount field says nothing about what the website should charge.
 * A variant that gate used to hide is now priceable and purchasable here.
 *
 * That removal is scoped to callers that opt in by passing this rule. `resolveStorefrontPrice`
 * remains the default everywhere else — cart, checkout, Pancake submission, Merchant audit, product
 * cards and structured data — because those surfaces belong to later units and changing what they
 * charge from a unit that owns the product page would be a silent, much larger change.
 *
 * `now` is supplied by the caller so one request resolves every option against a single instant.
 */

import {
  resolvePromotionPricing,
  type ApplicablePromotionCampaign,
} from "./promotion-pricing.ts";
import type { StorefrontPricingRule } from "./storefront-product.ts";

export function buildPromotionalStorefrontPricing({
  campaignsByVariantId,
  now,
}: Readonly<{
  /** Keyed by internal `VariantMirror.id`, which is how the candidate repository reports them. */
  campaignsByVariantId: ReadonlyMap<string, readonly ApplicablePromotionCampaign[]>;
  now: Date;
}>): StorefrontPricingRule {
  return (variant) => {
    const pricing = resolvePromotionPricing({
      basePriceVnd: variant.retailPrice,
      campaigns: campaignsByVariantId.get(variant.id) ?? [],
      now,
    });

    return Object.freeze({
      // `effectivePriceVnd` is base when nothing applies and stays null when the base itself is
      // unusable, so this one field covers promoted, unpromoted and unpriceable alike.
      price: pricing.effectivePriceVnd,
      basePriceVnd: pricing.basePriceVnd,
      isDiscounted: pricing.isDiscounted,
    });
  };
}
