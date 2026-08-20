import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";
import {
  resolveStorefrontProductMedia,
  type StorefrontProductMedia,
} from "./product-media.ts";
import type { StorefrontDiscoveryQuery } from "./storefront-discovery.ts";

const MAX_STOREFRONT_PRODUCTS = 48;
const MAX_STOREFRONT_OFFSET = 50_000;
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_STOREFRONT_SLUG_LENGTH = 160;

function parseShopId(shopId: number): number {
  if (!Number.isSafeInteger(shopId) || shopId <= 0 || shopId > MAX_POSTGRES_INTEGER) {
    throw new RangeError("Storefront shop id must fit a positive PostgreSQL INTEGER");
  }
  return shopId;
}

function parseListLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_STOREFRONT_PRODUCTS) {
    throw new RangeError(
      `Storefront product list limit must be between 1 and ${MAX_STOREFRONT_PRODUCTS}`,
    );
  }
  return limit;
}

function parsePageOffset(page: number, pageSize: number): number {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError("Storefront product page must be a positive integer");
  }

  const offset = (page - 1) * pageSize;
  if (!Number.isSafeInteger(offset) || offset > MAX_STOREFRONT_OFFSET) {
    throw new RangeError("Storefront product page is outside the supported catalog window");
  }
  return offset;
}

function parseSlug(slug: string): string {
  if (
    typeof slug !== "string" ||
    slug.length < 1 ||
    slug.length > MAX_STOREFRONT_SLUG_LENGTH ||
    slug !== slug.trim()
  ) {
    throw new RangeError("Storefront product slug is invalid");
  }
  return slug;
}

function sumWarehouseStocks(stocks: readonly { quantity: number }[]): number {
  let total = 0;
  for (const stock of stocks) {
    if (!Number.isFinite(stock.quantity)) {
      throw new Error("Storefront catalog contains malformed warehouse quantity");
    }
    total += stock.quantity;
    if (!Number.isFinite(total)) {
      throw new Error("Storefront catalog stock total is outside numeric bounds");
    }
  }
  return total;
}

const productSelection = {
  id: true,
  slug: true,
  name: true,
  primaryImageUrl: true,
  content: {
    select: {
      editorialDescription: true,
      careInstructions: true,
      sizeGuide: true,
      seoTitle: true,
      seoDescription: true,
    },
  },
  variants: {
    where: { isPresent: true, isActive: true },
    orderBy: [{ pancakeVariationId: "asc" }],
    select: {
      id: true,
      pancakeVariationId: true,
      color: true,
      size: true,
      pancakeRetailPrice: true,
      pancakeRetailPriceAfterDiscount: true,
      pancakeImageUrls: true,
      warehouseStocks: {
        orderBy: [{ pancakeWarehouseId: "asc" }],
        select: { quantity: true },
      },
    },
  },
} satisfies Prisma.ProductMirrorSelect;

type SelectedProduct = Prisma.ProductMirrorGetPayload<{ select: typeof productSelection }>;
type DiscoveryIdRow = { id: string; sortPrice: number | null };
type DiscoveryCountRow = { count: bigint };
type FacetRow = { value: string };

function parseJsonStringArray(value: Prisma.JsonValue): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function toStorefrontProduct(product: SelectedProduct) {
  const media: StorefrontProductMedia = resolveStorefrontProductMedia({
    productName: product.name,
    primaryImageUrl: product.primaryImageUrl,
    variantImageUrls: product.variants.map((variant) =>
      parseJsonStringArray(variant.pancakeImageUrls),
    ),
  });

  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    media,
    editorialDescription: product.content?.editorialDescription ?? null,
    careInstructions: product.content?.careInstructions ?? null,
    sizeGuide: product.content?.sizeGuide ?? null,
    seoTitle: product.content?.seoTitle ?? null,
    seoDescription: product.content?.seoDescription ?? null,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      pancakeVariationId: variant.pancakeVariationId,
      color: variant.color,
      size: variant.size,
      retailPrice: variant.pancakeRetailPrice,
      retailPriceAfterDiscount: variant.pancakeRetailPriceAfterDiscount,
      sellableStock: sumWarehouseStocks(variant.warehouseStocks),
    })),
  };
}

function visibleProductWhere(shopId: number) {
  return {
    pancakeShopId: parseShopId(shopId),
    isPresent: true,
    isActive: true,
  } satisfies Prisma.ProductMirrorWhereInput;
}

