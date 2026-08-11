import type { PrismaClient } from "../generated/prisma/client.ts";
import type { PancakeCatalogVariation } from "../integrations/pancake/catalog-contract.ts";
import {
  buildPancakeCreateOrderRequest,
  parsePancakeCreateOrderResponse,
  type PancakeCreateOrderRequest,
} from "../integrations/pancake/order-create.ts";
import { ANONYMOUS_CART_MAX_DISTINCT_ITEMS } from "./anonymous-cart.ts";
import { calculateGuestShippingFeeVnd } from "./guest-shipping-policy.ts";
import { resolveStorefrontPrice } from "./storefront-product.ts";

const MAX_PUBLIC_CODE_LENGTH = 128;

export type PancakeOrderSubmissionReason =
  | "ORDER_NOT_FOUND"
  | "SUBMISSION_ALREADY_CLAIMED"
  | "SUBMISSION_BUSY"
  | "LOCAL_ORDER_INVALID"
  | "VARIATION_UNAVAILABLE"
  | "PRICE_CHANGED"
  | "PRICE_UNAVAILABLE"
  | "STOCK_UNAVAILABLE"
  | "VALIDATION_UNAVAILABLE"
  | "CREATE_OUTCOME_UNKNOWN"
  | "ORDER_REJECTED";

export type PancakeOrderSubmissionResult =
  | { ok: true; state: "CONFIRMED"; pancakeOrderId: string }
  | {
      ok: false;
      state: "DRAFT" | "VALIDATING" | "POS_SUBMITTING" | "REJECTED" | "SYNC_UNKNOWN" | "CONFIRMED";
      reason: PancakeOrderSubmissionReason;
    };

export type PancakeOrderSubmissionGateway = {
  fetchCompleteCatalog(shopId: number): Promise<readonly PancakeCatalogVariation[]>;
  createOrder(request: PancakeCreateOrderRequest): Promise<unknown>;
};

function requirePublicCode(value: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PUBLIC_CODE_LENGTH ||
    value.trim() !== value
  ) {
    throw new TypeError("Order public code must be a normalized non-empty string");
  }
  return value;
}

function requireShopId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("Pancake shop id must be a positive safe integer");
  }
  return value;
}

function isNormalizedNonEmptyString(value: string | null): value is string {
  return value !== null && value.length > 0 && value.trim() === value;
}

function isNormalizedOptionalString(value: string | null): boolean {
  return value === null || (value.length > 0 && value.trim() === value);
}

function isSupportedVndAmount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function checkedMultiplyVnd(unitPriceVnd: number, quantity: number): number | null {
  if (!isSupportedVndAmount(unitPriceVnd) || !Number.isSafeInteger(quantity) || quantity <= 0) {
    return null;
  }
  const result = unitPriceVnd * quantity;
  return isSupportedVndAmount(result) ? result : null;
}

function checkedAddVnd(left: number, right: number): number | null {
  const result = left + right;
  return isSupportedVndAmount(result) ? result : null;
}

function existingResult(order: {
  state: string;
  pancakeOrderId: string | null;
  syncErrorCode: string | null;
}): PancakeOrderSubmissionResult {
  if (order.state === "CONFIRMED" && order.pancakeOrderId) {
    return { ok: true, state: "CONFIRMED", pancakeOrderId: order.pancakeOrderId };
  }
  if (order.state === "SYNC_UNKNOWN") {
    return { ok: false, state: "SYNC_UNKNOWN", reason: "CREATE_OUTCOME_UNKNOWN" };
  }
  if (order.state === "REJECTED") {
    const reason = order.syncErrorCode;
    if (
      reason === "LOCAL_ORDER_INVALID" ||
      reason === "VARIATION_UNAVAILABLE" ||
      reason === "PRICE_CHANGED" ||
      reason === "PRICE_UNAVAILABLE" ||
      reason === "STOCK_UNAVAILABLE"
    ) {
      return { ok: false, state: "REJECTED", reason };
    }
    return { ok: false, state: "REJECTED", reason: "ORDER_REJECTED" };
  }
  if (order.state === "POS_SUBMITTING") {
    return { ok: false, state: "POS_SUBMITTING", reason: "SUBMISSION_ALREADY_CLAIMED" };
  }
  if (order.state === "VALIDATING") {
    return { ok: false, state: "VALIDATING", reason: "SUBMISSION_ALREADY_CLAIMED" };
  }
  if (order.state === "DRAFT") {
    return { ok: false, state: "DRAFT", reason: "SUBMISSION_BUSY" };
  }
  return { ok: false, state: "CONFIRMED", reason: "LOCAL_ORDER_INVALID" };
}

