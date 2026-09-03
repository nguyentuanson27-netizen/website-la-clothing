"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireCurrentAdmin } from "@/auth/current-admin";
import { AuthorizationError } from "@/auth/authorization";
import {
  copyPromotionCampaign,
  createDraftPromotionCampaign,
  disablePromotionCampaign,
  editDraftPromotionCampaign,
  editScheduledPromotionCampaign,
  endPromotionCampaignEarly,
  publishPromotionCampaign,
  type CampaignPatch,
} from "@/commerce/promotion-activation-service";
import {
  MAX_PROMOTION_IDENTIFIER_LENGTH,
  MAX_TARGETS_PER_CAMPAIGN,
  type CampaignTargetInput,
} from "@/commerce/promotion-activation";
import { deriveCampaignLifecycle } from "@/commerce/promotion-campaign-lifecycle";
import { createPromotionAdminRepository } from "@/commerce/promotion-admin-repository";
import {
  describePromotionFailure,
  translatePromotionWriteError,
  type PromotionFailureDescription,
} from "@/commerce/promotion-admin-feedback";
import { prisma } from "@/db/prisma";

/**
 * Outcomes travel back as a redirect rather than a returned value, so the surface keeps working
 * with JavaScript unavailable and a reload never replays a mutation. Only the typed *reason* is put
 * in the URL; the operator-facing sentence is looked up on the server when the page re-renders, so
 * no message text — and nothing derived from a failure payload — is ever client-supplied.
 */
type PromotionActionOutcome =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; failure: PromotionFailureDescription }>;

/**
 * Every operation runs the same way: re-authorize on the server, hand the decision to the P4
 * service, and translate whatever comes back. The browser's view of what is enabled or permitted
 * is never an input — a disabled button is a courtesy, not a control.
 */
