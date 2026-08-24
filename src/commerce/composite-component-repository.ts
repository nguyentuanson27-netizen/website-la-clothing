import type { PrismaClient } from "../generated/prisma/client.ts";

export type LinkedComponentVariantActivation = {
  productId: string;
  variantId: string;
  isActive: boolean;
};

export function createCompositeComponentRepository(client: PrismaClient) {
  async function setLinkedVariantActivation({
    productId,
    variantId,
    isActive,
  }: LinkedComponentVariantActivation): Promise<boolean> {
    const result = await client.variantMirror.updateMany({
      where: {
        id: variantId,
        productId,
        isPresent: true,
        product: {
          isPresent: true,
        },
        compositeParents: {
          some: {},
        },
      },
      data: {
        isActive,
      },
    });

    return result.count === 1;
  }

  return { setLinkedVariantActivation };
}
