import Image from "next/image";
import Link from "next/link";

import type { StorefrontProductMedia } from "@/commerce/product-media";
import {
  buildStorefrontVariantOptions,
  getStorefrontResolvedPriceRange,
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
  editorialDescription: string | null;
  variants: StorefrontVariantFacts[];
  tone: "stone" | "olive" | "ink" | "sand";
  media?: StorefrontProductMedia | null;
};

function describePrice(options: readonly StorefrontVariantOption[]): string {
  const range = getStorefrontResolvedPriceRange(options);
  if (!range) return "Giá đang cập nhật";
  return range.minimum === range.maximum
    ? currency.format(range.minimum)
    : `Từ ${currency.format(range.minimum)}`;
}

function describeAvailability(options: readonly StorefrontVariantOption[]): string {
  if (options.some((option) => option.purchasable)) return "Có sẵn";
  if (
    options.length > 0 &&
    options.every((option) => option.unavailableReason === "OUT_OF_STOCK")
  ) {
    return "Tạm hết hàng";
  }
  return "Chưa thể mua online";
}

export function StorefrontProductCard({
  slug,
  name,
  editorialDescription,
  variants,
  tone,
  media,
}: StorefrontProductCardProps) {
  const options = buildStorefrontVariantOptions(variants);
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
        <div className="product-meta">
          <div className="min-w-0">
            <h2 className="truncate uppercase tracking-[0.08em]">{name}</h2>
            {editorialDescription ? (
              <p className="mt-1 line-clamp-2 max-w-[32ch] text-black/60">{editorialDescription}</p>
            ) : null}
          </div>
          <div className="shrink-0 text-right">
            <p>{describePrice(options)}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.12em] text-black/60">
              {describeAvailability(options)}
            </p>
          </div>
        </div>
      </Link>
    </article>
  );
}
