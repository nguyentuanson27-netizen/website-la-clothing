import { createHash } from "node:crypto";

import type { PrismaClient } from "../generated/prisma/client.ts";
import type { PancakeCatalogVariation } from "../integrations/pancake/catalog-contract.ts";

const MAX_READ_PRODUCTS = 100;
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const SYNC_LOCK_NAMESPACE = 1_277_934_572;
const SYNC_TRANSACTION_TIMEOUT_MS = 60_000;

type CatalogProductSnapshot = {
  pancakeProductId: string;
  name: string;
};

function requireShopId(shopId: number): number {
  if (!Number.isSafeInteger(shopId) || shopId <= 0 || shopId > MAX_POSTGRES_INTEGER) {
    throw new TypeError("Catalog mirror shop id must fit a positive PostgreSQL INTEGER");
  }
  return shopId;
}

function requireSyncedAt(syncedAt: Date): Date {
  if (!(syncedAt instanceof Date) || Number.isNaN(syncedAt.getTime())) {
    throw new TypeError("Catalog mirror syncedAt must be a valid timestamp");
  }
  return syncedAt;
}

function parseReadLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_READ_PRODUCTS) {
    throw new RangeError(`Catalog mirror read limit must be between 1 and ${MAX_READ_PRODUCTS}`);
  }
  return limit;
}

function stableMirrorSlug(shopId: number, pancakeProductId: string): string {
  const digest = createHash("sha256")
    .update(`${shopId}:${pancakeProductId}`)
    .digest("hex")
    .slice(0, 20);
  return `p-${digest}`;
}

function validateSnapshot(variations: readonly PancakeCatalogVariation[]) {
  const productByExternalId = new Map<string, CatalogProductSnapshot>();
  const variationIds = new Set<string>();

  for (const variation of variations) {
    if (variationIds.has(variation.id)) {
      throw new Error("Catalog mirror snapshot contains duplicate variation identity");
    }
    variationIds.add(variation.id);

    if (variation.product.id !== variation.productId) {
      throw new Error("Catalog mirror snapshot contains inconsistent canonical product identity");
    }

    const existingProduct = productByExternalId.get(variation.productId);
    if (existingProduct && existingProduct.name !== variation.product.name) {
      throw new Error("Catalog mirror snapshot contains inconsistent product presentation");
    }
    productByExternalId.set(variation.productId, {
      pancakeProductId: variation.productId,
      name: variation.product.name,
    });

    const warehouseIds = new Set<string>();
    let sellableStock = 0;
    for (const stock of variation.warehouseStocks) {
      if (warehouseIds.has(stock.warehouseId)) {
        throw new Error("Catalog mirror snapshot contains duplicate warehouse identity");
      }
      warehouseIds.add(stock.warehouseId);
      if (!Number.isFinite(stock.remainQuantity)) {
        throw new Error("Catalog mirror snapshot contains malformed warehouse quantity");
      }
      sellableStock += stock.remainQuantity;
      if (!Number.isFinite(sellableStock)) {
        throw new Error("Catalog mirror snapshot stock total is outside numeric bounds");
      }
    }
    if (sellableStock !== variation.sellableStock) {
      throw new Error("Catalog mirror snapshot contains inconsistent sellable stock aggregation");
    }
  }

  return { productByExternalId, variationIds };
}

function sumWarehouseStocks(stocks: readonly { quantity: number }[]): number {
  let total = 0;
  for (const stock of stocks) {
    if (!Number.isFinite(stock.quantity)) {
      throw new Error("Catalog mirror contains malformed warehouse quantity");
    }
    total += stock.quantity;
    if (!Number.isFinite(total)) {
      throw new Error("Catalog mirror stock total is outside numeric bounds");
    }
  }
  return total;
}