async function runPromotionOperation(
  operation: (session: Awaited<ReturnType<typeof requireCurrentAdmin>>) => Promise<
    | Readonly<{ ok: true }>
    | Readonly<{ ok: false; failure: Parameters<typeof describePromotionFailure>[0] }>
  >,
): Promise<PromotionActionOutcome> {
  // Authorization is re-established here rather than inherited from the page render. A Server
  // Action is its own request, and a session can have ended since the page was drawn.
  let session: Awaited<ReturnType<typeof requireCurrentAdmin>>;
  try {
    session = await requireCurrentAdmin();
  } catch (error) {
    if (error instanceof AuthorizationError) {
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

  try {
    const outcome = await operation(session);
    if (outcome.ok) {
      revalidatePath("/admin/promotions");
      return { ok: true };
    }
    return { ok: false, failure: describePromotionFailure(outcome.failure) };
  } catch (error) {
    // Only the one violation the surface can describe better than the driver can. Anything else
    // is re-thrown so a genuine fault reaches the error boundary and the logs instead of being
    // rendered as a form message.
    const translated = translatePromotionWriteError(error);
    if (translated === null) throw error;
    return { ok: false, failure: describePromotionFailure(translated) };
  }
}

function campaignIdFrom(formData: FormData): string {
  const raw = formData.get("campaignId");
  // Bounded by the service before any lookup; this only guarantees a string reaches it.
  return typeof raw === "string" ? raw : "";
}

/**
 * `redirect` throws by design, so it is called after the operation has fully settled — never from
 * inside the catch that translates database errors, which would otherwise swallow the redirect.
 */
function completeWith(outcome: PromotionActionOutcome): never {
  if (outcome.ok) redirect("/admin/promotions?status=ok");
  redirect(`/admin/promotions?status=error&reason=${encodeURIComponent(outcome.failure.reason)}`);
}

export async function publishPromotionAction(formData: FormData): Promise<void> {
  const campaignId = campaignIdFrom(formData);
  const outcome = await runPromotionOperation((session) =>
    publishPromotionCampaign({ campaignId, now: new Date(), session }),
  );
  completeWith(outcome);
}

export async function disablePromotionAction(formData: FormData): Promise<void> {
  const campaignId = campaignIdFrom(formData);
  const outcome = await runPromotionOperation((session) =>
    disablePromotionCampaign({ campaignId, now: new Date(), session }),
  );
  completeWith(outcome);
}

export async function endPromotionEarlyAction(formData: FormData): Promise<void> {
  const campaignId = campaignIdFrom(formData);
  const outcome = await runPromotionOperation((session) =>
    endPromotionCampaignEarly({ campaignId, now: new Date(), session }),
  );
  completeWith(outcome);
}

export async function copyPromotionAction(formData: FormData): Promise<void> {
  const campaignId = campaignIdFrom(formData);
  const outcome = await runPromotionOperation((session) =>
    copyPromotionCampaign({ campaignId, session }),
  );
  completeWith(outcome);
}

function parseVietnamDateTime(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}:00+07:00`.slice(0, 25));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDiscountInputs(formData: FormData): {
  discountType: "PERCENTAGE" | "FIXED_PRICE";
  percentageValue: number | null;
  fixedPriceVnd: bigint | null;
} {
  const discountType = formData.get("discountType") === "FIXED_PRICE" ? "FIXED_PRICE" : "PERCENTAGE";
  if (discountType === "PERCENTAGE") {
    const raw = formData.get("percentageValue");
    const num = typeof raw === "string" && raw.trim().length > 0 ? Number(raw.trim()) : null;
    return {
      discountType,
      percentageValue: num !== null && Number.isSafeInteger(num) ? num : null,
      fixedPriceVnd: null,
    };
  }

  const raw = formData.get("fixedPriceVnd");
  if (typeof raw === "string") {
    const cleaned = raw.replace(/\D/g, "");
    if (cleaned.length > 0) {
      try {
        return {
          discountType,
          percentageValue: null,
          fixedPriceVnd: BigInt(cleaned),
        };
      } catch {
        // fall through to null
      }
    }
  }

  return {
    discountType,
    percentageValue: null,
    fixedPriceVnd: null,
  };
}

function parseTargets(formData: FormData): CampaignTargetInput[] {
  const targetProductIds = formData
    .getAll("targetProductId")
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim().slice(0, MAX_PROMOTION_IDENTIFIER_LENGTH));

  const targetVariantIds = formData
    .getAll("targetVariantId")
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim().slice(0, MAX_PROMOTION_IDENTIFIER_LENGTH));

  const targets: CampaignTargetInput[] = [
    ...targetProductIds.map((id) => ({ productId: id, variantId: null })),
    ...targetVariantIds.map((id) => ({ productId: null, variantId: id })),
  ];

  return targets.slice(0, MAX_TARGETS_PER_CAMPAIGN + 1);
}

export async function createPromotionAction(formData: FormData): Promise<void> {
  const name = typeof formData.get("name") === "string" ? (formData.get("name") as string) : "";
  const kind = formData.get("kind") === "FLASH_SALE" ? "FLASH_SALE" : "PROMOTION";
  const { discountType, percentageValue, fixedPriceVnd } = parseDiscountInputs(formData);
  const startsAt = parseVietnamDateTime(formData.get("startsAt"));
  const endsAt = parseVietnamDateTime(formData.get("endsAt"));
  const targets = parseTargets(formData);

  const outcome = await runPromotionOperation((session) =>
    createDraftPromotionCampaign({
      name,
      kind,
      discountType,
      percentageValue,
      fixedPriceVnd,
      startsAt,
      endsAt,
      targets,
      session,
    }),
  );

  completeWith(outcome);
}

export async function editPromotionAction(formData: FormData): Promise<void> {
  const campaignId = campaignIdFrom(formData);
  const name = typeof formData.get("name") === "string" ? (formData.get("name") as string) : "";
  const kind = formData.get("kind") === "FLASH_SALE" ? "FLASH_SALE" : "PROMOTION";
  const { discountType, percentageValue, fixedPriceVnd } = parseDiscountInputs(formData);
  const startsAt = parseVietnamDateTime(formData.get("startsAt"));
  const endsAt = parseVietnamDateTime(formData.get("endsAt"));
  const targets = parseTargets(formData);

  const outcome = await runPromotionOperation(async (session) => {
    const existing = await prisma.promotionCampaign.findUnique({
      where: { id: campaignId },
      select: {
        id: true,
        isEnabled: true,
        enabledAt: true,
        disabledAt: true,
        startsAt: true,
        endsAt: true,
      },
    });
    if (!existing) {
      return { ok: false, failure: { reason: "CAMPAIGN_NOT_FOUND" } as const };
    }

    const now = new Date();
    const lifecycle = deriveCampaignLifecycle({ ...existing, now });

    const patch: CampaignPatch = {
      name,
      kind,
      discountType,
      percentageValue,
      fixedPriceVnd,
      startsAt,
      endsAt,
      targets,
    };

    if (lifecycle.status === "DRAFT") {
      return editDraftPromotionCampaign({ campaignId, now, session, patch });
    }

    if (lifecycle.status === "SCHEDULED") {
      return editScheduledPromotionCampaign({ campaignId, now, session, patch });
    }

    return { ok: false, failure: { reason: "ILLEGAL_TRANSITION", from: lifecycle.status } as const };
  });

  completeWith(outcome);
}

export async function searchPromotionTargetsAction(
  search: string,
  scope: "PRODUCT" | "VARIANT",
): Promise<
  Array<{
    id: string;
    label: string;
    scope: "PRODUCT" | "VARIANT";
    productId: string | null;
    variantId: string | null;
  }>
> {
  try {
    await requireCurrentAdmin();
  } catch {
    return [];
  }

  const repository = createPromotionAdminRepository(prisma);

  if (scope === "PRODUCT") {
    const products = await repository.searchTargetProducts({ search });
    return products.map((p) => ({
      id: p.id,
      label: p.name,
      scope: "PRODUCT" as const,
      productId: p.id,
      variantId: null,
    }));
  }

  const variants = await repository.searchTargetVariants({ search });
  return variants.map((v) => {
    const details = v.sku || [v.color, v.size].filter(Boolean).join(" / ") || v.id;
    const parent = v.product?.name ? `${v.product.name} — ` : "";
    return {
      id: v.id,
      label: `${parent}${details}`,
      scope: "VARIANT" as const,
      productId: null,
      variantId: v.id,
    };
  });
}
