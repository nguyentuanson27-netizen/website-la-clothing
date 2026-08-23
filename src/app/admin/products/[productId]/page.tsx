import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { requireCurrentAdmin, requireCurrentAdminPage } from "@/auth/current-admin";
import { createCollectionDefinitionRepository } from "@/commerce/collection-definition-repository";
import {
  createProductContentAdminService,
  PRODUCT_CONTENT_LIMITS,
} from "@/commerce/product-content-admin";
import { createProductContentRepository } from "@/commerce/product-content-repository";
import { AdminFormStatus } from "@/components/admin/admin-form-status";
import { ProductSlugEditor } from "@/components/admin/product-slug-editor";
import { prisma } from "@/db/prisma";

export const metadata: Metadata = {
  title: "Biên tập nội dung sản phẩm",
};

const repository = createProductContentRepository(prisma);
const collectionRepository = createCollectionDefinitionRepository(prisma);
const adminService = createProductContentAdminService({
  productExists: repository.productExists,
  resolveCollectionSlugs: collectionRepository.resolveMembershipSlugs,
  saveContent: repository.saveContent,
});

const inputClassName =
  "w-full border-b border-black/30 bg-transparent px-0 py-3 text-base outline-none transition-colors placeholder:text-black/35 focus-visible:border-black focus-visible:outline-2 focus-visible:outline-offset-4";
const textareaClassName = `${inputClassName} min-h-36 resize-y leading-7`;

function queryValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

function formatVnd(amount: number | null | undefined): string {
  if (typeof amount !== "number" || Number.isNaN(amount)) return "—";
  return new Intl.NumberFormat("vi-VN").format(amount) + " ₫";
}

type ProductEditorPageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{
    saved?: string | string[];
    error?: string | string[];
    slugSaved?: string | string[];
    slugError?: string | string[];
  }>;
};

