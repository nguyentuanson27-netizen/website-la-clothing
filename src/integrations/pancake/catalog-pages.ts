import type { PancakeCatalogVariation } from "./catalog-contract.ts";
import { parsePancakeCatalogVariations } from "./catalog-contract.ts";

const CATALOG_PAGE_SIZE = 100;
const MAX_CATALOG_PAGES = 10_000;

type QueryValue = string | number | boolean;
type CatalogClient = {
  getJson(endpoint: string, query?: Readonly<Record<string, QueryValue>>): Promise<unknown>;
};

function requireShopId(shopId: number): number {
  if (!Number.isSafeInteger(shopId) || shopId <= 0) {
    throw new TypeError("Pancake shop id must be a positive safe integer");
  }
  return shopId;
}

export async function fetchAllPancakeCatalogVariations({
  client,
  shopId,
}: {
  client: CatalogClient;
  shopId: number;
}): Promise<PancakeCatalogVariation[]> {
  const safeShopId = requireShopId(shopId);
  const endpoint = `/shops/${safeShopId}/products/variations`;
  const variations: PancakeCatalogVariation[] = [];

  const first = parsePancakeCatalogVariations(
    await client.getJson(endpoint, { page_number: 1, page_size: CATALOG_PAGE_SIZE }),
  );
  if (first.pageNumber !== 1) {
    throw new Error("Pancake catalog response does not match requested page 1");
  }
  if (first.totalPages > MAX_CATALOG_PAGES) {
    throw new Error("Pancake catalog page limit exceeded");
  }

  variations.push(...first.variations);
  const totalPages = Math.max(1, first.totalPages);

  for (let pageNumber = 2; pageNumber <= totalPages; pageNumber += 1) {
    const page = parsePancakeCatalogVariations(
      await client.getJson(endpoint, {
        page_number: pageNumber,
        page_size: CATALOG_PAGE_SIZE,
      }),
    );

    if (page.pageNumber !== pageNumber) {
      throw new Error(`Pancake catalog response does not match requested page ${pageNumber}`);
    }
    if (page.totalPages !== first.totalPages) {
      throw new Error("Pancake catalog pagination changed during traversal");
    }

    variations.push(...page.variations);
  }

  return variations;
}
