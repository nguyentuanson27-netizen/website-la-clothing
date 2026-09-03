/**
 * Bounded reads for the promotion admin surface.
 *
 * Read-only by design: every mutation goes through the P4 activation service, which owns
 * authorization, validation, locking and the pricing revision. Nothing here writes.
 *
 * Lifecycle is derived from persisted intent plus the caller's instant rather than read from a
 * status column, so a scheduled window that opened while nobody was looking is reported correctly
 * on the next page load.
 */

import type { PrismaClient } from "../generated/prisma/client.ts";
import {
  deriveCampaignLifecycle,
  type CampaignLifecycleStatus,
} from "./promotion-campaign-lifecycle.ts";
import {
  ADMIN_TARGET_SEARCH_LIMIT,
  MAX_ADMIN_PROMOTION_PAGE_SIZE,
  parseAdminPromotionPageSize,
  parseAdminTargetSearchLimit,
} from "./promotion-admin-feedback.ts";

/** Bounds the operator-supplied search text before it reaches a query. */
const MAX_ADMIN_SEARCH_LENGTH = 120;

export type AdminPromotionCampaignRow = Readonly<{
  id: string;
  name: string;
  kind: "PROMOTION" | "FLASH_SALE";
  discountType: "PERCENTAGE" | "FIXED_PRICE";
  percentageValue: number | null;
  fixedPriceVnd: bigint | null;
  startsAt: Date | null;
  endsAt: Date | null;
  status: CampaignLifecycleStatus;
  canReEnable: boolean;
  isTerminal: boolean;
  targetCount: number;
}>;

export function createPromotionAdminRepository(client: PrismaClient) {
  async function listCampaigns({
    search,
    pageSize = MAX_ADMIN_PROMOTION_PAGE_SIZE,
    now = new Date(),
  }: Readonly<{ search?: string | null; pageSize?: number; now?: Date }> = {}) {
    const take = parseAdminPromotionPageSize(pageSize);
    const trimmed = typeof search === "string" ? search.trim().slice(0, MAX_ADMIN_SEARCH_LENGTH) : "";

    const campaigns = await client.promotionCampaign.findMany({
      where: trimmed.length > 0 ? { name: { contains: trimmed, mode: "insensitive" } } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take,
      select: {
        id: true, name: true, kind: true, discountType: true,
        percentageValue: true, fixedPriceVnd: true,
        startsAt: true, endsAt: true, isEnabled: true, enabledAt: true, disabledAt: true,
        _count: { select: { targets: true } },
      },
    });

    return campaigns.map((campaign): AdminPromotionCampaignRow => {
      const lifecycle = deriveCampaignLifecycle({ ...campaign, now });
      return {
        id: campaign.id,
        name: campaign.name,
        kind: campaign.kind,
        discountType: campaign.discountType,
        percentageValue: campaign.percentageValue,
        fixedPriceVnd: campaign.fixedPriceVnd,
        startsAt: campaign.startsAt,
        endsAt: campaign.endsAt,
        status: lifecycle.status,
        canReEnable: lifecycle.canReEnable,
        isTerminal: lifecycle.isTerminal,
        targetCount: campaign._count.targets,
      };
    });
  }

  /** Bounded product search for building a campaign's explicit target list. */
  async function searchTargetProducts({
    shopId,
    search,
    limit = ADMIN_TARGET_SEARCH_LIMIT,
  }: Readonly<{ shopId: number; search?: string | null; limit?: number }>) {
    const take = parseAdminTargetSearchLimit(limit);
    const trimmed = typeof search === "string" ? search.trim().slice(0, MAX_ADMIN_SEARCH_LENGTH) : "";

    return client.productMirror.findMany({
      where: {
        pancakeShopId: shopId,
        isPresent: true,
        isActive: true,
        ...(trimmed.length > 0 ? { name: { contains: trimmed, mode: "insensitive" as const } } : {}),
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take,
      select: { id: true, name: true, slug: true },
    });
  }

  return { listCampaigns, searchTargetProducts };
}
