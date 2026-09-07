import {
  describeGuestShippingPromotion,
  type GuestShippingPolicy,
} from "../commerce/guest-shipping-policy.ts";

export function buildPublicBrandFacts(policy: GuestShippingPolicy) {
  return Object.freeze({
    brandName: "LA Clothing",
    brandSummary: "Minimal, modern menswear by LA Clothing.",
    paymentMethod: "Thanh toán khi nhận hàng (COD).",
    checkoutAccount: "Không cần tài khoản để thanh toán.",
    shipping: describeGuestShippingPromotion(policy),
    orderTracking: Object.freeze({
      title: "Tra cứu đơn hàng",
      detail: "Tra cứu trạng thái đơn COD bằng mã đơn và số điện thoại đã dùng khi đặt hàng.",
    }),
    serverVerification:
      "Giá, tồn kho và phí vận chuyển được máy chủ kiểm tra lại khi bạn đặt hàng.",
  });
}

/**
 * B2 — the contact facts the repository owner approved for publication, transcribed from
 * `docs/specs/la-clothing-owner-approved-facts-and-decisions.md` §2 and nothing else.
 *
 * This is the single authority for them. The Organization entity in the site JSON-LD reads it, and
 * the evergreen Contact page will read the same constant rather than copying the values, so the
 * storefront and structured data cannot end up publishing two different phone numbers.
 *
 * What is deliberately absent matters as much as what is here:
 *
 * - **No logo.** B2 approved no brand mark. `SOCIAL_FALLBACK_PATH` is a share card, not a logo, and
 *   publishing it as one would misstate what the asset is.
 * - **No `addressCountry` or `postalCode`.** The owner approved an address *string*, not a
 *   structured postal address. Deriving a country from the city name is an inference about a legal
 *   address, and B6 leaves the registered entity and its identifiers unapproved for publication.
 * - **No Zalo URL.** The approved fact is one number reachable by phone and Zalo; a profile URL for
 *   it does not exist in any source.
 *
 * Support hours carry the approved `UTC+7` offset inside the ISO 8601 time rather than dropping it,
 * so a consumer reading `08:00` cannot resolve it against its own timezone.
 */
export const PUBLIC_CONTACT_FACTS = Object.freeze({
  telephone: "0923159666",
  email: "laclothing2025@gmail.com",
  fanpageUrl: "https://www.facebook.com/LAclothing.vn",
  streetAddress: "212 Nguyễn Trãi, Đại Mỗ",
  addressLocality: "Hà Nội",
  supportHours: Object.freeze({
    opens: "08:00:00+07:00",
    closes: "22:00:00+07:00",
  }),
});
