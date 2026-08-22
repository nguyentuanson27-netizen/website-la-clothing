import {
  describeGuestShippingPromotion,
  type GuestShippingPolicy,
} from "../commerce/guest-shipping-policy.ts";

export function buildPublicBrandFacts(policy: GuestShippingPolicy) {
  return Object.freeze({
    brandName: "LA Clothing",
    brandSummary: "Modern menswear for everyday movement.",
    paymentMethod: "Thanh toán khi nhận hàng (COD).",
    checkoutAccount: "Không cần tài khoản để thanh toán.",
    shipping: describeGuestShippingPromotion(policy),
    serverVerification:
      "Giá, tồn kho và phí vận chuyển được máy chủ kiểm tra lại khi bạn đặt hàng.",
  });
}
