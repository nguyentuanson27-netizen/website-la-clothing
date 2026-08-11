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

export function readPancakeShopId(env: ServerEnvironment = process.env): number {
  const shopIdInput = env.PANCAKE_SHOP_ID?.trim();
  if (!shopIdInput || !/^\d+$/.test(shopIdInput)) {
    throw new PancakeConfigError("PANCAKE_SHOP_ID must be a positive integer");
  }

  const shopId = Number(shopIdInput);
  if (!Number.isSafeInteger(shopId) || shopId <= 0) {
    throw new PancakeConfigError("PANCAKE_SHOP_ID must be a positive integer");
  }

  return shopId;
}

export function readPancakeConfig(env: ServerEnvironment = process.env): PancakeConfig {
  const apiKey = env.PANCAKE_API_KEY?.trim();
  if (!apiKey) {
    throw new PancakeConfigError("PANCAKE_API_KEY must be configured on the server");
  }

  return { apiKey, shopId: readPancakeShopId(env) };
}