const variantStockCte = Prisma.sql`
  WITH "variant_stock" AS (
    SELECT
      v."id",
      v."productId",
      v."color",
      v."size",
      CASE
        WHEN v."pancakeRetailPrice" IS NOT NULL
          AND v."pancakeRetailPriceAfterDiscount" IS NOT NULL
          AND v."pancakeRetailPrice" = v."pancakeRetailPriceAfterDiscount"
          AND v."pancakeRetailPrice" >= 0
          AND v."pancakeRetailPrice" <> 'NaN'::float8
          AND v."pancakeRetailPrice" <> 'Infinity'::float8
          AND v."pancakeRetailPrice" <> '-Infinity'::float8
        THEN v."pancakeRetailPrice"
        ELSE NULL
      END AS "resolvedPrice",
      CASE
        WHEN COUNT(ws."id") = 0 THEN 0::float8
        WHEN BOOL_AND(
          ws."quantity" <> 'NaN'::float8
          AND ws."quantity" <> 'Infinity'::float8
          AND ws."quantity" <> '-Infinity'::float8
        ) THEN SUM(ws."quantity")
        ELSE NULL
      END AS "sellableStock"
    FROM "VariantMirror" v
    LEFT JOIN "WarehouseStock" ws ON ws."variantId" = v."id"
    WHERE v."isPresent" = TRUE AND v."isActive" = TRUE
    GROUP BY
      v."id",
      v."productId",
      v."color",
      v."size",
      v."pancakeRetailPrice",
      v."pancakeRetailPriceAfterDiscount"
  )
`;

function buildVariantPredicate(discovery: StorefrontDiscoveryQuery) {
  const filters: Prisma.Sql[] = [];
  if (discovery.color) {
    filters.push(Prisma.sql`LOWER(BTRIM(vf."color")) = LOWER(${discovery.color})`);
  }
  if (discovery.size) {
    filters.push(Prisma.sql`LOWER(BTRIM(vf."size")) = LOWER(${discovery.size})`);
  }
  if (discovery.availability === "in-stock") {
    filters.push(Prisma.sql`vf."sellableStock" > 0`);
  }
  if (discovery.minPriceVnd !== null) {
    filters.push(Prisma.sql`vf."resolvedPrice" >= ${discovery.minPriceVnd}`);
  }
  if (discovery.maxPriceVnd !== null) {
    filters.push(Prisma.sql`vf."resolvedPrice" <= ${discovery.maxPriceVnd}`);
  }
  return filters;
}

function buildProductPredicate(shopId: number, discovery: StorefrontDiscoveryQuery) {
  const safeShopId = parseShopId(shopId);
  const filters: Prisma.Sql[] = [
    Prisma.sql`p."pancakeShopId" = ${safeShopId}`,
    Prisma.sql`p."isPresent" = TRUE`,
    Prisma.sql`p."isActive" = TRUE`,
  ];

  if (discovery.query) {
    filters.push(Prisma.sql`POSITION(LOWER(${discovery.query}) IN LOWER(p."name")) > 0`);
  }
  if (discovery.collection) {
    filters.push(
      Prisma.sql`${discovery.collection} = ANY(COALESCE(pc."collectionSlugs", ARRAY[]::TEXT[]))`,
    );
  }

  const variantFilters = buildVariantPredicate(discovery);
  if (variantFilters.length > 0) {
    filters.push(Prisma.sql`
      EXISTS (
        SELECT 1
        FROM "variant_stock" vf
        WHERE vf."productId" = p."id"
          AND ${Prisma.join(variantFilters, " AND ")}
      )
    `);
  }

  return {
    productPredicate: Prisma.join(filters, " AND "),
    variantFilters,
  };
}

function buildSortPrice(variantFilters: readonly Prisma.Sql[]) {
  const extraFilters =
    variantFilters.length > 0
      ? Prisma.sql`AND ${Prisma.join([...variantFilters], " AND ")}`
      : Prisma.sql``;
  return Prisma.sql`
    (
      SELECT MIN(vf."resolvedPrice")
      FROM "variant_stock" vf
      WHERE vf."productId" = p."id" ${extraFilters}
    )
  `;
}

function buildDiscoveryOrder(sort: StorefrontDiscoveryQuery["sort"]) {
  switch (sort) {
    case "name-desc":
      return Prisma.sql`p."name" DESC, p."id" ASC`;
    case "price-asc":
      return Prisma.sql`"sortPrice" ASC NULLS LAST, p."name" ASC, p."id" ASC`;
    case "price-desc":
      return Prisma.sql`"sortPrice" DESC NULLS LAST, p."name" ASC, p."id" ASC`;
    case "name-asc":
      return Prisma.sql`p."name" ASC, p."id" ASC`;
  }
}

function bigintToSafeNumber(value: bigint): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error("Storefront discovery count is outside safe integer bounds");
  }
  return parsed;
}

