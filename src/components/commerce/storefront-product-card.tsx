import Image from "next/image";

import { ProductSelectLink } from "@/components/analytics/product-select-link";
import type { StorefrontProductMedia } from "@/commerce/product-media";
import { resolveStorefrontDiscountPresentation } from "@/commerce/storefront-discount-presentation";
import type { TrackingEvent } from "@/tracking/commerce-events";
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

export type StorefrontFlashSalePresentation = Readonly<{
  representativeVariantId: string;
  basePriceVnd: number;
  effectivePriceVnd: number;
  hasCheaperCurrentVariant: boolean;
  /** Server-relative remaining duration. No browser wall-clock deadline is exposed. */
  remainingMs: number;
}>;

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
  /** Exact Flash representative selected server-side from purchasable active Flash variants. */
  flashSale?: StorefrontFlashSalePresentation;
  /**
   * The prebuilt product-level `select_item` for this card, or absent where the deployment
   * publishes no commerce events. Built on the server so a click handler never has to read an
   * identity or a price back out of the rendered card.
   */
  selectEvent?: TrackingEvent | null;
};

function describePrice(options: readonly StorefrontVariantOption[]): string {
  const range = getStorefrontResolvedPriceRange(options);
  if (!range) return "Giá đang cập nhật";
  return range.minimum === range.maximum
    ? currency.format(range.minimum)
    : `Từ ${currency.format(range.minimum)}`;
}

function describePromotionalPrice({
  effectivePriceVnd,
  hasCheaperCurrentVariant,
}: Readonly<{ effectivePriceVnd: number; hasCheaperCurrentVariant: boolean }>): string {
  return hasCheaperCurrentVariant
    ? `Sale từ ${currency.format(effectivePriceVnd)}`
    : currency.format(effectivePriceVnd);
}

function describeFlashCountdown(remainingMs: number): string | null {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
  const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `Còn ${days} ngày ${hours} giờ` : `Còn ${days} ngày`;
  }
  if (hours > 0) return `Còn ${hours} giờ ${minutes} phút`;
  return `Còn ${minutes} phút`;
}

export function StorefrontProductCard({
  slug,
  name,
  variants,
  tone,
  media,
  pricingRule,
  flashSale,
  selectEvent = null,
}: StorefrontProductCardProps) {
  // Flash cards receive the exact representative selected before pagination. Other listings keep
  // their existing option-range path and can still inject a promotion-aware pricing rule.
  const options = flashSale ? null : buildStorefrontVariantOptions(variants, pricingRule);
  const promotionSale = options ? resolveStorefrontDiscountPresentation(options) : null;
  const countdown = flashSale ? describeFlashCountdown(flashSale.remainingMs) : null;
  const primaryImage = media?.primary ?? null;
  const secondaryImage =
    media?.gallery && media.gallery.length > 1 && media.gallery[1]?.url !== primaryImage?.url
      ? media.gallery[1]
      : null;
  const productHref = `/shop/${encodeURIComponent(slug)}`;

  const flashSaleDiscountPercent =
    flashSale && flashSale.basePriceVnd > flashSale.effectivePriceVnd
      ? Math.round((1 - flashSale.effectivePriceVnd / flashSale.basePriceVnd) * 100)
      : 0;
  const discountPercent = flashSale
    ? flashSaleDiscountPercent
    : promotionSale?.discountPercent ?? 0;

  return (
    <article className="group">
      <ProductSelectLink
        ariaLabel={`Xem ${name}`}
        className="product-visual-link block"
        href={productHref}
        event={selectEvent}
      >
        <div
          className={`product-visual product-visual--${tone} relative aspect-[3/4] overflow-hidden`}
          aria-hidden={primaryImage ? undefined : "true"}
        >
          {discountPercent > 0 ? (
            <span className="product-badge product-badge--sale z-10">
              -{discountPercent}%
            </span>
          ) : null}
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
          {flashSale ? (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em]">
                <span className="bg-black px-2 py-1 text-white">FLASH SALE</span>
                {countdown ? <span className="text-black/70">{countdown}</span> : null}
              </div>
              <p className="product-price mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="sr-only">Giá gốc</span>
                <del className="text-black/60 line-through">{currency.format(flashSale.basePriceVnd)}</del>
                <span className="sr-only">Giá Flash Sale</span>
                <strong className="font-semibold text-black">{describePromotionalPrice(flashSale)}</strong>
              </p>
            </>
          ) : promotionSale ? (
            <p className="product-price flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="sr-only">Giá gốc</span>
              <del className="font-normal text-black/50 line-through">
                {currency.format(promotionSale.basePriceVnd)}
              </del>
              <span className="sr-only">Giá khuyến mãi</span>
              <strong className="font-semibold text-black">
                {describePromotionalPrice(promotionSale)}
              </strong>
            </p>
          ) : (
            <p className="product-price">{describePrice(options ?? [])}</p>
          )}
        </div>
      </ProductSelectLink>
    </article>
  );
}
