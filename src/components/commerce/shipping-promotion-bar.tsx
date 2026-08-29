import { connection } from "next/server";

import {
  describeGuestShippingPromotion,
  describeGuestShippingPromotionHeadline,
  readGuestShippingPolicy,
} from "@/commerce/guest-shipping-policy";

export async function ShippingPromotionBar() {
  await connection();
  const policy = readGuestShippingPolicy();

  return (
    // The landmark keeps the short, stable name; the headline is the content it introduces.
    <aside
      aria-label={describeGuestShippingPromotion(policy).title}
      className="promotion-shell"
    >
      {describeGuestShippingPromotionHeadline(policy)}
    </aside>
  );
}
