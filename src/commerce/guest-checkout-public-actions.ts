import type { GuestCheckoutSubmitResult } from "./guest-checkout-submit.ts";

type GuestCheckoutCartSession = {
  read(): string | null;
  clear(): void;
};

type SubmitCheckout = (input: {
  cartId: string;
  checkoutInput: unknown;
}) => Promise<GuestCheckoutSubmitResult>;

type ConsumeAttempt = (cartId: string) => Promise<boolean>;

export type GuestCheckoutPublicActionDependencies = {
  cartSession: GuestCheckoutCartSession;
  consumeAttempt: ConsumeAttempt;
  submitCheckout: SubmitCheckout;
};

function checkoutInputFromFormData(formData: FormData) {
  return {
    name: formData.get("name"),
    phone: formData.get("phone"),
    provinceRef: formData.get("provinceRef"),
    districtRef: formData.get("districtRef"),
    communeRef: formData.get("communeRef"),
    detail: formData.get("detail"),
    note: formData.get("note"),
  };
}

export async function submitGuestCheckoutPublicAction(
  { cartSession, consumeAttempt, submitCheckout }: GuestCheckoutPublicActionDependencies,
  formData: FormData,
): Promise<GuestCheckoutSubmitResult> {
  const cartId = cartSession.read();
  if (!cartId) {
    return {
      ok: false,
      status: "RETRYABLE",
      reason: "CART_UNAVAILABLE",
    };
  }

  let attemptAllowed = false;
  try {
    attemptAllowed = await consumeAttempt(cartId);
  } catch {
    return {
      ok: false,
      status: "RETRYABLE",
      reason: "CHECKOUT_UNAVAILABLE",
    };
  }

  if (!attemptAllowed) {
    return {
      ok: false,
      status: "RETRYABLE",
      reason: "CHECKOUT_UNAVAILABLE",
    };
  }

  const result = await submitCheckout({
    cartId,
    checkoutInput: checkoutInputFromFormData(formData),
  });

  if (result.ok) {
    cartSession.clear();
  }

  return result;
}
