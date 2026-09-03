/**
 * The in-transaction commerce authority for one cart line.
 *
 * Every accepted cart write — the PDP increment, an absolute quantity update, a removal's departing
 * facts — resolves through here, inside the transaction that commits it. That placement is the
 * contract: a rendered price, a `canSetQuantity` pre-check or any other fact read before the cart
 * row was locked is advice, and a catalog, stock, campaign or price change between then and now is
 * caught before the write rather than after.
 *
 * It resolves through the same `getLines` projection the cart page and checkout render use, so
 * there is exactly one answer to "what is this line, right now": one identity, one price from the
 * central promotion authority, one availability rule. A second in-mutation resolver written to be
 * "just for analytics" is how a shopper ends up charged one price and measured at another.
 *
 * The two outputs are deliberately independent:
 *
 *   - `available` is commerce authority and decides whether the write is accepted;
 *   - `snapshot` is the bounded non-PII analytics fact set, and is `null` whenever a safe one
 *     cannot be produced. A null snapshot never rejects a mutation. Tracking fails closed; commerce
 *     does not fail with it.
 */

import type { Prisma } from "../generated/prisma/client.ts";
import type { CommerceVariantItemFacts } from "../tracking/commerce-events.ts";
import type { CartLineAuthorityResolver } from "./anonymous-cart.ts";
import {
  buildCartAnalyticsItemFacts,
  toCartAnalyticsLineFacts,
} from "./cart-analytics-facts.ts";
import {
  createStorefrontCartRepository,
  type StorefrontCartReadClient,
} from "./storefront-cart-repository.ts";

/**
 * Builds the resolver a cart mutation runs under its own lock.
 *
 * `now` is fixed by the caller for the whole request so the price a mutation validates and the
 * price it snapshots are resolved against one instant, even if a campaign boundary falls in the
 * middle of the transaction.
 */
export function createCartLineAuthorityResolver({
  shopId,
  now,
}: Readonly<{
  shopId: number;
  now: Date;
}>): CartLineAuthorityResolver<CommerceVariantItemFacts> {
  return async (tx: Prisma.TransactionClient, { variantId, quantity }) => {
    const repository = createStorefrontCartRepository(
      tx as unknown as StorefrontCartReadClient,
    );

    let line;
    try {
      const [resolved] = await repository.getLines({
        shopId,
        items: [{ variantId, quantity }],
        now,
      });
      line = resolved;
    } catch {
      // Malformed mirrored facts (an unusable warehouse quantity, an out-of-range shop id) mean the
      // line cannot be authorized. Failing closed here refuses the write rather than committing
      // against facts the projection itself refused to produce.
      return { available: false, snapshot: null };
    }

    if (line === undefined) {
      return { available: false, snapshot: null };
    }

    return {
      available: line.available,
      snapshot: buildCartAnalyticsItemFacts({
        line: toCartAnalyticsLineFacts(line),
        quantity,
      }),
    };
  };
}
