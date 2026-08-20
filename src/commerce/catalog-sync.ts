import type { PancakeParsedCatalogVariation } from "../integrations/pancake/catalog-contract.ts";
import { fetchAllPancakeCatalogVariations } from "../integrations/pancake/catalog-pages.ts";

type QueryValue = string | number | boolean;
type CatalogClient = {
  getJson(endpoint: string, query?: Readonly<Record<string, QueryValue>>): Promise<unknown>;
};

type CatalogMirrorWriter = {
  syncSnapshot(input: {
    shopId: number;
    variations: readonly PancakeParsedCatalogVariation[];
    syncedAt: Date;
  }): Promise<{ products: number; variations: number }>;
};

export async function syncPancakeCatalog({
  client,
  repository,
  shopId,
  syncedAt,
}: {
  client: CatalogClient;
  repository: CatalogMirrorWriter;
  shopId: number;
  syncedAt: Date;
}) {
  const variations = await fetchAllPancakeCatalogVariations({ client, shopId });
  return repository.syncSnapshot({ shopId, variations, syncedAt });
}
