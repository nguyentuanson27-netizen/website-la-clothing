import type { PrismaClient } from "../generated/prisma/client.ts";
import type { CompositeComponentVariantActivation } from "./composite-component-admin.ts";

export function createCompositeComponentRepository(client: PrismaClient) {
  async function setRelationLinkedVariantActive(
    input: CompositeComponentVariantActivation,
  ): Promise<CompositeComponentVariantActivation | null> {
    // One conditional UPDATE is the authorization-adjacent persistence guard:
    // ownership, current mirror presence, and a persisted incoming composite edge
    // are revalidated atomically at the write itself.
    const updated = await client.variantMirror.updateMany({
      where: {
        id: input.variantId,
        productId: input.productId,
        isPresent: true,
        product: {
          isPresent: true,
        },
        compositeParents: {
          some: {},
        },
      },
      data: {
        isActive: input.isActive,
      },
    });

    return updated.count === 1 ? input : null;
  }

  return { setRelationLinkedVariantActive };
}
