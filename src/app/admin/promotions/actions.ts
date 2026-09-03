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
import { isBoundedPromotionIdentifier } from "@/commerce/promotion-activation";
import { deriveCampaignLifecycle } from "@/commerce/promotion-campaign-lifecycle";
import { createPromotionAdminRepository } from "@/commerce/promotion-admin-repository";
import { parseCampaignFormInput } from "@/commerce/promotion-admin-input";
import {
  describePromotionFailure,
  translatePromotionWriteError,
  type PromotionFailureDescription,
} from "@/commerce/promotion-admin-feedback";
import { prisma } from "@/db/prisma";
import { readPancakeShopId } from "@/integrations/pancake/config";

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

export async function createPromotionAction(formData: FormData): Promise<void> {
  const outcome = await runPromotionOperation((session) => {
    const parseResult = parseCampaignFormInput(formData);
    if (!parseResult.ok) {
      return Promise.resolve({ ok: false, failure: { reason: parseResult.reason } });
    }

    const {
      name,
      kind,
      discountType,
      percentageValue,
      fixedPriceVnd,
      startsAt,
      endsAt,
      targets,
    } = parseResult.value;

    return createDraftPromotionCampaign({
      name,
      kind,
      discountType,
      percentageValue,
      fixedPriceVnd,
      startsAt,
      endsAt,
      targets,
      session,
    });
  });

  completeWith(outcome);
}

export async function editPromotionAction(formData: FormData): Promise<void> {
  const outcome = await runPromotionOperation(async (session) => {
    const parseResult = parseCampaignFormInput(formData);
    if (!parseResult.ok) {
      return { ok: false, failure: { reason: parseResult.reason } };
    }

    const rawId = campaignIdFrom(formData).trim();
    if (!isBoundedPromotionIdentifier(rawId)) {
      return { ok: false, failure: { reason: "CAMPAIGN_NOT_FOUND" } };
    }
    const campaignId = rawId;

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
      return { ok: false, failure: { reason: "CAMPAIGN_NOT_FOUND" } };
    }

    const now = new Date();
    const lifecycle = deriveCampaignLifecycle({ ...existing, now });

    const patch: CampaignPatch = parseResult.value;

    if (lifecycle.status === "DRAFT") {
      return editDraftPromotionCampaign({ campaignId, now, session, patch });
    }

    if (lifecycle.status === "SCHEDULED") {
      return editScheduledPromotionCampaign({ campaignId, now, session, patch });
    }

    return { ok: false, failure: { reason: "ILLEGAL_TRANSITION", from: lifecycle.status } };
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

  // Promotion targets belong to this storefront's Pancake shop. Configuration is parsed strictly;
  // a missing or invalid shop id fails closed instead of broadening the search to every mirror row.
  const shopId = readPancakeShopId();
  const repository = createPromotionAdminRepository(prisma);

  if (scope === "PRODUCT") {
    const products = await repository.searchTargetProducts({ shopId, search });
    return products.map((p) => ({
      id: p.id,
      label: p.name,
      scope: "PRODUCT" as const,
      productId: p.id,
      variantId: null,
    }));
  }

  const variants = await repository.searchTargetVariants({ shopId, search });
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
