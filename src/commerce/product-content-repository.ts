import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
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
            isActive: true,
            warehouseStocks: {
              select: {
                quantity: true,
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
   * Facet counts share the search/activity filter but ignore status and collection, so each
   * chip reports how many products the operator would see by switching to it.
   */
  async function countDirectoryFacets(query: AdminProductDirectoryQuery) {
    const base = adminBaseConditions(query);
    const withCondition = (condition: Prisma.ProductMirrorWhereInput | null) => {
      const conditions = condition ? [...base, condition] : base;
      return conditions.length > 0 ? { AND: conditions } : {};
    };

    const [all, draft, reviewed, published, uncategorized] = await Promise.all([
      client.productMirror.count({ where: withCondition(null) }),
      client.productMirror.count({ where: withCondition(adminStatusCondition("DRAFT")) }),
      client.productMirror.count({ where: withCondition(adminStatusCondition("REVIEWED")) }),
      client.productMirror.count({ where: withCondition(adminStatusCondition("PUBLISHED")) }),
      client.productMirror.count({
        where: withCondition(
          adminCollectionCondition({ ...query, collection: null, uncategorized: true }),
        ),
      }),
    ]);

    return { all, draft, reviewed, published, uncategorized };
  }

  /**
   * `collectionSlugs` is a scalar list, so membership totals are tallied in application code
   * rather than grouped in SQL. Bounded by the mirrored catalog size.
   */
  async function countProductsByCollectionSlug(): Promise<ReadonlyMap<string, number>> {
    const rows = await client.productContent.findMany({ select: { collectionSlugs: true } });
    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const slug of row.collectionSlugs) {
        counts.set(slug, (counts.get(slug) ?? 0) + 1);
      }
    }
    return counts;
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
