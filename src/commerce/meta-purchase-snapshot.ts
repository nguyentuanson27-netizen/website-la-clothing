import type { PrismaClient } from "../generated/prisma/client.ts";

/**
 * The order facts both halves of the Purchase report are built from.
 *
 * The browser pixel and the Conversions API must describe the same sale identically — Meta pairs
 * them by event id, and a mismatched value or item list turns one conversion into two conflicting
 * ones — so both read this rather than assembling their own view of the order.
 */

export type MetaPurchaseContent = Readonly<{
  id: string;
  quantity: number;
  itemPrice: number;
}>;

export type MetaPurchaseSnapshot = Readonly<{
  valueVnd: number;
  contents: readonly MetaPurchaseContent[];
}>;

type OrderClient = Pick<PrismaClient, "orderMirror" | "variantMirror">;

/** VND amounts are stored as BigInt; a total past Number's exact range is not reportable. */
function toSafeNumber(value: bigint | null): number | null {
  if (value === null) return null;
  if (value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

export async function readMetaPurchaseSnapshot(
  client: OrderClient,
  orderCode: string,
): Promise<MetaPurchaseSnapshot | null> {
  const order = await client.orderMirror.findUnique({
    where: { publicCode: orderCode },
    select: {
      state: true,
      totalVnd: true,
      lines: {
        select: {
          variantId: true,
          pancakeVariationId: true,
          quantity: true,
          unitPriceVnd: true,
        },
      },
    },
  });

  // Only a confirmed order is a sale. Anything else would report revenue that does not exist.
  if (order === null || order.state !== "CONFIRMED") return null;

  const valueVnd = toSafeNumber(order.totalVnd);
  if (valueVnd === null) return null;

  // OrderLineSnapshot carries no relation to the variant, so the catalog identity the pixel
  // reports has to be looked up separately.
  const variants = await client.variantMirror.findMany({
    where: { id: { in: order.lines.map((line) => line.variantId) } },
    select: { id: true, product: { select: { slug: true } } },
  });
  const slugByVariantId = new Map(variants.map((variant) => [variant.id, variant.product.slug]));

  const contents: MetaPurchaseContent[] = [];
  for (const line of order.lines) {
    const itemPrice = toSafeNumber(line.unitPriceVnd);
    // Dropping the line while valueVnd still counts it would report an item list that contradicts
    // its own total. An order that cannot be described exactly is not reported at all.
    if (itemPrice === null) return null;
    contents.push({
      // Falls back to the POS variation id so a line whose product mirror has since been removed
      // is still counted rather than silently dropped from the sale.
      id: slugByVariantId.get(line.variantId) ?? line.pancakeVariationId,
      quantity: line.quantity,
      itemPrice,
    });
  }

  return Object.freeze({ valueVnd, contents: Object.freeze(contents) });
}
