/**
 * Reads the mirrored money facts the pre-rollout audit needs.
 *
 * Scoped to the configured Pancake shop and bounded, because this is an operational report rather
 * than a request path: an unbounded scan of a catalog that has grown is not something to run against
 * production by accident.
 */

import { prisma } from "../db/prisma.ts";

import type { MirroredVariantMoneyRow } from "./mirrored-money-audit.ts";

/** Well above the current catalog and far below anything that would strain a report. */
export const MAX_AUDITED_VARIANTS = 50_000;

export class MirroredMoneyAuditError extends Error {}

export async function readMirroredVariantMoneyRows(
  pancakeShopId: number,
): Promise<MirroredVariantMoneyRow[]> {
  if (!Number.isSafeInteger(pancakeShopId) || pancakeShopId <= 0) {
    throw new MirroredMoneyAuditError("Pancake shop id must be a positive safe integer");
  }

  const rows = await prisma.variantMirror.findMany({
    where: { product: { pancakeShopId } },
    // Visibility mirrors the storefront's own filter: the variant and its product must both be
    // present and active. Anything already hidden is not something the rule takes from buyers.
    select: {
      pancakeVariationId: true,
      pancakeRetailPrice: true,
      pancakeRetailPriceAfterDiscount: true,
      isPresent: true,
      isActive: true,
      product: { select: { isPresent: true, isActive: true } },
    },
    orderBy: { pancakeVariationId: "asc" },
    take: MAX_AUDITED_VARIANTS + 1,
  });

  if (rows.length > MAX_AUDITED_VARIANTS) {
    throw new MirroredMoneyAuditError(
      `Catalog exceeds the audited bound of ${MAX_AUDITED_VARIANTS} variants; raise it deliberately rather than truncating evidence`,
    );
  }

  return rows.map((row) => ({
    pancakeVariationId: row.pancakeVariationId,
    pancakeRetailPrice: row.pancakeRetailPrice,
    pancakeRetailPriceAfterDiscount: row.pancakeRetailPriceAfterDiscount,
    isStorefrontVisible:
      row.isPresent && row.isActive && row.product.isPresent && row.product.isActive,
  }));
}