export function createCatalogMirrorRepository(client: PrismaClient) {
  async function syncSnapshot({
    shopId,
    variations,
    syncedAt,
  }: {
    shopId: number;
    variations: readonly PancakeCatalogVariation[];
    syncedAt: Date;
  }) {
    const safeShopId = requireShopId(shopId);
    const safeSyncedAt = requireSyncedAt(syncedAt);
    const { productByExternalId, variationIds } = validateSnapshot(variations);
    const productIds = [...productByExternalId.keys()];
    const variationIdList = [...variationIds];

    return client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SYNC_LOCK_NAMESPACE}, ${safeShopId})`;

        const internalProductIds = new Map<string, string>();

        for (const product of productByExternalId.values()) {
          const mirrored = await tx.productMirror.upsert({
            where: { pancakeProductId: product.pancakeProductId },
            create: {
              pancakeShopId: safeShopId,
              pancakeProductId: product.pancakeProductId,
              slug: stableMirrorSlug(safeShopId, product.pancakeProductId),
              name: product.name,
              isPresent: true,
              isActive: false,
              syncedAt: safeSyncedAt,
            },
            update: {
              pancakeShopId: safeShopId,
              name: product.name,
              isPresent: true,
              syncedAt: safeSyncedAt,
            },
            select: { id: true },
          });
          internalProductIds.set(product.pancakeProductId, mirrored.id);
        }

        for (const variation of variations) {
          const internalProductId = internalProductIds.get(variation.productId);
          if (!internalProductId) {
            throw new Error("Catalog mirror product identity could not be resolved");
          }

          const mirrored = await tx.variantMirror.upsert({
            where: { pancakeVariationId: variation.id },
            create: {
              pancakeVariationId: variation.id,
              productId: internalProductId,
              pancakeDisplayId: variation.displayId,
              pancakeBarcode: variation.barcode,
              pancakeFields: variation.fields,
              pancakeImageUrls: variation.imageUrls,
              pancakeIsHidden: variation.isHidden,
              pancakeIsLocked: variation.isLocked,
              pancakeRetailPrice: variation.retailPrice,
              pancakeRetailPriceAfterDiscount: variation.retailPriceAfterDiscount,
              isPresent: true,
              isActive: false,
              syncedAt: safeSyncedAt,
            },
            update: {
              productId: internalProductId,
              pancakeDisplayId: variation.displayId,
              pancakeBarcode: variation.barcode,
              pancakeFields: variation.fields,
              pancakeImageUrls: variation.imageUrls,
              pancakeIsHidden: variation.isHidden,
              pancakeIsLocked: variation.isLocked,
              pancakeRetailPrice: variation.retailPrice,
              pancakeRetailPriceAfterDiscount: variation.retailPriceAfterDiscount,
              isPresent: true,
              syncedAt: safeSyncedAt,
            },
            select: { id: true },
          });

          const currentWarehouseIds = variation.warehouseStocks.map(({ warehouseId }) => warehouseId);
          await tx.warehouseStock.deleteMany({
            where: {
              variantId: mirrored.id,
              ...(currentWarehouseIds.length > 0
                ? { pancakeWarehouseId: { notIn: currentWarehouseIds } }
                : {}),
            },
          });

          for (const stock of variation.warehouseStocks) {
            await tx.warehouseStock.upsert({
              where: {
                variantId_pancakeWarehouseId: {
                  variantId: mirrored.id,
                  pancakeWarehouseId: stock.warehouseId,
                },
              },
              create: {
                variantId: mirrored.id,
                pancakeWarehouseId: stock.warehouseId,
                quantity: stock.remainQuantity,
                syncedAt: safeSyncedAt,
              },
              update: {
                quantity: stock.remainQuantity,
                syncedAt: safeSyncedAt,
              },
            });
          }
        }

        const shopProducts = await tx.productMirror.findMany({
          where: { pancakeShopId: safeShopId },
          select: { id: true, pancakeProductId: true },
        });
        const shopProductIds = shopProducts.map(({ id }) => id);

        const staleVariants =
          shopProductIds.length === 0
            ? []
            : await tx.variantMirror.findMany({
                where: {
                  productId: { in: shopProductIds },
                  ...(variationIdList.length > 0
                    ? { pancakeVariationId: { notIn: variationIdList } }
                    : {}),
                },
                select: { id: true },
              });
        const staleVariantIds = staleVariants.map(({ id }) => id);
        if (staleVariantIds.length > 0) {
          await tx.warehouseStock.deleteMany({ where: { variantId: { in: staleVariantIds } } });
          await tx.variantMirror.updateMany({
            where: { id: { in: staleVariantIds } },
            data: { isPresent: false, isActive: false, syncedAt: safeSyncedAt },
          });
        }

        const staleProducts = shopProducts.filter(
          ({ pancakeProductId }) => !productByExternalId.has(pancakeProductId),
        );
        const staleProductIds = staleProducts.map(({ id }) => id);
        if (staleProductIds.length > 0) {
          await tx.variantMirror.updateMany({
            where: { productId: { in: staleProductIds } },
            data: { isPresent: false, isActive: false, syncedAt: safeSyncedAt },
          });
          await tx.productMirror.updateMany({
            where: { id: { in: staleProductIds } },
            data: { isPresent: false, isActive: false, syncedAt: safeSyncedAt },
          });
        }

        return {
          products: productIds.length,
          variations: variationIdList.length,
        };
      },
      { timeout: SYNC_TRANSACTION_TIMEOUT_MS },
    );
  }

  async function listPresentProducts({ shopId, limit }: { shopId: number; limit: number }) {
    const products = await client.productMirror.findMany({
      where: { pancakeShopId: requireShopId(shopId), isPresent: true },
      take: parseReadLimit(limit),
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        pancakeProductId: true,
        slug: true,
        name: true,
        isActive: true,
        syncedAt: true,
        variants: {
          where: { isPresent: true },
          orderBy: [{ pancakeVariationId: "asc" }],
          select: {
            id: true,
            pancakeVariationId: true,
            pancakeDisplayId: true,
            pancakeBarcode: true,
            pancakeFields: true,
            pancakeImageUrls: true,
            pancakeIsHidden: true,
            pancakeIsLocked: true,
            pancakeRetailPrice: true,
            pancakeRetailPriceAfterDiscount: true,
            sku: true,
            color: true,
            size: true,
            isActive: true,
            syncedAt: true,
            warehouseStocks: {
              orderBy: [{ pancakeWarehouseId: "asc" }],
              select: {
                pancakeWarehouseId: true,
                quantity: true,
              },
            },
          },
        },
      },
    });

    return products.map((product) => ({
      ...product,
      variants: product.variants.map((variant) => ({
        ...variant,
        sellableStock: sumWarehouseStocks(variant.warehouseStocks),
      })),
    }));
  }

  return { syncSnapshot, listPresentProducts };
}
