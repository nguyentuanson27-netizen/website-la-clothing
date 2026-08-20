import Link from "next/link";
import { connection } from "next/server";

import { listConfiguredStorefrontProducts } from "@/commerce/storefront-catalog-runtime";
import { StorefrontProductCard } from "@/components/commerce/storefront-product-card";
import { PancakeConfigError } from "@/integrations/pancake/config";

const tones = ["stone", "ink", "olive", "sand"] as const;

async function loadHomepageProductEdit() {
  try {
    return await listConfiguredStorefrontProducts(4);
  } catch (error) {
    if (error instanceof PancakeConfigError) return [];
    throw error;
  }
}

export default async function HomePage() {
  await connection();
  const featuredProducts = await loadHomepageProductEdit();

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
          <Link className="text-link" href="/shop">
            Shop the collection <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </section>

      <section className="collection-intro" aria-labelledby="new-collection-title">
        <p className="eyebrow">Collection / 01</p>
        <h2 id="new-collection-title">ESSENTIALS FOR THE IN-BETWEEN.</h2>
        <p>
          Shirts, trousers and layers built around proportion rather than noise — simple enough to wear every day,
          distinct enough to feel considered.
        </p>
      </section>

      <section className="product-section" aria-labelledby="shop-edit-title">
        <div className="section-heading-row">
          <h2 id="shop-edit-title">Shop edit</h2>
          <Link className="text-link" href="/shop">View all</Link>
        </div>
        {featuredProducts.length > 0 ? (
          <div className="product-grid">
            {featuredProducts.map((product, index) => (
              <StorefrontProductCard
                key={product.id}
                slug={product.slug}
                name={product.name}
                media={product.media}
                editorialDescription={product.editorialDescription}
                variants={product.variants}
                tone={tones[index % tones.length]!}
              />
            ))}
          </div>
        ) : (
          <div className="border-t border-black/20 py-16">
            <p className="max-w-xl font-serif text-2xl leading-snug md:text-3xl">
              The current edit is being prepared.
            </p>
            <p className="mt-4 max-w-lg text-sm leading-6 text-black/60">
              Products will appear here when the shop catalog is available for the website.
            </p>
          </div>
        )}
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
          <Link href="/shop?category=shirts">Shirts</Link>
          <Link href="/shop?category=t-shirts">T-shirts</Link>
          <Link href="/shop?category=trousers">Trousers</Link>
          <Link href="/shop?category=outerwear">Outerwear</Link>
        </nav>
      </section>
    </>
  );
}
