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
 * This module is the reduction that makes those failures loggable. What it bounds is *volume and
 * shape*, not the existence of identifiers: `docs/specs/promotions-flash-sale-v1.md` §Observability
 * names "campaign ID, target type/ID, variant ID, bounded reason code" as useful context and
 * forbids "customer address/phone/secrets/session handles or raw quote proof". A signal that
 * reduced everything to a count would obey a stricter rule than the spec asks for and would leave
 * an operator holding `OVERLAPPING_CAMPAIGN affectedCount=1` with no way to find the campaign that
 * conflicted. So identifiers survive, capped at `MAX_REPORTED_SIGNAL_IDENTIFIERS` per signal and
 * each individually length-bounded, with the untruncated total kept alongside so a sample is never
 * mistaken for the whole.
 *
 * It exists as a function rather than a convention because
 * `docs/decisions/0002-vps-production-infrastructure.md` states the redaction policy in prose, and
 * prose does not fail a test when a future field carries an unbounded value into a signal.
 *
 * Event names follow the existing `pancake_order.*` convention, and emission follows
 * `pancake-order-submit-runtime.ts`: one JSON object per line on stdout, which
 * `docs/decisions/0002-vps-production-infrastructure.md` names as the collected stream. The writer
 * is injectable so the shaping and the emission can both be asserted without capturing stdout.
 */

import {
  isBoundedPromotionIdentifier,
  type CampaignActivationError,
  type DraftInputError,
} from "../commerce/promotion-activation.ts";
import type { PromotionAdminFailure } from "../commerce/promotion-admin-feedback.ts";
import type { CampaignLifecycleStatus } from "../commerce/promotion-campaign-lifecycle.ts";

/**
 * Bounds the reason list so one malformed submission cannot turn a diagnostic into a flood.
 *
 * The vocabularies are small — twelve activation errors, five draft-input errors — but the arrays
 * are built per request and nothing in the type stops a caller repeating a code.
 */
export const MAX_REPORTED_ACTIVATION_ERRORS = 12;

/**
 * How many identifiers one signal may carry.
 *
 * A sample, not the set. Triage needs somewhere to start looking — the first conflicting campaign,
 * the first few unpriced variants — and the admin screen still holds the complete list for the
 * person who has to fix it. Ten keeps a log line readable and keeps a 2,000-variant campaign from
 * writing a 2,000-identifier line; `affectedCount` reports the real total so the sample is never
 * read as the whole.
 */
export const MAX_REPORTED_SIGNAL_IDENTIFIERS = 10;

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

/**
 * The operations whose outcome the `LA_PROMOTION_ACTIVATION_ENABLED` gate can decide.
 *
 * Mirrors the two `isPromotionActivationEnabled` checks in `promotion-activation-service.ts`:
 * `publishPromotionCampaign` and `editScheduledPromotionCampaign`. Disable and end-early are
 * deliberately ungated — turning a live promotion off must never depend on the flag that turned it
 * on — so reporting gate state alongside them would suggest a bearing it does not have.
 *
 * `tests/domain/promotion-admin-actions-structure.test.ts` pins this against the service source, so
 * a gate check added to a third operation fails a test rather than silently going unreported.
 */
export const GATE_GOVERNED_OPERATIONS = [
  "publish",
  "edit",
] as const satisfies readonly PromotionActivationOperation[];

export function isGateGovernedOperation(operation: PromotionActivationOperation): boolean {
  return (GATE_GOVERNED_OPERATIONS as readonly PromotionActivationOperation[]).includes(operation);
}

export type PromotionActivationGateSignal = Readonly<{
  name: "promotion.activation_gate";
  operation: PromotionActivationOperation;
  enabled: boolean;
}>;

/** Context common to every rejection, present only when it is known and within bounds. */
type RejectionContext = Readonly<{ campaignId?: string }>;

