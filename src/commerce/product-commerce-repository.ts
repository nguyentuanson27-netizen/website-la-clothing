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
          .filter(
            (variant) =>
              variant.warehouseStocks.reduce((sum, stock) => sum + stock.quantity, 0) > 0,
          )
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

  return {
    setVariantActivation,
    readCatalogEnableWarningState,
    commitCatalogEnable,
    disableCatalog,
    activateProductAndStockedVariants,
  };
}
