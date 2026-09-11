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

type StorefrontPromotionBoundary = Readonly<{
  startsAt: Date | null;
  endsAt: Date | null;
}>;

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

/**
 * Finds the next enabled-campaign transition already present in a server pricing projection.
 * Callers pass the same candidate campaigns used for pricing, so the timer and rendered money share
 * one request clock and one campaign set.
 */
export function resolveStorefrontPromotionRefreshFromCampaigns({
  now,
  campaigns,
}: Readonly<{
  now: Date;
  campaigns: readonly StorefrontPromotionBoundary[];
}>): StorefrontPromotionRefresh {
  const nowMs = now.getTime();
  let nextBoundaryAt: Date | null = null;

  for (const campaign of campaigns) {
    for (const boundary of [campaign.startsAt, campaign.endsAt]) {
      if (boundary === null) continue;
      const boundaryMs = boundary.getTime();
      if (!Number.isFinite(boundaryMs) || boundaryMs <= nowMs) continue;
      if (nextBoundaryAt === null || boundaryMs < nextBoundaryAt.getTime()) {
        nextBoundaryAt = boundary;
      }
    }
  }

  return resolveStorefrontPromotionRefresh({ now, nextBoundaryAt });
}
