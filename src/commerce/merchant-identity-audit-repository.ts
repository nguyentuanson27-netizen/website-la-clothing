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
      product: { select: { pancakeProductId: true, isPresent: true, isActive: true } },
      // A variation that is a component of any parent set is composite for Merchant purposes.
      compositeParents: { select: { parentVariantId: true }, take: 1 },
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
    isComposite: row.compositeParents.length > 0,
    isStorefrontVisible:
      row.isPresent && row.isActive && row.product.isPresent && row.product.isActive,
  }));
}
