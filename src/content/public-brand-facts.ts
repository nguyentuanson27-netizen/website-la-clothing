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

/**
 * B6/§7 — the brand positioning the owner approved for publication, as one sentence.
 *
 * The owner withheld the founding year, the founder and any brand story or values beyond this
 * sentence. It is a constant rather than page prose for exactly that reason: an About page written
 * freehand is how an invented history reaches the storefront, and a test pins this against §7 word
 * for word.
 */
export const PUBLIC_BRAND_POSITIONING =
  "LA Clothing là thương hiệu thời trang nam theo định hướng tối giản, hiện đại.";

/**
 * B6/§11 — the legal identity the owner confirmed and approved for publication.
 *
 * U32b left these out because they are not B2 contact facts and the `Organization` entity it built
 * implements the B2 contract. The About/legal surface is where they belong, and this is where a
 * later `legalName`/`taxID` mapping would read them from.
 */
export const PUBLIC_LEGAL_FACTS = Object.freeze({
  legalEntityName: "CÔNG TY TNHH QUỐC TẾ THƯƠNG MẠI LAS",
  taxCode: "0111242251",
});

const vnd = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});

/**
 * B1/§4 — the returns, exchange and refund policy the owner approved, transcribed.
 *
 * Policy is the one kind of content a coding agent must never author, so every clause a page shows
 * is a member of this constant. A page that renders `productConditions` cannot quietly grow a
 * condition the owner never wrote, and a reviewer comparing this file to §4 is comparing like with
 * like rather than reading prose for omissions.
 *
 * `nonReturnableCategories` is deliberately an empty array rather than an absent key: §4 states
 * there is **no** separate excluded-category list, which is a decision, not a gap.
 */
export const PUBLIC_RETURNS_POLICY = Object.freeze({
  windowDays: 15,
  productConditions: Object.freeze([
    "còn mới",
    "chưa qua sử dụng",
    "còn đầy đủ tem/mác",
    "không rách, bẩn, hư hỏng",
    "không có mùi lạ",
    "không có dấu hiệu đã qua sử dụng",
    "đúng sản phẩm được mua từ LA Clothing",
    "gửi lại theo hướng dẫn của bộ phận hỗ trợ",
  ]),
  supportedCases: Object.freeze([
    "Sản phẩm lỗi hoặc có vết bẩn từ phía sản xuất.",
    "LA Clothing giao sai mẫu.",
    "Giao sai màu.",
    "Giao sai size.",
    "Khách hàng chủ động đổi sang mẫu khác.",
    "Khách hàng mua đúng hàng nhưng muốn đổi size hoặc đổi màu.",
  ]),
  customerInitiatedExchangeFeeVnd: 50_000,
  nonReturnableCategories: Object.freeze([]),
  refundWorkingDays: Object.freeze({ minimum: 7, maximum: 10 }),
});

/**
 * B4/§5 — the delivery facts the owner approved. **Not** the shipping price: that stays with
 * `readGuestShippingPolicy`, which B4 keeps as the pricing authority because production may
 * legitimately override it. Duplicating a fee here is how a page starts contradicting checkout.
 *
 * The estimates are estimates. §5 says so outright — "không phải guaranteed SLA tuyệt đối" — and the
 * page has to read that way, because a delivery window presented as a promise is a policy the owner
 * did not make.
 */
export const PUBLIC_DELIVERY_FACTS = Object.freeze({
  coverage: "Giao hàng toàn quốc",
  carriers: Object.freeze(["GHN", "GHTK"]),
  estimateDays: Object.freeze({
    innerCity: Object.freeze({ minimum: 1, maximum: 3 }),
    otherProvince: Object.freeze({ minimum: 3, maximum: 15 }),
  }),
  /** §5: no carrier tracking number or link is provided to the customer by default. */
  providesCarrierTracking: false,
  /** §5: a verification call is possible but is not a required step. */
  requiresPhoneConfirmation: false,
  phoneConfirmationWording: "LA Clothing có thể liên hệ để xác minh đơn hàng khi cần.",
});

/**
 * §3 — the checkout and payment facts approved for publication.
 *
 * `acceptedMethods` holds exactly one entry on purpose. §3 forbids publishing bank transfer, card or
 * wallet as a checkout method while the website does not actually support them, so the page lists
 * what the storefront really does and nothing a buyer could try and fail to use. The refund note is
 * separate because a refund channel is not a checkout method.
 */
export const PUBLIC_PAYMENT_FACTS = Object.freeze({
  acceptedMethods: Object.freeze(["Thanh toán khi nhận hàng (COD)"]),
  accountRequired: false,
  serverVerificationNote:
    "Giá, tồn kho và phí vận chuyển có thể được máy chủ kiểm tra lại tại thời điểm đặt hàng.",
  refundNote:
    "Hoàn tiền cho đơn COD có thể thực hiện qua chuyển khoản ngân hàng hoặc phương thức phù hợp được thống nhất với khách hàng.",
});

/** The approved customer-initiated exchange fee, formatted for a reader. */
export function describePublicExchangeFee(): string {
  return `${vnd.format(PUBLIC_RETURNS_POLICY.customerInitiatedExchangeFeeVnd)} / sản phẩm`;
}

/** An approved delivery estimate as a range of days; always an estimate, never an SLA. */
export function describePublicDeliveryEstimate(
  estimate: Readonly<{ minimum: number; maximum: number }>,
): string {
  return `${estimate.minimum}–${estimate.maximum} ngày`;
}
