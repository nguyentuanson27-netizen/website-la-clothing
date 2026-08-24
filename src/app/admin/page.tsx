import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { requireCurrentAdminPage } from "@/auth/current-admin";
import {
  ADMIN_PRODUCT_DIRECTORY_LIMITS,
  ADMIN_PRODUCT_UNCATEGORIZED,
  buildAdminProductDirectoryHref,
  buildAdminProductFacetHref,
  hasActiveAdminProductFilters,
  parseAdminProductDirectorySearchParams,
} from "@/commerce/admin-product-directory";
import { createCollectionDefinitionRepository } from "@/commerce/collection-definition-repository";
import { createProductContentRepository } from "@/commerce/product-content-repository";
import { prisma } from "@/db/prisma";

export const metadata: Metadata = {
  title: "Quản trị nội dung sản phẩm",
};

const repository = createProductContentRepository(prisma);
const collectionRepository = createCollectionDefinitionRepository(prisma);

const controlClassName =
  "min-h-11 w-full border border-black/25 bg-white px-3 py-2 text-sm outline-none transition-colors focus-visible:border-black focus-visible:outline-2 focus-visible:outline-offset-2";
const buttonClassName =
  "inline-flex min-h-11 items-center justify-center border border-black px-5 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-colors hover:bg-black hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4";
const chipClassName =
  "inline-flex min-h-9 items-center gap-2 border px-3 py-1 text-xs font-semibold uppercase tracking-[0.1em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2";

const statusLabels = {
  DRAFT: "Nháp",
  REVIEWED: "Đã duyệt",
  PUBLISHED: "Đã xuất bản",
} as const;

const statusStyles = {
  DRAFT: "bg-black/10 text-black/70",
  REVIEWED: "bg-amber-100 text-amber-900",
  PUBLISHED: "bg-emerald-100 text-emerald-900",
} as const;

const sortLabels = {
  "name-asc": "Tên A → Z",
  "name-desc": "Tên Z → A",
  "updated-desc": "Cập nhật gần nhất",
  "synced-desc": "Đồng bộ gần nhất",
} as const;

function formatVnd(amount: number | null | undefined): string {
  if (typeof amount !== "number" || Number.isNaN(amount)) return "—";
  return new Intl.NumberFormat("vi-VN").format(amount) + " ₫";
}

function priceRange(
  variants: readonly Readonly<{
    pancakeRetailPrice: number | null;
    pancakeRetailPriceAfterDiscount: number | null;
  }>[],
): string | null {
  const prices = variants
    .map((v) => v.pancakeRetailPriceAfterDiscount ?? v.pancakeRetailPrice)
    .filter((p): p is number => typeof p === "number" && !Number.isNaN(p));
  if (prices.length === 0) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? formatVnd(min) : `${formatVnd(min)} – ${formatVnd(max)}`;
}

type AdminProductsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminProductsPage({ searchParams }: AdminProductsPageProps) {
  await requireCurrentAdminPage();

  let query: ReturnType<typeof parseAdminProductDirectorySearchParams>;
  try {
    query = parseAdminProductDirectorySearchParams(await searchParams);
  } catch (error) {
    if (error instanceof RangeError) {
      query = parseAdminProductDirectorySearchParams({});
    } else {
      throw error;
    }
  }

  const [directory, facets, collections] = await Promise.all([
    repository.listDirectoryPage({ query }),
    repository.countDirectoryFacets(query),
    collectionRepository.listForAdmin(100),
  ]);
  const collectionCounts = await repository.countProductsByCollectionSlug();

  const { products, page, totalCount, totalPages, pageSize } = directory;
  const collectionTitles = new Map(collections.map((c) => [c.slug, c.title]));
  const filtered = hasActiveAdminProductFilters(query);
  const firstIndex = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastIndex = Math.min(page * pageSize, totalCount);

  const facetChips = [
    { key: "all", label: "Tất cả", count: facets.all, active: !filtered, href: "/admin" },
    {
      key: "draft",
      label: statusLabels.DRAFT,
      count: facets.draft,
      active: query.status === "DRAFT",
      href: buildAdminProductFacetHref(query, {
        status: query.status === "DRAFT" ? null : "DRAFT",
      }),
    },
    {
      key: "reviewed",
      label: statusLabels.REVIEWED,
      count: facets.reviewed,
      active: query.status === "REVIEWED",
      href: buildAdminProductFacetHref(query, {
        status: query.status === "REVIEWED" ? null : "REVIEWED",
      }),
    },
    {
      key: "published",
      label: statusLabels.PUBLISHED,
      count: facets.published,
      active: query.status === "PUBLISHED",
      href: buildAdminProductFacetHref(query, {
        status: query.status === "PUBLISHED" ? null : "PUBLISHED",
      }),
    },
    {
      key: "uncategorized",
      label: "Chưa phân loại",
      count: facets.uncategorized,
      active: query.uncategorized,
      href: buildAdminProductFacetHref(query, {
        collection: null,
        uncategorized: !query.uncategorized,
      }),
    },
  ];

  return (
    <div className="mx-auto max-w-[1500px]">
      <div className="flex flex-col gap-4 border-b border-black/20 pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="eyebrow">Nội dung sản phẩm</p>
          <h1 className="mt-2 font-serif text-4xl leading-none tracking-[-0.04em] md:text-5xl">
            Biên tập catalog
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-black/65">
            Chỉ trường editorial, bảo quản, size guide, SEO và phân loại collection được chỉnh tại
            đây. Giá, tồn kho và dữ liệu vận hành vẫn thuộc Pancake.
          </p>
        </div>
        <Link className={buttonClassName} href="/admin/collections">
          Quản lý collections
        </Link>
      </div>

      <section aria-labelledby="product-filters-title" className="border-b border-black/20 py-5">
        <h2 className="sr-only" id="product-filters-title">
          Lọc sản phẩm
        </h2>

        <form action="/admin" className="grid gap-4 md:grid-cols-[2fr_1fr_1.4fr_1fr_1.2fr_auto]" method="get">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.13em]">Tìm kiếm</span>
            <input
              className={`${controlClassName} mt-2`}
              defaultValue={query.query ?? ""}
              maxLength={ADMIN_PRODUCT_DIRECTORY_LIMITS.query}
              name="q"
              placeholder="Tên hoặc slug"
              type="search"
            />
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.13em]">Trạng thái</span>
            <select className={`${controlClassName} mt-2`} defaultValue={query.status ?? ""} name="status">
              <option value="">Tất cả</option>
              <option value="DRAFT">{statusLabels.DRAFT}</option>
              <option value="REVIEWED">{statusLabels.REVIEWED}</option>
              <option value="PUBLISHED">{statusLabels.PUBLISHED}</option>
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.13em]">Collection</span>
            <select
              className={`${controlClassName} mt-2`}
              defaultValue={query.uncategorized ? ADMIN_PRODUCT_UNCATEGORIZED : (query.collection ?? "")}
              name="collection"
            >
              <option value="">Tất cả</option>
              <option value={ADMIN_PRODUCT_UNCATEGORIZED}>Chưa phân loại</option>
              {collections.map((collection) => (
                <option key={collection.slug} value={collection.slug}>
                  {collection.title} ({collectionCounts.get(collection.slug) ?? 0})
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.13em]">Hoạt động</span>
            <select
              className={`${controlClassName} mt-2`}
              defaultValue={query.activity ?? ""}
              name="activity"
            >
              <option value="">Tất cả</option>
              <option value="active">Đang hoạt động</option>
              <option value="inactive">Không hoạt động</option>
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-[0.13em]">Sắp xếp</span>
            <select className={`${controlClassName} mt-2`} defaultValue={query.sort} name="sort">
              {Object.entries(sortLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-end gap-3">
            <button className={buttonClassName} type="submit">
              Lọc
            </button>
            {filtered ? (
              <Link
                className="min-h-11 self-center text-xs font-semibold uppercase tracking-[0.13em] text-black/60 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
                href="/admin"
              >
                Xóa lọc
              </Link>
            ) : null}
          </div>
        </form>

        <div className="mt-5 flex flex-wrap gap-2">
          {facetChips.map((chip) => (
            <Link
              aria-current={chip.active ? "true" : undefined}
              className={`${chipClassName} ${
                chip.active
                  ? "border-black bg-black text-white"
                  : "border-black/25 text-black/70 hover:border-black hover:text-black"
              }`}
              href={chip.href}
              key={chip.key}
            >
              {chip.label}
              <span className={chip.active ? "text-white/70" : "text-black/45"}>{chip.count}</span>
            </Link>
          ))}
        </div>
      </section>

      <p className="py-4 text-sm text-black/65" role="status">
        {totalCount === 0
          ? "Không có sản phẩm nào khớp bộ lọc."
          : `Hiển thị ${firstIndex}–${lastIndex} trong ${totalCount} sản phẩm.`}
      </p>

      {products.length === 0 ? (
        <section aria-labelledby="empty-admin-products-title" className="border-t border-black/20 py-16">
          <p className="eyebrow">{filtered ? "Không có kết quả" : "Chưa có dữ liệu"}</p>
          <h2 className="mt-3 max-w-2xl font-serif text-3xl tracking-[-0.03em]" id="empty-admin-products-title">
            {filtered
              ? "Không sản phẩm nào khớp bộ lọc hiện tại."
              : "Catalog mirror chưa có sản phẩm để biên tập."}
          </h2>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-black/70">
            {filtered
              ? "Thử nới bộ lọc hoặc xóa từ khóa tìm kiếm."
              : "Hoàn tất bước đồng bộ catalog đã được xác minh trước; màn hình quản trị này không tự tạo hay đoán dữ liệu sản phẩm từ POS."}
          </p>
          {filtered ? (
            <Link className={`${buttonClassName} mt-8`} href="/admin">
              Xóa lọc
            </Link>
          ) : null}
        </section>
      ) : (
        <div className="overflow-x-auto border-y border-black/20">
          <table className="w-full min-w-[64rem] border-collapse text-left">
            <caption className="sr-only">
              Danh sách sản phẩm với trạng thái nội dung, collection và giá tham chiếu
            </caption>
            <thead>
              <tr className="border-b border-black/20 text-[0.65rem] uppercase tracking-[0.14em] text-black/60">
                <th className="py-3 pr-4 font-semibold" scope="col">
                  <span className="sr-only">Ảnh</span>
                </th>
                <th className="py-3 pr-4 font-semibold" scope="col">
                  Sản phẩm
                </th>
                <th className="py-3 pr-4 font-semibold" scope="col">
                  Trạng thái
                </th>
                <th className="py-3 pr-4 font-semibold" scope="col">
                  Collection
                </th>
                <th className="py-3 pr-4 font-semibold" scope="col">
                  Giá
                </th>
                <th className="py-3 pr-4 font-semibold" scope="col">
                  Biến thể
                </th>
                <th className="py-3 font-semibold" scope="col">
                  <span className="sr-only">Hành động</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/12">
              {products.map((product) => {
                const status = product.content?.status ?? "DRAFT";
                const slugs = product.content?.collectionSlugs ?? [];
                const display = priceRange(product.variants);

                return (
                  <tr className="align-middle transition-colors hover:bg-black/[0.03]" key={product.id}>
                    <td className="py-3 pr-4">
                      {product.primaryImageUrl ? (
                        <div className="relative aspect-[3/4] w-12 overflow-hidden border border-black/15 bg-[var(--stone)]">
                          <Image
                            alt=""
                            className="object-cover"
                            fill
                            sizes="48px"
                            src={product.primaryImageUrl}
                            unoptimized
                          />
                        </div>
                      ) : (
                        <div className="flex aspect-[3/4] w-12 items-center justify-center border border-black/15 bg-black/5 text-[0.55rem] uppercase tracking-wider text-black/40">
                          Không ảnh
                        </div>
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <Link
                        className="font-serif text-lg leading-tight tracking-[-0.02em] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
                        href={`/admin/products/${product.id}`}
                      >
                        {product.name}
                      </Link>
                      <p className="mt-1 text-xs text-black/55">/{product.slug}</p>
                      {!product.isActive ? (
                        <p className="mt-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-black/55">
                          Không hoạt động
                        </p>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider ${statusStyles[status]}`}
                      >
                        {statusLabels[status]}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      {slugs.length === 0 ? (
                        <span className="text-xs text-black/45">Chưa phân loại</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {slugs.map((slug) => (
                            <Link
                              className="inline-flex min-h-7 items-center border border-black/20 px-2 py-0.5 text-xs transition-colors hover:border-black focus-visible:outline-2 focus-visible:outline-offset-2"
                              href={buildAdminProductFacetHref(query, {
                                collection: slug,
                                uncategorized: false,
                              })}
                              key={slug}
                            >
                              {collectionTitles.get(slug) ?? slug}
                            </Link>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-sm font-semibold">{display ?? "—"}</td>
                    <td className="py-3 pr-4 text-sm text-black/60">{product.variants.length}</td>
                    <td className="py-3">
                      <Link
                        className="inline-flex min-h-11 items-center border border-black px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-colors hover:bg-black hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4"
                        href={`/admin/products/${product.id}`}
                      >
                        Biên tập
                        <span className="sr-only"> {product.name}</span>
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 ? (
        <nav aria-label="Phân trang sản phẩm" className="flex items-center justify-between gap-4 py-6">
          {page > 1 ? (
            <Link className={buttonClassName} href={buildAdminProductDirectoryHref(query, page - 1)}>
              ← Trang trước
            </Link>
          ) : (
            <span className="text-xs uppercase tracking-[0.14em] text-black/35">← Trang trước</span>
          )}
          <p className="text-xs font-semibold uppercase tracking-[0.14em]">
            Trang {page} / {totalPages}
          </p>
          {page < totalPages ? (
            <Link className={buttonClassName} href={buildAdminProductDirectoryHref(query, page + 1)}>
              Trang sau →
            </Link>
          ) : (
            <span className="text-xs uppercase tracking-[0.14em] text-black/35">Trang sau →</span>
          )}
        </nav>
      ) : null}
    </div>
  );
}
