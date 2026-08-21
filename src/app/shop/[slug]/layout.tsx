import type { Metadata } from "next";
import { connection } from "next/server";

import { getConfiguredStorefrontProductBySlug } from "@/commerce/storefront-catalog-runtime";
import { buildStorefrontProductMetadata } from "@/seo/product-metadata";
import { readSearchExposure } from "@/seo/search-exposure";

type ProductLayoutProps = Readonly<{
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}>;

export async function generateMetadata({
  params,
}: Omit<ProductLayoutProps, "children">): Promise<Metadata> {
  await connection();
  const { slug } = await params;

  let product: Awaited<ReturnType<typeof getConfiguredStorefrontProductBySlug>>;
  try {
    product = await getConfiguredStorefrontProductBySlug(slug);
  } catch (error) {
    if (error instanceof RangeError) return {};
    throw error;
  }

  if (!product) return {};

  const exposure = readSearchExposure();
  return buildStorefrontProductMetadata({
    origin: exposure.origin,
    indexingEnabled: exposure.indexingEnabled,
    product,
  });
}

export default function ProductLayout({ children }: ProductLayoutProps) {
  return children;
}
