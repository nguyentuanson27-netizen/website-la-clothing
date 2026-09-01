/**
 * Activation-time validation and the activation gate.
 *
 * A Draft may legitimately be incomplete or business-invalid at rest — the database deliberately
 * permits that, so an admin can save work in progress. Everything the database therefore stopped
 * enforcing has to be enforced here instead, at the boundary where a campaign becomes capable of
 * changing what a buyer is charged: publish, re-enable, and material edits to a Scheduled campaign.
 *
 * Two rules live here because no `CHECK` constraint can express them: the explicit target bound, and
 * the prohibition on targeting a product and separately targeting a variant that product already
 * covers. Both are cross-row questions.
 *
 * Validation is pure and reports every failing rule at once, so an admin fixes one form rather than
 * discovering problems one save at a time.
 */

import { normalizePromotionCampaignName } from "./promotion-campaign-name.ts";
import type {
  PromotionCampaignKind,
  PromotionDiscountType,
} from "./promotion-pricing.ts";

/** Server-authoritative bound on normalized explicit target rows. */
export const MAX_TARGETS_PER_CAMPAIGN = 200;

const MIN_PERCENTAGE = 1;
const MAX_PERCENTAGE = 99;

export type CampaignTargetInput = Readonly<{
  productId: string | null;
  variantId: string | null;
}>;

export type CampaignActivationInput = Readonly<{
  kind: PromotionCampaignKind;
  name: string;
  discountType: PromotionDiscountType;
  percentageValue: number | null;
  fixedPriceVnd: bigint | null;
  startsAt: Date | null;
  endsAt: Date | null;
  targets: readonly CampaignTargetInput[];
  /**
   * Owning product for each targeted variant, supplied by the caller because it is a catalog fact.
   * Without it the product-covers-variant rule cannot be evaluated, and it is skipped rather than
   * guessed.
   */
  variantOwnerProductIds?: ReadonlyMap<string, string>;
  now: Date;
}>;

export type CampaignActivationError =
  | "INVALID_NAME"
  | "DISCOUNT_VALUE_MISSING"
  | "PERCENTAGE_OUT_OF_RANGE"
  | "FIXED_PRICE_NOT_POSITIVE"
  | "WINDOW_NOT_POSITIVE"
  | "WINDOW_ALREADY_ENDED"
  | "FLASH_SALE_WINDOW_REQUIRED"
  | "NO_TARGETS"
  | "TOO_MANY_TARGETS"
  | "DUPLICATE_TARGET"
  | "INVALID_TARGET_SCOPE"
  | "VARIANT_ALREADY_COVERED_BY_PRODUCT";

export type CampaignActivationResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; errors: readonly CampaignActivationError[] }>;

type ActivationEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * The activation gate, default off.
 *
 * Server-owned and exact-match on `"true"`: a `NEXT_PUBLIC_` value, a request header or a casual
 * `1`/`TRUE` cannot switch real discounted pricing on. Turning this on is a deliberate deployment
 * decision, and it is the last thing to change rather than the first.
 */
export function isPromotionActivationEnabled(
  env: ActivationEnvironment = process.env,
): boolean {
  return env.LA_PROMOTION_ACTIVATION_ENABLED === "true";
}

function validateDiscount(
  input: CampaignActivationInput,
  errors: CampaignActivationError[],
): void {
  if (input.discountType === "PERCENTAGE") {
    if (input.percentageValue === null) {
      errors.push("DISCOUNT_VALUE_MISSING");
      return;
    }
    if (
      !Number.isSafeInteger(input.percentageValue)
      || input.percentageValue < MIN_PERCENTAGE
      || input.percentageValue > MAX_PERCENTAGE
    ) {
      errors.push("PERCENTAGE_OUT_OF_RANGE");
    }
    return;
  }

  if (input.fixedPriceVnd === null) {
    errors.push("DISCOUNT_VALUE_MISSING");
    return;
  }
  // Whether it is below a given variant's base price is a per-variant runtime question the pricing
  // resolver owns; being positive at all is a definitional one and belongs here.
  if (input.fixedPriceVnd <= BigInt(0)) errors.push("FIXED_PRICE_NOT_POSITIVE");
}

function validateWindow(
  input: CampaignActivationInput,
  errors: CampaignActivationError[],
): void {
  if (input.kind === "FLASH_SALE" && (input.startsAt === null || input.endsAt === null)) {
    errors.push("FLASH_SALE_WINDOW_REQUIRED");
  }
  if (
    input.startsAt !== null
    && input.endsAt !== null
    && input.endsAt.getTime() <= input.startsAt.getTime()
  ) {
    // Half-open intervals make an empty window meaningless, not merely useless.
    errors.push("WINDOW_NOT_POSITIVE");
  }
  // Activation makes a campaign capable of charging someone. A window that has already closed can
  // never do that, so enabling it is an admin mistake rather than a harmless no-op — and it would
  // leave an enabled campaign sitting in a terminal state that only Copy can escape.
  if (input.endsAt !== null && input.endsAt.getTime() <= input.now.getTime()) {
    errors.push("WINDOW_ALREADY_ENDED");
  }
}

function validateTargets(
  input: CampaignActivationInput,
  errors: CampaignActivationError[],
): void {
  const { targets } = input;
  if (targets.length === 0) {
    errors.push("NO_TARGETS");
    return;
  }
  if (targets.length > MAX_TARGETS_PER_CAMPAIGN) {
    errors.push("TOO_MANY_TARGETS");
    return;
  }

  const seen = new Set<string>();
  const productIds = new Set<string>();
  const variantIds: string[] = [];
  let invalidScope = false;
  let duplicate = false;

  for (const target of targets) {
    const namesProduct = target.productId !== null;
    const namesVariant = target.variantId !== null;
    if (namesProduct === namesVariant) {
      invalidScope = true;
      continue;
    }

    const key = namesProduct ? `p:${target.productId}` : `v:${target.variantId}`;
    if (seen.has(key)) duplicate = true;
    seen.add(key);

    if (namesProduct) productIds.add(target.productId as string);
    else variantIds.push(target.variantId as string);
  }

  if (invalidScope) errors.push("INVALID_TARGET_SCOPE");
  if (duplicate) errors.push("DUPLICATE_TARGET");

  const owners = input.variantOwnerProductIds;
  if (owners === undefined) return;
  for (const variantId of variantIds) {
    const ownerProductId = owners.get(variantId);
    if (ownerProductId !== undefined && productIds.has(ownerProductId)) {
      errors.push("VARIANT_ALREADY_COVERED_BY_PRODUCT");
      return;
    }
  }
}

export function validateCampaignForActivation(
  input: CampaignActivationInput,
): CampaignActivationResult {
  const errors: CampaignActivationError[] = [];

  if (!normalizePromotionCampaignName(input.name).ok) errors.push("INVALID_NAME");
  validateDiscount(input, errors);
  validateWindow(input, errors);
  validateTargets(input, errors);

  return errors.length === 0
    ? Object.freeze({ ok: true as const })
    : Object.freeze({ ok: false as const, errors: Object.freeze(errors) });
}
