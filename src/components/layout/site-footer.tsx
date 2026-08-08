import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div>
        <p className="footer-kicker">LA CLOTHING</p>
        <p className="footer-copy">Modern menswear for everyday movement.</p>
      </div>

      <div className="footer-links" aria-label="Liên kết cuối trang">
        <Link href="/shipping">Shipping</Link>
        <Link href="/returns">Returns</Link>
        <Link href="/size-guide">Size guide</Link>
        <Link href="/contact">Contact</Link>
      </div>

      <p className="footer-meta">© 2026 LA Clothing</p>
    </footer>
  );
}
