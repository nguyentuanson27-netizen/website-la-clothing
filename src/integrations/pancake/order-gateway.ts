import type { PancakeCatalogVariation } from "./catalog-contract.ts";
import { fetchAllPancakeCatalogVariations } from "./catalog-pages.ts";
import type { PancakeCreateOrderRequest } from "./order-create.ts";

type QueryValue = string | number | boolean;
type PostJsonOptions = Readonly<{ expectedStatus?: number }>;

export type PancakeOrderGatewayClient = {
  getJson(endpoint: string, query?: Readonly<Record<string, QueryValue>>): Promise<unknown>;
  postJson(endpoint: string, body: unknown, options?: PostJsonOptions): Promise<unknown>;
};

type FetchCompleteCatalog = (input: {
  client: PancakeOrderGatewayClient;
  shopId: number;
}) => Promise<readonly PancakeCatalogVariation[]>;

function requireShopId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError("Pancake shop id must be a positive safe integer");
  }
  return value;
}

export function createPancakeOrderGateway(
  client: PancakeOrderGatewayClient,
  fetchCompleteCatalog: FetchCompleteCatalog = fetchAllPancakeCatalogVariations,
) {
  return {
    async fetchCompleteCatalog(shopId: number): Promise<readonly PancakeCatalogVariation[]> {
      return fetchCompleteCatalog({ client, shopId: requireShopId(shopId) });
    },

    async createOrder(request: PancakeCreateOrderRequest): Promise<unknown> {
      const shopId = requireShopId(request.shop_id);
      return client.postJson(`/shops/${shopId}/orders`, request, { expectedStatus: 200 });
    },
  };
}
