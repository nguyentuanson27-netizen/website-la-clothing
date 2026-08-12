import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { calculateGuestShippingFeeVnd } from "@/commerce/guest-shipping-policy";
import { getCurrentStorefrontCartLines } from "@/commerce/storefront-cart-runtime";
import { GuestCheckoutForm } from "@/components/commerce/guest-checkout-form";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Guest COD checkout for LA Clothing.",
};

const currency = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

function checkoutTotals(
  lines: Awaited<ReturnType<typeof getCurrentStorefrontCartLines>>,
) {
  let subtotalVnd = 0;
  let totalQuantity = 0;

  for (const line of lines) {
    if (!line.available || line.price === null) return null;
    const lineTotal = line.price * line.quantity;
    const nextSubtotal = subtotalVnd + lineTotal;
    const nextQuantity = totalQuantity + line.quantity;
    if (
      !Number.isSafeInteger(line.price) ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity <= 0 ||
      !Number.isSafeInteger(lineTotal) ||
      !Number.isSafeInteger(nextSubtotal) ||
      !Number.isSafeInteger(nextQuantity)
    ) {
      return null;
    }
    subtotalVnd = nextSubtotal;
    totalQuantity = nextQuantity;
  }

  if (totalQuantity <= 0) return null;
  const shippingFeeVnd = calculateGuestShippingFeeVnd({
    subtotalVnd,
    totalQuantity,
  });
  const totalVnd = subtotalVnd + shippingFeeVnd;
  if (!Number.isSafeInteger(totalVnd)) return null;

  return { subtotalVnd, shippingFeeVnd, totalVnd, totalQuantity };
}

export default async function CheckoutPage() {
  await connection();
  const lines = await getCurrentStorefrontCartLines();

  if (lines.length === 0) {
    return (
      <main className="mx-auto min-h-[65vh] max-w-[1600px] px-6 py-16 md:py-24">
        <p className="eyebrow">Shopping / Checkout</p>
        <h1 className="mt-4 text-[clamp(3.5rem,10vw,9rem)] font-semibold leading-[0.86] tracking-[-0.05em]">
          CHECKOUT
        </h1>
        <div className="mt-12 border-t border-black/20 pt-8">
          <p className="font-serif text-2xl md:text-3xl">Giỏ hàng của bạn đang trống.</p>
          <Link className="text-link mt-6 inline-block" href="/shop">
            Tiếp tục mua sắm ↗
          </Link>
        </div>
      </main>
    );
  }

  const totals = checkoutTotals(lines);
  if (!totals) {
    return (
      <main className="mx-auto min-h-[65vh] max-w-[1600px] px-6 py-16 md:py-24">
        <p className="eyebrow">Shopping / Checkout</p>
        <h1 className="mt-4 text-[clamp(3.5rem,10vw,9rem)] font-semibold leading-[0.86] tracking-[-0.05em]">
          CHECKOUT
        </h1>
        <div className="mt-12 max-w-2xl border-t border-black/20 pt-8">
          <p className="font-serif text-2xl md:text-3xl">Giỏ hàng cần được kiểm tra lại.</p>
          <p className="mt-4 text-sm leading-6 text-black/60">
            Có sản phẩm, giá hoặc tồn kho chưa sẵn sàng để đặt hàng. Hãy quay lại giỏ hàng để cập nhật trước khi tiếp tục.
          </p>
          <Link className="text-link mt-6 inline-block" href="/cart">
            Quay lại giỏ hàng ↗
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-[65vh] max-w-[1600px] px-6 py-16 md:py-24">
      <p className="eyebrow">Shopping / Checkout</p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
        <h1 className="text-[clamp(3.5rem,10vw,9rem)] font-semibold leading-[0.86] tracking-[-0.05em]">
          CHECKOUT
        </h1>
        <p className="pb-2 text-xs uppercase tracking-[0.14em] text-black/55">Thanh toán khi nhận hàng</p>
      </div>

      <div className="mt-12 grid gap-12 border-t border-black/20 pt-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.42fr)] lg:gap-16">
        <GuestCheckoutForm />

        <aside className="h-fit border-t border-black pt-6 lg:sticky lg:top-24">
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em]">Đơn hàng</p>
            <Link className="text-xs font-semibold uppercase tracking-[0.1em] underline underline-offset-4" href="/cart">
              Sửa giỏ hàng
            </Link>
          </div>

          <div className="mt-6 divide-y divide-black/15 border-b border-black/15">
            {lines.map((line) => (
              <div className="flex items-start justify-between gap-5 py-4 first:pt-0" key={line.variantId}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold uppercase tracking-[0.05em]">
                    {line.productName}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-black/55">
                    {[line.color, line.size].filter(Boolean).join(" / ") || "Biến thể"} · SL {line.quantity}
                  </p>
                </div>
                <p className="shrink-0 text-sm font-medium">
                  {currency.format((line.price ?? 0) * line.quantity)}
                </p>
              </div>
            ))}
          </div>

          <dl className="mt-5 space-y-3 text-sm">
            <div className="flex justify-between gap-5">
              <dt className="text-black/60">Tạm tính</dt>
              <dd>{currency.format(totals.subtotalVnd)}</dd>
            </div>
            <div className="flex justify-between gap-5">
              <dt className="text-black/60">Phí vận chuyển</dt>
              <dd>{totals.shippingFeeVnd === 0 ? "Miễn phí" : currency.format(totals.shippingFeeVnd)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-5 border-t border-black pt-4">
              <dt className="font-semibold uppercase tracking-[0.08em]">Tổng dự kiến</dt>
              <dd className="text-xl font-semibold tracking-[-0.02em]">{currency.format(totals.totalVnd)}</dd>
            </div>
          </dl>

          <p className="mt-5 text-xs leading-5 text-black/50">
            Đây là số tiền dự kiến. Máy chủ sẽ kiểm tra lại giá, tồn kho và phí vận chuyển khi bạn đặt hàng.
          </p>
        </aside>
      </div>
    </main>
  );
}
