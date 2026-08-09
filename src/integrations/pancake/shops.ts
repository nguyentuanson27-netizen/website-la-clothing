export type PancakeShop = {
  id: number;
  name: string;
};

type PancakeReadableClient = {
  getJson(endpoint: string): Promise<unknown>;
};

export class PancakePayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PancakePayloadError";
  }
}

export async function listPancakeShops(client: PancakeReadableClient): Promise<PancakeShop[]> {
  const payload = await client.getJson("/shops");
  return parsePancakeShops(payload);
}

function parsePancakeShops(payload: unknown): PancakeShop[] {
  if (!isRecord(payload) || payload.success !== true || !Array.isArray(payload.shops)) {
    throw new PancakePayloadError("Pancake shop response is malformed or unsuccessful");
  }

  return payload.shops.map((shop, index) => {
    if (
      !isRecord(shop) ||
      !Number.isSafeInteger(shop.id) ||
      Number(shop.id) <= 0 ||
      typeof shop.name !== "string" ||
      shop.name.trim().length === 0
    ) {
      throw new PancakePayloadError(`Pancake shop at index ${index} is malformed`);
    }

    return {
      id: shop.id as number,
      name: shop.name.trim(),
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
