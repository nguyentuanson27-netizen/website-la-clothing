export type CommerceVariant = {
  id: string;
  color: string;
  size: string;
  availableQuantity: number;
  active: boolean;
};

export function findPurchasableVariant(
  variants: readonly CommerceVariant[],
  color: string,
  size: string,
): CommerceVariant | undefined {
  return variants.find(
    (variant) =>
      variant.active &&
      variant.availableQuantity > 0 &&
      variant.color === color &&
      variant.size === size,
  );
}
