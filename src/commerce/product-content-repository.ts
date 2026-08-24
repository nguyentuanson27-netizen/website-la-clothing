import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import type { AdminProductDirectoryQuery } from "./admin-product-directory.ts";
import { ADMIN_PRODUCT_DIRECTORY_LIMITS } from "./admin-product-directory.ts";
import type { ProductContentSnapshot } from "./product-content-admin.ts";

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

function adminWhere(query: AdminProductDirectoryQuery): Prisma.ProductMirrorWhereInput {
  const conditions = adminBaseConditions(query);
  const status = adminStatusCondition(query.status);
  if (status) conditions.push(status);
  const collection = adminCollectionCondition(query);
  if (collection) conditions.push(collection);
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

  async function listDirectoryPage({
    query,
    pageSize = ADMIN_PRODUCT_DIRECTORY_LIMITS.pageSize,
  }: Readonly<{ query: AdminProductDirectoryQuery; pageSize?: number }>) {
    const take = parseAdminPageSize(pageSize);
    const where = adminWhere(query);
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

    return { products, page, pageSize: take, totalCount, totalPages };
  }

  /**
   * Counts each facet against the exact query its own link opens, using the same `adminWhere`
   * as `listDirectoryPage`. Callers pass the switch-to targets — see
   * `buildAdminProductFacetTargets` — so a chip's count and its href cannot drift apart.
   */
  async function countDirectoryFacets<Key extends string>(
    targets: Readonly<Record<Key, AdminProductDirectoryQuery>>,
  ): Promise<Record<Key, number>> {
    const entries = Object.entries(targets) as [Key, AdminProductDirectoryQuery][];
    const counted = await Promise.all(
      entries.map(
        async ([key, target]) =>
          [key, await client.productMirror.count({ where: adminWhere(target) })] as const,
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
    findForEditor,
    listForAdmin,
    listDirectoryPage,
    countDirectoryFacets,
    countProductsByCollectionSlug,
  };
}