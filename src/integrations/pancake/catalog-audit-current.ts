import {
  PancakeCatalogAuditError,
  runPancakeCatalogAudit,
  type PancakeCatalogAuditReport,
} from "./catalog-audit.ts";

const LIMITS = {
  pageSize: 100,
  pages: 500,
  entries: 50_000,
  idLength: 512,
} as const;

type QueryValue = string | number | boolean;
type JsonRecord = Record<string, unknown>;
type AuditClient = {
  getJson(endpoint: string, query?: Readonly<Record<string, QueryValue>>): Promise<unknown>;
};

export type CurrentCatalogScope = {
  productIds: ReadonlySet<string>;
  variationIds: ReadonlySet<string>;
};

export type CurrentPancakeCatalogAuditReport = {
  source: {
    rawVariationEntries: number;
  };
  currentCatalog: {
    products: PancakeCatalogAuditReport["products"];
    variations: {
      total: number;
    };
    images: PancakeCatalogAuditReport["images"];
    categories: PancakeCatalogAuditReport["categories"];
  };
};

function fail(message: string): never {
  throw new PancakeCatalogAuditError(message);
}

function record(value: unknown, message: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(message);
  return value as JsonRecord;
}

function array(value: unknown, message: string): unknown[] {
  if (!Array.isArray(value)) fail(message);
  return value;
}

function safeInteger(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(message);
  return value;
}

function boundedString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > LIMITS.idLength) fail(message);
  return value;
}

function validateScope(scope: CurrentCatalogScope): void {
  if (scope.productIds.size > LIMITS.entries || scope.variationIds.size > LIMITS.entries) {
    fail("Current storefront scope exceeds catalog audit limits");
  }

  for (const productId of scope.productIds) {
    boundedString(productId, "Current storefront product identity is malformed");
  }
  for (const variationId of scope.variationIds) {
    boundedString(variationId, "Current storefront variation identity is malformed");
  }
}

function readPage(payload: unknown, requestedPage: number): {
  totalEntries: number;
  totalPages: number;
  data: unknown[];
} {
  const root = record(payload, "Pancake product-variation payload is malformed");
  if (root.success !== true) fail("Pancake product-variation response is unsuccessful");
  if (safeInteger(root.page_number, "Pancake catalog page_number is malformed") !== requestedPage) {
    fail("Pancake catalog response does not match the requested page");
  }

  const totalEntries = safeInteger(root.total_entries, "Pancake catalog total_entries is malformed");
  const totalPages = safeInteger(root.total_pages, "Pancake catalog total_pages is malformed");
  if (totalEntries > LIMITS.entries || totalPages > LIMITS.pages) {
    fail("Pancake catalog traversal limit exceeded");
  }

  return {
    totalEntries,
    totalPages,
    data: array(root.data, "Pancake product-variation payload is missing data array"),
  };
}

async function collectCurrentRows({
  client,
  shopId,
  currentScope,
  pageSize,
}: {
  client: AuditClient;
  shopId: number;
  currentScope: CurrentCatalogScope;
  pageSize: number;
}): Promise<{ rawVariationEntries: number; currentRows: JsonRecord[] }> {
  const endpoint = `/shops/${shopId}/products/variations`;
  const currentRows: JsonRecord[] = [];
  const seenVariationIds = new Set<string>();
  const seenCurrentProductIds = new Set<string>();
  const seenCurrentVariationIds = new Set<string>();
  let expectedEntries: number | undefined;
  let expectedPages: number | undefined;
  let rawVariationEntries = 0;

  for (let pageNumber = 1; ; pageNumber += 1) {
    if (pageNumber > LIMITS.pages) fail("Pancake catalog traversal limit exceeded");
    const page = readPage(
      await client.getJson(endpoint, { page_number: pageNumber, page_size: pageSize }),
      pageNumber,
    );
    const totalPages = Math.max(1, page.totalPages);

    if (expectedEntries === undefined) {
      expectedEntries = page.totalEntries;
      expectedPages = totalPages;
    } else if (page.totalEntries !== expectedEntries || totalPages !== expectedPages) {
      fail("Pancake catalog pagination changed during audit traversal");
    }

    for (const rawVariation of page.data) {
      rawVariationEntries += 1;
      if (rawVariationEntries > LIMITS.entries) fail("Pancake catalog entry limit exceeded");

      const variation = record(rawVariation, "Pancake product-variation item is malformed");
      const variationId = boundedString(variation.id, "Pancake variation id is malformed");
      if (seenVariationIds.has(variationId)) {
        fail("Pancake catalog contains duplicate variation identity");
      }
      seenVariationIds.add(variationId);

      const productId = boundedString(variation.product_id, "Pancake variation product_id is malformed");
      const productIsCurrent = currentScope.productIds.has(productId);
      const variationIsCurrent = currentScope.variationIds.has(variationId);

      if (variationIsCurrent && !productIsCurrent) {
        fail("Current storefront scope is inconsistent");
      }
      if (!productIsCurrent) continue;

      seenCurrentProductIds.add(productId);
      if (variationIsCurrent) seenCurrentVariationIds.add(variationId);

      currentRows.push({
        ...variation,
        images: variationIsCurrent ? variation.images : [],
      });
    }

    if (pageNumber >= (expectedPages ?? 1)) break;
  }

  if (rawVariationEntries !== expectedEntries) {
    fail("Pancake catalog entry count does not match completed audit traversal");
  }
  if (
    seenCurrentProductIds.size !== currentScope.productIds.size ||
    seenCurrentVariationIds.size !== currentScope.variationIds.size
  ) {
    fail("Current storefront scope does not match Pancake source");
  }

  return { rawVariationEntries, currentRows };
}

export async function runCurrentPancakeCatalogAudit({
  client,
  shopId,
  currentScope,
  pageSize = LIMITS.pageSize,
}: {
  client: AuditClient;
  shopId: number;
  currentScope: CurrentCatalogScope;
  pageSize?: number;
}): Promise<CurrentPancakeCatalogAuditReport> {
  if (!Number.isSafeInteger(shopId) || shopId <= 0) {
    throw new TypeError("Pancake shop id must be a positive safe integer");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0 || pageSize > LIMITS.pageSize) {
    throw new TypeError(`Pancake catalog audit page size must be between 1 and ${LIMITS.pageSize}`);
  }
  validateScope(currentScope);

  const collected = await collectCurrentRows({ client, shopId, currentScope, pageSize });
  const variationsEndpoint = `/shops/${shopId}/products/variations`;
  const scopedClient: AuditClient = {
    async getJson(endpoint, query) {
      if (endpoint === variationsEndpoint) {
        if (query?.page_number !== 1) fail("Scoped catalog audit requested an unexpected synthetic page");
        return {
          success: true,
          page_number: 1,
          page_size: pageSize,
          total_entries: collected.currentRows.length,
          total_pages: 1,
          data: collected.currentRows,
        };
      }
      return client.getJson(endpoint, query);
    },
  };

  const current = await runPancakeCatalogAudit({
    client: scopedClient,
    shopId,
    pageSize,
  });

  return {
    source: {
      rawVariationEntries: collected.rawVariationEntries,
    },
    currentCatalog: {
      products: current.products,
      variations: {
        total: currentScope.variationIds.size,
      },
      images: current.images,
      categories: current.categories,
    },
  };
}
