import type { PancakeOrderSubmissionResult } from "./pancake-order-submit.ts";

const ACTIVE_SNAPSHOT_STATES = [
  "DRAFT",
  "VALIDATING",
  "POS_SUBMITTING",
  "CONFIRMED",
  "SYNC_UNKNOWN",
] as const;

type ActiveSnapshotState = (typeof ACTIVE_SNAPSHOT_STATES)[number];

type SnapshotFailureReason =
  | "INVALID_INPUT"
  | "CART_UNAVAILABLE"
  | "CART_EMPTY"
  | "CART_LINE_UNAVAILABLE"
  | "MONEY_UNSUPPORTED"
  | "PUBLIC_CODE_UNAVAILABLE";

type SnapshotResult =
  | {
      ok: true;
      order: {
        publicCode: string;
        state: ActiveSnapshotState;
        merchandiseSubtotalVnd: bigint;
        shippingFeeVnd: bigint;
        totalVnd: bigint;
      };
    }
  | { ok: false; reason: SnapshotFailureReason };

type SnapshotService = {
  create(input: {
    cartId: string;
    shopId: number;
    publicCode: string;
    checkoutInput: unknown;
    now: Date;
  }): Promise<SnapshotResult>;
};

type OrderSubmissionService = {
  submit(input: { publicCode: string; shopId: number }): Promise<PancakeOrderSubmissionResult>;
};

export type GuestCheckoutBrowserReason =
  | "INVALID_INPUT"
  | "CART_UNAVAILABLE"
  | "CART_CHANGED"
  | "SERVICE_UNAVAILABLE"
  | "CHECKOUT_UNAVAILABLE";

export type GuestCheckoutSubmitResult =
  | { ok: true; status: "CONFIRMED"; orderCode: string }
  | {
      ok: false;
      status: "RETRYABLE";
      reason: GuestCheckoutBrowserReason;
      orderCode?: string;
    }
  | { ok: false; status: "PROCESSING"; orderCode: string }
  | { ok: false; status: "SYNC_UNKNOWN"; orderCode: string };

export type GuestCheckoutSubmitDependencies = {
  snapshot: SnapshotService;
  orderSubmission: OrderSubmissionService;
  generatePublicCode: () => string;
};

function mapSnapshotFailure(reason: SnapshotFailureReason): GuestCheckoutSubmitResult {
  switch (reason) {
    case "INVALID_INPUT":
      return { ok: false, status: "RETRYABLE", reason: "INVALID_INPUT" };
    case "CART_UNAVAILABLE":
    case "CART_EMPTY":
    case "CART_LINE_UNAVAILABLE":
      return { ok: false, status: "RETRYABLE", reason: "CART_UNAVAILABLE" };
    case "MONEY_UNSUPPORTED":
    case "PUBLIC_CODE_UNAVAILABLE":
      return { ok: false, status: "RETRYABLE", reason: "CHECKOUT_UNAVAILABLE" };
  }
}

function isCartChangedReason(reason: string): boolean {
  return (
    reason === "VARIATION_UNAVAILABLE" ||
    reason === "PRICE_CHANGED" ||
    reason === "PRICE_UNAVAILABLE" ||
    reason === "STOCK_UNAVAILABLE"
  );
}

function mapSubmissionResult(
  orderCode: string,
  result: PancakeOrderSubmissionResult,
): GuestCheckoutSubmitResult {
  if (result.ok) {
    return { ok: true, status: "CONFIRMED", orderCode };
  }

  if (result.state === "SYNC_UNKNOWN") {
    return { ok: false, status: "SYNC_UNKNOWN", orderCode };
  }

  if (result.state === "VALIDATING" || result.state === "POS_SUBMITTING") {
    return { ok: false, status: "PROCESSING", orderCode };
  }

  if (result.state === "DRAFT") {
    if (result.reason === "VALIDATION_UNAVAILABLE") {
      return {
        ok: false,
        status: "RETRYABLE",
        reason: "SERVICE_UNAVAILABLE",
        orderCode,
      };
    }
    return { ok: false, status: "PROCESSING", orderCode };
  }

  if (result.state === "REJECTED") {
    return {
      ok: false,
      status: "RETRYABLE",
      reason: isCartChangedReason(result.reason) ? "CART_CHANGED" : "CHECKOUT_UNAVAILABLE",
      orderCode,
    };
  }

  return { ok: false, status: "PROCESSING", orderCode };
}

export function createGuestCheckoutSubmitService({
  snapshot,
  orderSubmission,
  generatePublicCode,
}: GuestCheckoutSubmitDependencies) {
  async function submit({
    cartId,
    shopId,
    checkoutInput,
    now,
  }: {
    cartId: string;
    shopId: number;
    checkoutInput: unknown;
    now: Date;
  }): Promise<GuestCheckoutSubmitResult> {
    const proposedPublicCode = generatePublicCode();
    const snapshotResult = await snapshot.create({
      cartId,
      shopId,
      publicCode: proposedPublicCode,
      checkoutInput,
      now,
    });

    if (!snapshotResult.ok) {
      return mapSnapshotFailure(snapshotResult.reason);
    }

    const orderCode = snapshotResult.order.publicCode;
    const submissionResult = await orderSubmission.submit({ publicCode: orderCode, shopId });
    return mapSubmissionResult(orderCode, submissionResult);
  }

  return { submit };
}
