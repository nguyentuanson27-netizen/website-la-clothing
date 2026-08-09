"use server";

import { cookies } from "next/headers";

import { prisma } from "../db/prisma.ts";
import type { AnonymousCartCookieWrite } from "./anonymous-cart-cookie.ts";
import { createAnonymousCartMutationService } from "./anonymous-cart-mutation.ts";

const MAX_VARIANT_ID_LENGTH = 128;

function parseVariantId(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_VARIANT_ID_LENGTH ||
    value !== value.trim()
  ) {
    return null;
  }
  return value;
}

function parseSetInput(input: unknown): { variantId: string; quantity: number } | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const variantId = parseVariantId(record.variantId);
  if (!variantId || typeof record.quantity !== "number") return null;
  return { variantId, quantity: record.quantity };
}

function parseRemoveInput(input: unknown): { variantId: string } | null {
  if (!input || typeof input !== "object") return null;
  const variantId = parseVariantId((input as Record<string, unknown>).variantId);
  return variantId ? { variantId } : null;
}

async function mutationService() {
  const cookieStore = await cookies();
  return createAnonymousCartMutationService(prisma, {
    get(name) {
      return cookieStore.get(name);
    },
    set(cookie: AnonymousCartCookieWrite) {
      cookieStore.set(cookie);
    },
  });
}

export async function setAnonymousCartItemQuantity(input: unknown) {
  const parsed = parseSetInput(input);
  if (!parsed) return { ok: false, reason: "INVALID_INPUT" } as const;

  return (await mutationService()).setItemQuantity({ ...parsed, now: new Date() });
}

export async function removeAnonymousCartItem(input: unknown) {
  const parsed = parseRemoveInput(input);
  if (!parsed) return { ok: false, reason: "INVALID_INPUT" } as const;

  return (await mutationService()).removeItem({ ...parsed, now: new Date() });
}
