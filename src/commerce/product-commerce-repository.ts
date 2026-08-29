import { verifyAdminCatalogConfirmationProof } from "./admin-catalog-confirmation.ts";
import { Prisma, type PrismaClient } from "../generated/prisma/client.ts";

export type ProductVariantActivationUpdate = {
  productId: string;
  variantIds: readonly string[];
  isActive: boolean;
};

export type CatalogEnableWarningState = {
  zeroActiveProductIds: string[];
  compositeChildProductIds: string[];
};

export type CatalogEnableCommitInput = {
  productId: string;
  actorId: string;
  proof: string;
  secret: string;
  nowMs: number;
};

export type CatalogEnableCommitResult =
  | { ok: true }
  | { ok: false; reason: "PRODUCT_NOT_AVAILABLE" }
  | {
      ok: false;
      reason: "RECONFIRM_REQUIRED";
      warningState: CatalogEnableWarningState;
    };

export type BulkCatalogEnableCommitInput = {
  productIds: readonly string[];
  actorId: string;
  proof: string;
  secret: string;
  nowMs: number;
};

export type BulkCatalogEnableCommitResult =
  | { ok: true; updatedCount: number }
  | { ok: false; reason: "PRODUCT_NOT_AVAILABLE" }
  | {
      ok: false;
      reason: "RECONFIRM_REQUIRED";
      warningState: CatalogEnableWarningState;
    };

export type BulkCatalogDisableResult =
  | { ok: true; updatedCount: number }
  | { ok: false; reason: "PRODUCT_NOT_AVAILABLE" };

export type BulkVariantActivationMode = "enable-all" | "enable-stocked" | "disable-all";

export type BulkVariantActivationResult =
  | { ok: true; updatedProductCount: number; updatedVariantCount: number }
  | { ok: false; reason: "PRODUCT_NOT_AVAILABLE" };

export type StockedQuickActionResult =
  | { ok: true; activatedVariantCount: number }
  | { ok: false; reason: "PRODUCT_NOT_AVAILABLE" | "COMPOSITE_CHILD" };

class ProductCommerceAtomicityError extends Error {
  constructor() {
    super("Product commerce mutation did not update the expected rows");
    this.name = "ProductCommerceAtomicityError";
  }
}

const SERIALIZABLE_RETRY_LIMIT = 3;

function isSerializationConflict(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2034",
  );
}

async function runSerializable<T>(
  client: PrismaClient,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
    try {
      return await client.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isSerializationConflict(error) || attempt === SERIALIZABLE_RETRY_LIMIT - 1) {
        throw error;
      }
    }
  }

  throw new Error("Serializable transaction retry loop exhausted");
}

/**
 * A malformed mirrored quantity makes the total unusable rather than positive.
 *
 * Summing straight through would let a single `Infinity` quantity read as sellable and activate
 * the variant, and the storefront's own `sumWarehouseStocks` then throws on that exact row while
 * rendering it. This matches the directory's `stocked-inactive` predicate, so the quick action
 * activates precisely the variants the health filter counts.
 */
function hasPositiveSellableStock(stocks: readonly { quantity: number }[]): boolean {
  let total = 0;
  for (const stock of stocks) {
    if (!Number.isFinite(stock.quantity)) return false;
    total += stock.quantity;
    if (!Number.isFinite(total)) return false;
  }
  return total > 0;
}

async function readWarningState(
  tx: Prisma.TransactionClient,
  productId: string,
): Promise<CatalogEnableWarningState | null> {
  const product = await tx.productMirror.findFirst({
    where: { id: productId, isPresent: true },
    select: {
      id: true,
      variants: {
        where: { isPresent: true },
        select: { isActive: true },
      },
    },
  });
  if (!product) return null;

  const incomingCompositeCount = await tx.compositeComponentMirror.count({
    where: {
      componentVariant: {
        productId,
        isPresent: true,
      },
    },
  });
  const hasActivePresentVariant = product.variants.some((variant) => variant.isActive);

  return {
    zeroActiveProductIds: hasActivePresentVariant ? [] : [productId],
    compositeChildProductIds: incomingCompositeCount > 0 ? [productId] : [],
  };
}

