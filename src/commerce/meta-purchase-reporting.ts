import { readMetaPurchaseSnapshot } from "./meta-purchase-snapshot.ts";
import {
  buildMetaPurchaseEvent,
  sendMetaConversionEvents,
  type MetaUserIdentity,
} from "../integrations/meta/conversions-api.ts";
import { readMetaConversionsConfig } from "../integrations/meta/pixel-config.ts";
import type { PrismaClient } from "../generated/prisma/client.ts";

/**
 * Reports a confirmed sale to Meta's Conversions API.
 *
 * The server-side half of the Purchase pair. It is the reliable one — it survives ad blockers and
 * a buyer who closes the tab before the success page paints — but it must never be able to affect
 * the sale it reports, so every failure here is swallowed.
 */

type ReportClient = Pick<PrismaClient, "orderMirror" | "variantMirror">;

export type MetaPurchaseRequestContext = Readonly<{
  clientIpAddress: string | null;
  clientUserAgent: string | null;
  fbp: string | null;
  fbc: string | null;
  eventSourceUrl: string | null;
}>;

export type MetaPurchaseReportOptions = Readonly<{
  now?: Date;
  fetchImpl?: typeof fetch;
}>;

export async function reportMetaPurchase(
  client: ReportClient,
  orderCode: string,
  context: MetaPurchaseRequestContext,
  options: MetaPurchaseReportOptions = {},
): Promise<void> {
  const now = options.now ?? new Date();
  const config = readMetaConversionsConfig();
  if (config === null) return;

  const snapshot = await readMetaPurchaseSnapshot(client, orderCode);
  if (snapshot === null) return;

  const order = await client.orderMirror.findUnique({
    where: { publicCode: orderCode },
    select: { guestName: true, guestPhone: true },
  });

  const identity: MetaUserIdentity = {
    phone: order?.guestPhone ?? null,
    fullName: order?.guestName ?? null,
    clientIpAddress: context.clientIpAddress,
    clientUserAgent: context.clientUserAgent,
    fbp: context.fbp,
    fbc: context.fbc,
  };

  const event = buildMetaPurchaseEvent({
    // The order code is the event id on both halves, which is what pairs them.
    eventId: orderCode,
    eventTimeSeconds: Math.floor(now.getTime() / 1000),
    eventSourceUrl: context.eventSourceUrl,
    valueVnd: snapshot.valueVnd,
    contents: snapshot.contents,
    identity,
  });

  await sendMetaConversionEvents(config, [event], options.fetchImpl);
}

/**
 * Never lets a reporting failure reach the checkout that triggered it: a sale is complete whether
 * or not Meta hears about it.
 */
export async function reportMetaPurchaseSafely(
  client: ReportClient,
  orderCode: string,
  context: MetaPurchaseRequestContext,
  options: MetaPurchaseReportOptions = {},
): Promise<void> {
  try {
    await reportMetaPurchase(client, orderCode, context, options);
  } catch {
    // Intentionally silent.
  }
}
