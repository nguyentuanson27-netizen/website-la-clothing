import Link from "next/link";

import { readGuestShippingPolicy } from "@/commerce/guest-shipping-policy";
import { buildPublicBrandFacts } from "@/content/public-brand-facts";

export function SiteFooter() {
  const brandFacts = buildPublicBrandFacts(readGuestShippingPolicy());

  return (
    <footer className="site-footer">
      <div>
        <p className="footer-kicker">LA CLOTHING</p>
        <p className="footer-copy">Modern menswear for everyday movement.</p>

        <dl className="mt-8 grid max-w-2xl gap-5 text-sm leading-6">
          <div>
            <dt className="font-semibold uppercase tracking-[0.12em]">Thanh toán</dt>
            <dd className="mt-1 text-black/70">
              {brandFacts.paymentMethod} {brandFacts.checkoutAccount}
            </dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-[0.12em]">Vận chuyển</dt>
            <dd className="mt-1 text-black/70">
              {brandFacts.shipping.title}. {brandFacts.shipping.detail}
            </dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-[0.12em]">{brandFacts.orderTracking.title}</dt>
            <dd className="mt-1 text-black/70">{brandFacts.orderTracking.detail}</dd>
          </div>
        </dl>
      </div>

      <nav className="footer-links" aria-label="Liên kết cuối trang">
        <Link href="/shop">Cửa hàng</Link>
        <Link href="/new-arrivals">Hàng mới</Link>
        <Link href="/lookbook">Lookbook</Link>
        <Link href="/track-order">Tra cứu đơn</Link>
        <Link href="/account">Tài khoản</Link>
      </nav>

      <p className="footer-meta">© 2026 LA Clothing</p>
    </footer>
  );
}
