import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import type { AdminProductDirectoryQuery } from "./admin-product-directory.ts";
import { ADMIN_PRODUCT_DIRECTORY_LIMITS } from "./admin-product-directory.ts";
import {
  directoryHealthMetricsSql,
  missingImageCondition,
  stockedInactiveCondition,
  zeroActiveCondition,
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

/** Rolls the membership batch back when a target is already at the editable collection limit. */
class CollectionMembershipLimitError extends Error {
  constructor() {
    super("Bulk collection membership would exceed the editable limit");
    this.name = "CollectionMembershipLimitError";
  }
}

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
 * The directory predicate, built once as SQL and shared by the page query, the total count and
 * every facet/health chip count.
 *
 * It is SQL rather than a Prisma `where` because two health dimensions have no Prisma
 * expression — summed multi-warehouse stock and storefront-equivalent media resolution — and
 * routing them through a materialized ID list would put the whole matching catalog into an
 * `IN (...)` list, one bind parameter per product. Keeping every condition in one builder means
 * a chip's count and the page its link opens cannot describe different result sets.
 *
 * The translated conditions match what Prisma generated before, including `ILIKE '%' || $1 || '%'`
 * search semantics and treating a product with no `ProductContent` row as an unedited draft.
 */
function adminSearchCondition(query: AdminProductDirectoryQuery): Prisma.Sql | null {
  if (!query.query) return null;
  return Prisma.sql`(
    p."name" ILIKE ('%' || ${query.query} || '%')
    OR p."slug" ILIKE ('%' || ${query.query} || '%')
  )`;
}

function adminActivityCondition(query: AdminProductDirectoryQuery): Prisma.Sql | null {
  if (!query.activity) return null;
  return Prisma.sql`p."isActive" = ${query.activity === "active"}`;
}

/** A product with no `ProductContent` row is an unedited draft, not a separate state. */
function adminStatusCondition(query: AdminProductDirectoryQuery): Prisma.Sql | null {
  if (query.status === null) return null;
  if (query.status === "DRAFT") {
    return Prisma.sql`(
      pc."productId" IS NULL
      OR pc."status" = CAST(${query.status}::text AS "ProductContentStatus")
    )`;
  }
  return Prisma.sql`pc."status" = CAST(${query.status}::text AS "ProductContentStatus")`;
}

function adminCollectionCondition(query: AdminProductDirectoryQuery): Prisma.Sql | null {
  if (query.uncategorized) {
    return Prisma.sql`(
      pc."productId" IS NULL
      OR COALESCE(ARRAY_LENGTH(pc."collectionSlugs", 1), 0) = 0
    )`;
  }
  if (query.collection) {
    return Prisma.sql`${query.collection} = ANY(COALESCE(pc."collectionSlugs", ARRAY[]::TEXT[]))`;
  }
  return null;
}

/** Health is always a full-catalog predicate, never a filter over the rows of the current page. */
function adminHealthCondition(query: AdminProductDirectoryQuery): Prisma.Sql | null {
  switch (query.health) {
    case "zero-active":
      return zeroActiveCondition(Prisma.sql`p`);
    case "stocked-inactive":
      return stockedInactiveCondition(Prisma.sql`p`);
    case "missing-image":
      return missingImageCondition(Prisma.sql`p`);
    case null:
      return null;
  }
}

function adminWhere(query: AdminProductDirectoryQuery): Prisma.Sql {
  const conditions = [
    adminSearchCondition(query),
    adminActivityCondition(query),
    adminStatusCondition(query),
    adminCollectionCondition(query),
    adminHealthCondition(query),
  ].filter((condition): condition is Prisma.Sql => condition !== null);

  return conditions.length === 0
    ? Prisma.sql`TRUE`
    : Prisma.join(conditions, " AND ");
}

/** Every directory read starts from the same row source, so the conditions can share aliases. */
const adminDirectoryFrom = Prisma.sql`
  FROM "ProductMirror" p
  LEFT JOIN "ProductContent" pc ON pc."productId" = p."id"
`;

function adminDirectoryCountSql(query: AdminProductDirectoryQuery): Prisma.Sql {
  return Prisma.sql`
    SELECT COUNT(*)::bigint AS "count"
    ${adminDirectoryFrom}
    WHERE ${adminWhere(query)}
  `;
}

function adminSortSql(sort: AdminProductDirectoryQuery["sort"]): Prisma.Sql {
  switch (sort) {
    case "name-desc":
      return Prisma.sql`p."name" DESC, p."id" ASC`;
    case "updated-desc":
      return Prisma.sql`p."updatedAt" DESC, p."id" ASC`;
    case "synced-desc":
      return Prisma.sql`p."syncedAt" DESC, p."id" ASC`;
    case "name-asc":
      return Prisma.sql`p."name" ASC, p."id" ASC`;
  }
}

type CollectionMembershipRow = { slug: string; count: bigint };
type DirectoryCountRow = { count: bigint };
type DirectoryIdRow = { id: string };
type DirectoryHealthMetricsRow = {
  id: string;
  presentVariantCount: bigint;
  activeVariantCount: bigint;
  stockedInactiveCount: bigint;
  missingImage: boolean;
};

export type AdminProductDirectoryMetrics = {
  presentVariantCount: number;
  activeVariantCount: number;
  stockedInactiveCount: number;
  missingImage: boolean;
};

function metricCountToNumber(value: bigint): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Admin directory metric is outside safe integer bounds");
  }
  return parsed;
}

