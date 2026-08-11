import Link from "next/link";

import {
  buildStorefrontVariantOptions,
  type StorefrontVariantFacts,
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

function describePrice(variants: readonly StorefrontVariantFacts[]): string {
  const prices = buildStorefrontVariantOptions(variants)
    .filter((variant) => variant.purchasable && variant.price !== null)
    .map((variant) => variant.price as number);

  if (prices.length === 0) return "Giá đang cập nhật";
  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  return minimum === maximum ? currency.format(minimum) : `Từ ${currency.format(minimum)}`;
}

export function StorefrontProductCard({
  slug,
  name,
  editorialDescription,
  variants,
  tone,
}: StorefrontProductCardProps) {
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
        <p className="shrink-0 text-right">{describePrice(variants)}</p>
      </div>
    </article>
  );
}
