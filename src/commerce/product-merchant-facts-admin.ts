/**
 * U25 / #153 M3 — admin editing of the ADR 0007 product apparel overrides.
 *
 * The service is the authority for what may be written. It sits behind the existing admin
 * authorization boundary, re-validates every submitted field against the reviewed Merchant enums,
 * and refuses the whole submission if any part of it is unusable — a partially applied merchandising
 * decision is worse than a rejected one, because the operator would have no way to tell which half
 * took effect.
 *
 * The three controls the admin page renders are a convenience. Nothing here trusts them: the browser
 * can submit anything, and this is the code that decides what the database is allowed to hold.
 */

import { requireAdminSession } from "../auth/authorization.ts";

import {
  INVALID_APPAREL_OVERRIDE,
  parseMerchantApparelOverrides,
  type MerchantApparelOverrides,
} from "./merchant-apparel-facts.ts";

export const PRODUCT_MERCHANT_FACTS_LIMITS = {
  productId: 128,
} as const;

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

export type ProductMerchantFactsUpdateResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; reason: typeof INVALID_APPAREL_OVERRIDE | "PRODUCT_NOT_FOUND" }>;

type ProductMerchantFactsAdminDependencies = {
  productExists(productId: string): Promise<boolean>;
  saveOverrides(productId: string, overrides: MerchantApparelOverrides): Promise<void>;
};

function parseProductId(input: unknown): string | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;

  const productId = (input as Record<string, unknown>).productId;
  if (
    typeof productId !== "string"
    || productId.length === 0
    || productId.length > PRODUCT_MERCHANT_FACTS_LIMITS.productId
    || productId !== productId.trim()
  ) {
    return null;
  }
  return productId;
}

export function createProductMerchantFactsAdminService({
  productExists,
  saveOverrides,
}: ProductMerchantFactsAdminDependencies) {
  async function update(
    session: AdminSessionCandidate,
    input: unknown,
  ): Promise<ProductMerchantFactsUpdateResult> {
    requireAdminSession(session);

    const productId = parseProductId(input);
    if (productId === null) {
      return { ok: false, reason: INVALID_APPAREL_OVERRIDE } as const;
    }

    const parsed = parseMerchantApparelOverrides(input);
    if (!parsed.ok) {
      return { ok: false, reason: INVALID_APPAREL_OVERRIDE } as const;
    }

    if (!(await productExists(productId))) {
      return { ok: false, reason: "PRODUCT_NOT_FOUND" } as const;
    }

    await saveOverrides(productId, parsed.overrides);
    return { ok: true } as const;
  }

  return { update };
}
