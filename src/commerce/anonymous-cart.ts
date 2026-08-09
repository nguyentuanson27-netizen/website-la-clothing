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

function isPositiveDatabaseInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_POSTGRES_INTEGER;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

function liveAnonymousCartWhere(cartId: string, now: Date) {
  return {
    id: cartId,
    userId: null,
    expiresAt: { gt: now },
  } as const;
}

export function createAnonymousCartService(client: PrismaClient) {
  async function findLiveAnonymousCart(cartId: string, now: Date) {
    return client.cart.findFirst({
      where: liveAnonymousCartWhere(cartId, now),
      select: cartSelection,
    });
  }

  async function hasLiveAnonymousCart(cartId: string, now: Date): Promise<boolean> {
    const cart = await client.cart.findFirst({
      where: liveAnonymousCartWhere(cartId, now),
      select: { id: true },
    });

    return cart !== null;
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

    if (!(await hasLiveAnonymousCart(cartId, now))) {
      return { ok: false, reason: "CART_UNAVAILABLE" };
    }

    const variant = await client.variantMirror.findUnique({
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

    const upsertInput = {
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
    } as const;

    try {
      const item = await client.cartItem.upsert(upsertInput);
      return { ok: true, item };
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      const item = await client.cartItem.update({
        where: upsertInput.where,
        data: { quantity },
        select: upsertInput.select,
      });
      return { ok: true, item };
    }
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
    if (!(await hasLiveAnonymousCart(cartId, now))) {
      return { ok: false, reason: "CART_UNAVAILABLE" };
    }

    await client.cartItem.deleteMany({
      where: {
        cartId,
        variantId,
      },
    });

    return { ok: true };
  }

  return {
    create,
    get,
    setItemQuantity,
    removeItem,
  };
}
