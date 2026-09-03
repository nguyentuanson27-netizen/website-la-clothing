import type { RenderedQuoteVerifier } from "../../src/commerce/guest-checkout-snapshot.ts";

/**
 * A verifier that treats every computed quote as already acknowledged by the buyer.
 *
 * For tests that exercise snapshotting, locking, promotion audit or geo authority rather than the
 * rendered-quote proof itself. Production callers always pass the real
 * `verifyRenderedQuoteProof` binding; the option is required precisely so no production path can
 * silently create a submit-capable DRAFT at a price nobody proved the buyer saw. The proof gate has
 * its own dedicated coverage in `tests/domain/checkout-quote-proof.test.ts` and the P9a database
 * suites, so accepting here narrows nothing that is not tested elsewhere.
 */
export const acceptAnyRenderedQuote: RenderedQuoteVerifier = () => ({ ok: true });

/** A verifier that refuses every quote, modelling a missing, forged or stale rendered proof. */
export const refuseAnyRenderedQuote: RenderedQuoteVerifier = () => ({
  ok: false,
  reason: "PRICE_CHANGED",
});
