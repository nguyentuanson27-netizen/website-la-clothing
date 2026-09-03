/**
 * Server-relative freshness for storefront promotion projections.
 *
 * Browser wall clock is never promotion authority. The server resolves campaign membership against
 * one request instant, then emits only how long the client may wait before asking the server again.
 * Even when no campaign boundary is known, a visible page revalidates within the reviewed 60s
 * staleness bound.
 */
export const MAX_STOREFRONT_PROMOTION_REFRESH_MS = 60_000;

export type StorefrontPromotionRefresh = Readonly<{ refreshAfterMs: number }>;

export function resolveStorefrontPromotionRefresh({
  now,
  nextBoundaryAt,
}: Readonly<{
  now: Date;
  nextBoundaryAt: Date | null;
}>): StorefrontPromotionRefresh {
  if (nextBoundaryAt === null || !Number.isFinite(nextBoundaryAt.getTime())) {
    return Object.freeze({ refreshAfterMs: MAX_STOREFRONT_PROMOTION_REFRESH_MS });
  }

  const untilBoundary = nextBoundaryAt.getTime() - now.getTime();
  if (untilBoundary <= 0) return Object.freeze({ refreshAfterMs: 0 });

  return Object.freeze({
    refreshAfterMs: Math.min(untilBoundary, MAX_STOREFRONT_PROMOTION_REFRESH_MS),
  });
}
