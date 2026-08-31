import { pathToFileURL } from "node:url";

import type { CatalogAcceptanceProduct } from "../src/commerce/catalog-acceptance.ts";
import type { StorefrontCompositeComponentGroup } from "../src/commerce/storefront-projection.ts";
import type { StorefrontVariantFacts } from "../src/commerce/storefront-product.ts";
import {
  assertTrustedCatalogAuditEnvironment,
  catalogAuditFailureMessage,
} from "./pancake-catalog-audit.ts";

type QueryValue = string | number | boolean;
type CompositeParentCountClient = {
  getJson(endpoint: string, query?: Readonly<Record<string, QueryValue>>): Promise<unknown>;
};
type JsonRecord = Record<string, unknown>;

const CURRENT_SCOPE_LIMIT = 50_000;
const GENERIC_FAILURE_MESSAGE =
  "P17 trusted live catalog acceptance failed without logging credentials or private Pancake payload values";
const COMPOSITE_PARENT_COUNT_ERROR = "P17 composite parent count payload is malformed";

// Repo-owned review state. Add only stable public product slugs whose intentional
// fallback presentation has been explicitly human-approved and code-reviewed.
const REVIEWED_MEDIA_FALLBACK_SLUGS: ReadonlySet<string> = new Set([]);

function parseJsonStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function sumWarehouseStocks(stocks: readonly { quantity: number }[]): number {
  let total = 0;
  for (const stock of stocks) {
    if (!Number.isFinite(stock.quantity)) {
      throw new Error(GENERIC_FAILURE_MESSAGE);
    }
    total += stock.quantity;
    if (!Number.isFinite(total)) {
      throw new Error(GENERIC_FAILURE_MESSAGE);
    }
  }
  return total;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    throw new TypeError(COMPOSITE_PARENT_COUNT_ERROR);
  }
  return value;
}

function requireNonNegativeSafeInteger(record: JsonRecord, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(COMPOSITE_PARENT_COUNT_ERROR);
  }
  return value;
}

export async function readCompositeParentVariationCount(
  client: CompositeParentCountClient,
  shopId: number,
): Promise<number> {
  if (!Number.isSafeInteger(shopId) || shopId <= 0) {
    throw new TypeError(COMPOSITE_PARENT_COUNT_ERROR);
  }

  const payload = requireRecord(
    await client.getJson(`/shops/${shopId}/products/variations`, {
      page_number: 1,
      page_size: 1,
      included_composite: "parent",
    }),
  );

  if (payload.success !== true || !Array.isArray(payload.data) || payload.data.length > 1) {
    throw new TypeError(COMPOSITE_PARENT_COUNT_ERROR);
  }

  const pageNumber = requireNonNegativeSafeInteger(payload, "page_number");
  const pageSize = requireNonNegativeSafeInteger(payload, "page_size");
  const totalEntries = requireNonNegativeSafeInteger(payload, "total_entries");
  const totalPages = requireNonNegativeSafeInteger(payload, "total_pages");
  const expectedRowCount = totalEntries === 0 ? 0 : 1;
  const paginationMatchesCount =
    totalEntries === 0 ? totalPages === 0 || totalPages === 1 : totalPages === totalEntries;

  if (
    pageNumber !== 1 ||
    pageSize !== 1 ||
    totalEntries > CURRENT_SCOPE_LIMIT ||
    !paginationMatchesCount ||
    payload.data.length !== expectedRowCount ||
    (expectedRowCount === 1 && !isRecord(payload.data[0]))
  ) {
    throw new TypeError(COMPOSITE_PARENT_COUNT_ERROR);
  }

  return totalEntries;
}

