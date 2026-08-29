import Link from "next/link";

const primaryNav = [
  { href: "/shop", label: "Cửa hàng" },
  { href: "/new-arrivals", label: "Hàng mới" },
  { href: "/collections", label: "Bộ sưu tập" },
  { href: "/lookbook", label: "Lookbook" },
];

export function SiteHeader() {
  return (
    <header className="site-header">
      <a className="skip-link" href="#main-content">
        Bỏ qua đến nội dung chính
      </a>

      <div className="nav-shell">
        <Link className="brand-mark" href="/" aria-label="LA Clothing — Trang chủ">
          LA CLOTHING
        </Link>

        <nav className="desktop-nav" aria-label="Điều hướng chính">
          {primaryNav.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="mobile-nav">
          <details>
            <summary>Menu</summary>
            <nav className="mobile-menu" aria-label="Điều hướng chính trên di động">
              {primaryNav.map((item) => (
                <Link key={item.href} href={item.href}>
                  {item.label}
                </Link>
              ))}
              <Link href="/search">Tìm kiếm</Link>
              <Link href="/account">Tài khoản</Link>
            </nav>
          </details>
        </div>

        <nav className="utility-nav" aria-label="Tiện ích">
          <Link href="/search">Tìm kiếm</Link>
          <Link href="/account">Tài khoản</Link>
          <Link href="/cart">Giỏ hàng</Link>
        </nav>
      </div>
    </header>
  );
}
