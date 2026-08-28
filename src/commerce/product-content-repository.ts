import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import type {
  AdminProductDirectoryQuery,
  AdminProductHealth,
  AdminProductHealthSqlFilter,
} from "./admin-product-directory.ts";
import {
  ADMIN_PRODUCT_DIRECTORY_LIMITS,
  ADMIN_PRODUCT_HEALTH_SQL_FILTERS,
} from "./admin-product-directory.ts";
import {
  directoryHealthMetricsSql,
  missingImageProductIdsSql,
  stockedInactiveProductIdsSql,
} from "./admin-product-health.ts";
import type {
  BulkProductCollectionResult,
  BulkProductCollectionUpdate,
  BulkProductContentStatusResult,
  BulkProductContentStatusUpdate,
  ProductContentSnapshot,
} from "./product-content-admin.ts";
import { PRODUCT_CONTENT_LIMITS } from "./product-content-admin.ts";

const MAX_ADMIN_PRODUCTS = 100;

function parseAdminListLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ADMIN_PRODUCTS) {
    throw new RangeError(`Admin product list limit must be between 1 and ${MAX_ADMIN_PRODUCTS}`);
  }
  return limit;
}

function parseAdminPageSize(pageSize: number): number {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_ADMIN_PRODUCTS) {
    throw new RangeError(`Admin page size must be between 1 and ${MAX_ADMIN_PRODUCTS}`);
  }
  return pageSize;
}

/**
 * Search/activity conditions only. Status and collection facets are layered on top of this so
 * facet counts describe the same result set the operator is currently looking at.
 */
function adminBaseConditions(
  query: AdminProductDirectoryQuery,
): Prisma.ProductMirrorWhereInput[] {
  const conditions: Prisma.ProductMirrorWhereInput[] = [];

  if (query.query) {
    conditions.push({
      OR: [
        { name: { contains: query.query, mode: "insensitive" } },
        { slug: { contains: query.query, mode: "insensitive" } },
      ],
    });
  }

  if (query.activity) {
    conditions.push({ isActive: query.activity === "active" });
  }

  return conditions;
}

/** A product with no `ProductContent` row is an unedited draft, not a separate state. */
function adminStatusCondition(
  status: AdminProductDirectoryQuery["status"],
): Prisma.ProductMirrorWhereInput | null {
  if (status === null) return null;
  if (status === "DRAFT") {
    return { OR: [{ content: { is: null } }, { content: { is: { status: "DRAFT" } } }] };
  }
  return { content: { is: { status } } };
}

function adminCollectionCondition(
  query: AdminProductDirectoryQuery,
): Prisma.ProductMirrorWhereInput | null {
  if (query.uncategorized) {
    return {
      OR: [{ content: { is: null } }, { content: { is: { collectionSlugs: { isEmpty: true } } } }],
    };
  }
  if (query.collection) {
    return { content: { is: { collectionSlugs: { has: query.collection } } } };
  }
  return null;
}

/**
 * Health is a full-catalog predicate, never a filter over the current page.
 *
 * `zero-active` is exactly expressible as a Prisma relation predicate. The other two are not —
 * summed multi-warehouse stock and storefront-equivalent media resolution both need SQL — so
 * they arrive as the database-resolved ID set for that dimension and compose with every other
 * condition through the same `where`.
 */
function adminHealthCondition(
  query: AdminProductDirectoryQuery,
  healthScope: AdminProductHealthScope | null,
): Prisma.ProductMirrorWhereInput | null {
  if (query.health === null) return null;
  if (query.health === "zero-active") {
    return { variants: { none: { isPresent: true, isActive: true } } };
  }
  return { id: { in: [...(healthScope?.get(query.health) ?? [])] } };
}

function adminWhere(
  query: AdminProductDirectoryQuery,
  healthScope: AdminProductHealthScope | null = null,
): Prisma.ProductMirrorWhereInput {
  const conditions = adminBaseConditions(query);
  const status = adminStatusCondition(query.status);
  if (status) conditions.push(status);
  const collection = adminCollectionCondition(query);
  if (collection) conditions.push(collection);
  const health = adminHealthCondition(query, healthScope);
  if (health) conditions.push(health);
  return conditions.length > 0 ? { AND: conditions } : {};
}

function adminOrderBy(
  sort: AdminProductDirectoryQuery["sort"],
): Prisma.ProductMirrorOrderByWithRelationInput[] {
  switch (sort) {
    case "name-desc":
      return [{ name: "desc" }, { id: "asc" }];
    case "updated-desc":
      return [{ updatedAt: "desc" }, { id: "asc" }];
    case "synced-desc":
      return [{ syncedAt: "desc" }, { id: "asc" }];
    default:
      return [{ name: "asc" }, { id: "asc" }];
  }
}

