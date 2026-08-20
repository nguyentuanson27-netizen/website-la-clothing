import type { Metadata } from "next";
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

      <section
        aria-labelledby="source-description-heading"
        className="mt-8 border border-black/20 bg-black/[0.025] p-6 md:p-8"
      >
        <p className="eyebrow">Nguồn Pancake · chỉ đọc</p>
        <h2
          id="source-description-heading"
          className="mt-2 font-serif text-3xl tracking-[-0.03em]"
        >
          Nguồn mô tả từ Pancake
        </h2>
        {product.sourceDescription ? (
          <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-black/75">
            {product.sourceDescription}
          </p>
        ) : (
          <p className="mt-5 text-sm leading-7 text-black/55">Chưa có mô tả nguồn từ Pancake.</p>
        )}
        <p className="mt-5 max-w-3xl text-xs leading-5 text-black/55">
          Dữ liệu này chỉ dùng làm ngữ cảnh đối chiếu. Đồng bộ Pancake không tự xuất bản và không ghi đè nội dung editorial hoặc SEO do website sở hữu.
        </p>
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
