import type { PrismaClient } from "../generated/prisma/client.ts";

const MAX_POSTGRES_INTEGER = 2_147_483_647;

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
  | { ok: false; reason: "VARIANT_UNAVAILABLE" };

type SetItemResult =
  | {
      ok: true;
      item: {
        variantId: string;
        quantity: number;
      };
    }
  | ExpectedMutationFailure;

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

  async function create({ now, expiresAt }: { now: Date; expiresAt: Date }) {
    if (
      Number.isNaN(now.getTime()) ||
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt.getTime() <= now.getTime()
    ) {
      throw new TypeError("Anonymous cart expiry must be a valid future timestamp");
    }

    return client.cart.create({
      data: {
        userId: null,
        expiresAt,
      },
      select: cartSelection,
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
    get,
    setItemQuantity,
    removeItem,
  };
}
