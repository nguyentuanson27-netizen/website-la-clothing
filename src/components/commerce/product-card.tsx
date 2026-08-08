import Link from "next/link";

type ProductCardProps = {
  name: string;
  href: string;
  price: string;
  tone: "stone" | "olive" | "ink" | "sand";
  badge?: string;
};

export function ProductCard({ name, href, price, tone, badge }: ProductCardProps) {
  return (
    <article className="product-card">
      <Link href={href} className="product-visual-link" aria-label={`${name} — ${price}`}>
        <div className={`product-visual product-visual--${tone}`} aria-hidden="true">
          {badge ? <span className="product-badge">{badge}</span> : null}
          <span className="garment-silhouette" />
        </div>
      </Link>
      <div className="product-meta">
        <h3>
          <Link href={href}>{name}</Link>
        </h3>
        <p>{price}</p>
      </div>
    </article>
  );
}