async function runP17CatalogAcceptance(): Promise<void> {
  assertTrustedCatalogAuditEnvironment();

  const [
    { buildCatalogAcceptanceReport },
    { syncConfiguredPancakeCatalog },
    { buildStorefrontProductProjection },
    { countProjectedCompositeParentVariations },
    { PancakeClient },
    { readPancakeConfig },
    { prisma },
  ] = await Promise.all([
    import("../src/commerce/catalog-acceptance.ts"),
    import("../src/commerce/catalog-sync-runtime.ts"),
    import("../src/commerce/storefront-projection.ts"),
    import("../src/commerce/storefront-product-detail.ts"),
    import("../src/integrations/pancake/client.ts"),
    import("../src/integrations/pancake/config.ts"),
    import("../src/db/prisma.ts"),
  ]);
  const config = readPancakeConfig();

  try {
    const compositeParentVariations = await readCompositeParentVariationCount(
      new PancakeClient({ apiKey: config.apiKey }),
      config.shopId,
    );
    const syncResult = await syncConfiguredPancakeCatalog();
    const [products, publishedCollections, projectedCompositeParentVariations] = await Promise.all([
      prisma.productMirror.findMany({
        where: {
          pancakeShopId: config.shopId,
          isPresent: true,
          isActive: true,
        },
        orderBy: { pancakeProductId: "asc" },
        take: CURRENT_SCOPE_LIMIT + 1,
        select: {
          slug: true,
          name: true,
          sourceDescription: true,
          primaryImageUrl: true,
          content: {
            select: {
              status: true,
              editorialDescription: true,
              seoTitle: true,
              seoDescription: true,
              collectionSlugs: true,
            },
          },
          variants: {
            where: { isPresent: true, isActive: true },
            orderBy: { pancakeVariationId: "asc" },
            select: {
              id: true,
              pancakeVariationId: true,
              color: true,
              size: true,
              pancakeRetailPrice: true,
              pancakeRetailPriceAfterDiscount: true,
              pancakeImageUrls: true,
              warehouseStocks: {
                orderBy: { pancakeWarehouseId: "asc" },
                select: { quantity: true },
              },
              compositeComponents: {
                orderBy: { componentVariantId: "asc" },
                select: {
                  componentVariant: {
                    select: {
                      id: true,
                      pancakeVariationId: true,
                      color: true,
                      size: true,
                      isPresent: true,
                      isActive: true,
                      pancakeRetailPrice: true,
                      pancakeRetailPriceAfterDiscount: true,
                      product: {
                        select: {
                          id: true,
                          name: true,
                          pancakeShopId: true,
                          isPresent: true,
                        },
                      },
                      warehouseStocks: {
                        orderBy: { pancakeWarehouseId: "asc" },
                        select: { quantity: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.collectionDefinition.findMany({
        where: { isPublished: true },
        orderBy: { slug: "asc" },
        take: CURRENT_SCOPE_LIMIT + 1,
        select: { slug: true },
      }),
      countProjectedCompositeParentVariations(prisma, config.shopId),
    ]);

    if (
      products.length > CURRENT_SCOPE_LIMIT ||
      publishedCollections.length > CURRENT_SCOPE_LIMIT ||
      projectedCompositeParentVariations > CURRENT_SCOPE_LIMIT
    ) {
      throw new Error(GENERIC_FAILURE_MESSAGE);
    }

    const acceptanceProducts: CatalogAcceptanceProduct[] = products.map((product) => {
      const parentVariants = product.variants.map((variant) => ({
        id: variant.id,
        pancakeVariationId: variant.pancakeVariationId,
        color: variant.color,
        size: variant.size,
        sellableStock: sumWarehouseStocks(variant.warehouseStocks),
        retailPrice: variant.pancakeRetailPrice,
        retailPriceAfterDiscount: variant.pancakeRetailPriceAfterDiscount,
        imageUrls: parseJsonStringArray(variant.pancakeImageUrls),
      }));

      const componentGroups = new Map<
        string,
        { label: string; variants: Map<string, StorefrontVariantFacts> }
      >();
      let hasCompositeGraph = false;

      for (const parentVariant of product.variants) {
        if (parentVariant.compositeComponents.length > 0) hasCompositeGraph = true;
        for (const edge of parentVariant.compositeComponents) {
          const component = edge.componentVariant;
          if (
            component.product.pancakeShopId !== config.shopId ||
            !component.product.isPresent ||
            !component.isPresent ||
            !component.isActive
          ) {
            continue;
          }

          let group = componentGroups.get(component.product.id);
          if (!group) {
            group = { label: component.product.name, variants: new Map() };
            componentGroups.set(component.product.id, group);
          }
          if (!group.variants.has(component.id)) {
            group.variants.set(component.id, {
              id: component.id,
              pancakeVariationId: component.pancakeVariationId,
              color: component.color,
              size: component.size,
              sellableStock: sumWarehouseStocks(component.warehouseStocks),
              retailPrice: component.pancakeRetailPrice,
              retailPriceAfterDiscount: component.pancakeRetailPriceAfterDiscount,
            });
          }
        }
      }

      const groups: StorefrontCompositeComponentGroup[] = [...componentGroups.values()]
        .sort((left, right) => left.label.localeCompare(right.label, "vi"))
        .map((group) => ({ label: group.label, variants: [...group.variants.values()] }));

      return {
        slug: product.slug,
        name: product.name,
        sourceDescription: product.sourceDescription,
        primaryImageUrl: product.primaryImageUrl,
        content: product.content
          ? {
              status: product.content.status,
              editorialDescription: product.content.editorialDescription,
              seoTitle: product.content.seoTitle,
              seoDescription: product.content.seoDescription,
              collectionSlugs: product.content.collectionSlugs,
            }
          : null,
        variants: parentVariants,
        projection: buildStorefrontProductProjection({
          parentVariants,
          componentGroups: groups,
          hasCompositeGraph,
        }),
      };
    });

    const report = buildCatalogAcceptanceReport({
      products: acceptanceProducts,
      publishedCollectionSlugs: new Set(publishedCollections.map(({ slug }) => slug)),
      sourceModel: {
        compositeParentVariations,
        projectedCompositeParentVariations,
      },
      approvedMediaFallbackSlugs: REVIEWED_MEDIA_FALLBACK_SLUGS,
    });

    console.log("P17_CATALOG_ACCEPTANCE_BEGIN");
    console.log(
      JSON.stringify(
        {
          sync: {
            products: syncResult.products,
            variations: syncResult.variations,
          },
          report,
        },
        null,
        2,
      ),
    );
    console.log("P17_CATALOG_ACCEPTANCE_END");

    if (!report.ready) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

function isDirectExecution(): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;
}

if (isDirectExecution()) {
  try {
    await runP17CatalogAcceptance();
  } catch (error) {
    const auditMessage = catalogAuditFailureMessage(error);
    if (auditMessage.includes("refuses CI execution")) {
      console.error(auditMessage);
    } else {
      console.error(GENERIC_FAILURE_MESSAGE);
    }
    process.exitCode = 1;
  }
}
