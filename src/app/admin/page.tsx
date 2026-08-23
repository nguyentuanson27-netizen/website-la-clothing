import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { requireCurrentAdminPage } from "@/auth/current-admin";
import { createProductContentRepository } from "@/commerce/product-content-repository";
import { prisma } from "@/db/prisma";

export const metadata: Metadata = {
  title: "Quản trị nội dung sản phẩm",
};

const repository = createProductContentRepository(prisma);

function formatVnd(amount: number | null | undefined): string {
  if (typeof amount !== "number" || Number.isNaN(amount)) return "—";
  return new Intl.NumberFormat("vi-VN").format(amount) + " ₫";
}

export default async function AdminProductsPage() {
  await requireCurrentAdminPage();
  const products = await repository.listForAdmin(100);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="grid gap-6 border-b border-black/20 pb-8 md:grid-cols-[1fr_0.8fr] md:items-end">
        <div>
          <p className="eyebrow">Nội dung sản phẩm</p>
          <h1 className="mt-3 max-w-4xl font-serif text-5xl leading-[0.95] tracking-[-0.05em] md:text-7xl">
            Biên tập catalog cho storefront.
          </h1>
        </div>
        <p className="max-w-xl font-serif text-lg leading-relaxed md:justify-self-end">
          Chỉ các trường editorial, hướng dẫn bảo quản, size guide và SEO được chỉnh tại đây. Giá, tồn kho và dữ liệu vận hành vẫn thuộc Pancake.
        </p>
      </div>

      <nav className="flex flex-wrap gap-3 border-b border-black/20 py-6" aria-label="Quản trị nội dung">
        <Link
          className="inline-flex min-h-11 items-center border border-black px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] transition-colors hover:bg-black hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4"
          href="/admin/collections"
        >
          Quản lý collections
        </Link>
      </nav>

      {products.length === 0 ? (
        <section className="py-16" aria-labelledby="empty-admin-products-title">
          <p className="eyebrow">Chưa có dữ liệu</p>
          <h2 id="empty-admin-products-title" className="mt-3 max-w-2xl font-serif text-3xl tracking-[-0.03em]">
            Catalog mirror chưa có sản phẩm để biên tập.
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-black/70">
            Hoàn tất bước đồng bộ catalog đã được xác minh trước; màn hình quản trị này không tự tạo hay đoán dữ liệu sản phẩm từ POS.
          </p>
        </section>
      ) : (
        <div className="divide-y divide-black/20 border-b border-black/20">
          {products.map((product) => {
            const prices = product.variants
              .map((v) => v.pancakeRetailPriceAfterDiscount ?? v.pancakeRetailPrice)
              .filter((p): p is number => typeof p === "number" && !Number.isNaN(p));
            const minPrice = prices.length > 0 ? Math.min(...prices) : null;
            const maxPrice = prices.length > 0 ? Math.max(...prices) : null;
            const priceDisplay =
              minPrice !== null && maxPrice !== null
                ? minPrice === maxPrice
                  ? formatVnd(minPrice)
                  : `${formatVnd(minPrice)} – ${formatVnd(maxPrice)}`
                : null;

            return (
              <article key={product.id} className="grid gap-4 py-6 md:grid-cols-[auto_1fr_auto] md:items-center">
                {product.primaryImageUrl ? (
                  <div className="relative aspect-[3/4] w-20 shrink-0 overflow-hidden border border-black/20 bg-[var(--stone)] md:w-24">
                    <Image
                      src={product.primaryImageUrl}
                      alt={product.name}
                      fill
                      sizes="96px"
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                ) : (
                  <div className="flex aspect-[3/4] w-20 shrink-0 items-center justify-center border border-black/15 bg-black/5 text-[0.65rem] uppercase tracking-wider text-black/40 md:w-24">
                    Không ảnh
                  </div>
                )}
                <div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <h2 className="font-serif text-2xl tracking-[-0.025em]">{product.name}</h2>
                    <span className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-black/55">
                      {product.isActive ? "Đang hoạt động" : "Không hoạt động"}
                    </span>
                    {product.content?.status ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider ${
                          product.content.status === "PUBLISHED"
                            ? "bg-emerald-100 text-emerald-800"
                            : product.content.status === "REVIEWED"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-black/10 text-black/60"
                        }`}
                      >
                        {product.content.status}
                      </span>
                    ) : (
                      <span className="rounded-full bg-black/10 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-black/60">
                        DRAFT
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-black/60">
                    <p>/{product.slug}</p>
                    {priceDisplay ? (
                      <>
                        <span>•</span>
                        <span className="font-semibold text-black">{priceDisplay}</span>
                      </>
                    ) : null}
                    {product.variants.length > 0 ? (
                      <>
                        <span>•</span>
                        <span>{product.variants.length} biến thể</span>
                      </>
                    ) : null}
                  </div>
                </div>
                <Link
                  className="inline-flex min-h-11 w-fit items-center border border-black px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] transition-colors hover:bg-black hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4"
                  href={`/admin/products/${product.id}`}
                >
                  Mở biên tập
                </Link>
              </article>
            );
          })}
        </div>
      )}

      {products.length === 100 ? (
        <p className="mt-6 text-xs leading-5 text-black/60">
          Đang hiển thị tối đa 100 sản phẩm trong foundation hiện tại; phân trang sẽ được bổ sung khi catalog sync hoàn chỉnh.
        </p>
      ) : null}
    </div>
  );
}
