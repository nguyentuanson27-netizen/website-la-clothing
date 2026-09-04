import type { PrismaClient } from "../generated/prisma/client.ts";
import {
  buildPurchaseEvent,
  buildVariantItem,
  MAX_COMMERCE_IDENTIFIER_LENGTH,
  type CommerceVariantItemFacts,
  type PurchaseEvent,
  type VariantItem,
} from "../tracking/commerce-events.ts";

/**
 * The vendor-neutral canonical Purchase snapshot derived from immutable order facts.
 *
 * Grounded strictly in OrderMirror and OrderLineSnapshot when state === "CONFIRMED".
 * No promotion recalculation, no current catalog retail price, no internal CUID leakage.
 * If catalog mirrors are modified, hidden or deleted, the confirmed Purchase facts
 * remain stable and authoritative from persisted line snapshots.
 */

export type CanonicalPurchaseSnapshot = Readonly<{
  publicCode: string;
  merchandiseValueVnd: number;
  shippingVnd: number;
  totalVnd: number;
  items: readonly VariantItem[];
  event: PurchaseEvent;
}>;

export type CanonicalPurchaseClient = Pick<PrismaClient, "orderMirror" | "variantMirror">;

const MAX_SAFE_VND = BigInt(Number.MAX_SAFE_INTEGER);

/** VND amounts are stored as BigInt; a total past Number's exact range is not reportable. */
function toSafeNumber(value: bigint | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (value < BigInt(0) || value > MAX_SAFE_VND) return null;
  return Number(value);
}

function isBoundedPublicCode(value: string): boolean {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > MAX_COMMERCE_IDENTIFIER_LENGTH) return false;
  if (value.trim() !== value) return false;
  return true;
}

export async function readCanonicalPurchaseSnapshot(
  client: CanonicalPurchaseClient,
  orderCode: string,
): Promise<CanonicalPurchaseSnapshot | null> {
  if (!isBoundedPublicCode(orderCode)) return null;

  const order = await client.orderMirror.findUnique({
    where: { publicCode: orderCode },
    select: {
      state: true,
      publicCode: true,
      merchandiseSubtotalVnd: true,
      shippingFeeVnd: true,
      totalVnd: true,
      lines: {
        select: {
          variantId: true,
          pancakeVariationId: true,
          productName: true,
          color: true,
          size: true,
          quantity: true,
          unitPriceVnd: true,
          lineTotalVnd: true,
        },
      },
    },
  });

  // Only a confirmed order is a sale. DRAFT, VALIDATING, POS_SUBMITTING, SYNC_UNKNOWN, REJECTED emit no Purchase.
  if (order === null || order.state !== "CONFIRMED") return null;
  if (!Array.isArray(order.lines) || order.lines.length === 0) return null;

  let totalMerchandiseVnd = BigInt(0);
  const rawLineFacts: Array<{
    variantId: string;
    pancakeVariationId: string;
    productName: string;
    color?: string;
    size?: string;
    quantity: number;
    unitPriceVnd: number;
  }> = [];

  for (const line of order.lines) {
    const unitPriceVnd = toSafeNumber(line.unitPriceVnd);
    if (unitPriceVnd === null) return null;

    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) return null;

    const computedLineTotal = BigInt(unitPriceVnd) * BigInt(line.quantity);
    if (line.lineTotalVnd !== null && line.lineTotalVnd !== undefined) {
      if (computedLineTotal !== line.lineTotalVnd) return null;
    }

    totalMerchandiseVnd += computedLineTotal;
    if (totalMerchandiseVnd > MAX_SAFE_VND) return null;

    rawLineFacts.push({
      variantId: line.variantId,
      pancakeVariationId: line.pancakeVariationId,
      productName: line.productName,
      ...(line.color ? { color: line.color } : {}),
      ...(line.size ? { size: line.size } : {}),
      quantity: line.quantity,
      unitPriceVnd,
    });
  }

  // Canonical merchandise value must reconcile with immutable finalized order subtotal.
  const recordedSubtotal = toSafeNumber(order.merchandiseSubtotalVnd);
  if (recordedSubtotal === null || recordedSubtotal !== Number(totalMerchandiseVnd)) {
    return null;
  }

  const shippingVnd = toSafeNumber(order.shippingFeeVnd ?? BigInt(0));
  const recordedTotal = toSafeNumber(order.totalVnd);
  if (shippingVnd === null || recordedTotal === null) return null;

  // Complete money consistency check: merchandise subtotal + shipping fee === order total.
  if (BigInt(recordedSubtotal) + BigInt(shippingVnd) !== order.totalVnd) {
    return null;
  }

  // Optional mutable catalog enrichment: lookup pancakeProductId for item_group_id.
  // Failure to resolve optional enrichment must never fail or suppress the valid Purchase.
  let productExternalIdByVariantId = new Map<string, string>();
  try {
    const variantIds = rawLineFacts.map((f) => f.variantId).filter(Boolean);
    if (variantIds.length > 0) {
      const variants = await client.variantMirror.findMany({
        where: { id: { in: variantIds } },
        select: {
          id: true,
          product: { select: { pancakeProductId: true } },
        },
      });
      productExternalIdByVariantId = new Map(
        variants.map((v) => [v.id, v.product.pancakeProductId]),
      );
    }
  } catch {
    // Optional enrichment failure degrades gracefully to empty map.
  }

  const items: VariantItem[] = [];
  try {
    for (const line of rawLineFacts) {
      const productExternalId = productExternalIdByVariantId.get(line.variantId);
      const facts: CommerceVariantItemFacts = {
        variantExternalId: line.pancakeVariationId,
        ...(productExternalId ? { productExternalId } : {}),
        itemName: line.productName,
        unitPriceVnd: line.unitPriceVnd,
        quantity: line.quantity,
        ...(line.color ? { color: line.color } : {}),
        ...(line.size ? { size: line.size } : {}),
      };
      items.push(buildVariantItem(facts));
    }
  } catch {
    return null;
  }

  let event: PurchaseEvent;
  try {
    event = buildPurchaseEvent({
      publicCode: order.publicCode,
      merchandiseValueVnd: Number(totalMerchandiseVnd),
      shippingVnd,
      totalVnd: recordedTotal,
      items,
    });
  } catch {
    return null;
  }

  return Object.freeze({
    publicCode: order.publicCode,
    merchandiseValueVnd: Number(totalMerchandiseVnd),
    shippingVnd,
    totalVnd: recordedTotal,
    items: Object.freeze(items),
    event,
  });
}

/**
 * Safely reads the canonical purchase snapshot without ever throwing.
 * Ensures tracking failure isolation so commerce success is completely decoupled from measurement errors.
 */
export async function readCanonicalPurchaseSnapshotSafely(
  client: CanonicalPurchaseClient,
  orderCode: string,
): Promise<CanonicalPurchaseSnapshot | null> {
  try {
    return await readCanonicalPurchaseSnapshot(client, orderCode);
  } catch (error) {
    console.warn(
      `canonical_purchase.snapshot_failed order=${orderCode} reason=UNEXPECTED_ERROR` +
        ` detail=${error instanceof Error ? error.message : "unknown"}`,
    );
    return null;
  }
}
