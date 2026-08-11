"use client";

import { useMemo, useState, useTransition } from "react";

import { addStorefrontItemToBag } from "@/commerce/storefront-actions";
import { deriveStorefrontSelection } from "@/commerce/storefront-selection";
import {
  getStorefrontResolvedPriceRange,
  type StorefrontVariantOption,
} from "@/commerce/storefront-product";

const currency = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

type ProductPurchasePanelProps = {
  slug: string;
  options: StorefrontVariantOption[];
};

function defaultPriceLabel(options: readonly StorefrontVariantOption[]): string {
  const range = getStorefrontResolvedPriceRange(options);
  if (!range) return "Giá đang cập nhật";
  return range.minimum === range.maximum
    ? currency.format(range.minimum)
    : `Từ ${currency.format(range.minimum)}`;
}

export function ProductPurchasePanel({ slug, options }: ProductPurchasePanelProps) {
  const [color, setColor] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const selection = useMemo(
    () => deriveStorefrontSelection(options, { color, size }),
    [color, options, size],
  );
  const priceLabel =
    selection.selectedPrice === null
      ? defaultPriceLabel(options)
      : currency.format(selection.selectedPrice);
  const hasPurchasableVariant = options.some((option) => option.purchasable);

  function chooseColor(value: string) {
    const next = deriveStorefrontSelection(options, { color: value, size });
    const currentSize = size === null ? null : next.sizes.find((choice) => choice.value === size);
    setColor(value);
    if (currentSize?.disabled) setSize(null);
    setMessage("");
  }

  function chooseSize(value: string) {
    setSize(value);
    setMessage("");
  }

  function addToBag() {
    if (!selection.canAdd || !selection.selectedVariantId || isPending) return;

    const variantId = selection.selectedVariantId;
    setMessage("");
    startTransition(async () => {
      try {
        const result = await addStorefrontItemToBag({ slug, variantId });
        if (result.ok) {
          setMessage("Đã thêm sản phẩm vào túi.");
          return;
        }
        setMessage("Lựa chọn này vừa thay đổi hoặc không còn mua được. Vui lòng chọn lại.");
      } catch {
        setMessage("Không thể thêm vào túi lúc này. Vui lòng thử lại.");
      }
    });
  }

  return (
    <div className="border-t border-black/20 pt-6">
      <div className="flex items-baseline justify-between gap-6">
        <p className="text-xl font-medium tracking-[-0.02em]">{priceLabel}</p>
        <p className="text-xs uppercase tracking-[0.14em] text-black/55">
          {hasPurchasableVariant ? "Chọn Color × Size" : "Chưa thể mua online"}
        </p>
      </div>

      <fieldset className="mt-8">
        <legend className="text-xs font-semibold uppercase tracking-[0.14em]">Màu</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {selection.colors.map((choice) => (
            <label key={choice.value} className={choice.disabled ? "cursor-not-allowed" : "cursor-pointer"}>
              <input
                className="peer sr-only"
                type="radio"
                name="storefront-color"
                value={choice.value}
                checked={color === choice.value}
                disabled={choice.disabled || isPending}
                onChange={() => chooseColor(choice.value)}
              />
              <span className="flex min-h-11 items-center border border-black/30 px-4 text-sm transition peer-checked:border-black peer-checked:bg-black peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-black peer-disabled:cursor-not-allowed peer-disabled:opacity-35">
                {choice.value}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-7">
        <legend className="text-xs font-semibold uppercase tracking-[0.14em]">Kích cỡ</legend>
        <div className="mt-3 flex flex-wrap gap-2">
          {selection.sizes.map((choice) => (
            <label key={choice.value} className={choice.disabled ? "cursor-not-allowed" : "cursor-pointer"}>
              <input
                className="peer sr-only"
                type="radio"
                name="storefront-size"
                value={choice.value}
                checked={size === choice.value}
                disabled={choice.disabled || isPending}
                onChange={() => chooseSize(choice.value)}
              />
              <span className="flex min-h-11 min-w-12 items-center justify-center border border-black/30 px-4 text-sm transition peer-checked:border-black peer-checked:bg-black peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-black peer-disabled:cursor-not-allowed peer-disabled:opacity-35">
                {choice.value}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <button
        className="mt-8 min-h-12 w-full border border-black bg-black px-6 text-sm font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-white hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:border-black/20 disabled:bg-black/10 disabled:text-black/35"
        type="button"
        disabled={!selection.canAdd || isPending}
        onClick={addToBag}
      >
        {isPending ? "Đang thêm…" : "Add to Bag"}
      </button>

      <p className="mt-3 min-h-6 text-sm text-black/65" role="status" aria-live="polite">
        {message || (!hasPurchasableVariant ? "Không có Color × Size khả dụng ở thời điểm hiện tại." : "")}
      </p>
    </div>
  );
}
