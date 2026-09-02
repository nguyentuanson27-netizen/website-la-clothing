import Image from "next/image";
import Link from "next/link";

import type { StorefrontProductMedia } from "@/commerce/product-media";
import {
  buildStorefrontVariantOptions,
  getStorefrontResolvedPriceRange,
  type StorefrontPricingRule,
  type StorefrontVariantFacts,
  type StorefrontVariantOption,
} from "@/commerce/storefront-product";

const currency = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

type StorefrontProductCardProps = {
  slug: string;
  name: string;
  variants: StorefrontVariantFacts[];
  tone: "stone" | "olive" | "ink" | "sand";
  media?: StorefrontProductMedia | null;
  /**
   * Supplied by the listing that produced this card, so its price matches the projection that
   * filtered and ordered it. Absent on surfaces that have not switched, which keeps the default.
   */
  pricingRule?: StorefrontPricingRule;
};

function describePrice(options: readonly StorefrontVariantOption[]): string {
  const range = getStorefrontResolvedPriceRange(options);
  if (!range) return "Giá đang cập nhật";
  return range.minimum === range.maximum
    ? currency.format(range.minimum)
    : `Từ ${currency.format(range.minimum)}`;
}

export function StorefrontProductCard({
  slug,
  name,
  variants,
  tone,
  media,
  pricingRule,
}: StorefrontProductCardProps) {
  // The rule is supplied by whoever listed these products, so the card shows the same price the
  // listing filtered and ordered by. Omitted elsewhere, which keeps the default behaviour.
  const options = buildStorefrontVariantOptions(variants, pricingRule);
  const primaryImage = media?.primary ?? null;
  const secondaryImage =
    media?.gallery && media.gallery.length > 1 && media.gallery[1]?.url !== primaryImage?.url
      ? media.gallery[1]
      : null;
  const productHref = `/shop/${encodeURIComponent(slug)}`;

  return (
    <article className="group">
      <Link
        aria-label={`Xem ${name}`}
        className="product-visual-link block"
        href={productHref}
      >
        <div
          className={`product-visual product-visual--${tone} relative aspect-[3/4] overflow-hidden`}
          aria-hidden={primaryImage ? undefined : "true"}
        >
          {primaryImage ? (
            <>
              <Image
                src={primaryImage.url}
                alt={primaryImage.alt || name}
                fill
                sizes="(min-width: 1024px) 25vw, 50vw"
                className={`object-cover transition-all duration-500 ${
                  secondaryImage
                    ? "group-hover:opacity-0 group-hover:scale-105"
                    : "group-hover:scale-105"
                }`}
              />
              {secondaryImage ? (
                <Image
                  src={secondaryImage.url}
                  alt=""
                  aria-hidden="true"
                  fill
                  sizes="(min-width: 1024px) 25vw, 50vw"
                  className="object-cover opacity-0 transition-all duration-500 group-hover:opacity-100 group-hover:scale-105"
                />
              ) : null}
            </>
          ) : (
            <span className="garment-silhouette" />
          )}
        </div>
        {/* The catalog card carries price only: the photo already identifies the garment, and
            name, editorial copy and stock state are the product page's job. The name stays in
            the document but out of sight so the heading outline, assistive tech and crawlers
            still read the card as this product. */}
        <div className="product-meta">
          <h2 className="sr-only">{name}</h2>
          <p className="product-price">{describePrice(options)}</p>
        </div>
      </Link>
    </article>
  );
}
