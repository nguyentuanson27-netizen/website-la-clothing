/**
 * Bounded, redacted promotion signals (#151 G2, master-plan unit U40).
 *
 * The promotion admin surface already returns precise typed failures, and that precision is right
 * where it lands: `PromotionAdminFailure` names the exact catalog rows an admin has to fix. A log
 * is a different audience with different rules. `NO_EFFECTIVE_DISCOUNT`, `UNUSABLE_BASE_PRICE` and
 * `OVERLAPPING_CAMPAIGN` each carry an **unbounded array of internal identifiers**, so writing a
 * failure straight to stdout would publish catalog identifiers at whatever volume a bad campaign
 * happens to produce.
 *
 * This module is the reduction that makes those failures loggable: reason codes and counts out,
 * identifiers never. It exists as a function rather than a convention because
 * `docs/decisions/0002-vps-production-infrastructure.md` states the redaction policy in prose, and
 * prose does not fail a test when a future field carries an identifier into a signal.
 *
 * What survives is deliberately not "as little as possible" — a signal reading only
 * `INVALID_CAMPAIGN` would tell an operator nothing they can act on. Closed reason vocabularies
 * (`CampaignActivationError`, `DraftInputError`, lifecycle status) are categorical, bounded and are
 * the whole diagnostic value, so they are kept. Identifiers are the part that cannot be.
 *
 * Event names follow the existing `pancake_order.*` convention, and emission follows
 * `pancake-order-submit-runtime.ts`: one JSON object per line on stdout, which
 * `docs/decisions/0002-vps-production-infrastructure.md` names as the collected stream. The writer
 * is injectable so the shaping and the emission can both be asserted without capturing stdout.
 */

import type {
  CampaignActivationError,
  DraftInputError,
} from "../commerce/promotion-activation.ts";
import type { PromotionAdminFailure } from "../commerce/promotion-admin-feedback.ts";

/**
 * Bounds the reason list so one malformed submission cannot turn a diagnostic into a flood.
 *
 * The vocabularies are small — twelve activation errors, five draft-input errors — but the arrays
 * are built per request and nothing in the type stops a caller repeating a code.
 */
export const MAX_REPORTED_ACTIVATION_ERRORS = 12;

/**
 * Which admin operation produced the signal.
 *
 * A closed set matching the Server Actions in `src/app/admin/promotions/actions.ts`, so the value
 * is chosen at the call site rather than derived from request input.
 */
export const PROMOTION_ACTIVATION_OPERATIONS = [
  "publish",
  "disable",
  "end-early",
  "copy",
  "create",
  "edit",
] as const;

export type PromotionActivationOperation = (typeof PROMOTION_ACTIVATION_OPERATIONS)[number];

export type PromotionActivationGateSignal = Readonly<{
  name: "promotion.activation_gate";
  operation: PromotionActivationOperation;
  enabled: boolean;
}>;

export type PromotionActivationRejectionSignal = Readonly<
  { name: "promotion.activation_rejected"; operation: PromotionActivationOperation } & (
    | {
        reason: Exclude<
          PromotionAdminFailure["reason"],
          | "ILLEGAL_TRANSITION"
          | "INVALID_CAMPAIGN"
          | "INVALID_DRAFT_INPUT"
          | "NO_EFFECTIVE_DISCOUNT"
          | "UNUSABLE_BASE_PRICE"
          | "OVERLAPPING_CAMPAIGN"
        >;
      }
    | { reason: "ILLEGAL_TRANSITION"; from: string }
    | { reason: "INVALID_CAMPAIGN"; errors: readonly CampaignActivationError[] }
    | { reason: "INVALID_DRAFT_INPUT"; errors: readonly DraftInputError[] }
    /** The identifier arrays reduced to how many rows are affected, and nothing else. */
    | {
        reason: "NO_EFFECTIVE_DISCOUNT" | "UNUSABLE_BASE_PRICE" | "OVERLAPPING_CAMPAIGN";
        affectedCount: number;
      }
  )
>;

export type PromotionObservabilitySignal =
  | PromotionActivationGateSignal
  | PromotionActivationRejectionSignal;

export function describeActivationGate({
  operation,
  enabled,
}: Readonly<{
  operation: PromotionActivationOperation;
  enabled: boolean;
}>): PromotionActivationGateSignal {
  return Object.freeze({ name: "promotion.activation_gate", operation, enabled });
}

function boundedReasons<Reason>(reasons: readonly Reason[]): readonly Reason[] {
  return Object.freeze(reasons.slice(0, MAX_REPORTED_ACTIVATION_ERRORS));
}

/**
 * Reduces one activation failure to a signal safe to write to stdout.
 *
 * The switch is exhaustive over `PromotionAdminFailure["reason"]`, so a reason added to that union
 * stops compiling here rather than silently emitting nothing — the failure mode of a catch-all
 * default is a new rejection class that is invisible in production for as long as nobody notices.
 */
export function describeActivationRejection({
  operation,
  failure,
}: Readonly<{
  operation: PromotionActivationOperation;
  failure: PromotionAdminFailure;
}>): PromotionActivationRejectionSignal {
  const name = "promotion.activation_rejected" as const;

  switch (failure.reason) {
    case "ACTIVATION_DISABLED":
    case "CAMPAIGN_NOT_FOUND":
    case "TARGET_EXPANSION_LIMIT_EXCEEDED":
    case "DUPLICATE_TARGET":
    case "MALFORMED_FIXED_PRICE":
    case "INVALID_PERCENTAGE":
    case "INVALID_CAMPAIGN_KIND":
    case "INVALID_DISCOUNT_TYPE":
    case "INVALID_DATE_TIME":
    case "FORBIDDEN":
      return Object.freeze({ name, operation, reason: failure.reason });

    case "ILLEGAL_TRANSITION":
      // The lifecycle status is a closed vocabulary, not an identifier.
      return Object.freeze({ name, operation, reason: failure.reason, from: failure.from });

    case "INVALID_CAMPAIGN":
      return Object.freeze({
        name,
        operation,
        reason: failure.reason,
        errors: boundedReasons(failure.errors),
      });

    case "INVALID_DRAFT_INPUT":
      return Object.freeze({
        name,
        operation,
        reason: failure.reason,
        errors: boundedReasons(failure.errors),
      });

    case "NO_EFFECTIVE_DISCOUNT":
      return Object.freeze({
        name,
        operation,
        reason: failure.reason,
        affectedCount: failure.invalidVariantIds.length,
      });

    case "UNUSABLE_BASE_PRICE":
      return Object.freeze({
        name,
        operation,
        reason: failure.reason,
        affectedCount: failure.variantIds.length,
      });

    case "OVERLAPPING_CAMPAIGN":
      return Object.freeze({
        name,
        operation,
        reason: failure.reason,
        affectedCount: failure.conflictingCampaignIds.length,
      });
  }
}

/** Where a signal is written. Injectable so tests assert real emission rather than a spy on stdout. */
export type PromotionSignalWriter = (line: string) => void;

function writeToStdout(line: string): void {
  process.stdout.write(line);
}

/**
 * Writes one signal as a single JSON line.
 *
 * Failures are swallowed for the same reason `emitSafely` swallows them in `pancake-order-submit.ts`:
 * observability must never change an admin outcome. A promotion that was refused for a real reason
 * must not additionally fail because a log write did.
 */
export function emitPromotionSignal(
  signal: PromotionObservabilitySignal,
  write: PromotionSignalWriter = writeToStdout,
): void {
  try {
    write(`${JSON.stringify(signal)}\n`);
  } catch {
    // Intentionally ignored.
  }
}
