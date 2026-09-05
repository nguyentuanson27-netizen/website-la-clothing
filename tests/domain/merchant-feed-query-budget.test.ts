import { describe, expect, it, vi } from "vitest";

import {
  MAX_MERCHANT_DB_ROUND_TRIPS,
  MAX_MERCHANT_OFFERS,
} from "../../src/commerce/merchant-feed-limits.ts";
import { createMerchantOfferRepository } from "../../src/commerce/merchant-offer-repository.ts";

function candidateProducts(variantCount: number) {
  return [
    {
      id: "product-internal-1",
      pancakeProductId: "product-1",
      slug: "product-1",
      name: "Product 1",
      primaryImageUrl: "https://cdn.example.test/product.jpg",
      content: { status: "PUBLISHED", editorialDescription: "Published description" },
      merchantFacts: null,
      variants: Array.from({ length: variantCount }, (_, index) => ({
        id: `variant-internal-${index}`,
        pancakeVariationId: `variation-${String(index).padStart(5, "0")}`,
        pancakeDisplayId: `MPN-${index}`,
        color: "Black",
        size: "M",
        pancakeRetailPrice: 100_000,
        pancakeRetailPriceAfterDiscount: null,
        pancakeImageUrls: ["https://cdn.example.test/product.jpg"],
        warehouseStocks: [{ quantity: 1 }],
        compositeParents: [],
        compositeComponents: [],
      })),
    },
  ];
}

describe("Merchant public-feed repository query envelope", () => {
  it("keeps the whole U25 candidate read at or below eight DB operations for 5,000 variants", async () => {
    const productFindMany = vi.fn(async () => candidateProducts(MAX_MERCHANT_OFFERS));
    const promotionFindMany = vi.fn(async () => []);
    const forbiddenVariantMirrorRead = vi.fn(async () => {
      throw new Error("Merchant trusted ownership path must not re-read VariantMirror per batch");
    });

    const repository = createMerchantOfferRepository({
      productMirror: { findMany: productFindMany },
      variantMirror: { findMany: forbiddenVariantMirrorRead },
      promotionTarget: { findMany: promotionFindMany },
    } as never);

    await repository.readCandidateProducts({ shopId: 920007, now: new Date("2026-09-05T00:00:00Z") });

    const dbOperations =
      productFindMany.mock.calls.length +
      promotionFindMany.mock.calls.length +
      forbiddenVariantMirrorRead.mock.calls.length;

    expect(productFindMany).toHaveBeenCalledTimes(1);
    expect(forbiddenVariantMirrorRead).not.toHaveBeenCalled();
    expect(promotionFindMany).toHaveBeenCalledTimes(MAX_MERCHANT_DB_ROUND_TRIPS - 1);
    expect(dbOperations).toBeLessThanOrEqual(MAX_MERCHANT_DB_ROUND_TRIPS);
  });
});
