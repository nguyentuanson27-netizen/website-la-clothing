import Link from "next/link";

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
}: StorefrontProductCardProps) {
  const options = buildStorefrontVariantOptions(variants);

  return (
    <article>
      <Link
        className="product-visual-link block"
        href={`/shop/${encodeURIComponent(slug)}`}
        aria-label={`Xem ${name}`}
      >
        <div className={`product-visual product-visual--${tone}`} aria-hidden="true">
          <span className="garment-silhouette" />
        </div>
      </Link>
      <div className="product-meta">
        <div className="min-w-0">
          <h2 className="truncate uppercase tracking-[0.08em]">{name}</h2>
          {editorialDescription ? (
            <p className="mt-1 line-clamp-2 max-w-[32ch] text-black/60">{editorialDescription}</p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <p>{describePrice(options)}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.12em] text-black/50">
            {describeAvailability(options)}
          </p>
        </div>
      </div>
    </article>
  );
}
