import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { listConfiguredStorefrontProductPage } from "@/commerce/storefront-catalog-runtime";
import { StorefrontProductCard } from "@/components/commerce/storefront-product-card";

export const metadata: Metadata = {
  title: "Shop",
  description: "Khám phá thời trang nam LA Clothing đang có sẵn từ catalog cửa hàng.",
};

const PAGE_SIZE = 24;
const tones = ["stone", "olive", "ink", "sand"] as const;

type ShopPageProps = {
  searchParams: Promise<{ page?: string | string[] }>;
};

function parsePageParam(value: string | string[] | undefined): number {
  if (value === undefined) return 1;
  if (Array.isArray(value) || !/^[1-9]\d*$/.test(value)) {
    throw new RangeError("Storefront page query is invalid");
  }

  const page = Number(value);
  if (!Number.isSafeInteger(page)) {
    throw new RangeError("Storefront page query is invalid");
  }
  return page;
}

function pageHref(page: number): string {
  return page === 1 ? "/shop" : `/shop?page=${page}`;
}

export default async function ShopPage({ searchParams }: ShopPageProps) {
  await connection();

  let catalogPage: Awaited<ReturnType<typeof listConfiguredStorefrontProductPage>>;
  try {
    const { page: pageParam } = await searchParams;
    const page = parsePageParam(pageParam);
    catalogPage = await listConfiguredStorefrontProductPage({ page, pageSize: PAGE_SIZE });
  } catch (error) {
    if (error instanceof RangeError) notFound();
    throw error;
  }

  const { page, products, totalProducts, totalPages } = catalogPage;
  if (page > Math.max(totalPages, 1)) notFound();

  return (
    <div className="mx-auto min-h-[65vh] max-w-[1600px] px-6 py-16 md:py-24">
      <p className="eyebrow">LA Clothing / Store</p>
      <h1 className="mt-4 max-w-5xl text-[clamp(3.5rem,10vw,9rem)] font-semibold leading-[0.86] tracking-[-0.05em]">
        SHOP
      </h1>
      <div className="mt-12 grid gap-8 border-t border-black/20 pt-8 md:grid-cols-2">
        <p className="max-w-xl font-serif text-2xl leading-snug md:text-3xl">
          Phom dáng thư thái, đường nét gọn và bảng màu trung tính cho nhịp sống hằng ngày.
        </p>
        <p className="max-w-lg text-sm leading-6 text-black/70 md:justify-self-end">
          Sản phẩm tại đây phản ánh catalog hiện tại của cửa hàng. Màu, kích cỡ và tình trạng mua được chỉ dùng dữ liệu đã được xác nhận phía máy chủ.
        </p>
      </div>

      {totalProducts === 0 ? (
        <section className="mt-16 border-t border-black/20 py-16" aria-labelledby="shop-empty-title">
          <p className="eyebrow">Current drop</p>
          <h2 id="shop-empty-title" className="mt-4 max-w-2xl font-serif text-3xl leading-tight md:text-5xl">
            Chưa có sản phẩm đang mở bán.
          </h2>
          <p className="mt-5 max-w-xl text-sm leading-6 text-black/65">
            Catalog sẽ xuất hiện tại đây khi sản phẩm được đồng bộ và chủ shop bật trạng thái bán trên website.
          </p>
        </section>
      ) : (
        <section className="mt-16" aria-labelledby="shop-products-title">
          <div className="section-heading-row border-t border-black/20 pt-5">
            <h2 id="shop-products-title">Current collection</h2>
            <p className="eyebrow">
              {totalProducts} sản phẩm · Trang {page}/{totalPages}
            </p>
          </div>
          <div className="product-grid">
            {products.map((product, index) => (
              <StorefrontProductCard
                key={product.id}
                slug={product.slug}
                name={product.name}
                editorialDescription={product.editorialDescription}
                variants={product.variants}
                tone={tones[((page - 1) * PAGE_SIZE + index) % tones.length]!}
              />
            ))}
          </div>

          {totalPages > 1 ? (
            <nav
              className="mt-12 flex items-center justify-between gap-4 border-t border-black/20 pt-6"
              aria-label="Phân trang sản phẩm"
            >
              {page > 1 ? (
                <Link
                  className="inline-flex min-h-11 items-center text-xs font-semibold uppercase tracking-[0.14em] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
                  href={pageHref(page - 1)}
                  rel="prev"
                >
                  ← Trang trước
                </Link>
              ) : (
                <span aria-hidden="true" />
              )}
              {page < totalPages ? (
                <Link
                  className="inline-flex min-h-11 items-center text-xs font-semibold uppercase tracking-[0.14em] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
                  href={pageHref(page + 1)}
                  rel="next"
                >
                  Trang sau →
                </Link>
              ) : null}
            </nav>
          ) : null}
        </section>
      )}
    </div>
  );
}
