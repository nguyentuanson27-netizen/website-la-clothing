type StorefrontPurchaseInput = {
  slug: string;
  variantId: string;
};

type InvalidStorefrontSelection = {
  ok: false;
  reason: "INVALID_SELECTION";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createStorefrontPurchasePublicActions<TResult>({
  purchase,
}: {
  purchase(input: StorefrontPurchaseInput): Promise<TResult>;
}) {
  async function add(input: unknown): Promise<TResult | InvalidStorefrontSelection> {
    if (
      !isRecord(input) ||
      typeof input.slug !== "string" ||
      typeof input.variantId !== "string"
    ) {
      return { ok: false, reason: "INVALID_SELECTION" };
    }

    return purchase({ slug: input.slug, variantId: input.variantId });
  }

  return { add };
}