function directoryCountToNumber(rows: readonly DirectoryCountRow[]): number {
  return rows[0] ? metricCountToNumber(rows[0].count) : 0;
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

    try {
      return await client.$transaction(async (tx) => {
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

      // Products without content yet get a minimal DRAFT row carrying only the requested slug.
      const created = await tx.productContent.createMany({
        data: productIds.map((productId) => ({ productId, collectionSlugs: [collectionSlug] })),
        skipDuplicates: true,
      });

      // The editor accepts at most `collectionCount` memberships per product, so the limit is
      // enforced inside the UPDATE rather than by a separate probe: under Read Committed the
      // predicate is re-evaluated against whatever a concurrent editor save committed, so no
      // interleaving can push a product past a limit its own editor could no longer save back.
      const appended = await tx.$executeRaw(Prisma.sql`
        UPDATE "ProductContent"
        SET "collectionSlugs" = ARRAY_APPEND("collectionSlugs", ${collectionSlug}),
            "updatedAt" = NOW()
        WHERE "productId" = ANY(${productIds}::text[])
          AND NOT (${collectionSlug} = ANY("collectionSlugs"))
          AND COALESCE(ARRAY_LENGTH("collectionSlugs", 1), 0)
            < ${PRODUCT_CONTENT_LIMITS.collectionCount}
      `);

      // Anything still missing the slug was at the limit, so the whole batch rolls back.
      const remainingRows = await tx.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        SELECT COUNT(*)::bigint AS "count"
        FROM "ProductContent"
        WHERE "productId" = ANY(${productIds}::text[])
          AND NOT (${collectionSlug} = ANY("collectionSlugs"))
      `);
      if (remainingRows[0] && membershipCountToNumber(remainingRows[0].count) > 0) {
        throw new CollectionMembershipLimitError();
      }

      return {
        ok: true,
        matchedCount: productIds.length,
        changedCount: created.count + appended,
      } as const;
      });
    } catch (error) {
      if (error instanceof CollectionMembershipLimitError) {
        return { ok: false, reason: "COLLECTION_LIMIT_REACHED" };
      }
      throw error;
    }
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

  /**
   * Selection, ordering and pagination run as one SQL statement over the whole catalog; Prisma
   * then hydrates only the page's rows by ID. That keeps the filter — health dimensions included —
   * a database predicate applied before pagination, with a bounded number of statements and no
   * catalog-sized parameter list.
   */
  async function listDirectoryPage({
    query,
    pageSize = ADMIN_PRODUCT_DIRECTORY_LIMITS.pageSize,
  }: Readonly<{ query: AdminProductDirectoryQuery; pageSize?: number }>) {
    const take = parseAdminPageSize(pageSize);
    const totalCount = directoryCountToNumber(
      await client.$queryRaw<DirectoryCountRow[]>(adminDirectoryCountSql(query)),
    );
    const totalPages = Math.max(Math.ceil(totalCount / take), 1);
    const page = Math.min(query.page, totalPages);

    const idRows = await client.$queryRaw<DirectoryIdRow[]>(Prisma.sql`
      SELECT p."id"
      ${adminDirectoryFrom}
      WHERE ${adminWhere(query)}
      ORDER BY ${adminSortSql(query.sort)}
      LIMIT ${take}
      OFFSET ${(page - 1) * take}
    `);
    const pageIds = idRows.map(({ id }) => id);

    const rows =
      pageIds.length === 0
        ? []
        : await client.productMirror.findMany({
            where: { id: { in: pageIds } },
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

    // The ordering is the SQL statement's, not the hydration query's.
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const products = pageIds.map((id) => {
      const row = rowsById.get(id);
      if (!row) throw new Error("Admin directory result changed during read");
      return row;
    });

    const metrics = await readDirectoryMetrics(pageIds);

    return { products, metrics, page, pageSize: take, totalCount, totalPages };
  }

  /**
   * Counts each facet against the exact query its own link opens, using the same `adminWhere` as
   * `listDirectoryPage`. Callers pass the switch-to targets — see `buildAdminProductFacetTargets`
   * and `buildAdminProductHealthTargets` — so a chip's count and its href cannot drift apart.
   */
  async function countDirectoryFacets<Key extends string>(
    targets: Readonly<Record<Key, AdminProductDirectoryQuery>>,
  ): Promise<Record<Key, number>> {
    const entries = Object.entries(targets) as [Key, AdminProductDirectoryQuery][];
    const counted = await Promise.all(
      entries.map(
        async ([key, target]) =>
          [
            key,
            directoryCountToNumber(
              await client.$queryRaw<DirectoryCountRow[]>(adminDirectoryCountSql(target)),
            ),
          ] as const,
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
    countDirectoryFacets,
    countProductsByCollectionSlug,
  };
}
