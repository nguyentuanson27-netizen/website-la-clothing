import {
  parseGuestOrderTrackingInput,
  type GuestOrderTrackingInput,
  type GuestOrderTrackingResult,
} from "./guest-order-tracking.ts";

export type GuestOrderTrackingPublicResult =
  | GuestOrderTrackingResult
  | { ok: false; reason: "UNAVAILABLE" };

type Dependencies = Readonly<{
  consumeClient(): Promise<boolean>;
  consumeOrderCode(orderCode: string): Promise<boolean>;
  lookup(input: GuestOrderTrackingInput): Promise<GuestOrderTrackingResult>;
}>;

export async function lookupGuestOrderPublicAction(
  dependencies: Dependencies,
  formData: FormData,
): Promise<GuestOrderTrackingPublicResult> {
  try {
    if (!(await dependencies.consumeClient())) {
      return { ok: false, reason: "UNAVAILABLE" };
    }

    const parsed = parseGuestOrderTrackingInput({
      orderCode: formData.get("orderCode"),
      phone: formData.get("phone"),
    });
    if (!parsed.ok) return parsed;

    if (!(await dependencies.consumeOrderCode(parsed.value.orderCode))) {
      return { ok: false, reason: "UNAVAILABLE" };
    }

    return await dependencies.lookup(parsed.value);
  } catch {
    return { ok: false, reason: "UNAVAILABLE" };
  }
}
