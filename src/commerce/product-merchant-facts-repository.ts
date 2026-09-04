/**
 * U25 / #153 M3 — persistence for the ADR 0007 website-owned apparel overrides.
 *
 * `ProductMerchantFacts` is a website table. Pancake catalog sync writes `ProductMirror` and
 * `VariantMirror` and never touches this one, which is exactly why a resync cannot erase a
 * merchandising decision — there is no code path from the sync into these columns.
 *
 * Clearing every override deletes the row instead of storing three nulls. Both spellings mean
 * inheritance to `resolveEffectiveApparelFacts`, but deleting keeps the table describing only the
 * products that actually carry a decision, and it makes "no override" a single state rather than
 * two that a later reader could accidentally distinguish.
 */

import type { PrismaClient } from "../generated/prisma/client.ts";

import {
  toMerchantApparelWireValues,
  toPersistedMerchantApparelNames,
  type MerchantApparelOverrides,
} from "./merchant-apparel-facts.ts";

/** What the mapper consumes: wire values, or `null` for inherit. Never trusted without validation. */
export type PersistedApparelOverrides = Readonly<{
  gender: string | null;
  ageGroup: string | null;
  condition: string | null;
}>;

export const INHERITED_APPAREL_OVERRIDES: PersistedApparelOverrides = Object.freeze({
  gender: null,
  ageGroup: null,
  condition: null,
});

export function createProductMerchantFactsRepository(client: PrismaClient) {
  async function productExists(productId: string): Promise<boolean> {
    return (
      (await client.productMirror.findUnique({
        where: { id: productId },
        select: { id: true },
      })) !== null
    );
  }

  async function readOverrides(productId: string): Promise<PersistedApparelOverrides> {
    const row = await client.productMerchantFacts.findUnique({
      where: { productId },
      select: { gender: true, ageGroup: true, condition: true },
    });

    if (row === null) return INHERITED_APPAREL_OVERRIDES;
    return toMerchantApparelWireValues(row);
  }

  async function saveOverrides(
    productId: string,
    overrides: MerchantApparelOverrides,
  ): Promise<void> {
    const persisted = toPersistedMerchantApparelNames(overrides);

    if (persisted.gender === null && persisted.ageGroup === null && persisted.condition === null) {
      await client.productMerchantFacts.deleteMany({ where: { productId } });
      return;
    }

    const values = {
      gender: persisted.gender as never,
      ageGroup: persisted.ageGroup as never,
      condition: persisted.condition as never,
    };

    await client.productMerchantFacts.upsert({
      where: { productId },
      create: { productId, ...values },
      update: values,
      select: { productId: true },
    });
  }

  return { productExists, readOverrides, saveOverrides };
}
