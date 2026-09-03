import type { CartLineAuthorityResolver } from "../../src/commerce/anonymous-cart.ts";

/**
 * A resolver that authorizes any requested line and produces no analytics snapshot.
 *
 * For tests that exercise cart locking, transitions and cookie behaviour rather than catalog
 * authority. Production callers always pass the real resolver; the parameter is required precisely
 * so no production path can silently skip the in-transaction re-resolution.
 */
export const allowAnyCartLine: CartLineAuthorityResolver<never> = async () => ({
  available: true,
  snapshot: null,
});

/** A resolver that refuses every line, modelling a catalog/stock change under the mutation lock. */
export const refuseAnyCartLine: CartLineAuthorityResolver<never> = async () => ({
  available: false,
  snapshot: null,
});
