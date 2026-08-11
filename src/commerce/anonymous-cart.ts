import type { PrismaClient } from "../generated/prisma/client.ts";

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const ANONYMOUS_CART_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const ANONYMOUS_CART_MAX_DISTINCT_ITEMS = 50;

const cartSelection = {
  id: true,
  userId: true,
  expiresAt: true,
  items: {
    select: {
      variantId: true,
      quantity: true,
    },
    orderBy: {
      createdAt: "asc" as const,
    },
  },
} as const;

type ExpectedMutationFailure =
  | { ok: false; reason: "INVALID_QUANTITY" }
  | { ok: false; reason: "CART_UNAVAILABLE" }
  | { ok: false; reason: "VARIANT_UNAVAILABLE" }
  | { ok: false; reason: "CART_LINE_LIMIT" };

type SetItemResult =
  | {
      ok: true;
      item: {
        variantId: string;
        quantity: number;
      };
    }
  | ExpectedMutationFailure;

type UpdateExistingItemResult =
  | {
      ok: true;
      item: {
        variantId: string;
        quantity: number;
      };
    }
  | { ok: false; reason: "INVALID_QUANTITY" }
  | { ok: false; reason: "CART_UNAVAILABLE" }
  | { ok: false; reason: "VARIANT_UNAVAILABLE" }
  | { ok: false; reason: "CART_ITEM_UNAVAILABLE" };

type CreateWithItemResult =
  | {
      ok: true;
      cart: {
        id: string;
        expiresAt: Date;
      };
      item: {
        variantId: string;
        quantity: number;
      };
    }
  | Exclude<ExpectedMutationFailure, { reason: "CART_UNAVAILABLE" } | { reason: "CART_LINE_LIMIT" }>;

type RemoveItemResult = { ok: true } | { ok: false; reason: "CART_UNAVAILABLE" };
type RawQueryClient = Pick<PrismaClient, "$queryRaw">;

function isPositiveDatabaseInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_POSTGRES_INTEGER;
}

function liveAnonymousCartWhere(cartId: string, now: Date) {
  return {
    id: cartId,
    userId: null,
    expiresAt: { gt: now },
  } as const;
}

function anonymousCartExpiresAt(now: Date): Date {
  const nowMs = now.getTime();
  if (Number.isNaN(nowMs)) {
    throw new TypeError("Anonymous cart creation time must be a valid timestamp");
  }

  const expiresAt = new Date(nowMs + ANONYMOUS_CART_TTL_MS);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new TypeError("Anonymous cart expiry must be a valid timestamp");
  }

  return expiresAt;
}