export default async function ProductEditorPage({ params, searchParams }: ProductEditorPageProps) {
  const { productId } = await params;
  if (
    productId.length === 0 ||
    productId.length > PRODUCT_CONTENT_LIMITS.productId ||
    productId !== productId.trim()
  ) {
    notFound();
  }

  await requireCurrentAdminPage();
  const product = await repository.findForEditor(productId);
  if (!product) {
    notFound();
  }

  const persistedProductId = product.id;
  const editorPath = `/admin/products/${persistedProductId}`;

  async function saveProductContent(formData: FormData) {
    "use server";

    const adminSession = await requireCurrentAdmin();
    const result = await adminService.update(adminSession, {
      productId: persistedProductId,
      status: formData.get("status"),
      editorialDescription: formData.get("editorialDescription"),
      careInstructions: formData.get("careInstructions"),
      sizeGuide: formData.get("sizeGuide"),
      seoTitle: formData.get("seoTitle"),
      seoDescription: formData.get("seoDescription"),
      collectionSlugs: formData.get("collectionSlugs"),
    });

    if (!result.ok) {
      if (result.reason === "PRODUCT_NOT_FOUND") {
        redirect("/admin");
      }
      redirect(`${editorPath}?error=invalid`);
    }

    revalidatePath(editorPath);
    revalidatePath("/admin");
    revalidatePath("/shop");
    redirect(`${editorPath}?saved=1`);
  }

  const query = await searchParams;
  const saved = queryValue(query.saved) === "1";
  const invalid = queryValue(query.error) === "invalid";
  const formStatus = invalid ? "error" : saved ? "success" : null;
  const slugSaved = queryValue(query.slugSaved) === "1";
  const rawSlugError = queryValue(query.slugError);
  const slugError =
    rawSlugError === "invalid" || rawSlugError === "unavailable" ? rawSlugError : null;

  // Extract all images
  const allImages = new Set<string>();
  if (product.primaryImageUrl) {
    allImages.add(product.primaryImageUrl);
  }
  for (const v of product.variants) {
    if (Array.isArray(v.pancakeImageUrls)) {
      for (const img of v.pancakeImageUrls) {
        if (typeof img === "string" && img.startsWith("http")) {
          allImages.add(img);
        }
      }
    }
  }
  const imageUrls = Array.from(allImages);

  // Compute price range and stock summary
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
      : "Chưa có giá";

  const totalStock = product.variants.reduce((acc, v) => {
    const variantStock = v.warehouseStocks.reduce((sAcc, ws) => sAcc + ws.quantity, 0);
    return acc + variantStock;
  }, 0);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="grid gap-8 border-b border-black/20 pb-8 md:grid-cols-[1fr_auto] md:items-end">
        <div>
          <Link
            className="text-xs font-semibold uppercase tracking-[0.14em] text-black/60 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
            href="/admin"
          >
            ← Danh sách sản phẩm
          </Link>
          <p className="eyebrow mt-8">Biên tập sản phẩm</p>
          <h1 className="mt-3 max-w-4xl font-serif text-5xl leading-[0.95] tracking-[-0.05em] md:text-7xl">
            {product.name}
          </h1>
          <p className="mt-4 text-sm text-black/60">/{product.slug}</p>
        </div>
        <div className="text-xs font-semibold uppercase tracking-[0.13em] md:text-right">
          <p>{product.isActive ? "Catalog: đang hoạt động" : "Catalog: không hoạt động"}</p>
          <p className="mt-2 text-black/55">
            Editorial: {product.content?.status ?? "DRAFT"}
          </p>
        </div>
      </div>

      <AdminFormStatus kind={formStatus} />

      <ProductSlugEditor
        productId={persistedProductId}
        currentSlug={product.slug}
        editorPath={editorPath}
        saved={slugSaved}
        error={slugError}
      />

      {/* PANCAKE POS SYNCHRONIZED SOURCE DATA */}
      <section
        aria-labelledby="source-description-heading"
        className="mt-8 border border-black/20 bg-black/[0.02] p-6 md:p-8"
      >
        <div className="flex flex-col justify-between gap-4 border-b border-black/15 pb-6 md:flex-row md:items-center">
          <div>
            <p className="eyebrow">Nguồn Pancake · chỉ đọc</p>
            <h2 id="source-description-heading" className="mt-1 font-serif text-3xl tracking-[-0.03em]">
              Nguồn mô tả từ Pancake
            </h2>
          </div>
          <div className="flex flex-wrap gap-4 text-xs font-semibold uppercase tracking-[0.12em]">
            <div className="border border-black/20 bg-white px-4 py-2">
              <span className="text-black/55">Giá bán: </span>
              <span className="text-black">{priceDisplay}</span>
            </div>
            <div className="border border-black/20 bg-white px-4 py-2">
              <span className="text-black/55">Biến thể: </span>
              <span className="text-black">{product.variants.length} phân loại</span>
            </div>
            <div className="border border-black/20 bg-white px-4 py-2">
              <span className="text-black/55">Tổng tồn kho: </span>
              <span className="text-black">{totalStock} cái</span>
            </div>
          </div>
        </div>

        {/* SOURCE DESCRIPTION */}
        <div className="mt-6">
          {product.sourceDescription ? (
            <p className="whitespace-pre-wrap text-sm leading-7 text-black/75">
              {product.sourceDescription}
            </p>
          ) : (
            <p className="text-sm leading-7 text-black/55">Chưa có mô tả nguồn từ Pancake.</p>
          )}
          <p className="mt-3 max-w-3xl text-xs leading-5 text-black/55">
            Dữ liệu này chỉ dùng làm ngữ cảnh đối chiếu. Đồng bộ Pancake không tự xuất bản và không ghi đè nội dung editorial hoặc SEO do website sở hữu.
          </p>
        </div>

        {/* IMAGE GALLERY */}
        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-black/70">
            Hình ảnh sản phẩm ({imageUrls.length} ảnh)
          </h3>
          {imageUrls.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-4">
              {imageUrls.map((url, idx) => (
                <div
                  key={idx}
                  className="relative aspect-[3/4] w-24 overflow-hidden border border-black/20 bg-[var(--stone)] md:w-32"
                >
                  <Image
                    src={url}
                    alt={`${product.name} ảnh ${idx + 1}`}
                    fill
                    sizes="128px"
                    className="object-cover"
                    unoptimized
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-black/50 italic">
              Chưa có hình ảnh nào được tải lên Pancake cho sản phẩm này.
            </p>
          )}
        </div>

        {/* VARIANTS BREAKDOWN TABLE */}
        <div className="mt-8">
          <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-black/70">
            Chi tiết các biến thể (Màu / Size / Giá / Kho)
          </h3>
          {product.variants.length > 0 ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-black/20 bg-black/5 uppercase tracking-[0.1em] text-black/70">
                    <th className="px-3 py-2.5">SKU</th>
                    <th className="px-3 py-2.5">Màu sắc</th>
                    <th className="px-3 py-2.5">Kích cỡ</th>
                    <th className="px-3 py-2.5">Giá niêm yết</th>
                    <th className="px-3 py-2.5">Giá sau giảm</th>
                    <th className="px-3 py-2.5">Tồn kho</th>
                    <th className="px-3 py-2.5">Trạng thái</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/10">
                  {product.variants.map((v) => {
                    const stock = v.warehouseStocks.reduce((acc, ws) => acc + ws.quantity, 0);
                    return (
                      <tr key={v.id} className="hover:bg-black/[0.02]">
                        <td className="px-3 py-2.5 font-mono">{v.sku || "—"}</td>
                        <td className="px-3 py-2.5 font-medium">{v.color || "—"}</td>
                        <td className="px-3 py-2.5 font-medium">{v.size || "—"}</td>
                        <td className="px-3 py-2.5">{formatVnd(v.pancakeRetailPrice)}</td>
                        <td className="px-3 py-2.5 font-medium text-black">
                          {v.pancakeRetailPriceAfterDiscount
                            ? formatVnd(v.pancakeRetailPriceAfterDiscount)
                            : formatVnd(v.pancakeRetailPrice)}
                        </td>
                        <td className="px-3 py-2.5 font-semibold">
                          {stock > 0 ? (
                            <span className="text-emerald-700">{stock}</span>
                          ) : (
                            <span className="text-rose-600">Hết hàng</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider ${
                              v.isActive ? "bg-emerald-100 text-emerald-800" : "bg-black/10 text-black/60"
                            }`}
                          >
                            {v.isActive ? "Hoạt động" : "Tắt"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-2 text-sm text-black/50 italic">Chưa có biến thể nào.</p>
          )}
        </div>
      </section>

      <form action={saveProductContent} className="mt-8 grid gap-12 lg:grid-cols-[1.35fr_0.65fr]">
        <div className="space-y-10">
          <section aria-labelledby="editorial-heading">
            <p className="eyebrow">Storefront</p>
            <h2 id="editorial-heading" className="mt-2 font-serif text-3xl tracking-[-0.03em]">
              Nội dung editorial
            </h2>
            <div className="mt-8 space-y-8">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.13em]">Mô tả biên tập</span>
                <textarea
                  className={textareaClassName}
                  defaultValue={product.content?.editorialDescription ?? ""}
                  maxLength={PRODUCT_CONTENT_LIMITS.editorialField}
                  name="editorialDescription"
                  rows={7}
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.13em]">Hướng dẫn bảo quản</span>
                <textarea
                  className={textareaClassName}
                  defaultValue={product.content?.careInstructions ?? ""}
                  maxLength={PRODUCT_CONTENT_LIMITS.editorialField}
                  name="careInstructions"
                  rows={5}
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.13em]">Size guide</span>
                <textarea
                  className={textareaClassName}
                  defaultValue={product.content?.sizeGuide ?? ""}
                  maxLength={PRODUCT_CONTENT_LIMITS.editorialField}
                  name="sizeGuide"
                  rows={5}
                />
              </label>
            </div>
          </section>
        </div>

        <aside className="space-y-10 lg:border-l lg:border-black/20 lg:pl-8">
          <section aria-labelledby="publication-heading">
            <p className="eyebrow">Publication</p>
            <h2 id="publication-heading" className="mt-2 font-serif text-3xl tracking-[-0.03em]">
              Trạng thái
            </h2>
            <label className="mt-8 block">
              <span className="text-xs font-semibold uppercase tracking-[0.13em]">
                Trạng thái xuất bản
              </span>
              <select
                className={inputClassName}
                defaultValue={product.content?.status ?? "DRAFT"}
                name="status"
              >
                <option value="DRAFT">DRAFT — Bản nháp</option>
                <option value="REVIEWED">REVIEWED — Đã duyệt nội bộ</option>
                <option value="PUBLISHED">PUBLISHED — Công khai</option>
              </select>
              <span className="mt-3 block text-xs leading-5 text-black/55">
                Chỉ PUBLISHED được đưa các trường editorial và SEO ra storefront. DRAFT và REVIEWED vẫn là nội dung nội bộ.
              </span>
            </label>
          </section>

          <section aria-labelledby="collections-heading" className="border-t border-black/20 pt-10">
            <p className="eyebrow">Discovery</p>
            <h2 id="collections-heading" className="mt-2 font-serif text-3xl tracking-[-0.03em]">
              Collections
            </h2>
            <label className="mt-8 block">
              <span className="text-xs font-semibold uppercase tracking-[0.13em]">
                Collection slugs
              </span>
              <input
                className={inputClassName}
                defaultValue={product.content?.collectionSlugs.join(", ") ?? ""}
                maxLength={
                  PRODUCT_CONTENT_LIMITS.collectionCount *
                  (PRODUCT_CONTENT_LIMITS.collectionSlug + 2)
                }
                name="collectionSlugs"
                placeholder="city-uniform, essentials"
                type="text"
              />
              <span className="mt-3 block text-xs leading-5 text-black/55">
                Tối đa {PRODUCT_CONTENT_LIMITS.collectionCount} slug, phân cách bằng dấu phẩy; chỉ dùng chữ thường, số và dấu gạch ngang.
              </span>
            </label>
          </section>

          <section aria-labelledby="seo-heading" className="border-t border-black/20 pt-10">
            <p className="eyebrow">Search</p>
            <h2 id="seo-heading" className="mt-2 font-serif text-3xl tracking-[-0.03em]">
              SEO
            </h2>
            <div className="mt-8 space-y-8">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.13em]">SEO title</span>
                <input
                  className={inputClassName}
                  defaultValue={product.content?.seoTitle ?? ""}
                  maxLength={PRODUCT_CONTENT_LIMITS.seoTitle}
                  name="seoTitle"
                  type="text"
                />
              </label>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.13em]">SEO description</span>
                <textarea
                  className={textareaClassName}
                  defaultValue={product.content?.seoDescription ?? ""}
                  maxLength={PRODUCT_CONTENT_LIMITS.seoDescription}
                  name="seoDescription"
                  rows={5}
                />
              </label>
            </div>
          </section>

          <div className="border-t border-black/20 pt-8">
            <p className="text-sm leading-6 text-black/65">
              Các trường để trống sẽ xóa nội dung biên tập tương ứng. Màn hình này không sửa giá, tồn kho, SKU hay trạng thái vận hành từ Pancake.
            </p>
            <button
              className="mt-6 inline-flex min-h-11 w-full items-center justify-center border border-black px-5 py-3 text-xs font-semibold uppercase tracking-[0.14em] transition-colors hover:bg-black hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4"
              type="submit"
            >
              Lưu nội dung
            </button>
          </div>
        </aside>
      </form>
    </div>
  );
}
