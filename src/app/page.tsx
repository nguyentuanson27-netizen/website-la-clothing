import Link from "next/link";

import { ProductCard } from "@/components/commerce/product-card";

const newArrivals = [
  { name: "Relaxed Oxford Shirt", href: "/products/relaxed-oxford-shirt", price: "790.000₫", tone: "stone" as const },
  { name: "Wide Pleat Trousers", href: "/products/wide-pleat-trousers", price: "890.000₫", tone: "ink" as const, badge: "New" },
  { name: "Utility Overshirt", href: "/products/utility-overshirt", price: "990.000₫", tone: "olive" as const },
  { name: "Essential Box Tee", href: "/products/essential-box-tee", price: "490.000₫", tone: "sand" as const },
];

export default function HomePage() {
  return (
    <>
      <section className="campaign-hero" aria-labelledby="campaign-title">
        <div className="campaign-visual" aria-hidden="true">
          <span className="campaign-figure campaign-figure--one" />
          <span className="campaign-figure campaign-figure--two" />
        </div>
        <div className="campaign-copy">
          <p className="eyebrow">Fall / Winter 2026</p>
          <h1 id="campaign-title">QUIET FORM.</h1>
          <p className="campaign-intro">
            Clean lines, relaxed proportions and a muted palette designed for everyday movement.
          </p>
          <Link className="text-link" href="/collections/fall-winter-2026">
            Explore the collection <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>

      <section className="collection-intro" aria-labelledby="new-collection-title">
        <p className="eyebrow">New collection / 01</p>
        <h2 id="new-collection-title">ESSENTIALS FOR THE IN-BETWEEN.</h2>
        <p>
          Shirts, trousers and layers built around proportion rather than noise — simple enough to wear every day,
          distinct enough to feel considered.
        </p>
      </section>

      <section className="product-section" aria-labelledby="new-arrivals-title">
        <div className="section-heading-row">
          <h2 id="new-arrivals-title">New arrivals</h2>
          <Link className="text-link" href="/new-arrivals">View all</Link>
        </div>
        <div className="product-grid">
          {newArrivals.map((product) => (
            <ProductCard key={product.href} {...product} />
          ))}
        </div>
      </section>

      <section className="lookbook-grid" aria-labelledby="lookbook-title">
        <div className="lookbook-panel lookbook-panel--large" aria-hidden="true">
          <span className="lookbook-figure" />
        </div>
        <div className="lookbook-copy">
          <p className="eyebrow">Editorial / 02</p>
          <h2 id="lookbook-title">CITY UNIFORM</h2>
          <p>Soft tailoring and utility pieces for long days, late evenings and everything between.</p>
          <Link className="text-link" href="/lookbook">View lookbook ↗</Link>
        </div>
        <div className="lookbook-panel lookbook-panel--small" aria-hidden="true">
          <span className="lookbook-figure lookbook-figure--small" />
        </div>
      </section>

      <section className="category-strip" aria-labelledby="categories-title">
        <p className="eyebrow" id="categories-title">Shop by category</p>
        <nav className="category-links" aria-label="Danh mục sản phẩm">
          <Link href="/category/shirts">Shirts</Link>
          <Link href="/category/t-shirts">T-shirts</Link>
          <Link href="/category/trousers">Trousers</Link>
          <Link href="/category/outerwear">Outerwear</Link>
        </nav>
      </section>
    </>
  );
}
