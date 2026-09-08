import type { Metadata } from "next";
import Link from "next/link";

import {
  describeGuestShippingPromotion,
  readGuestShippingPolicy,
} from "@/commerce/guest-shipping-policy";
import {
  describePublicDeliveryEstimate,
  PUBLIC_DELIVERY_FACTS,
  PUBLIC_PAYMENT_FACTS,
} from "@/content/public-brand-facts";
import { readSearchExposure } from "@/seo/search-exposure";
import { buildStaticPageMetadata } from "@/seo/static-page-metadata";

type ShippingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ searchParams }: ShippingPageProps): Promise<Metadata> {
  const exposure = readSearchExposure();
  return buildStaticPageMetadata({
    origin: exposure.origin,
    indexingEnabled: exposure.indexingEnabled,
    pathname: "/shipping",
    searchParams: await searchParams,
    title: "Chính sách vận chuyển và thanh toán",
    description:
      "Phạm vi giao hàng, đơn vị vận chuyển, thời gian dự kiến và phương thức thanh toán của LA Clothing.",
  });
}

/**
 * W13/U33b — the Shipping & Payment page.
 *
 * Two authorities, deliberately kept apart. The **delivery** facts — coverage, carriers, estimates,
 * tracking and the verification call — come from `PUBLIC_DELIVERY_FACTS`, the transcription of §5.
 * The **shipping price** comes from `readGuestShippingPolicy`, which B4 keeps as the pricing
 * authority because production may legitimately override it: a fee copied into the content module
 * would let this page contradict what checkout actually charges.
 *
 * The delivery windows are printed as estimates because §5 says they are estimates and not a
 * guaranteed SLA. The page also states plainly that no carrier tracking is provided by default,
 * rather than staying silent and letting a buyer assume it exists.
 */
export default function ShippingPage() {
  const policy = readGuestShippingPolicy();
  const promotion = describeGuestShippingPromotion(policy);
  const { coverage, carriers, estimateDays, phoneConfirmationWording } = PUBLIC_DELIVERY_FACTS;

  return (
    <div className="mx-auto min-h-[65vh] max-w-[1600px] px-6 py-16 md:py-24">
      <p className="eyebrow">Chính sách</p>
      <h1 className="mt-3 max-w-4xl font-serif text-5xl leading-[0.95] tracking-[-0.05em] md:text-7xl">
        Vận chuyển &amp; thanh toán
      </h1>
      <p className="mt-6 max-w-2xl text-lg leading-8">{coverage}.</p>

      <div className="mt-16 grid max-w-4xl gap-14">
        <section aria-labelledby="delivery-heading">
          <h2 id="delivery-heading" className="font-serif text-3xl tracking-[-0.03em]">
            Giao hàng
          </h2>
          <dl className="mt-6 grid max-w-2xl gap-6 text-base leading-7">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.13em]">
                Đơn vị vận chuyển
              </dt>
              <dd className="mt-2 text-black/70">{carriers.join(" · ")}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.13em]">Nội thành</dt>
              <dd className="mt-2 text-black/70">
                {describePublicDeliveryEstimate(estimateDays.innerCity)} (dự kiến)
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.13em]">Ngoại tỉnh</dt>
              <dd className="mt-2 text-black/70">
                {describePublicDeliveryEstimate(estimateDays.otherProvince)} (dự kiến)
              </dd>
            </div>
          </dl>
          <p className="mt-6 max-w-2xl text-base leading-7 text-black/70">
            Đây là thời gian dự kiến, không phải cam kết thời hạn tuyệt đối.
          </p>
        </section>

        <section aria-labelledby="fee-heading">
          <h2 id="fee-heading" className="font-serif text-3xl tracking-[-0.03em]">
            Phí vận chuyển
          </h2>
          <p className="mt-6 max-w-2xl text-base leading-7 text-black/70">
            {promotion.title}: {promotion.detail} Phí vận chuyển và điều kiện miễn phí được máy chủ
            áp dụng tại thời điểm đặt hàng.
          </p>
        </section>

        <section aria-labelledby="tracking-heading">
          <h2 id="tracking-heading" className="font-serif text-3xl tracking-[-0.03em]">
            Theo dõi đơn hàng
          </h2>
          <p className="mt-6 max-w-2xl text-base leading-7 text-black/70">
            LA Clothing không cung cấp mã vận đơn hoặc link theo dõi của đơn vị vận chuyển theo mặc
            định. Bạn có thể{" "}
            <Link
              className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
              href="/track-order"
            >
              tra cứu trạng thái đơn hàng
            </Link>{" "}
            bằng mã đơn và số điện thoại đã dùng khi đặt. {phoneConfirmationWording}
          </p>
        </section>

        <section aria-labelledby="payment-heading">
          <h2 id="payment-heading" className="font-serif text-3xl tracking-[-0.03em]">
            Thanh toán
          </h2>
          <ul className="mt-6 max-w-2xl list-disc space-y-2 pl-6 text-base leading-7">
            {PUBLIC_PAYMENT_FACTS.acceptedMethods.map((method) => (
              <li key={method}>{method}</li>
            ))}
          </ul>
          <p className="mt-6 max-w-2xl text-base leading-7 text-black/70">
            Khách hàng không bắt buộc đăng ký tài khoản để đặt hàng.{" "}
            {PUBLIC_PAYMENT_FACTS.serverVerificationNote}
          </p>
          <p className="mt-4 max-w-2xl text-base leading-7 text-black/70">
            {PUBLIC_PAYMENT_FACTS.refundNote} Điều kiện và thời gian hoàn tiền được nêu trong{" "}
            <Link
              className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
              href="/returns"
            >
              chính sách đổi trả
            </Link>
            .
          </p>
        </section>
      </div>
    </div>
  );
}