export function createStorefrontCatalogRepository(client: PrismaClient) {
  async function listProducts({ shopId, limit }: { shopId: number; limit: number }) {
    const products = await client.productMirror.findMany({
      where: visibleProductWhere(shopId),
      take: parseListLimit(limit),
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: productSelection,
    });

    return products.map((product) => toStorefrontProduct(product));
  }

  async function listProductPage({
    shopId,
    page,
    pageSize,
  }: {
    shopId: number;
    page: number;
    pageSize: number;
  }) {
    const safePageSize = parseListLimit(pageSize);
    const offset = parsePageOffset(page, safePageSize);
    const where = visibleProductWhere(shopId);
    const [totalProducts, products] = await Promise.all([
      client.productMirror.count({ where }),
      client.productMirror.findMany({
        where,
        skip: offset,
        take: safePageSize,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: productSelection,
      }),
    ]);

    return {
      products: products.map((product) => toStorefrontProduct(product)),
      page,
      pageSize: safePageSize,
      totalProducts,
      totalPages: Math.ceil(totalProducts / safePageSize),
    };
  }

  async function listDiscoveryPage({
    shopId,
    pageSize,
    discovery,
  }: {
    shopId: number;
    pageSize: number;
    discovery: StorefrontDiscoveryQuery;
  }) {
    const safePageSize = parseListLimit(pageSize);
    const offset = parsePageOffset(discovery.page, safePageSize);
    const { productPredicate, variantFilters } = buildProductPredicate(shopId, discovery);
    const sortPrice = buildSortPrice(variantFilters);
    const orderBy = buildDiscoveryOrder(discovery.sort);

    const [countRows, idRows] = await Promise.all([
      client.$queryRaw<DiscoveryCountRow[]>(Prisma.sql`
        ${variantStockCte}
        SELECT COUNT(*)::bigint AS "count"
        FROM "ProductMirror" p
        LEFT JOIN "ProductContent" pc ON pc."productId" = p."id"
        WHERE ${productPredicate}
      `),
      client.$queryRaw<DiscoveryIdRow[]>(Prisma.sql`
        ${variantStockCte}
        SELECT p."id", ${sortPrice} AS "sortPrice"
        FROM "ProductMirror" p
        LEFT JOIN "ProductContent" pc ON pc."productId" = p."id"
        WHERE ${productPredicate}
        ORDER BY ${orderBy}
        LIMIT ${safePageSize}
        OFFSET ${offset}
      `),
    ]);

    const totalCount = countRows[0] ? bigintToSafeNumber(countRows[0].count) : 0;
    const ids = idRows.map(({ id }) => id);
    const products =
      ids.length === 0
        ? []
        : await client.productMirror.findMany({
            where: { ...visibleProductWhere(shopId), id: { in: ids } },
            select: productSelection,
          });
    const byId = new Map(products.map((product) => [product.id, product]));
    const orderedProducts = ids.map((id) => {
      const product = byId.get(id);
      if (!product) throw new Error("Storefront discovery result changed during read");
      return toStorefrontProduct(product);
    });

    return {
      products: orderedProducts,
      page: discovery.page,
      pageSize: safePageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / safePageSize),
      hasPrevious: discovery.page > 1,
      hasNext: offset + orderedProducts.length < totalCount,
    };
  }

  async function listDiscoveryFacets({ shopId }: { shopId: number }) {
    const safeShopId = parseShopId(shopId);
    const [colorRows, sizeRows, collectionRows] = await Promise.all([
      client.$queryRaw<FacetRow[]>(Prisma.sql`
        SELECT DISTINCT BTRIM(v."color") AS "value"
        FROM "VariantMirror" v
        INNER JOIN "ProductMirror" p ON p."id" = v."productId"
        WHERE p."pancakeShopId" = ${safeShopId}
          AND p."isPresent" = TRUE
          AND p."isActive" = TRUE
          AND v."isPresent" = TRUE
          AND v."isActive" = TRUE
          AND v."color" IS NOT NULL
          AND BTRIM(v."color") <> ''
        ORDER BY "value" ASC
      `),
      client.$queryRaw<FacetRow[]>(Prisma.sql`
        SELECT DISTINCT BTRIM(v."size") AS "value"
        FROM "VariantMirror" v
        INNER JOIN "ProductMirror" p ON p."id" = v."productId"
        WHERE p."pancakeShopId" = ${safeShopId}
          AND p."isPresent" = TRUE
          AND p."isActive" = TRUE
          AND v."isPresent" = TRUE
          AND v."isActive" = TRUE
          AND v."size" IS NOT NULL
          AND BTRIM(v."size") <> ''
        ORDER BY "value" ASC
      `),
      client.$queryRaw<FacetRow[]>(Prisma.sql`
        SELECT DISTINCT collection AS "value"
        FROM "ProductContent" pc
        INNER JOIN "ProductMirror" p ON p."id" = pc."productId"
        CROSS JOIN LATERAL UNNEST(pc."collectionSlugs") AS collection
        WHERE p."pancakeShopId" = ${safeShopId}
          AND p."isPresent" = TRUE
          AND p."isActive" = TRUE
          AND collection <> ''
        ORDER BY "value" ASC
      `),
    ]);

    return {
      colors: colorRows.map(({ value }) => value),
      sizes: sizeRows.map(({ value }) => value),
      collections: collectionRows.map(({ value }) => value),
    };
  }

  async function getProductBySlug({ shopId, slug }: { shopId: number; slug: string }) {
    const product = await client.productMirror.findFirst({
      where: {
        ...visibleProductWhere(shopId),
        slug: parseSlug(slug),
      },
      select: productSelection,
    });

    return product ? toStorefrontProduct(product) : null;
  }

  return {
    listProducts,
    listProductPage,
    listDiscoveryPage,
    listDiscoveryFacets,
    getProductBySlug,
  };
}
