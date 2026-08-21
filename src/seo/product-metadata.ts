import type { Metadata } from "next";

export const PRODUCT_SOCIAL_FALLBACK_PATH =
  "/la-clothing-modern-menswear-social-card.png";

const SITE_NAME = "LA Clothing";
const SOCIAL_FALLBACK_ALT = "LA Clothing — Modern Menswear";

type ProductMetadataInput = Readonly<{
  origin: string;
  indexingEnabled: boolean;
  product: Readonly<{
    slug: string;
    name: string;
    seoTitle: string | null;
    seoDescription: string | null;
    media: Readonly<{
      primary: Readonly<{
        url: string;
        alt: string;
      }> | null;
    }>;
  }>;
}>;

export function buildStorefrontProductMetadata({
  origin,
  indexingEnabled,
  product,
}: ProductMetadataInput): Metadata {
  const title = product.seoTitle ?? product.name;
  const description =
    product.seoDescription ?? `Khám phá ${product.name} từ LA Clothing.`;
  const productUrl = new URL(`/shop/${product.slug}`, origin).href;
  const image = product.media.primary
    ? {
        url: product.media.primary.url,
        alt: product.media.primary.alt,
      }
    : {
        url: new URL(PRODUCT_SOCIAL_FALLBACK_PATH, origin).href,
        alt: SOCIAL_FALLBACK_ALT,
      };

  return {
    title,
    description,
    alternates: indexingEnabled ? { canonical: productUrl } : undefined,
    openGraph: {
      type: "website",
      locale: "vi_VN",
      siteName: SITE_NAME,
      title,
      description,
      url: productUrl,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}