async function lockLiveAnonymousCart(
  client: RawQueryClient,
  cartId: string,
  now: Date,
): Promise<boolean> {
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Cart"
    WHERE "id" = ${cartId}
      AND "userId" IS NULL
      AND "expiresAt" > ${now}
    FOR UPDATE
  `;

  return rows.length === 1;
}

export function createAnonymousCartService(client: PrismaClient) {
  async function findLiveAnonymousCart(cartId: string, now: Date) {
    return client.cart.findFirst({
      where: liveAnonymousCartWhere(cartId, now),
      select: cartSelection,
    });
  }

  async function create({ now }: { now: Date }) {
    return client.cart.create({
      data: {
        userId: null,
        expiresAt: anonymousCartExpiresAt(now),
      },
      select: cartSelection,
    });
  }

  async function createWithItem({
    variantId,
    quantity,
    now,
  }: {
    variantId: string;
    quantity: number;
    now: Date;
  }): Promise<CreateWithItemResult> {
    if (!isPositiveDatabaseInteger(quantity)) {
      return { ok: false, reason: "INVALID_QUANTITY" };
    }

    return client.$transaction(async (tx): Promise<CreateWithItemResult> => {
      const variant = await tx.variantMirror.findUnique({
        where: { id: variantId },
        select: {
          isActive: true,
          product: { select: { isActive: true } },
        },
      });

      if (!variant?.isActive || !variant.product.isActive) {
        return { ok: false, reason: "VARIANT_UNAVAILABLE" };
      }

      const cart = await tx.cart.create({
        data: {
          userId: null,
          expiresAt: anonymousCartExpiresAt(now),
        },
        select: { id: true, expiresAt: true },
      });
      const item = await tx.cartItem.create({
        data: { cartId: cart.id, variantId, quantity },
        select: { variantId: true, quantity: true },
      });

      return { ok: true, cart, item };
    });
  }

  async function get({ cartId, now }: { cartId: string; now: Date }) {
    return findLiveAnonymousCart(cartId, now);
  }

  async function setItemQuantity({
    cartId,
    variantId,
    quantity,
    now,
  }: {
    cartId: string;
    variantId: string;
    quantity: number;
    now: Date;
  }): Promise<SetItemResult> {
    if (!isPositiveDatabaseInteger(quantity)) {
      return { ok: false, reason: "INVALID_QUANTITY" };
    }

    return client.$transaction(async (tx): Promise<SetItemResult> => {
      if (!(await lockLiveAnonymousCart(tx, cartId, now))) {
        return { ok: false, reason: "CART_UNAVAILABLE" };
      }

      const variant = await tx.variantMirror.findUnique({
        where: { id: variantId },
        select: {
          isActive: true,
          product: {
            select: { isActive: true },
          },
        },
      });

      if (!variant?.isActive || !variant.product.isActive) {
        return { ok: false, reason: "VARIANT_UNAVAILABLE" };
      }

      const existingItem = await tx.cartItem.findUnique({
        where: { cartId_variantId: { cartId, variantId } },
        select: { id: true },
      });

      if (!existingItem) {
        const distinctItemCount = await tx.cartItem.count({ where: { cartId } });
        if (distinctItemCount >= ANONYMOUS_CART_MAX_DISTINCT_ITEMS) {
          return { ok: false, reason: "CART_LINE_LIMIT" };
        }
      }

      const item = await tx.cartItem.upsert({
        where: {
          cartId_variantId: {
            cartId,
            variantId,
          },
        },
        create: {
          cartId,
          variantId,
          quantity,
        },
        update: {
          quantity,
        },
        select: {
          variantId: true,
          quantity: true,
        },
      });

      return { ok: true, item };
    });
  }

  async function updateExistingItemQuantity({
    cartId,
    variantId,
    quantity,
    now,
  }: {
    cartId: string;
    variantId: string;
    quantity: number;
    now: Date;
  }): Promise<UpdateExistingItemResult> {
    if (!isPositiveDatabaseInteger(quantity)) {
      return { ok: false, reason: "INVALID_QUANTITY" };
    }

    return client.$transaction(async (tx): Promise<UpdateExistingItemResult> => {
      if (!(await lockLiveAnonymousCart(tx, cartId, now))) {
        return { ok: false, reason: "CART_UNAVAILABLE" };
      }

      const existingItem = await tx.cartItem.findUnique({
        where: { cartId_variantId: { cartId, variantId } },
        select: { id: true },
      });

      if (!existingItem) {
        return { ok: false, reason: "CART_ITEM_UNAVAILABLE" };
      }

      const variant = await tx.variantMirror.findUnique({
        where: { id: variantId },
        select: {
          isActive: true,
          product: {
            select: { isActive: true },
          },
        },
      });

      if (!variant?.isActive || !variant.product.isActive) {
        return { ok: false, reason: "VARIANT_UNAVAILABLE" };
      }

      const item = await tx.cartItem.update({
        where: { cartId_variantId: { cartId, variantId } },
        data: { quantity },
        select: { variantId: true, quantity: true },
      });

      return { ok: true, item };
    });
  }

  async function removeItem({
    cartId,
    variantId,
    now,
  }: {
    cartId: string;
    variantId: string;
    now: Date;
  }): Promise<RemoveItemResult> {
    return client.$transaction(async (tx): Promise<RemoveItemResult> => {
      if (!(await lockLiveAnonymousCart(tx, cartId, now))) {
        return { ok: false, reason: "CART_UNAVAILABLE" };
      }

      await tx.cartItem.deleteMany({
        where: {
          cartId,
          variantId,
        },
      });

      return { ok: true };
    });
  }

  return {
    create,
    createWithItem,
    get,
    setItemQuantity,
    updateExistingItemQuantity,
    removeItem,
  };
}