/**
 * Bulk warning state for an exact selection. Returns `null` as soon as any selected product is
 * missing or no longer present, so a stale directory page can never reach a write path.
 *
 * The two warning sets are read with bounded grouped queries rather than per-product reads: one
 * for products that still have at least one active present variant, one for products whose
 * present variants are components of a current composite parent.
 */
async function readBulkWarningState(
  tx: Prisma.TransactionClient,
  productIds: readonly string[],
): Promise<CatalogEnableWarningState | null> {
  const presentCount = await tx.productMirror.count({
    where: { id: { in: [...productIds] }, isPresent: true },
  });
  if (presentCount !== productIds.length) return null;

  const [activeRows, compositeRows] = await Promise.all([
    tx.variantMirror.findMany({
      where: { productId: { in: [...productIds] }, isPresent: true, isActive: true },
      select: { productId: true },
      distinct: ["productId"],
    }),
    tx.variantMirror.findMany({
      where: {
        productId: { in: [...productIds] },
        isPresent: true,
        compositeParents: { some: {} },
      },
      select: { productId: true },
      distinct: ["productId"],
    }),
  ]);

  const withActiveVariant = new Set(activeRows.map(({ productId }) => productId));
  const compositeChildren = new Set(compositeRows.map(({ productId }) => productId));

  return {
    zeroActiveProductIds: productIds.filter((productId) => !withActiveVariant.has(productId)),
    compositeChildProductIds: productIds.filter((productId) => compositeChildren.has(productId)),
  };
}

