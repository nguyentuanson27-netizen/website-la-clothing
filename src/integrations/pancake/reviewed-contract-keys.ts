export const REVIEWED_PANCAKE_CONTRACT_KEYS = {
  productVariations: [] as readonly string[],
  warehouses: [] as readonly string[],
} as const;

export function assertReviewedPancakeContractKeysConfigured(): void {
  if (
    REVIEWED_PANCAKE_CONTRACT_KEYS.productVariations.length === 0 ||
    REVIEWED_PANCAKE_CONTRACT_KEYS.warehouses.length === 0
  ) {
    throw new Error("Reviewed Pancake contract field allowlists are not configured");
  }
}
