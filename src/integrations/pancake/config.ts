export type PancakeConfig = {
  apiKey: string;
  shopId: number;
};

type ServerEnvironment = Readonly<Record<string, string | undefined>>;

export class PancakeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PancakeConfigError";
  }
}

export function readPancakeConfig(env: ServerEnvironment = process.env): PancakeConfig {
  const apiKey = env.PANCAKE_API_KEY?.trim();
  if (!apiKey) {
    throw new PancakeConfigError("PANCAKE_API_KEY must be configured on the server");
  }

  const shopIdInput = env.PANCAKE_SHOP_ID?.trim();
  if (!shopIdInput || !/^\d+$/.test(shopIdInput)) {
    throw new PancakeConfigError("PANCAKE_SHOP_ID must be a positive integer");
  }

  const shopId = Number(shopIdInput);
  if (!Number.isSafeInteger(shopId) || shopId <= 0) {
    throw new PancakeConfigError("PANCAKE_SHOP_ID must be a positive integer");
  }

  return { apiKey, shopId };
}

export function readPancakeOnlineWarehouseIds(
  env: ServerEnvironment = process.env,
): readonly string[] {
  const input = env.PANCAKE_ONLINE_WAREHOUSE_IDS;
  if (!input?.trim()) {
    throw new PancakeConfigError(
      "PANCAKE_ONLINE_WAREHOUSE_IDS must explicitly list at least one online warehouse",
    );
  }

  const warehouseIds = input.split(",").map((value) => value.trim());
  if (warehouseIds.some((warehouseId) => warehouseId.length === 0)) {
    throw new PancakeConfigError(
      "PANCAKE_ONLINE_WAREHOUSE_IDS must not contain empty warehouse entries",
    );
  }

  if (new Set(warehouseIds).size !== warehouseIds.length) {
    throw new PancakeConfigError(
      "PANCAKE_ONLINE_WAREHOUSE_IDS must not contain duplicate warehouse entries",
    );
  }

  return warehouseIds;
}
