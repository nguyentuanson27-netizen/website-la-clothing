"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  removeStorefrontCartLine,
  updateStorefrontCartLine,
} from "@/commerce/storefront-cart-actions";

const MAX_POSTGRES_INTEGER = 2_147_483_647;

type CartLineControlsProps = {
  variantId: string;
  initialQuantity: number;
  available: boolean;
};

export function CartLineControls({
  variantId,
  initialQuantity,
  available,
}: CartLineControlsProps) {
  const inputId = useId();
  const router = useRouter();
  const [quantity, setQuantity] = useState(String(initialQuantity));
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const parsedQuantity = Number(quantity);
  const quantityValid =
    Number.isSafeInteger(parsedQuantity) &&
    parsedQuantity > 0 &&
    parsedQuantity <= MAX_POSTGRES_INTEGER;

  function updateLine() {
    if (!available || !quantityValid || isPending) return;
    setMessage("");

    startTransition(async () => {
      try {
        const result = await updateStorefrontCartLine({
          variantId,
          quantity: parsedQuantity,
        });
        if (result.ok) {
          setMessage("Đã cập nhật số lượng.");
          router.refresh();
          return;
        }
        setMessage(
          result.reason === "LINE_UNAVAILABLE"
            ? "Sản phẩm vừa thay đổi và không còn cập nhật được."
            : "Không thể cập nhật số lượng lúc này.",
        );
        router.refresh();
      } catch {
        setMessage("Không thể cập nhật số lượng lúc này.");
      }
    });
  }

  function removeLine() {
    if (isPending) return;
    setMessage("");

    startTransition(async () => {
      try {
        const result = await removeStorefrontCartLine({ variantId });
        if (result.ok) {
          router.refresh();
          return;
        }
        setMessage("Không thể xóa sản phẩm lúc này.");
        router.refresh();
      } catch {
        setMessage("Không thể xóa sản phẩm lúc này.");
      }
    });
  }

  return (
    <div className="mt-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-2" htmlFor={inputId}>
          <span className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-black/55">
            Số lượng
          </span>
          <input
            id={inputId}
            className="h-11 w-24 border border-black/30 bg-transparent px-3 text-sm outline-none focus-visible:border-black focus-visible:ring-1 focus-visible:ring-black disabled:cursor-not-allowed disabled:opacity-45"
            type="number"
            min={1}
            max={MAX_POSTGRES_INTEGER}
            step={1}
            inputMode="numeric"
            value={quantity}
            disabled={!available || isPending}
            onChange={(event) => {
              setQuantity(event.target.value);
              setMessage("");
            }}
          />
        </label>
        <button
          className="min-h-11 border border-black bg-black px-5 text-xs font-semibold uppercase tracking-[0.12em] text-white transition hover:bg-white hover:text-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:border-black/20 disabled:bg-black/10 disabled:text-black/35"
          type="button"
          disabled={!available || !quantityValid || isPending}
          onClick={updateLine}
        >
          {isPending ? "Đang xử lý…" : "Cập nhật"}
        </button>
        <button
          className="min-h-11 px-2 text-xs font-semibold uppercase tracking-[0.12em] underline decoration-black/30 underline-offset-4 transition hover:decoration-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:cursor-not-allowed disabled:opacity-40"
          type="button"
          disabled={isPending}
          onClick={removeLine}
        >
          Xóa
        </button>
      </div>
      <p className="mt-2 min-h-5 text-sm text-black/60" role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