type CollectionMembershipRow = { slug: string; count: bigint };
type HealthProductIdRow = { id: string };
type DirectoryHealthMetricsRow = {
  id: string;
  presentVariantCount: bigint;
  activeVariantCount: bigint;
  stockedInactiveCount: bigint;
  missingImage: boolean;
};

/** Database-resolved product IDs per health dimension that has no Prisma-expressible predicate. */
export type AdminProductHealthScope = ReadonlyMap<AdminProductHealthSqlFilter, readonly string[]>;

export type AdminProductDirectoryMetrics = {
  presentVariantCount: number;
  activeVariantCount: number;
  stockedInactiveCount: number;
  missingImage: boolean;
};

function isHealthSqlFilter(
  health: AdminProductHealth | null,
): health is AdminProductHealthSqlFilter {
  return (
    health !== null &&
    (ADMIN_PRODUCT_HEALTH_SQL_FILTERS as readonly string[]).includes(health)
  );
}

function metricCountToNumber(value: bigint): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Admin directory metric is outside safe integer bounds");
  }
  return parsed;
}

function membershipCountToNumber(value: bigint): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Collection membership count is outside safe integer bounds");
  }
  return parsed;
}

export function createProductContentRepository(client: PrismaClient) {
  async function productExists(productId: string): Promise<boolean> {
    return (
      (await client.productMirror.findUnique({
        where: { id: productId },
        select: { id: true },
      })) !== null
    );
  }

  async function saveContent(content: ProductContentSnapshot): Promise<ProductContentSnapshot> {
    const { productId, ...fields } = content;
    return client.productContent.upsert({
      where: { productId },
      create: { productId, ...fields },
      update: fields,
      select: {
        productId: true,
        status: true,
        editorialDescription: true,
        careInstructions: true,
        sizeGuide: true,
        seoTitle: true,
        seoDescription: true,
        collectionSlugs: true,
      },
    });
  }

  async function updateStatusesAtomically(
    input: BulkProductContentStatusUpdate,
  ): Promise<BulkProductContentStatusResult> {
    const { productIds, status } = input;

    return client.$transaction(async (tx) => {
      const productCount = await tx.productMirror.count({
        where: { id: { in: productIds } },
      });
      if (productCount !== productIds.length) {
        return { ok: false, reason: "PRODUCT_NOT_FOUND" } as const;
      }

      // Create content rows only for products that do not have one yet, then patch the single
      // website-owned status field for the whole batch. Unrelated editorial/Pancake fields are
      // never reconstructed from stale table data.
      await tx.productContent.createMany({
        data: productIds.map((productId) => ({ productId, status })),
        skipDuplicates: true,
      });
      await tx.productContent.updateMany({
        where: { productId: { in: productIds } },
        data: { status },
      });

      return { ok: true, updatedCount: productIds.length } as const;
    });
  }

  /**
   * Adds or removes exactly one validated collection slug for the selected products.
   *
   * The membership array is patched database-side (`array_append` / `array_remove`) instead of
   * being rebuilt from directory data, so a product's other collections, editorial fields, SEO
   * text and mirrored Pancake columns are never rewritten from a stale browser snapshot. Any
   * missing or no-longer-present target aborts the whole batch before the first write.
   */
  async function updateCollectionMembershipAtomically(
    input: BulkProductCollectionUpdate,
  ): Promise<BulkProductCollectionResult> {
    const { productIds, collectionSlug, operation } = input;

    return client.$transaction(async (tx) => {
      const presentCount = await tx.productMirror.count({
        where: { id: { in: productIds }, isPresent: true },
      });
      if (presentCount !== productIds.length) {
        return { ok: false, reason: "PRODUCT_NOT_FOUND" } as const;
      }

      if (operation === "remove") {
        const changedCount = await tx.$executeRaw(Prisma.sql`
          UPDATE "ProductContent"
          SET "collectionSlugs" = ARRAY_REMOVE("collectionSlugs", ${collectionSlug}),
              "updatedAt" = NOW()
          WHERE "productId" = ANY(${productIds}::text[])
            AND ${collectionSlug} = ANY("collectionSlugs")
        `);
        return { ok: true, matchedCount: productIds.length, changedCount } as const;
      }

      // The editor accepts at most `collectionCount` memberships per product, so an append that
      // would exceed it has to fail the batch rather than write content the editor can no longer
      // save back.
      const overflowRows = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS "count"
        FROM "ProductContent"
        WHERE "productId" = ANY(${productIds}::text[])
          AND NOT (${collectionSlug} = ANY("collectionSlugs"))
          AND COALESCE(ARRAY_LENGTH("collectionSlugs", 1), 0) >= ${PRODUCT_CONTENT_LIMITS.collectionCount}
      `);
      const overflowCount = overflowRows[0] ? membershipCountToNumber(overflowRows[0].count) : 0;
      if (overflowCount > 0) {
        return { ok: false, reason: "COLLECTION_LIMIT_REACHED" } as const;
      }

      // Products without content yet get a minimal DRAFT row carrying only the requested slug.
      const created = await tx.productContent.createMany({
        data: productIds.map((productId) => ({ productId, collectionSlugs: [collectionSlug] })),
        skipDuplicates: true,
      });
      const appended = await tx.$executeRaw(Prisma.sql`
        UPDATE "ProductContent"
        SET "collectionSlugs" = ARRAY_APPEND("collectionSlugs", ${collectionSlug}),
            "updatedAt" = NOW()
        WHERE "productId" = ANY(${productIds}::text[])
          AND NOT (${collectionSlug} = ANY("collectionSlugs"))
      `);

      return {
        ok: true,
        matchedCount: productIds.length,
        changedCount: created.count + appended,
      } as const;
    });
  }

  async function findForEditor(productId: string) {
    return client.productMirror.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        slug: true,
        primaryImageUrl: true,
        sourceDescription: true,
        isActive: true,
        variants: {
          orderBy: [{ color: "asc" }, { size: "asc" }, { id: "asc" }],
          select: {
            id: true,
            sku: true,
            color: true,
            size: true,
            pancakeRetailPrice: true,
            pancakeRetailPriceAfterDiscount: true,
            pancakeImageUrls: true,
            isPresent: true,
            isActive: true,
            warehouseStocks: {
              select: {
                quantity: true,
              },
            },
            // Composite membership is read from the persisted P17 mirror only. The editor never
            // infers a parent → child relation from names, SKUs or categories.
            compositeComponents: {
              orderBy: [{ componentVariantId: "asc" }],
              select: {
                quantity: true,
                componentVariant: {
                  select: {
                    id: true,
                    sku: true,
                    color: true,
                    size: true,
                    isPresent: true,
                    isActive: true,
                    warehouseStocks: {
                      orderBy: [{ pancakeWarehouseId: "asc" }],
                      select: { quantity: true },
                    },
                    product: {
                      select: {
                        id: true,
                        name: true,
                        slug: true,
                        isPresent: true,
                        isActive: true,
                      },
                    },
                  },
                },
              },
            },
            // Incoming membership belongs to the child variant's admin read model. It is used only
            // to expose the existing global VariantMirror activation state; the editor still never
            // creates, removes or infers composite edges.
            compositeParents: {
              orderBy: [{ parentVariantId: "asc" }],
              select: {
                quantity: true,
                parentVariant: {
                  select: {
                    id: true,
                    sku: true,
                    color: true,
                    size: true,
                    isPresent: true,
                    isActive: true,
                    product: {
                      select: {
                        id: true,
                        name: true,
                        slug: true,
                        isPresent: true,
                        isActive: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        content: {
          select: {
            status: true,
            editorialDescription: true,
            careInstructions: true,
            sizeGuide: true,
            seoTitle: true,
            seoDescription: true,
            collectionSlugs: true,
            updatedAt: true,
          },
        },
      },
    });
  }

  async function listForAdmin(limit: number) {
    return client.productMirror.findMany({
      take: parseAdminListLimit(limit),
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        primaryImageUrl: true,
        isActive: true,
        syncedAt: true,
        variants: {
          select: {
            pancakeRetailPrice: true,
            pancakeRetailPriceAfterDiscount: true,
            size: true,
            color: true,
          },
        },
        content: {
          select: {
            status: true,
            updatedAt: true,
          },
        },
      },
    });
  }

  /**
   * Resolves the product IDs for the health dimensions that need database-side SQL.
   *
   * One statement per requested dimension over the whole catalog — never a per-product read —
   * so the directory keeps a fixed query count no matter how many rows the page shows.
   */
  async function loadHealthScope(
    healthFilters: readonly AdminProductHealthSqlFilter[] = ADMIN_PRODUCT_HEALTH_SQL_FILTERS,
  ): Promise<AdminProductHealthScope> {
    const requested = [...new Set(healthFilters)];
    const resolved = await Promise.all(
      requested.map(async (health) => {
        const rows = await client.$queryRaw<HealthProductIdRow[]>(
          health === "missing-image" ? missingImageProductIdsSql : stockedInactiveProductIdsSql,
        );
        return [health, rows.map(({ id }) => id)] as const;
      }),
    );
    return new Map(resolved);
  }

  async function resolveHealthScope(
    query: AdminProductDirectoryQuery,
    healthScope: AdminProductHealthScope | null,
  ): Promise<AdminProductHealthScope | null> {
    if (healthScope || !isHealthSqlFilter(query.health)) return healthScope;
    return loadHealthScope([query.health]);
  }

  /**
   * Server-derived row metrics for the products actually shown, in one bounded query. The row
   * health an operator reads therefore comes from the same database truth as the filters and
   * their counts, not from a second client-side interpretation of the mirrored data.
   */
  async function readDirectoryMetrics(
    productIds: readonly string[],
  ): Promise<ReadonlyMap<string, AdminProductDirectoryMetrics>> {
    if (productIds.length === 0) return new Map();

    const rows = await client.$queryRaw<DirectoryHealthMetricsRow[]>(
      directoryHealthMetricsSql(productIds),
    );
    return new Map(
      rows.map((row) => [
        row.id,
        {
          presentVariantCount: metricCountToNumber(row.presentVariantCount),
          activeVariantCount: metricCountToNumber(row.activeVariantCount),
          stockedInactiveCount: metricCountToNumber(row.stockedInactiveCount),
          missingImage: row.missingImage,
        },
      ]),
    );
  }

  async function listDirectoryPage({
    query,
    pageSize = ADMIN_PRODUCT_DIRECTORY_LIMITS.pageSize,
    healthScope = null,
  }: Readonly<{
    query: AdminProductDirectoryQuery;
    pageSize?: number;
    healthScope?: AdminProductHealthScope | null;
  }>) {
    const take = parseAdminPageSize(pageSize);
    const where = adminWhere(query, await resolveHealthScope(query, healthScope));
    const totalCount = await client.productMirror.count({ where });
    const totalPages = Math.max(Math.ceil(totalCount / take), 1);
    const page = Math.min(query.page, totalPages);

    const products = await client.productMirror.findMany({
      where,
      take,
      skip: (page - 1) * take,
      orderBy: adminOrderBy(query.sort),
      select: {
        id: true,
        name: true,
        slug: true,
        primaryImageUrl: true,
        isActive: true,
        syncedAt: true,
        variants: {
          select: {
            pancakeRetailPrice: true,
            pancakeRetailPriceAfterDiscount: true,
            size: true,
            color: true,
          },
        },
        content: {
          select: {
            status: true,
            collectionSlugs: true,
            updatedAt: true,
          },
        },
      },
    });

    const metrics = await readDirectoryMetrics(products.map(({ id }) => id));

    return { products, metrics, page, pageSize: take, totalCount, totalPages };
  }

  /**
   * Counts each facet against the exact query its own link opens, using the same `adminWhere`
   * as `listDirectoryPage`. Callers pass the switch-to targets — see
   * `buildAdminProductFacetTargets` — so a chip's count and its href cannot drift apart.
   */
  async function countDirectoryFacets<Key extends string>(
    targets: Readonly<Record<Key, AdminProductDirectoryQuery>>,
    healthScope: AdminProductHealthScope | null = null,
  ): Promise<Record<Key, number>> {
    const entries = Object.entries(targets) as [Key, AdminProductDirectoryQuery][];
    const scope =
      healthScope ??
      (entries.some(([, target]) => isHealthSqlFilter(target.health))
        ? await loadHealthScope(
            entries
              .map(([, target]) => target.health)
              .filter((health): health is AdminProductHealthSqlFilter => isHealthSqlFilter(health)),
          )
        : null);

    const counted = await Promise.all(
      entries.map(
        async ([key, target]) =>
          [key, await client.productMirror.count({ where: adminWhere(target, scope) })] as const,
      ),
    );
    return Object.fromEntries(counted) as Record<Key, number>;
  }

  /**
   * `collectionSlugs` is a scalar list, so membership is unnested and grouped database-side. The
   * result set is one row per slug actually in use, not one per product, so this stays bounded by
   * the number of collections rather than by catalog size.
   *
   * A slug repeated inside one product's list counts once per occurrence, matching what the
   * membership editor writes back.
   */
  async function countProductsByCollectionSlug(): Promise<ReadonlyMap<string, number>> {
    const rows = await client.$queryRaw<CollectionMembershipRow[]>(Prisma.sql`
      SELECT collection AS "slug", COUNT(*)::bigint AS "count"
      FROM "ProductContent" pc
      CROSS JOIN LATERAL UNNEST(pc."collectionSlugs") AS collection
      GROUP BY collection
    `);
    return new Map(rows.map(({ slug, count }) => [slug, membershipCountToNumber(count)]));
  }

  return {
    productExists,
    saveContent,
    updateStatusesAtomically,
    updateCollectionMembershipAtomically,
    findForEditor,
    listForAdmin,
    listDirectoryPage,
    loadHealthScope,
    readDirectoryMetrics,
    countDirectoryFacets,
    countProductsByCollectionSlug,
  };
}
