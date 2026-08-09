import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <p className="footer-kicker">LA CLOTHING</p>
        <p className="footer-copy">Modern menswear for everyday movement.</p>
      </div>

      <div className="footer-links" aria-label="Liên kết cuối trang">
        <Link href="/shop">Shop</Link>
        <Link href="/new-arrivals">New arrivals</Link>
        <Link href="/lookbook">Lookbook</Link>
        <Link href="/account">Account</Link>
      </div>

      <p className="footer-meta">© 2026 LA Clothing</p>
    </footer>
  );
}
