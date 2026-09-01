import { createHash } from "node:crypto";

export type CatalogIdSnapshot = Readonly<{
  runIndex: number;
  timestamp: string;
  shopId: number;
  productExternalIds: readonly string[];
  variationExternalIds: readonly string[];
  productExternalIdsHash: string;
  variationExternalIdsHash: string;
  internalVariantIdMap?: Readonly<Record<string, string>>;
}>;

export type DurabilityComparisonResult = Readonly<{
  runsAudited: number;
  totalProductsPerRun: readonly number[];
  totalVariationsPerRun: readonly number[];
  disappearedProductIds: readonly string[];
  appearedProductIds: readonly string[];
  disappearedVariationIds: readonly string[];
  appearedVariationIds: readonly string[];
  stableProductIds: number;
  stableVariationIds: number;
  productStabilityPercent: number;
  variationStabilityPercent: number;
  duplicateProductIds: readonly string[];
  duplicateVariationIds: readonly string[];
  internalRowIdPreservedCount: number;
  internalRowIdReplacedCount: number;
  isDurable: boolean;
}>;

function hashIdList(ids: readonly string[]): string {
  return createHash("sha256").update(ids.join("\n")).digest("hex");
}

function findDuplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates].sort();
}

export function createCatalogIdSnapshot({
  runIndex,
  timestamp,
  shopId,
  productExternalIds,
  variationExternalIds,
  internalVariantIdMap,
}: {
  runIndex: number;
  timestamp: string;
  shopId: number;
  productExternalIds: readonly string[];
  variationExternalIds: readonly string[];
  internalVariantIdMap?: Readonly<Record<string, string>>;
}): CatalogIdSnapshot {
  if (!Number.isSafeInteger(runIndex) || runIndex < 0) {
    throw new TypeError("Catalog snapshot runIndex must be a non-negative integer");
  }
  if (!Number.isSafeInteger(shopId) || shopId <= 0) {
    throw new TypeError("Catalog snapshot shopId must be a positive safe integer");
  }
  if (typeof timestamp !== "string" || timestamp.length === 0) {
    throw new TypeError("Catalog snapshot timestamp must be a non-empty string");
  }

  const sortedProductIds = [...productExternalIds].sort();
  const sortedVariationIds = [...variationExternalIds].sort();

  return Object.freeze({
    runIndex,
    timestamp,
    shopId,
    productExternalIds: Object.freeze(sortedProductIds),
    variationExternalIds: Object.freeze(sortedVariationIds),
    productExternalIdsHash: hashIdList(sortedProductIds),
    variationExternalIdsHash: hashIdList(sortedVariationIds),
    internalVariantIdMap: internalVariantIdMap ? Object.freeze({ ...internalVariantIdMap }) : undefined,
  });
}

export function compareCatalogSnapshots(
  snapshots: readonly CatalogIdSnapshot[],
): DurabilityComparisonResult {
  if (snapshots.length < 2) {
    throw new Error("Durability comparison requires at least two independent snapshots");
  }

  const baseSnapshot = snapshots[0]!;
  const shopId = baseSnapshot.shopId;

  for (let i = 1; i < snapshots.length; i += 1) {
    if (snapshots[i]!.shopId !== shopId) {
      throw new Error("Durability comparison snapshots must share the same shop scope");
    }
  }

  const baseProductSet = new Set(baseSnapshot.productExternalIds);
  const baseVariationSet = new Set(baseSnapshot.variationExternalIds);

  const disappearedProductIds = new Set<string>();
  const appearedProductIds = new Set<string>();
  const disappearedVariationIds = new Set<string>();
  const appearedVariationIds = new Set<string>();

  const allDuplicateProductIds = new Set<string>();
  const allDuplicateVariationIds = new Set<string>();

  let internalRowIdPreserved = 0;
  let internalRowIdReplaced = 0;

  for (const snapshot of snapshots) {
    for (const dup of findDuplicates(snapshot.productExternalIds)) {
      allDuplicateProductIds.add(dup);
    }
    for (const dup of findDuplicates(snapshot.variationExternalIds)) {
      allDuplicateVariationIds.add(dup);
    }
  }

  for (let i = 1; i < snapshots.length; i += 1) {
    const current = snapshots[i]!;
    const currentProductSet = new Set(current.productExternalIds);
    const currentVariationSet = new Set(current.variationExternalIds);

    for (const id of baseProductSet) {
      if (!currentProductSet.has(id)) disappearedProductIds.add(id);
    }
    for (const id of currentProductSet) {
      if (!baseProductSet.has(id)) appearedProductIds.add(id);
    }

    for (const id of baseVariationSet) {
      if (!currentVariationSet.has(id)) disappearedVariationIds.add(id);
    }
    for (const id of currentVariationSet) {
      if (!baseVariationSet.has(id)) appearedVariationIds.add(id);
    }

    if (baseSnapshot.internalVariantIdMap && current.internalVariantIdMap) {
      for (const [varId, internalId] of Object.entries(baseSnapshot.internalVariantIdMap)) {
        const currentInternalId = current.internalVariantIdMap[varId];
        if (currentInternalId !== undefined) {
          if (currentInternalId === internalId) {
            internalRowIdPreserved += 1;
          } else {
            internalRowIdReplaced += 1;
          }
        }
      }
    }
  }

  const stableProducts = baseProductSet.size - disappearedProductIds.size;
  const stableVariations = baseVariationSet.size - disappearedVariationIds.size;

  const productStabilityPercent = baseProductSet.size === 0
    ? 0
    : Math.round((stableProducts / baseProductSet.size) * 10_000) / 100;
  const variationStabilityPercent = baseVariationSet.size === 0
    ? 0
    : Math.round((stableVariations / baseVariationSet.size) * 10_000) / 100;

  const isDurable =
    disappearedProductIds.size === 0 &&
    appearedProductIds.size === 0 &&
    disappearedVariationIds.size === 0 &&
    appearedVariationIds.size === 0 &&
    allDuplicateProductIds.size === 0 &&
    allDuplicateVariationIds.size === 0 &&
    internalRowIdReplaced === 0 &&
    baseSnapshot.variationExternalIds.length > 0;

  return Object.freeze({
    runsAudited: snapshots.length,
    totalProductsPerRun: Object.freeze(snapshots.map((s) => s.productExternalIds.length)),
    totalVariationsPerRun: Object.freeze(snapshots.map((s) => s.variationExternalIds.length)),
    disappearedProductIds: Object.freeze([...disappearedProductIds].sort()),
    appearedProductIds: Object.freeze([...appearedProductIds].sort()),
    disappearedVariationIds: Object.freeze([...disappearedVariationIds].sort()),
    appearedVariationIds: Object.freeze([...appearedVariationIds].sort()),
    stableProductIds: stableProducts,
    stableVariationIds: stableVariations,
    productStabilityPercent,
    variationStabilityPercent,
    duplicateProductIds: Object.freeze([...allDuplicateProductIds].sort()),
    duplicateVariationIds: Object.freeze([...allDuplicateVariationIds].sort()),
    internalRowIdPreservedCount: internalRowIdPreserved,
    internalRowIdReplacedCount: internalRowIdReplaced,
    isDurable,
  });
}
