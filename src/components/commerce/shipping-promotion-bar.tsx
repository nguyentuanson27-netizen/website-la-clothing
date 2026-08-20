import { connection } from "next/server";

import {
  describeGuestShippingPromotion,
  readGuestShippingPolicy,
} from "@/commerce/guest-shipping-policy";

export async function ShippingPromotionBar() {
  await connection();
  const promotion = describeGuestShippingPromotion(readGuestShippingPolicy());

  return (
    <aside aria-label={promotion.title} className="promotion-shell">
      <span>{promotion.title}</span>
      <span aria-hidden="true"> · </span>
      <span>{promotion.detail}</span>
    </aside>
  );
}
