import type { PancakeCatalogVariation } from "./catalog-contract.ts";
import { fetchAllPancakeCatalogVariations } from "./catalog-pages.ts";
import type { PancakeCreateOrderRequest } from "./order-create.ts";
import {
  isCanonicalPancakeOrderId,
  parsePancakeOrderStatusResponse,
  type PancakeOrderStatus,
} from "./order-status.ts";

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

function requireOrderId(value: string): string {
  if (!isCanonicalPancakeOrderId(value)) {
    throw new TypeError("Pancake order id must be a canonical positive safe integer string");
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

    async fetchOrderStatus(shopId: number, orderId: string): Promise<PancakeOrderStatus> {
      const checkedShopId = requireShopId(shopId);
      const checkedOrderId = requireOrderId(orderId);
      const payload = await client.getJson(`/shops/${checkedShopId}/orders/${checkedOrderId}`);
      return parsePancakeOrderStatusResponse(payload, {
        shopId: checkedShopId,
        orderId: checkedOrderId,
      });
    },

    async createOrder(request: PancakeCreateOrderRequest): Promise<unknown> {
      const shopId = requireShopId(request.shop_id);
      return client.postJson(`/shops/${shopId}/orders`, request, { expectedStatus: 200 });
    },
  };
}
