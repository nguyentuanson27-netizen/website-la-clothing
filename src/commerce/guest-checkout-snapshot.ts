import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { ANONYMOUS_CART_MAX_DISTINCT_ITEMS } from "./anonymous-cart.ts";
import { parseGuestCheckoutInput } from "./guest-checkout-input.ts";
import { calculateGuestShippingFeeVnd } from "./guest-shipping-policy.ts";
import { buildStorefrontCartLines } from "./storefront-cart.ts";

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_PUBLIC_CODE_LENGTH = 128;

type CheckoutFailureReason =
  | "INVALID_INPUT"
  | "CART_UNAVAILABLE"
  | "CART_EMPTY"
  | "CART_LINE_UNAVAILABLE"
  | "MONEY_UNSUPPORTED"
  | "PUBLIC_CODE_UNAVAILABLE";

type CheckoutSnapshotResult =
  | {
      ok: true;
      order: {
        publicCode: string;
        state: "DRAFT";
        merchandiseSubtotalVnd: bigint;
        shippingFeeVnd: bigint;
        totalVnd: bigint;
      };
    }
  | { ok: false; reason: CheckoutFailureReason };

const productSelection = {
  name: true,
  isPresent: true,
  isActive: true,
  variants: {
    orderBy: [{ pancakeVariationId: "asc" as const }],
    select: {
      id: true,
      pancakeVariationId: true,
      isPresent: true,
      isActive: true,
      color: true,
      size: true,
      pancakeRetailPrice: true,
      pancakeRetailPriceAfterDiscount: true,
      warehouseStocks: {
        orderBy: [{ pancakeWarehouseId: "asc" as const }],
        select: { quantity: true },
      },
    },
  },
} satisfies Prisma.ProductMirrorSelect;

type SelectedProduct = Prisma.ProductMirrorGetPayload<{ select: typeof productSelection }>;
type TransactionClient = Prisma.TransactionClient;

function parseShopId(shopId: number): number | null {
  return Number.isSafeInteger(shopId) && shopId > 0 && shopId <= MAX_POSTGRES_INTEGER
    ? shopId
    : null;
}

function parsePublicCode(publicCode: unknown): string | null {
  if (typeof publicCode !== "string") return null;
  if (publicCode.length === 0 || publicCode.length > MAX_PUBLIC_CODE_LENGTH) return null;
  if (publicCode.trim() !== publicCode) return null;
  return publicCode;
}

function isValidDate(now: Date): boolean {
  return now instanceof Date && !Number.isNaN(now.getTime());
}

function sumWarehouseStocks(stocks: readonly { quantity: number }[]): number | null {
  let total = 0;
  for (const stock of stocks) {
    if (!Number.isFinite(stock.quantity)) return null;
    total += stock.quantity;
    if (!Number.isFinite(total)) return null;
  }
  return total;
}

