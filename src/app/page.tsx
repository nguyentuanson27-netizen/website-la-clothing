import Image from "next/image";
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
  const productsWithMedia = featuredProducts.filter((p) => p.media?.primary);
  const heroProduct = productsWithMedia[0];
  const heroImage = heroProduct?.media?.primary ?? null;
  const lookbookLargeProduct = productsWithMedia[1] ?? productsWithMedia[0];
  const lookbookLargeImage = lookbookLargeProduct?.media?.primary ?? null;
  const lookbookSmallProduct =
    productsWithMedia[2] ?? productsWithMedia[1] ?? productsWithMedia[0];
  const lookbookSmallImage = lookbookSmallProduct?.media?.primary ?? null;

  return (
    <>
      <section className="campaign-hero" aria-labelledby="campaign-title">
        {heroImage ? (
          <div className="campaign-visual relative min-h-[620px] overflow-hidden bg-[var(--stone)]">
            <Image
              src={heroImage.url}
              alt={heroImage.alt || heroProduct?.name || "LA Clothing Campaign"}
              fill
              preload
              sizes="(min-width: 900px) 60vw, 100vw"
              className="object-cover"
            />
          </div>
        ) : (
          <div
            className="campaign-visual relative min-h-[620px] overflow-hidden bg-[var(--stone)]"
            aria-hidden="true"
          />
        )}
        <div className="campaign-copy">
          <p className="eyebrow">LA Clothing / Campaign</p>
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
        <div>
          <p>
            Shirts, trousers and layers built around proportion rather than noise — simple enough to wear every day,
            distinct enough to feel considered.
          </p>
          <Link className="text-link mt-4 inline-block" href="/collections">
            View collections ↗
          </Link>
        </div>
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
          <section
            aria-labelledby="homepage-empty-title"
            className="ui-state ui-state--empty"
            data-ui-state="empty"
          >
            <p className="eyebrow">Current edit</p>
            <h2 id="homepage-empty-title" className="ui-state__title">
              The current edit is being prepared.
            </h2>
            <p className="ui-state__copy">
              Products will appear here when the shop catalog is available for the website.
            </p>
          </section>
        )}
      </section>

      <section className="lookbook-grid" aria-labelledby="lookbook-title">
        {lookbookLargeImage ? (
          <div className="lookbook-panel lookbook-panel--large relative min-h-[68vh] overflow-hidden bg-[#b9b2a4] md:min-h-[780px]">
            <Image
              src={lookbookLargeImage.url}
              alt={lookbookLargeImage.alt || lookbookLargeProduct?.name || "LA Clothing Lookbook"}
              fill
              sizes="(min-width: 900px) 50vw, 100vw"
              className="object-cover"
            />
          </div>
        ) : (
          <div
            className="lookbook-panel lookbook-panel--large relative min-h-[68vh] overflow-hidden bg-[#b9b2a4] md:min-h-[780px]"
            aria-hidden="true"
          />
        )}
        <div className="lookbook-copy">
          <p className="eyebrow">Editorial / 02</p>
          <h2 id="lookbook-title">CITY UNIFORM</h2>
          <p>Measured proportions and functional utility for moving through the everyday.</p>
          <Link className="text-link" href="/lookbook">View lookbook ↗</Link>
        </div>
        {lookbookSmallImage ? (
          <div className="lookbook-panel lookbook-panel--small relative min-h-[55vh] overflow-hidden bg-[var(--olive)]">
            <Image
              src={lookbookSmallImage.url}
              alt={lookbookSmallImage.alt || lookbookSmallProduct?.name || "LA Clothing Detail"}
              fill
              sizes="(min-width: 900px) 25vw, 100vw"
              className="object-cover"
            />
          </div>
        ) : (
          <div
            className="lookbook-panel lookbook-panel--small relative min-h-[55vh] overflow-hidden bg-[var(--olive)]"
            aria-hidden="true"
          />
        )}
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
