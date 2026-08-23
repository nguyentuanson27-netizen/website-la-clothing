import {
  buildStorefrontVariantOptions,
  type StorefrontVariantFacts,
} from "../commerce/storefront-product.ts";
import {
  buildProductStructuredData,
  type ProductStructuredDataDocument,
} from "./structured-data.ts";

type StorefrontStructuredDataProduct = Readonly<{
  slug: string;
  name: string;
  editorialDescription: string | null;
  media: Readonly<{
    gallery: readonly Readonly<{
      url: string;
      alt: string;
    }>[];
  }>;
  variants: readonly StorefrontVariantFacts[];
}>;

export function buildStorefrontProductStructuredData({
  origin,
  product,
}: Readonly<{
  origin: string;
  product: StorefrontStructuredDataProduct;
}>): ProductStructuredDataDocument {
  return buildProductStructuredData({
    origin,
    product,
    variantOptions: buildStorefrontVariantOptions(product.variants),
  });
}
