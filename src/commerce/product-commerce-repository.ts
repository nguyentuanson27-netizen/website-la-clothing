import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";

export type ProductVariantActivationUpdate = {
  productId: string;
  variantIds: readonly string[];
  isActive: boolean;
};

class ProductCommerceAtomicityError extends Error {
  constructor() {
    super("Product commerce mutation did not update the expected rows");
    this.name = "ProductCommerceAtomicityError";
  }
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

  return { setVariantActivation };
}
