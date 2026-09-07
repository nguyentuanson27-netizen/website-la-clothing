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
 * "Hằng ngày" from the approved support hours: every day carries the same window.
 *
 * Part of the fact, not a presentation detail — it lives here with the times so a consumer reading
 * `PUBLIC_CONTACT_FACTS` gets the whole approved statement rather than two thirds of it.
 */
const PUBLIC_SUPPORT_DAYS = Object.freeze([
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
]);

/**
 * B2 — the contact facts the repository owner approved for publication, transcribed from
 * `docs/specs/la-clothing-owner-approved-facts-and-decisions.md` §2 and nothing else.
 *
 * This is the single authority for them. The site footer renders them and the `Organization` entity
 * in the site JSON-LD marks the same values up, both reading this constant; the evergreen Contact
 * page will read it too. Nothing copies a literal, so the visible text and the structured data
 * cannot end up publishing two different phone numbers.
 *
 * Support hours are stored as their parts — the seven days, the local open/close times and the
 * approved `UTC+7` offset — because two consumers need two shapes of the same fact: schema.org
 * wants an ISO 8601 time carrying the offset, a reader wants a sentence. Both are derived here by
 * {@link supportHoursSchemaTime} and {@link describePublicSupportHours}, so neither can drift.
 *
 * What is deliberately absent:
 *
 * - **No logo.** B2 approved no brand mark. `SOCIAL_FALLBACK_PATH` is a share card, not a logo, and
 *   publishing it as one would misstate what the asset is.
 * - **No `addressCountry` or `postalCode`.** The owner approved an address *string*, not a
 *   structured postal address, and deriving a country from a city name is an inference.
 * - **No Zalo URL.** The approved fact is one number reachable by phone and Zalo; a profile URL for
 *   it does not exist in any source.
 *
 * `telephone` and `telephoneInternational` are the **same approved number**, written two ways. The
 * owner approved `0923159666`, a Vietnamese national form with the trunk zero; Google's Organization
 * guidance asks `contactPoint.telephone` to carry the country code. The calling code is not inferred
 * from the address — it comes from **O2**, the owner decision that the country/market is Việt Nam
 * (`+84`). No subscriber digit is added or changed: the trunk zero is replaced by the approved
 * country's calling code, and a test pins that against the repository's existing reviewed
 * `normalizeVietnamesePhone`, so the two spellings cannot drift apart or hide a typo.
 * - **No `legalName` or `taxID`.** B6 *does* approve publishing the legal entity and the confirmed
 *   MST — this is not an owner block. They are simply **outside the B2 contact contract** this
 *   constant owns; they belong to the About/legal surface U33 builds.
 */
export const PUBLIC_CONTACT_FACTS = Object.freeze({
  telephone: "0923159666",
  telephoneInternational: "+84923159666",
  email: "laclothing2025@gmail.com",
  fanpageUrl: "https://www.facebook.com/LAclothing.vn",
  streetAddress: "212 Nguyễn Trãi, Đại Mỗ",
  addressLocality: "Hà Nội",
  supportHours: Object.freeze({
    days: PUBLIC_SUPPORT_DAYS,
    opens: "08:00",
    closes: "22:00",
    utcOffset: "+07:00",
    utcOffsetLabel: "UTC+7",
  }),
});

/** The full postal address as the owner wrote it, for surfaces that show one line. */
export function describePublicAddress(): string {
  return `${PUBLIC_CONTACT_FACTS.streetAddress}, ${PUBLIC_CONTACT_FACTS.addressLocality}`;
}

/**
 * A local support time as a schema.org `Time`: ISO 8601 carrying the approved offset, so a consumer
 * reading `08:00` cannot resolve it against its own timezone.
 */
export function supportHoursSchemaTime(localTime: string): string {
  return `${localTime}:00${PUBLIC_CONTACT_FACTS.supportHours.utcOffset}`;
}

/** The same hours as a sentence a reader sees, built from the same parts the markup uses. */
export function describePublicSupportHours(): string {
  const { days, opens, closes, utcOffsetLabel } = PUBLIC_CONTACT_FACTS.supportHours;
  const cadence = days.length === 7 ? "hằng ngày" : days.join(", ");
  return `${opens} - ${closes} ${cadence} (${utcOffsetLabel})`;
}
