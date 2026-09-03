"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { addStorefrontItemToBag } from "@/commerce/storefront-actions";
import { trackFacebookPixelEvent } from "@/components/analytics/facebook-pixel-client";
import {
  deriveStorefrontProjectionSelection,
  type StorefrontProjectionOption,
} from "@/commerce/storefront-projection";
import { getStorefrontResolvedPriceRange } from "@/commerce/storefront-product";
import type { DeepLinkedVariantSelection } from "@/commerce/storefront-variant-deep-link";

const currency = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

type ProductPurchasePanelProps = {
  slug: string;
  productName: string;
  options: StorefrontProjectionOption[];
  initialSelection?: DeepLinkedVariantSelection | null;
};

function defaultPriceLabel(options: readonly StorefrontProjectionOption[]): string {
  const range = getStorefrontResolvedPriceRange(options);
  if (!range) return "Giá đang cập nhật";
  return range.minimum === range.maximum
    ? currency.format(range.minimum)
    : `Từ ${currency.format(range.minimum)}`;
}

export function ProductPurchasePanel({
  slug,
  productName,
  options,
  initialSelection = null,
}: ProductPurchasePanelProps) {
  const [kindKey, setKindKey] = useState<string | null>(initialSelection?.kindKey ?? null);
  const [color, setColor] = useState<string | null>(initialSelection?.color ?? null);
  const [size, setSize] = useState<string | null>(initialSelection?.size ?? null);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const selection = useMemo(
    () => deriveStorefrontProjectionSelection(options, { kindKey, color, size }),
    [color, kindKey, options, size],
  );
  const priceLabel =
    selection.selectedPrice === null
      ? defaultPriceLabel(options)
      : currency.format(selection.selectedPrice);
  const showsDiscount =
    selection.selectedIsDiscounted
    && selection.selectedPrice !== null
    && selection.selectedBasePriceVnd !== null
    && selection.selectedBasePriceVnd > selection.selectedPrice;
  const hasPurchasableVariant = options.some((option) => option.purchasable);
  const selectedUnavailableMessage =
    selection.selectedVariantId !== null && !selection.canAdd
      ? selection.selectedUnavailableReason === "OUT_OF_STOCK"
        ? "Lựa chọn này đã hết hàng."
        : "Lựa chọn này hiện chưa mua được."
      : "";
  const entryPrice = useMemo(() => getStorefrontResolvedPriceRange(options)?.minimum ?? null, [options]);

  useEffect(() => {
    trackFacebookPixelEvent("ViewContent", {
      content_ids: [slug],
      content_name: productName,
      content_type: "product",
      currency: "VND",
      ...(entryPrice === null ? {} : { value: entryPrice }),
    });
  }, [entryPrice, productName, slug]);

  function chooseKind(value: string) {
    setKindKey(value);
    setSize(null);
    setColor(null);
    setMessage("");
  }

  function chooseColor(value: string) {
    setColor(value);
    setMessage("");
  }

  function chooseSize(value: string) {
    const next = deriveStorefrontProjectionSelection(options, { kindKey, color, size: value });
    const currentColor = color === null ? null : next.colors.find((choice) => choice.value === color);
    setSize(value);
    if (currentColor?.disabled) setColor(null);
    setMessage("");
  }

  function addToBag() {
    if (!selection.canAdd || !selection.selectedVariantId || isPending) return;
    const variantId = selection.selectedVariantId;
    const addedPrice = selection.selectedPrice;
    setMessage("");
    startTransition(async () => {
      try {
        const result = await addStorefrontItemToBag({ slug, variantId });
        if (result.ok) {
          setMessage("Đã thêm sản phẩm vào giỏ hàng.");
          trackFacebookPixelEvent("AddToCart", {
            content_ids: [slug],
            content_name: productName,
            content_type: "product",
            currency: "VND",
            ...(addedPrice === null ? {} : { value: addedPrice }),
          });
          return;
        }
        setMessage("Lựa chọn này vừa thay đổi hoặc không còn mua được. Vui lòng chọn lại.");
      } catch {
        setMessage("Không thể thêm vào giỏ hàng lúc này. Vui lòng thử lại.");
      }
    });
  }

  const kindFieldset = selection.hasKindOptions ? (
    <fieldset className="mt-8">
      <legend className="text-xs font-semibold uppercase tracking-[0.14em]">Loại</legend>
      <div className="mt-3 flex flex-wrap gap-2">
        {selection.kinds.map((choice) => (
          <label key={choice.key} className={choice.disabled ? "cursor-not-allowed" : "cursor-pointer"}>
            <input className="peer sr-only" type="radio" name="storefront-kind" value={choice.key} checked={kindKey === choice.key} disabled={choice.disabled || isPending} onChange={() => chooseKind(choice.key)} />
            <span className="flex min-h-11 items-center border border-black/30 px-4 text-sm transition peer-checked:border-black peer-checked:bg-black peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-black peer-disabled:cursor-not-allowed peer-disabled:opacity-35">{choice.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  ) : null;

  const colorFieldset = selection.hasColorOptions ? (
    <fieldset className="mt-7">
      <legend className="text-xs font-semibold uppercase tracking-[0.14em]">Màu</legend>
      <div className="mt-3 flex flex-wrap gap-2">
        {selection.colors.map((choice) => (
          <label key={choice.value} className={choice.disabled ? "cursor-not-allowed" : "cursor-pointer"}>
            <input className="peer sr-only" type="radio" name="storefront-color" value={choice.value} checked={color === choice.value} disabled={choice.disabled || isPending} onChange={() => chooseColor(choice.value)} />
            <span className="flex min-h-11 items-center border border-black/30 px-4 text-sm transition peer-checked:border-black peer-checked:bg-black peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-black peer-disabled:cursor-not-allowed peer-disabled:opacity-35">{choice.value}</span>
          </label>
        ))}
      </div>
    </fieldset>
  ) : null;

  const sizeFieldset = (
    <fieldset className={selection.hasKindOptions ? "mt-7" : selection.hasColorOptions ? "mt-7" : "mt-8"}>
      <legend className="text-xs font-semibold uppercase tracking-[0.14em]">Kích cỡ</legend>
      <div className="mt-3 flex flex-wrap gap-2">
        {selection.sizes.map((choice) => (
          <label key={choice.value} className={choice.disabled ? "cursor-not-allowed" : "cursor-pointer"}>
            <input className="peer sr-only" type="radio" name="storefront-size" value={choice.value} checked={size === choice.value} disabled={choice.disabled || isPending} onChange={() => chooseSize(choice.value)} />
            <span className="flex min-h-11 min-w-12 items-center justify-center border border-black/30 px-4 text-sm transition peer-checked:border-black peer-checked:bg-black peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-black peer-disabled:cursor-not-allowed peer-disabled:opacity-35">{choice.value}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <div className="border-t border-black/20 pt-6">
      <div className="flex items-baseline justify-between gap-6">
        <p className="text-xl font-medium tracking-[-0.02em]">
          {showsDiscount ? (
            <>
              <span className="sr-only">Giá gốc </span>
              <span className="mr-2 align-baseline text-base font-normal text-black/45 line-through">
                {currency.format(selection.selectedBasePriceVnd as number)}
              </span>
              <span className="sr-only">Giá khuyến mãi </span>
              <span>{priceLabel}</span>
            </>
          ) : priceLabel}
        </p>
        <p className="text-xs uppercase tracking-[0.14em] text-black/55">
          {hasPurchasableVariant
            ? selection.hasKindOptions
              ? selection.hasColorOptions ? "Chọn loại × kích cỡ × màu" : "Chọn loại × kích cỡ"
              : selection.hasColorOptions ? "Chọn màu × kích cỡ" : "Chọn kích cỡ"
            : "Chưa thể mua online"}
        </p>
      </div>

      {selection.hasKindOptions ? <>{kindFieldset}{sizeFieldset}{colorFieldset}</> : <>{colorFieldset}{sizeFieldset}</>}

      <button
        className="mt-8 min-h-12 w-full border border-black bg-black px-6 text-sm font-semibold uppercase tracking-[0.12em] text-white hover:bg-white hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:border-black/20 disabled:bg-black/10 disabled:text-black/35"
        type="button"
        disabled={!selection.canAdd || isPending}
        onClick={addToBag}
      >
        {isPending ? "Đang thêm…" : "Thêm vào giỏ hàng"}
      </button>

      <p className="mt-3 min-h-6 text-sm text-black/65" role="status" aria-live="polite">
        {message || selectedUnavailableMessage || (!hasPurchasableVariant ? "Không có lựa chọn khả dụng ở thời điểm hiện tại." : "")}
      </p>
    </div>
  );
}
