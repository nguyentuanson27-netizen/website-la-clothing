import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_MERCHANT_DB_ROUND_TRIPS,
  MAX_MERCHANT_OFFERS,
} from "../../src/commerce/merchant-feed-limits.ts";
import { createMerchantOfferRepository } from "../../src/commerce/merchant-offer-repository.ts";

function candidateVariants(variantCount: number) {
  return Array.from({ length: variantCount }, (_, index) => ({
    id: `variant-internal-${index}`,
    productId: "product-internal-1",
    pancakeVariationId: `variation-${String(index).padStart(5, "0")}`,
    pancakeDisplayId: `MPN-${index}`,
    color: "Black",
    size: "M",
    pancakeRetailPrice: 100_000,
    pancakeRetailPriceAfterDiscount: null,
    pancakeImageUrls: ["https://cdn.example.test/product.jpg"],
  }));
}

describe("Merchant public-feed repository query envelope", () => {
  it("loads 5,000 variants completely with at most eight bounded database operations", async () => {
    const calls = new Map<string, number>();
    const counted = <T>(name: string, value: T) => async () => {
      calls.set(name, (calls.get(name) ?? 0) + 1);
      return value;
    };
    const variants = candidateVariants(MAX_MERCHANT_OFFERS);

    const repository = createMerchantOfferRepository({
      productMirror: {
        findMany: counted("productMirror", [
          {
            id: "product-internal-1",
            pancakeProductId: "product-1",
            slug: "product-1",
            name: "Product 1",
            primaryImageUrl: "https://cdn.example.test/product.jpg",
          },
        ]),
      },
      variantMirror: { findMany: counted("variantMirror", variants) },
      productContent: {
        findMany: counted("productContent", [
          {
            productId: "product-internal-1",
            status: "PUBLISHED",
            editorialDescription: "Published description",
          },
        ]),
      },
      productMerchantFacts: { findMany: counted("productMerchantFacts", []) },
      warehouseStock: {
        findMany: counted(
          "warehouseStock",
          variants.map((variant) => ({
            variantId: variant.id,
            pancakeWarehouseId: "warehouse-1",
            quantity: 1,
          })),
        ),
      },
      compositeComponentMirror: { findMany: counted("compositeComponentMirror", []) },
      promotionTarget: {
        findMany: counted("promotionTarget", [
          {
            campaignId: "campaign-1",
            productId: null,
            variantId: variants[0]!.id,
          },
        ]),
      },
      promotionCampaign: {
        findMany: counted("promotionCampaign", [
          {
            id: "campaign-1",
            name: "Campaign 1",
            kind: "PROMOTION",
            discountType: "PERCENTAGE",
            percentageValue: 10,
            fixedPriceVnd: null,
            startsAt: null,
            endsAt: null,
          },
        ]),
      },
    } as never);

    const products = await repository.readCandidateProducts({
      shopId: 920007,
      now: new Date("2026-09-05T00:00:00Z"),
    });

    assert.equal(products.length, 1);
    assert.equal(products[0]?.variations.length, MAX_MERCHANT_OFFERS);
    const dbOperations = [...calls.values()].reduce((sum, count) => sum + count, 0);
    assert.equal(dbOperations <= MAX_MERCHANT_DB_ROUND_TRIPS, true);
    assert.equal(dbOperations, 8);
    for (const model of [
      "productMirror",
      "variantMirror",
      "productContent",
      "productMerchantFacts",
      "warehouseStock",
      "compositeComponentMirror",
      "promotionTarget",
      "promotionCampaign",
    ]) {
      assert.equal(calls.get(model), 1, `${model} must be read once`);
    }
  });
});