function isSupportedVndAmount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function checkedMultiplyVnd(unitPriceVnd: number, quantity: number): number | null {
  if (!isSupportedVndAmount(unitPriceVnd) || !Number.isSafeInteger(quantity) || quantity <= 0) {
    return null;
  }
  const total = unitPriceVnd * quantity;
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

function checkedAddVnd(left: number, right: number): number | null {
  const total = left + right;
  return Number.isSafeInteger(total) && total >= 0 ? total : null;
}

async function lockLiveAnonymousCart(
  tx: TransactionClient,
  cartId: string,
  now: Date,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Cart"
    WHERE "id" = ${cartId}
      AND "userId" IS NULL
      AND "expiresAt" > ${now}
    FOR UPDATE
  `;
  return rows.length === 1;
}

function toStorefrontProduct(product: SelectedProduct) {
  const variants = [];
  for (const variant of product.variants) {
    const sellableStock = sumWarehouseStocks(variant.warehouseStocks);
    if (sellableStock === null) return null;
    variants.push({
      id: variant.id,
      isPresent: variant.isPresent,
      isActive: variant.isActive,
      color: variant.color,
      size: variant.size,
      sellableStock,
      retailPrice: variant.pancakeRetailPrice,
      retailPriceAfterDiscount: variant.pancakeRetailPriceAfterDiscount,
    });
  }
  return {
    slug: "checkout-snapshot",
    name: product.name,
    isPresent: product.isPresent,
    isActive: product.isActive,
    variants,
  };
}

export function createGuestCheckoutSnapshotService(client: PrismaClient) {
  async function create({
    cartId,
    shopId,
    publicCode,
    checkoutInput,
    now,
  }: {
    cartId: string;
    shopId: number;
    publicCode: string;
    checkoutInput: unknown;
    now: Date;
  }): Promise<CheckoutSnapshotResult> {
    const parsedCheckout = parseGuestCheckoutInput(checkoutInput);
    const safeShopId = parseShopId(shopId);
    const safePublicCode = parsePublicCode(publicCode);
    if (
      !parsedCheckout.ok ||
      safeShopId === null ||
      safePublicCode === null ||
      typeof cartId !== "string" ||
      cartId.length === 0 ||
      !isValidDate(now)
    ) {
      return { ok: false, reason: "INVALID_INPUT" };
    }

    try {
      return await client.$transaction(async (tx): Promise<CheckoutSnapshotResult> => {
        if (!(await lockLiveAnonymousCart(tx, cartId, now))) {
          return { ok: false, reason: "CART_UNAVAILABLE" };
        }

        const items = await tx.cartItem.findMany({
          where: { cartId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { variantId: true, quantity: true },
        });
        if (items.length === 0) {
          return { ok: false, reason: "CART_EMPTY" };
        }
        if (items.length > ANONYMOUS_CART_MAX_DISTINCT_ITEMS) {
          return { ok: false, reason: "CART_LINE_UNAVAILABLE" };
        }

        const variantIds = items.map(({ variantId }) => variantId);
        const products = await tx.productMirror.findMany({
          where: {
            pancakeShopId: safeShopId,
            variants: { some: { id: { in: variantIds } } },
          },
          orderBy: [{ pancakeProductId: "asc" }],
          select: productSelection,
        });

        const storefrontProducts = [];
        const variationIdentity = new Map<string, string>();
        for (const product of products) {
          const storefrontProduct = toStorefrontProduct(product);
          if (!storefrontProduct) {
            return { ok: false, reason: "CART_LINE_UNAVAILABLE" };
          }
          storefrontProducts.push(storefrontProduct);
          for (const variant of product.variants) {
            variationIdentity.set(variant.id, variant.pancakeVariationId);
          }
        }

        const lines = buildStorefrontCartLines({ items, products: storefrontProducts });
        const snapshots: Array<{
          variantId: string;
          pancakeVariationId: string;
          productName: string;
          color: string;
          size: string;
          quantity: number;
          unitPriceVnd: bigint;
          lineTotalVnd: bigint;
        }> = [];
        let merchandiseSubtotalVnd = 0;
        let totalQuantity = 0;

        for (const line of lines) {
          const pancakeVariationId = variationIdentity.get(line.variantId);
          if (
            !line.available ||
            line.price === null ||
            line.productName === null ||
            line.color === null ||
            line.size === null ||
            !pancakeVariationId
          ) {
            return { ok: false, reason: "CART_LINE_UNAVAILABLE" };
          }

          const lineTotalVnd = checkedMultiplyVnd(line.price, line.quantity);
          if (lineTotalVnd === null) {
            return { ok: false, reason: "MONEY_UNSUPPORTED" };
          }
          const nextSubtotal = checkedAddVnd(merchandiseSubtotalVnd, lineTotalVnd);
          const nextQuantity = totalQuantity + line.quantity;
          if (nextSubtotal === null || !Number.isSafeInteger(nextQuantity) || nextQuantity <= 0) {
            return { ok: false, reason: "MONEY_UNSUPPORTED" };
          }
          merchandiseSubtotalVnd = nextSubtotal;
          totalQuantity = nextQuantity;
          snapshots.push({
            variantId: line.variantId,
            pancakeVariationId,
            productName: line.productName,
            color: line.color,
            size: line.size,
            quantity: line.quantity,
            unitPriceVnd: BigInt(line.price),
            lineTotalVnd: BigInt(lineTotalVnd),
          });
        }

        const shippingFeeVnd = calculateGuestShippingFeeVnd({
          subtotalVnd: merchandiseSubtotalVnd,
          totalQuantity,
        });
        const totalVnd = checkedAddVnd(merchandiseSubtotalVnd, shippingFeeVnd);
        if (totalVnd === null) {
          return { ok: false, reason: "MONEY_UNSUPPORTED" };
        }

        const order = await tx.orderMirror.create({
          data: {
            publicCode: safePublicCode,
            userId: null,
            state: "DRAFT",
            checkoutSnapshottedAt: now,
            guestName: parsedCheckout.value.name,
            guestPhone: parsedCheckout.value.phone,
            provinceRef: parsedCheckout.value.provinceRef,
            districtRef: parsedCheckout.value.districtRef,
            communeRef: parsedCheckout.value.communeRef,
            addressDetail: parsedCheckout.value.detail,
            note: parsedCheckout.value.note,
            merchandiseSubtotalVnd: BigInt(merchandiseSubtotalVnd),
            shippingFeeVnd: BigInt(shippingFeeVnd),
            totalVnd: BigInt(totalVnd),
            lines: { create: snapshots },
          },
          select: {
            publicCode: true,
            state: true,
            merchandiseSubtotalVnd: true,
            shippingFeeVnd: true,
            totalVnd: true,
          },
        });

        return {
          ok: true,
          order: {
            publicCode: order.publicCode,
            state: "DRAFT",
            merchandiseSubtotalVnd: order.merchandiseSubtotalVnd!,
            shippingFeeVnd: order.shippingFeeVnd!,
            totalVnd: order.totalVnd!,
          },
        };
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2002"
      ) {
        return { ok: false, reason: "PUBLIC_CODE_UNAVAILABLE" };
      }
      throw error;
    }
  }

  return { create };
}
