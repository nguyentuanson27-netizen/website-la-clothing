type StorefrontPurchaseInput = {
  slug: string;
  variantId: string;
};

type StorefrontPublicPurchaseResult =
  | { ok: true }
  | {
      ok: false;
      reason: "INVALID_SELECTION" | "VARIANT_UNAVAILABLE" | "PURCHASE_FAILED";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toPublicPurchaseResult(result: unknown): StorefrontPublicPurchaseResult {
  if (!isRecord(result)) {
    return { ok: false, reason: "PURCHASE_FAILED" };
  }

  if (result.ok === true) {
    return { ok: true };
  }

  if (result.ok === false && result.reason === "INVALID_SELECTION") {
    return { ok: false, reason: "INVALID_SELECTION" };
  }

  if (result.ok === false && result.reason === "VARIANT_UNAVAILABLE") {
    return { ok: false, reason: "VARIANT_UNAVAILABLE" };
  }

  return { ok: false, reason: "PURCHASE_FAILED" };
}

export function createStorefrontPurchasePublicActions({
  purchase,
}: {
  purchase(input: StorefrontPurchaseInput): Promise<unknown>;
}) {
  async function add(input: unknown): Promise<StorefrontPublicPurchaseResult> {
    if (
      !isRecord(input) ||
      typeof input.slug !== "string" ||
      typeof input.variantId !== "string"
    ) {
      return { ok: false, reason: "INVALID_SELECTION" };
    }

    return toPublicPurchaseResult(
      await purchase({ slug: input.slug, variantId: input.variantId }),
    );
  }

  return { add };
}
