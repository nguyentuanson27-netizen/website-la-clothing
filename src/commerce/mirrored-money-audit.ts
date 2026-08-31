/**
 * The pre-rollout mirrored money-data audit.
 *
 * `isUsableBasePriceVnd` narrows authoritative website money to a positive safe integer, but the
 * mirrored Pancake columns are `DOUBLE PRECISION`. Before that rule is enforced on buyers, someone
 * has to answer a factual question with real data rather than an assumption: how much of the current
 * catalog fails it, and how many variants that shoppers can see today would stop being purchasable.
 *
 * This module only counts and classifies. It changes no pricing behaviour and decides nothing about
 * `pancakeRetailPriceAfterDiscount`; it reports how often that field disagrees with base so the W3
 * decision can be made on evidence.
 *
 * Reports are bounded on purpose. An audit that dumps every offending row is one nobody reads and a
 * liability to paste into an issue, so counts are complete and examples are capped.
 */

import { isUsableBasePriceVnd } from "./promotion-pricing.ts";

export const MAX_MIRRORED_MONEY_EXAMPLES = 10;

export type MirroredBasePriceClass =
  | "USABLE"
  | "NULL"
  | "ZERO"
  | "NEGATIVE"
  | "NON_FINITE"
  | "NON_INTEGER"
  | "UNSAFE_INTEGER";

const CLASSES: readonly MirroredBasePriceClass[] = [
  "USABLE",
  "NULL",
  "ZERO",
  "NEGATIVE",
  "NON_FINITE",
  "NON_INTEGER",
  "UNSAFE_INTEGER",
];

export type MirroredVariantMoneyRow = Readonly<{
  pancakeVariationId: string;
  pancakeRetailPrice: number | null;
  pancakeRetailPriceAfterDiscount: number | null;
  /** Whether the variant and its product are currently present and active for the configured shop. */
  isStorefrontVisible: boolean;
}>;

export type MirroredMoneyExample = Readonly<{
  pancakeVariationId: string;
  pancakeRetailPrice: number | null;
  pancakeRetailPriceAfterDiscount: number | null;
}>;

export type MirroredMoneySummary = Readonly<{
  totalVariants: number;
  visibleVariants: number;
  counts: Readonly<Record<MirroredBasePriceClass, number>>;
  examples: Readonly<Record<MirroredBasePriceClass, readonly MirroredMoneyExample[]>>;
  /** Currently visible variants that the positive-safe-integer rule would make unpurchasable. */
  visibleVariantsBecomingUnavailable: number;
  visibleUnavailableExamples: readonly MirroredMoneyExample[];
  discountField: Readonly<{
    equalToBase: number;
    lowerThanBase: number;
    higherThanBase: number;
    /** Either side is not usable money, so the two cannot be meaningfully compared. */
    unusableForComparison: number;
    lowerThanBaseExamples: readonly MirroredMoneyExample[];
  }>;
}>;

/**
 * Exactly one class per value, and `USABLE` agrees with the pricing authority by construction: the
 * classifier defers to `isUsableBasePriceVnd` rather than restating its rule, so the audit can never
 * drift from what the resolver actually accepts.
 */
export function classifyMirroredBasePrice(value: number | null): MirroredBasePriceClass {
  if (isUsableBasePriceVnd(value)) return "USABLE";
  if (value === null) return "NULL";
  if (!Number.isFinite(value)) return "NON_FINITE";
  if (!Number.isInteger(value)) return value < 0 ? "NEGATIVE" : "NON_INTEGER";
  if (value === 0) return "ZERO";
  if (value < 0) return "NEGATIVE";
  return "UNSAFE_INTEGER";
}

function toExample(row: MirroredVariantMoneyRow): MirroredMoneyExample {
  // Catalog identity and the offending values only. No buyer, order or cart fact is in scope here,
  // and reconstructing the example rather than copying the row keeps it that way.
  return Object.freeze({
    pancakeVariationId: row.pancakeVariationId,
    pancakeRetailPrice: row.pancakeRetailPrice,
    pancakeRetailPriceAfterDiscount: row.pancakeRetailPriceAfterDiscount,
  });
}

function push(collected: MirroredMoneyExample[], row: MirroredVariantMoneyRow): void {
  if (collected.length < MAX_MIRRORED_MONEY_EXAMPLES) collected.push(toExample(row));
}

export function summarizeMirroredMoney(
  rows: readonly MirroredVariantMoneyRow[],
): MirroredMoneySummary {
  const counts = Object.fromEntries(CLASSES.map((name) => [name, 0])) as Record<
    MirroredBasePriceClass,
    number
  >;
  const examples = Object.fromEntries(CLASSES.map((name) => [name, [] as MirroredMoneyExample[]])) as
    Record<MirroredBasePriceClass, MirroredMoneyExample[]>;

  let visibleVariants = 0;
  let visibleVariantsBecomingUnavailable = 0;
  const visibleUnavailableExamples: MirroredMoneyExample[] = [];

  let equalToBase = 0;
  let lowerThanBase = 0;
  let higherThanBase = 0;
  let unusableForComparison = 0;
  const lowerThanBaseExamples: MirroredMoneyExample[] = [];

  for (const row of rows) {
    const classification = classifyMirroredBasePrice(row.pancakeRetailPrice);
    counts[classification] += 1;
    if (classification !== "USABLE") push(examples[classification], row);

    if (row.isStorefrontVisible) {
      visibleVariants += 1;
      if (classification !== "USABLE") {
        visibleVariantsBecomingUnavailable += 1;
        push(visibleUnavailableExamples, row);
      }
    }

    const base = row.pancakeRetailPrice;
    const discounted = row.pancakeRetailPriceAfterDiscount;
    if (!isUsableBasePriceVnd(base) || discounted === null || !Number.isFinite(discounted)) {
      unusableForComparison += 1;
    } else if (discounted === base) {
      equalToBase += 1;
    } else if (discounted < base) {
      lowerThanBase += 1;
      push(lowerThanBaseExamples, row);
    } else {
      higherThanBase += 1;
    }
  }

  return Object.freeze({
    totalVariants: rows.length,
    visibleVariants,
    counts: Object.freeze(counts),
    examples: Object.freeze(
      Object.fromEntries(CLASSES.map((name) => [name, Object.freeze(examples[name])])),
    ) as MirroredMoneySummary["examples"],
    visibleVariantsBecomingUnavailable,
    visibleUnavailableExamples: Object.freeze(visibleUnavailableExamples),
    discountField: Object.freeze({
      equalToBase,
      lowerThanBase,
      higherThanBase,
      unusableForComparison,
      lowerThanBaseExamples: Object.freeze(lowerThanBaseExamples),
    }),
  });
}
