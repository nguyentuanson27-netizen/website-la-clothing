import type { PrismaClient } from "../generated/prisma/client.ts";
import { createStorefrontCatalogRepository } from "./storefront-catalog.ts";
import {
  buildStorefrontProductProjection,
  type StorefrontCompositeComponentGroup,
} from "./storefront-projection.ts";
import type { StorefrontVariantFacts } from "./storefront-product.ts";
import { buildPromotionalStorefrontPricing } from "./storefront-promotion-projection.ts";
import { readApplicablePromotionCampaigns } from "./promotion-candidate-repository.ts";

function sumWarehouseStocks(stocks: readonly { quantity: number }[]): number {
  let total = 0;
  for (const stock of stocks) {
    if (!Number.isFinite(stock.quantity)) {
      throw new Error("Storefront projection contains malformed warehouse quantity");
    }
    total += stock.quantity;
    if (!Number.isFinite(total)) {
      throw new Error("Storefront projection stock total is outside numeric bounds");
    }
  }
  return total;
}

export function createStorefrontProductDetailRepository(client: PrismaClient) {
  const catalog = createStorefrontCatalogRepository(client);

  async function getProductBySlug({
    shopId,
    slug,
    now = new Date(),
  }: { shopId: number; slug: string; now?: Date }) {
    const product = await catalog.getProductBySlug({ shopId, slug });
    if (!product) return null;

    const parentRelations = await client.variantMirror.findMany({
      where: {
        productId: product.id,
        isPresent: true,
        isActive: true,
      },
      orderBy: [{ pancakeVariationId: "asc" }],
      select: {
        id: true,
        compositeComponents: {
          orderBy: [{ componentVariantId: "asc" }],
          select: {
            componentVariant: {
              select: {
                id: true,
                pancakeVariationId: true,
                color: true,
                size: true,
                isPresent: true,
                isActive: true,
                pancakeRetailPrice: true,
                pancakeRetailPriceAfterDiscount: true,
                product: {
                  select: {
                    id: true,
                    name: true,
                    pancakeShopId: true,
                    isPresent: true,
                  },
                },
                warehouseStocks: {
                  orderBy: [{ pancakeWarehouseId: "asc" }],
                  select: { quantity: true },
                },
              },
            },
          },
        },
      },
    });

    const hasCompositeGraph = parentRelations.some(
      (parent) => parent.compositeComponents.length > 0,
    );
    const groups = new Map<
      string,
      { label: string; variants: Map<string, StorefrontVariantFacts> }
    >();

    for (const parent of parentRelations) {
      for (const edge of parent.compositeComponents) {
        const component = edge.componentVariant;
        if (
          component.product.pancakeShopId !== shopId ||
          !component.product.isPresent ||
          !component.isPresent ||
          !component.isActive
        ) {
          continue;
        }

        let group = groups.get(component.product.id);
        if (!group) {
          group = { label: component.product.name, variants: new Map() };
          groups.set(component.product.id, group);
        }
        if (!group.variants.has(component.id)) {
          group.variants.set(component.id, {
            id: component.id,
            pancakeVariationId: component.pancakeVariationId,
            color: component.color,
            size: component.size,
            sellableStock: sumWarehouseStocks(component.warehouseStocks),
            retailPrice: component.pancakeRetailPrice,
            retailPriceAfterDiscount: component.pancakeRetailPriceAfterDiscount,
          });
        }
      }
    }

    const componentGroups: StorefrontCompositeComponentGroup[] = [...groups.values()]
      .sort((left, right) => left.label.localeCompare(right.label, "vi"))
      .map((group) => ({
        label: group.label,
        variants: [...group.variants.values()],
      }));

    // One batched candidate lookup for every variant this page can display — parent options and
    // composite components alike. Resolving per option would be an N+1 on the busiest storefront
    // page, and a component must be priced by its own owning product's campaigns rather than the
    // parent's, which the repository already handles by keying on each variant's real owner.
    const pricedVariantIds = [
      ...new Set([
        ...product.variants.map((variant) => variant.id),
        ...componentGroups.flatMap((group) => group.variants.map((variant) => variant.id)),
      ]),
    ];
    const { campaignsByVariantId } = await readApplicablePromotionCampaigns({
      variantIds: pricedVariantIds,
    });

    return {
      ...product,
      projection: buildStorefrontProductProjection({
        parentVariants: product.variants,
        componentGroups,
        hasCompositeGraph,
        // One instant for the whole page, passed in by the caller, so every option on it agrees
        // about whether a window is open.
        pricingRule: buildPromotionalStorefrontPricing({ campaignsByVariantId, now }),
      }),
    };
  }

  return { getProductBySlug };
}

export async function countProjectedCompositeParentVariations(
  client: PrismaClient,
  shopId: number,
): Promise<number> {
  return client.variantMirror.count({
    where: {
      product: { pancakeShopId: shopId },
      compositeComponents: { some: {} },
    },
  });
}
