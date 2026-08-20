import { createHash } from "node:crypto";

import type { PrismaClient } from "../generated/prisma/client.ts";
import { requireAdminSession } from "../auth/authorization.ts";

export const PRODUCT_SLUG_LIMITS = {
  productId: 128,
  rawInput: 240,
  slug: 160,
} as const;

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const PRODUCT_SLUG_LOCK_NAMESPACE = 1_277_934_573;
const BOOTSTRAP_DIGEST_LENGTH = 20;

type AdminSessionCandidate =
  | {
      user: {
        id: string;
        role?: string | null;
      };
      session: {
        id: string;
      };
    }
  | null
  | undefined;

type ProductSlugChangeInput = {
  productId: string;
  slug: string;
};

type ProductSlugChangeResult =
  | {
      ok: true;
      productId: string;
      previousSlug: string;
      slug: string;
      changed: boolean;
    }
  | { ok: false; reason: "PRODUCT_NOT_FOUND" | "SLUG_UNAVAILABLE" };

type ProductSlugAdminDependencies = {
  changeSlug(input: ProductSlugChangeInput): Promise<ProductSlugChangeResult>;
};

function requireShopId(shopId: number): number {
  if (!Number.isSafeInteger(shopId) || shopId <= 0 || shopId > MAX_POSTGRES_INTEGER) {
    throw new TypeError("Product slug shop id must fit a positive PostgreSQL INTEGER");
  }
  return shopId;
}

function requirePancakeProductId(pancakeProductId: string): string {
  if (
    typeof pancakeProductId !== "string" ||
    pancakeProductId.length === 0 ||
    pancakeProductId.length > PRODUCT_SLUG_LIMITS.productId ||
    pancakeProductId !== pancakeProductId.trim()
  ) {
    throw new TypeError("Product slug Pancake product id is invalid");
  }
  return pancakeProductId;
}

export function normalizeProductSlug(value: string): string | null {
  if (typeof value !== "string") return null;

  const normalized = value
    .normalize("NFD")
    .replace(/[đĐ]/g, (character) => (character === "đ" ? "d" : "D"))
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized.length === 0) return null;

  const bounded = normalized
    .slice(0, PRODUCT_SLUG_LIMITS.slug)
    .replace(/-+$/g, "");
  return bounded.length > 0 ? bounded : null;
}

function bootstrapDigest(shopId: number, pancakeProductId: string): string {
  return createHash("sha256")
    .update(`${shopId}:${pancakeProductId}`)
    .digest("hex")
    .slice(0, BOOTSTRAP_DIGEST_LENGTH);
}

export function createBootstrapProductSlug({
  shopId,
  pancakeProductId,
  name,
}: {
  shopId: number;
  pancakeProductId: string;
  name: string;
}): string {
  const safeShopId = requireShopId(shopId);
  const safeProductId = requirePancakeProductId(pancakeProductId);
  const digest = bootstrapDigest(safeShopId, safeProductId);
  const suffix = `-${digest}`;
  const maxBaseLength = PRODUCT_SLUG_LIMITS.slug - suffix.length;
  const normalizedName = normalizeProductSlug(name) ?? "san-pham";
  const base = normalizedName.slice(0, maxBaseLength).replace(/-+$/g, "") || "san-pham";
  return `${base}${suffix}`;
}

function parseAdminInput(input: unknown): ProductSlugChangeInput | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const record = input as Record<string, unknown>;
  const productId = record.productId;
  const rawSlug = record.slug;
  if (
    typeof productId !== "string" ||
    productId.length === 0 ||
    productId.length > PRODUCT_SLUG_LIMITS.productId ||
    productId !== productId.trim() ||
    typeof rawSlug !== "string" ||
    rawSlug.length === 0 ||
    rawSlug.length > PRODUCT_SLUG_LIMITS.rawInput
  ) {
    return null;
  }

  const slug = normalizeProductSlug(rawSlug);
  if (!slug) return null;
  return { productId, slug };
}

export function createProductSlugAdminService({ changeSlug }: ProductSlugAdminDependencies) {
  async function update(session: AdminSessionCandidate, input: unknown) {
    requireAdminSession(session);

    const parsed = parseAdminInput(input);
    if (!parsed) return { ok: false, reason: "INVALID_INPUT" } as const;

    return changeSlug(parsed);
  }

  return { update };
}

export function createProductSlugRepository(client: PrismaClient) {
  async function changeSlug(input: ProductSlugChangeInput): Promise<ProductSlugChangeResult> {
    return client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PRODUCT_SLUG_LOCK_NAMESPACE}, 0)`;

      const product = await tx.productMirror.findUnique({
        where: { id: input.productId },
        select: { id: true, slug: true },
      });
      if (!product) return { ok: false, reason: "PRODUCT_NOT_FOUND" } as const;

      if (product.slug === input.slug) {
        return {
          ok: true,
          productId: product.id,
          previousSlug: product.slug,
          slug: product.slug,
          changed: false,
        } as const;
      }

      const [currentOwner, historicalOwner] = await Promise.all([
        tx.productMirror.findUnique({
          where: { slug: input.slug },
          select: { id: true },
        }),
        tx.productSlugHistory.findUnique({
          where: { slug: input.slug },
          select: { productId: true },
        }),
      ]);
      if (currentOwner || historicalOwner) {
        return { ok: false, reason: "SLUG_UNAVAILABLE" } as const;
      }

      await tx.productSlugHistory.create({
        data: {
          slug: product.slug,
          productId: product.id,
        },
      });
      await tx.productMirror.update({
        where: { id: product.id },
        data: { slug: input.slug },
      });

      return {
        ok: true,
        productId: product.id,
        previousSlug: product.slug,
        slug: input.slug,
        changed: true,
      } as const;
    });
  }

  return { changeSlug };
}
