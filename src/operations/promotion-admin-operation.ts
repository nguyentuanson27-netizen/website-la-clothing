/**
 * The promotion admin mutation funnel (#151 G2, master-plan unit U40).
 *
 * Every promotion Server Action runs the same way: re-authorize on the server, report the state of
 * the activation gate for the operations that gate decides, hand the decision to the P4 service,
 * translate whatever comes back, and emit a bounded signal for anything that was refused.
 *
 * It lives here, outside `src/app/admin/promotions/actions.ts`, for one reason: a `"use server"`
 * module cannot be imported by a test. Leaving the funnel in the action file would leave its
 * emission provable only by reading the source, and a signal that is only asserted structurally is
 * a signal nobody has watched fire. Everything Next-specific — the `"use server"` boundary, the
 * session lookup, `revalidatePath` — is injected, so the action file keeps owning the wiring and
 * this file owns the order of operations.
 *
 * The order is the security property `tests/domain/promotion-admin-actions-structure.test.ts`
 * pins: nothing the caller supplied is parsed, read or acted on until `authorize()` has resolved.
 * The gate signal is emitted after authorization for the same reason — unauthenticated traffic must
 * not be able to write log lines.
 */

import { AuthorizationError } from "../auth/authorization.ts";
import { isPromotionActivationEnabled } from "../commerce/promotion-activation.ts";
import {
  describePromotionFailure,
  translatePromotionWriteError,
  type PromotionAdminFailure,
  type PromotionFailureDescription,
} from "../commerce/promotion-admin-feedback.ts";
import {
  describeActivationGate,
  describeActivationRejection,
  emitPromotionSignal,
  isGateGovernedOperation,
  type PromotionActivationOperation,
  type PromotionObservabilitySignal,
} from "./promotion-observability.ts";

/** What the P4 service hands back to an action. */
export type PromotionOperationResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; failure: PromotionAdminFailure }>;

/**
 * What the action hands back to the page. Only the typed reason travels; the operator-facing
 * sentence is looked up on the server when the page re-renders.
 */
export type PromotionActionOutcome =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; failure: PromotionFailureDescription }>;

export type PromotionAdminOperationInput<Session> = Readonly<{
  /** Chosen at the call site from a closed set, never derived from request input. */
  operation: PromotionActivationOperation;
  /** Raw browser input where the operation takes one; bounded before it reaches a signal. */
  campaignId?: string;
  authorize: () => Promise<Session>;
  run: (session: Session) => Promise<PromotionOperationResult>;
  /** Cache invalidation for a committed write. Runs only on success. */
  onCommitted: () => void;
  emit?: (signal: PromotionObservabilitySignal) => void;
  env?: Readonly<Record<string, string | undefined>>;
}>;

export async function runPromotionAdminOperation<Session>({
  operation,
  campaignId,
  authorize,
  run,
  onCommitted,
  emit = (signal) => emitPromotionSignal(signal),
  env = process.env,
}: PromotionAdminOperationInput<Session>): Promise<PromotionActionOutcome> {
  // Authorization is re-established here rather than inherited from the page render. A Server
  // Action is its own request, and a session can have ended since the page was drawn.
  let session: Session;
  try {
    session = await authorize();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      emit(describeActivationRejection({ operation, campaignId, failure: { reason: "FORBIDDEN" } }));
      return {
        ok: false,
        failure: {
          reason: "FORBIDDEN",
          message: "Bạn không có quyền thực hiện thao tác này.",
          wroteNothing: true,
        },
      };
    }
    throw error;
  }

  // Rollback for promotions is an environment flip, so the gate's state in the running process is
  // the fact an operator needs to confirm the flip landed. Reported per gated operation rather than
  // once at boot, because a boot-time line says nothing about the process serving this request.
  if (isGateGovernedOperation(operation)) {
    emit(describeActivationGate({ operation, enabled: isPromotionActivationEnabled(env) }));
  }

  try {
    const outcome = await run(session);
    if (outcome.ok) {
      onCommitted();
      return { ok: true };
    }
    emit(describeActivationRejection({ operation, campaignId, failure: outcome.failure }));
    return { ok: false, failure: describePromotionFailure(outcome.failure) };
  } catch (error) {
    // Only the one violation the surface can describe better than the driver can. Anything else
    // is re-thrown so a genuine fault reaches the error boundary and the logs instead of being
    // rendered as a form message.
    const translated = translatePromotionWriteError(error);
    if (translated === null) throw error;
    emit(describeActivationRejection({ operation, campaignId, failure: translated }));
    return { ok: false, failure: describePromotionFailure(translated) };
  }
}