export type PromotionActivationRejectionSignal = Readonly<
  {
    name: "promotion.activation_rejected";
    operation: PromotionActivationOperation;
  } & RejectionContext &
    (
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
      | { reason: "ILLEGAL_TRANSITION"; from: CampaignLifecycleStatus }
      | { reason: "INVALID_CAMPAIGN"; errors: readonly CampaignActivationError[] }
      | { reason: "INVALID_DRAFT_INPUT"; errors: readonly DraftInputError[] }
      /** `affectedCount` is the untruncated total; the array is a bounded sample of it. */
      | {
          reason: "NO_EFFECTIVE_DISCOUNT";
          affectedCount: number;
          invalidVariantIds: readonly string[];
        }
      | { reason: "UNUSABLE_BASE_PRICE"; affectedCount: number; variantIds: readonly string[] }
      | {
          reason: "OVERLAPPING_CAMPAIGN";
          affectedCount: number;
          conflictingCampaignIds: readonly string[];
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
 * A bounded sample of identifiers.
 *
 * Each candidate passes the same length bound the admin surface applies before any lookup, so an
 * identifier that was never legal input cannot reach a log line by riding inside a failure payload.
 * One that fails the bound is dropped from the sample and still counted in the total.
 */
function boundedIdentifiers(ids: readonly string[]): readonly string[] {
  const sample: string[] = [];
  for (const id of ids) {
    if (sample.length >= MAX_REPORTED_SIGNAL_IDENTIFIERS) break;
    if (isBoundedPromotionIdentifier(id)) sample.push(id);
  }
  return Object.freeze(sample);
}

/**
 * The campaign the operation acted on, when it is known and legal.
 *
 * For the operations that take one, this value is raw browser input: the same string the service
 * refuses before it opens a transaction. It is bounded here for the same reason, and omitted rather
 * than truncated when it fails — a truncated identifier reads like a real one.
 */
function rejectionContext(campaignId: string | undefined): RejectionContext {
  if (campaignId === undefined) return {};
  const trimmed = campaignId.trim();
  return isBoundedPromotionIdentifier(trimmed) ? { campaignId: trimmed } : {};
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
  campaignId,
}: Readonly<{
  operation: PromotionActivationOperation;
  failure: PromotionAdminFailure;
  campaignId?: string;
}>): PromotionActivationRejectionSignal {
  const name = "promotion.activation_rejected" as const;
  const context = rejectionContext(campaignId);

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
      return Object.freeze({ name, operation, ...context, reason: failure.reason });

    case "ILLEGAL_TRANSITION":
      // The lifecycle status is a closed vocabulary, not an identifier.
      return Object.freeze({
        name,
        operation,
        ...context,
        reason: failure.reason,
        from: failure.from,
      });

    case "INVALID_CAMPAIGN":
      return Object.freeze({
        name,
        operation,
        ...context,
        reason: failure.reason,
        errors: boundedReasons(failure.errors),
      });

    case "INVALID_DRAFT_INPUT":
      return Object.freeze({
        name,
        operation,
        ...context,
        reason: failure.reason,
        errors: boundedReasons(failure.errors),
      });

    case "NO_EFFECTIVE_DISCOUNT":
      return Object.freeze({
        name,
        operation,
        ...context,
        reason: failure.reason,
        affectedCount: failure.invalidVariantIds.length,
        invalidVariantIds: boundedIdentifiers(failure.invalidVariantIds),
      });

    case "UNUSABLE_BASE_PRICE":
      return Object.freeze({
        name,
        operation,
        ...context,
        reason: failure.reason,
        affectedCount: failure.variantIds.length,
        variantIds: boundedIdentifiers(failure.variantIds),
      });

    case "OVERLAPPING_CAMPAIGN":
      return Object.freeze({
        name,
        operation,
        ...context,
        reason: failure.reason,
        affectedCount: failure.conflictingCampaignIds.length,
        conflictingCampaignIds: boundedIdentifiers(failure.conflictingCampaignIds),
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
