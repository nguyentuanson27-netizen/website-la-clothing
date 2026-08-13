import {
  describeGuestShippingPromotion,
  readGuestShippingPolicy,
} from "@/commerce/guest-shipping-policy";

export function ShippingPromotionBar() {
  const promotion = describeGuestShippingPromotion(readGuestShippingPolicy());

  return (
    <aside
      aria-label={promotion.title}
      className="border-b border-black bg-black px-4 py-2 text-center text-[0.68rem] font-semibold uppercase tracking-[0.13em] text-white"
    >
      <span>{promotion.title}</span>
      <span aria-hidden="true"> · </span>
      <span>{promotion.detail}</span>
    </aside>
  );
}
