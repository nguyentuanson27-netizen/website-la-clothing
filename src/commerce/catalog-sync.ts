import type { PancakeParsedCatalogVariation } from "../integrations/pancake/catalog-contract.ts";
import { fetchAllPancakeCatalogVariations } from "../integrations/pancake/catalog-pages.ts";
import type { PancakeCompositeSnapshot } from "../integrations/pancake/composite-contract.ts";
import { fetchPancakeCompositeSnapshot } from "../integrations/pancake/composite-pages.ts";

type QueryValue = string | number | boolean;
type CatalogClient = {
  getJson(endpoint: string, query?: Readonly<Record<string, QueryValue>>): Promise<unknown>;
};

type CatalogMirrorWriter = {
  syncSnapshot(input: {
    shopId: number;
    variations: readonly PancakeParsedCatalogVariation[];
    compositeSnapshot: PancakeCompositeSnapshot;
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
  const compositeSnapshot = await fetchPancakeCompositeSnapshot({ client, shopId });
  return repository.syncSnapshot({ shopId, variations, compositeSnapshot, syncedAt });
}