export function createProductCommerceRepository(client: PrismaClient) {
  async function setVariantActivation({
    productId,
    variantIds,
    isActive,
  }: ProductVariantActivationUpdate): Promise<boolean> {
    try {
      return await client.$transaction(async (tx) => {
        const where: Prisma.VariantMirrorWhereInput = {
          id: { in: [...variantIds] },
          productId,
          isPresent: true,
          product: {
            isPresent: true,
          },
        };

        const targetCount = await tx.variantMirror.count({ where });
        if (targetCount !== variantIds.length) {
          return false;
        }

        const result = await tx.variantMirror.updateMany({
          where,
          data: { isActive },
        });
        if (result.count !== variantIds.length) {
          throw new ProductCommerceAtomicityError();
        }

        return true;
      });
    } catch (error) {
      if (error instanceof ProductCommerceAtomicityError) {
        return false;
      }
      throw error;
    }
  }

  async function readCatalogEnableWarningState(
    productId: string,
  ): Promise<CatalogEnableWarningState | null> {
    return client.$transaction((tx) => readWarningState(tx, productId));
  }

  async function commitCatalogEnable(
    input: CatalogEnableCommitInput,
  ): Promise<CatalogEnableCommitResult> {
    try {
      return await runSerializable(client, async (tx) => {
        const warningState = await readWarningState(tx, input.productId);
        if (!warningState) {
          return { ok: false, reason: "PRODUCT_NOT_AVAILABLE" } as const;
        }

        const proofIsCurrent = verifyAdminCatalogConfirmationProof({
          secret: input.secret,
          nowMs: input.nowMs,
          proof: input.proof,
          actorId: input.actorId,
          operation: "enable",
          targetProductIds: [input.productId],
          zeroActiveProductIds: warningState.zeroActiveProductIds,
          compositeChildProductIds: warningState.compositeChildProductIds,
        });
        if (!proofIsCurrent) {
          return {
            ok: false,
            reason: "RECONFIRM_REQUIRED",
            warningState,
          } as const;
        }

        const updated = await tx.productMirror.updateMany({
          where: { id: input.productId, isPresent: true },
          data: { isActive: true },
        });
        if (updated.count !== 1) {
          throw new ProductCommerceAtomicityError();
        }

        return { ok: true } as const;
      });
    } catch (error) {
      if (error instanceof ProductCommerceAtomicityError) {
        return { ok: false, reason: "PRODUCT_NOT_AVAILABLE" };
      }
      throw error;
    }
  }

  async function readBulkCatalogEnableWarningState(
    productIds: readonly string[],
  ): Promise<CatalogEnableWarningState | null> {
    return client.$transaction((tx) => readBulkWarningState(tx, productIds));
  }

  /**
   * Re-reads every selected target and both warning sets inside one serializable transaction and
   * validates them against the confirmation proof before the first write. Any target drift or
   * warning-state drift returns `RECONFIRM_REQUIRED` with zero writes for the whole batch, even
   * when enabling would otherwise still be valid.
   */
  async function commitBulkCatalogEnable(
    input: BulkCatalogEnableCommitInput,
  ): Promise<BulkCatalogEnableCommitResult> {
    try {
      return await runSerializable(client, async (tx) => {
        const warningState = await readBulkWarningState(tx, input.productIds);
        if (!warningState) {
          return { ok: false, reason: "PRODUCT_NOT_AVAILABLE" } as const;
        }

        const proofIsCurrent = verifyAdminCatalogConfirmationProof({
          secret: input.secret,
          nowMs: input.nowMs,
          proof: input.proof,
          actorId: input.actorId,
          operation: "enable",
          targetProductIds: input.productIds,
          zeroActiveProductIds: warningState.zeroActiveProductIds,
          compositeChildProductIds: warningState.compositeChildProductIds,
        });
        if (!proofIsCurrent) {
          return { ok: false, reason: "RECONFIRM_REQUIRED", warningState } as const;
        }

        const updated = await tx.productMirror.updateMany({
          where: { id: { in: [...input.productIds] }, isPresent: true },
          data: { isActive: true },
        });
        if (updated.count !== input.productIds.length) {
          throw new ProductCommerceAtomicityError();
        }

        return { ok: true, updatedCount: updated.count } as const;
      });
    } catch (error) {
      if (error instanceof ProductCommerceAtomicityError) {
        return { ok: false, reason: "PRODUCT_NOT_AVAILABLE" };
      }
      throw error;
    }
  }

  /**
   * Disabling carries no publication risk, so it needs no freshness proof — but it still
   * validates every selected target atomically and touches only `ProductMirror.isActive`.
   */
  async function disableBulkCatalog(
    productIds: readonly string[],
  ): Promise<BulkCatalogDisableResult> {
    try {
      return await client.$transaction(async (tx) => {
        const presentCount = await tx.productMirror.count({
          where: { id: { in: [...productIds] }, isPresent: true },
        });
        if (presentCount !== productIds.length) {
          return { ok: false, reason: "PRODUCT_NOT_AVAILABLE" } as const;
        }

        const updated = await tx.productMirror.updateMany({
          where: { id: { in: [...productIds] }, isPresent: true },
          data: { isActive: false },
        });
        if (updated.count !== productIds.length) {
          throw new ProductCommerceAtomicityError();
        }

        return { ok: true, updatedCount: updated.count } as const;
      });
    } catch (error) {
      if (error instanceof ProductCommerceAtomicityError) {
        return { ok: false, reason: "PRODUCT_NOT_AVAILABLE" };
      }
      throw error;
    }
  }

  async function disableCatalog(productId: string): Promise<boolean> {
    const updated = await client.productMirror.updateMany({
      where: { id: productId, isPresent: true },
      data: { isActive: false },
    });
    return updated.count === 1;
  }

  async function activateProductAndStockedVariants(
    productId: string,
  ): Promise<StockedQuickActionResult> {
    try {
      return await runSerializable(client, async (tx) => {
        const product = await tx.productMirror.findFirst({
          where: { id: productId, isPresent: true },
          select: {
            id: true,
            variants: {
              where: { isPresent: true },
              select: {
                id: true,
                warehouseStocks: { select: { quantity: true } },
              },
            },
          },
        });
        if (!product) {
          return { ok: false, reason: "PRODUCT_NOT_AVAILABLE" } as const;
        }

        const incomingCompositeCount = await tx.compositeComponentMirror.count({
          where: {
            componentVariant: {
              productId,
              isPresent: true,
            },
          },
        });
        if (incomingCompositeCount > 0) {
          return { ok: false, reason: "COMPOSITE_CHILD" } as const;
        }

        const eligibleVariantIds = product.variants
          .filter((variant) => hasPositiveSellableStock(variant.warehouseStocks))
          .map((variant) => variant.id);

        const productUpdate = await tx.productMirror.updateMany({
          where: { id: productId, isPresent: true },
          data: { isActive: true },
        });
        if (productUpdate.count !== 1) {
          throw new ProductCommerceAtomicityError();
        }

        if (eligibleVariantIds.length > 0) {
          const variantUpdate = await tx.variantMirror.updateMany({
            where: {
              id: { in: eligibleVariantIds },
              productId,
              isPresent: true,
            },
            data: { isActive: true },
          });
          if (variantUpdate.count !== eligibleVariantIds.length) {
            throw new ProductCommerceAtomicityError();
          }
        }

        return {
          ok: true,
          activatedVariantCount: eligibleVariantIds.length,
        } as const;
      });
    } catch (error) {
      if (error instanceof ProductCommerceAtomicityError) {
        return { ok: false, reason: "PRODUCT_NOT_AVAILABLE" };
      }
      throw error;
    }
  }

  async function updateBulkVariantActivation(
    productIds: readonly string[],
    mode: BulkVariantActivationMode,
  ): Promise<BulkVariantActivationResult> {
    try {
      return await client.$transaction(async (tx) => {
        const presentCount = await tx.productMirror.count({
          where: { id: { in: [...productIds] }, isPresent: true },
        });
        if (presentCount !== productIds.length) {
          return { ok: false, reason: "PRODUCT_NOT_AVAILABLE" } as const;
        }

        if (mode === "enable-all" || mode === "disable-all") {
          const targetActive = mode === "enable-all";
          const updated = await tx.variantMirror.updateMany({
            where: { productId: { in: [...productIds] }, isPresent: true },
            data: { isActive: targetActive },
          });

          return {
            ok: true,
            updatedProductCount: productIds.length,
            updatedVariantCount: updated.count,
          } as const;
        }

        const variants = await tx.variantMirror.findMany({
          where: { productId: { in: [...productIds] }, isPresent: true },
          select: {
            id: true,
            warehouseStocks: { select: { quantity: true } },
          },
        });

        const eligibleVariantIds = variants
          .filter((variant) => hasPositiveSellableStock(variant.warehouseStocks))
          .map((variant) => variant.id);

        if (eligibleVariantIds.length > 0) {
          const updated = await tx.variantMirror.updateMany({
            where: { id: { in: eligibleVariantIds } },
            data: { isActive: true },
          });
          if (updated.count !== eligibleVariantIds.length) {
            throw new ProductCommerceAtomicityError();
          }
        }

        return {
          ok: true,
          updatedProductCount: productIds.length,
          updatedVariantCount: eligibleVariantIds.length,
        } as const;
      });
    } catch (error) {
      if (error instanceof ProductCommerceAtomicityError) {
        return { ok: false, reason: "PRODUCT_NOT_AVAILABLE" };
      }
      throw error;
    }
  }

  return {
    setVariantActivation,
    readCatalogEnableWarningState,
    commitCatalogEnable,
    readBulkCatalogEnableWarningState,
    commitBulkCatalogEnable,
    disableBulkCatalog,
    disableCatalog,
    activateProductAndStockedVariants,
    updateBulkVariantActivation,
  };
}