export function createPancakeOrderSubmissionService(
  client: PrismaClient,
  gateway: PancakeOrderSubmissionGateway,
) {
  async function submit({
    publicCode,
    shopId,
  }: {
    publicCode: string;
    shopId: number;
  }): Promise<PancakeOrderSubmissionResult> {
    const safePublicCode = requirePublicCode(publicCode);
    const safeShopId = requireShopId(shopId);

    const claim = await client.orderMirror.updateMany({
      where: { publicCode: safePublicCode, state: "DRAFT" },
      data: { state: "VALIDATING", syncErrorCode: null },
    });

    if (claim.count !== 1) {
      const current = await client.orderMirror.findUnique({
        where: { publicCode: safePublicCode },
        select: { state: true, pancakeOrderId: true, syncErrorCode: true },
      });
      return current ? existingResult(current) : { ok: false, state: "DRAFT", reason: "ORDER_NOT_FOUND" };
    }

    const order = await client.orderMirror.findUniqueOrThrow({
      where: { publicCode: safePublicCode },
      include: { lines: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });

    async function reject(reason: Extract<PancakeOrderSubmissionReason,
      | "LOCAL_ORDER_INVALID"
      | "VARIATION_UNAVAILABLE"
      | "PRICE_CHANGED"
      | "PRICE_UNAVAILABLE"
      | "STOCK_UNAVAILABLE"
    >): Promise<PancakeOrderSubmissionResult> {
      await client.orderMirror.updateMany({
        where: { id: order.id, state: "VALIDATING" },
        data: { state: "REJECTED", syncErrorCode: reason },
      });
      return { ok: false, state: "REJECTED", reason };
    }

    async function resetValidation(): Promise<PancakeOrderSubmissionResult> {
      await client.orderMirror.updateMany({
        where: { id: order.id, state: "VALIDATING" },
        data: { state: "DRAFT", syncErrorCode: "VALIDATION_UNAVAILABLE" },
      });
      return { ok: false, state: "DRAFT", reason: "VALIDATION_UNAVAILABLE" };
    }

    if (
      order.checkoutSnapshottedAt === null ||
      !isNormalizedNonEmptyString(order.guestName) ||
      !isNormalizedNonEmptyString(order.guestPhone) ||
      !isNormalizedNonEmptyString(order.provinceRef) ||
      !isNormalizedNonEmptyString(order.districtRef) ||
      !isNormalizedNonEmptyString(order.communeRef) ||
      !isNormalizedNonEmptyString(order.addressDetail) ||
      !isNormalizedOptionalString(order.note) ||
      order.merchandiseSubtotalVnd === null ||
      order.shippingFeeVnd === null ||
      order.totalVnd === null ||
      order.lines.length === 0 ||
      order.lines.length > ANONYMOUS_CART_MAX_DISTINCT_ITEMS
    ) {
      return reject("LOCAL_ORDER_INVALID");
    }

    let liveCatalog: readonly PancakeCatalogVariation[];
    try {
      liveCatalog = await gateway.fetchCompleteCatalog(safeShopId);
    } catch {
      return resetValidation();
    }

    const liveByVariationId = new Map<string, PancakeCatalogVariation | null>();
    for (const variation of liveCatalog) {
      if (liveByVariationId.has(variation.id)) {
        liveByVariationId.set(variation.id, null);
      } else {
        liveByVariationId.set(variation.id, variation);
      }
    }

    const requestedVariationIds = new Set<string>();
    const requestLines: Array<{
      pancakeVariationId: string;
      quantity: number;
      unitPriceVnd: number;
    }> = [];
    let subtotalVnd = 0;
    let totalQuantity = 0;

    for (const line of order.lines) {
      if (
        !isNormalizedNonEmptyString(line.pancakeVariationId) ||
        requestedVariationIds.has(line.pancakeVariationId) ||
        !Number.isSafeInteger(line.quantity) ||
        line.quantity <= 0
      ) {
        return reject("LOCAL_ORDER_INVALID");
      }
      requestedVariationIds.add(line.pancakeVariationId);

      const live = liveByVariationId.get(line.pancakeVariationId);
      if (!live) {
        return reject("VARIATION_UNAVAILABLE");
      }

      const livePrice = resolveStorefrontPrice({
        retailPrice: live.retailPrice,
        retailPriceAfterDiscount: live.retailPriceAfterDiscount,
      });
      if (livePrice === null || !isSupportedVndAmount(livePrice)) {
        return reject("PRICE_UNAVAILABLE");
      }
      if (line.unitPriceVnd !== BigInt(livePrice)) {
        return reject("PRICE_CHANGED");
      }
      if (!Number.isFinite(live.sellableStock) || live.sellableStock < line.quantity) {
        return reject("STOCK_UNAVAILABLE");
      }

      const lineTotalVnd = checkedMultiplyVnd(livePrice, line.quantity);
      const nextSubtotal = lineTotalVnd === null ? null : checkedAddVnd(subtotalVnd, lineTotalVnd);
      const nextQuantity = totalQuantity + line.quantity;
      if (
        lineTotalVnd === null ||
        nextSubtotal === null ||
        !Number.isSafeInteger(nextQuantity) ||
        nextQuantity <= 0 ||
        line.lineTotalVnd !== BigInt(lineTotalVnd)
      ) {
        return reject("LOCAL_ORDER_INVALID");
      }

      subtotalVnd = nextSubtotal;
      totalQuantity = nextQuantity;
      requestLines.push({
        pancakeVariationId: line.pancakeVariationId,
        quantity: line.quantity,
        unitPriceVnd: livePrice,
      });
    }

    const shippingFeeVnd = calculateGuestShippingFeeVnd({ subtotalVnd, totalQuantity });
    const totalVnd = checkedAddVnd(subtotalVnd, shippingFeeVnd);
    if (
      totalVnd === null ||
      order.merchandiseSubtotalVnd !== BigInt(subtotalVnd) ||
      order.shippingFeeVnd !== BigInt(shippingFeeVnd) ||
      order.totalVnd !== BigInt(totalVnd)
    ) {
      return reject("LOCAL_ORDER_INVALID");
    }

    const request = buildPancakeCreateOrderRequest({
      shopId: safeShopId,
      guestName: order.guestName,
      guestPhone: order.guestPhone,
      provinceRef: order.provinceRef,
      districtRef: order.districtRef,
      communeRef: order.communeRef,
      addressDetail: order.addressDetail,
      note: order.note,
      shippingFeeVnd,
      lines: requestLines,
    });

    const submitting = await client.orderMirror.updateMany({
      where: { id: order.id, state: "VALIDATING" },
      data: { state: "POS_SUBMITTING", syncErrorCode: null },
    });
    if (submitting.count !== 1) {
      const current = await client.orderMirror.findUniqueOrThrow({
        where: { id: order.id },
        select: { state: true, pancakeOrderId: true, syncErrorCode: true },
      });
      return existingResult(current);
    }

    let pancakeOrderId: string;
    try {
      const response = await gateway.createOrder(request);
      pancakeOrderId = parsePancakeCreateOrderResponse(response);
    } catch {
      await client.orderMirror.updateMany({
        where: { id: order.id, state: "POS_SUBMITTING" },
        data: { state: "SYNC_UNKNOWN", syncErrorCode: "CREATE_OUTCOME_UNKNOWN" },
      });
      return { ok: false, state: "SYNC_UNKNOWN", reason: "CREATE_OUTCOME_UNKNOWN" };
    }

    try {
      const confirmed = await client.orderMirror.updateMany({
        where: { id: order.id, state: "POS_SUBMITTING" },
        data: {
          state: "CONFIRMED",
          pancakeOrderId,
          syncErrorCode: null,
        },
      });
      if (confirmed.count !== 1) {
        const current = await client.orderMirror.findUniqueOrThrow({
          where: { id: order.id },
          select: { state: true, pancakeOrderId: true, syncErrorCode: true },
        });
        return existingResult(current);
      }
    } catch {
      await client.orderMirror.updateMany({
        where: { id: order.id, state: "POS_SUBMITTING" },
        data: { state: "SYNC_UNKNOWN", syncErrorCode: "CREATE_OUTCOME_UNKNOWN" },
      });
      return { ok: false, state: "SYNC_UNKNOWN", reason: "CREATE_OUTCOME_UNKNOWN" };
    }

    return { ok: true, state: "CONFIRMED", pancakeOrderId };
  }

  return { submit };
}
