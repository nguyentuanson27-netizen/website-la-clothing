/**
 * How long a Flash Sale view may go before it must re-ask the server.
 *
 * The browser clock is never authority here. A device whose time is wrong — or deliberately set
 * forward — must not be able to make a sale look started or finished. The server therefore never
 * emits an absolute deadline for the client to compare against `Date.now()`; it emits a *duration*
 * computed from its own instant, and the client's only job is to wait that long and ask again.
 * The shape of the returned fact is part of the contract: there is nothing here a client could
 * mistake for a timestamp.
 */

/** The reviewed maximum staleness for a Flash surface. */
export const MAX_FLASH_SALE_REFRESH_MS = 60_000;

export type FlashSaleRefresh = Readonly<{ refreshAfterMs: number }>;

export function resolveFlashSaleRefresh({
  now,
  nextBoundaryAt,
}: Readonly<{
  now: Date;
  /** The next server-side instant at which membership could change, if any is known. */
  nextBoundaryAt: Date | null;
}>): FlashSaleRefresh {
  if (nextBoundaryAt === null || !Number.isFinite(nextBoundaryAt.getTime())) {
    // Nothing scheduled, or a boundary we cannot read: still re-ask within the staleness bound
    // rather than trusting the page to stay correct indefinitely.
    return Object.freeze({ refreshAfterMs: MAX_FLASH_SALE_REFRESH_MS });
  }

  const untilBoundary = nextBoundaryAt.getTime() - now.getTime();
  // A boundary already reached means the page is showing the previous world; refresh at once. A
  // negative wait would otherwise become an immediate-but-unbounded loop or, worse, a timer that
  // never fires.
  if (untilBoundary <= 0) return Object.freeze({ refreshAfterMs: 0 });

  return Object.freeze({
    refreshAfterMs: Math.min(untilBoundary, MAX_FLASH_SALE_REFRESH_MS),
  });
}
