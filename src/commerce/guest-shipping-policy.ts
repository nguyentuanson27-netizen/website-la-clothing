export const GUEST_SHIPPING_FEE_VND = 30_000;
export const GUEST_FREE_SHIPPING_SUBTOTAL_VND = 1_000_000;
export const GUEST_FREE_SHIPPING_MIN_QUANTITY = 3;

export function calculateGuestShippingFeeVnd({
  subtotalVnd,
  totalQuantity,
}: {
  subtotalVnd: number;
  totalQuantity: number;
}): number {
  if (!Number.isSafeInteger(subtotalVnd) || subtotalVnd < 0) {
    throw new RangeError("Guest checkout subtotal must be a safe non-negative integer VND amount");
  }
  if (!Number.isSafeInteger(totalQuantity) || totalQuantity <= 0) {
    throw new RangeError("Guest checkout total quantity must be a positive safe integer");
  }

  if (subtotalVnd > GUEST_FREE_SHIPPING_SUBTOTAL_VND) {
    return 0;
  }
  if (totalQuantity >= GUEST_FREE_SHIPPING_MIN_QUANTITY) {
    return 0;
  }

  return GUEST_SHIPPING_FEE_VND;
}
