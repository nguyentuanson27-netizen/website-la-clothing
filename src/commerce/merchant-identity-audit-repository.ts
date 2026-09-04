/**
 * Bounded read-only source for the M1 identity audit.
 *
 * `pancakeBarcode` is deliberately not selected: reading it would invite a later change to treat it
 * as a GTIN, which the spec forbids without proof of identifier type, format and check digit.
 */

import { prisma } from "../db/prisma.ts";

import type { MerchantIdentityRow } from "./merchant-identity-audit.ts";

export const MAX_AUDITED_VARIATIONS = 50_000;

export class MerchantIdentityAuditError extends Error {}

function aggregateWarehouseStock(quantities: readonly number[]): number {
  for (const quantity of quantities) {
    if (!Number.isFinite(quantity) || quantity < 0) return Number.NaN;
  }
  return quantities.reduce((total, quantity) => total + quantity, 0);
}

function parseVariantImageUrls(raw: unknown): readonly unknown[] | null {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      return [raw];
    } catch {
      return [raw];
    }
  }
  return [raw];
}

export async function readMerchantIdentityRows(
  pancakeShopId: number,
): Promise<MerchantIdentityRow[]> {
  if (!Number.isSafeInteger(pancakeShopId) || pancakeShopId <= 0) {
    throw new MerchantIdentityAuditError("Pancake shop id must be a positive safe integer");
  }

  const rows = await prisma.variantMirror.findMany({
    where: { product: { pancakeShopId } },
    select: {
      pancakeVariationId: true,
      sku: true,
      isPresent: true,
      isActive: true,
      pancakeRetailPrice: true,
      pancakeRetailPriceAfterDiscount: true,
      pancakeImageUrls: true,
      // Availability is a Merchant fact, so it is summed here rather than treated as an exclusion.
      warehouseStocks: { select: { quantity: true } },
      product: {
        select: {
          pancakeProductId: true,
          isPresent: true,
          isActive: true,
          name: true,
          primaryImageUrl: true,
          // Only a PUBLISHED description is a fact the storefront would show, so only that is a
          // Merchant fact; a Draft is work in progress and auditing it would overstate readiness.
          content: { select: { status: true, editorialDescription: true } },
        },
      },
      // Composite is either side of the graph. A variation that *is* a set is as deferred as one
      // that belongs to a set: Merchant v1 defers all composite projections, and counting a bundle
      // parent as standalone would audit an offer M3 is not allowed to emit.
      compositeParents: { select: { parentVariantId: true }, take: 1 },
      compositeComponents: { select: { componentVariantId: true }, take: 1 },
    },
    orderBy: { pancakeVariationId: "asc" },
    take: MAX_AUDITED_VARIATIONS + 1,
  });

  if (rows.length > MAX_AUDITED_VARIATIONS) {
    throw new MerchantIdentityAuditError(
      `Catalog exceeds the audited bound of ${MAX_AUDITED_VARIATIONS} variations; raise it deliberately rather than truncating evidence`,
    );
  }

  return rows.map((row) => ({
    pancakeVariationId: row.pancakeVariationId,
    pancakeProductId: row.product.pancakeProductId,
    sku: row.sku,
    isComposite: row.compositeParents.length > 0 || row.compositeComponents.length > 0,
    isStorefrontVisible:
      row.isPresent && row.isActive && row.product.isPresent && row.product.isActive,
    retailPrice: row.pancakeRetailPrice,
    retailPriceAfterDiscount: row.pancakeRetailPriceAfterDiscount,
    // Reject the whole availability fact when any source row is invalid; summing first would let a
    // positive warehouse hide a negative mirrored quantity (for example -3 + 4 => 1).
    stockQuantity: aggregateWarehouseStock(row.warehouseStocks.map((stock) => stock.quantity)),
    primaryImageUrl: row.product.primaryImageUrl,
    variantImageUrls: parseVariantImageUrls(row.pancakeImageUrls),
    title: row.product.name,
    publishedDescription: row.product.content?.status === "PUBLISHED"
      ? row.product.content.editorialDescription
      : null,
  }));
}
