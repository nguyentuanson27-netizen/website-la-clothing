import type { Metadata } from "next";
import Link from "next/link";

import { requireCurrentAdminPage } from "@/auth/current-admin";
import { createProductContentRepository } from "@/commerce/product-content-repository";
import { prisma } from "@/db/prisma";

export const metadata: Metadata = {
  title: "Quản trị nội dung sản phẩm",
};

const repository = createProductContentRepository(prisma);

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
          {products.map((product) => (
            <article key={product.id} className="grid gap-4 py-6 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <h2 className="font-serif text-2xl tracking-[-0.025em]">{product.name}</h2>
                  <span className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-black/55">
                    {product.isActive ? "Đang hoạt động" : "Không hoạt động"}
                  </span>
                </div>
                <p className="mt-2 text-sm text-black/60">/{product.slug}</p>
                <p className="mt-3 text-xs font-semibold uppercase tracking-[0.13em]">
                  {product.content ? "Đã có nội dung biên tập" : "Chưa có nội dung biên tập"}
                </p>
              </div>
              <Link
                className="inline-flex min-h-11 w-fit items-center border border-black px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] transition-colors hover:bg-black hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4"
                href={`/admin/products/${product.id}`}
              >
                Mở biên tập
              </Link>
            </article>
          ))}
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
