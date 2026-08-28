import Link from "next/link";

import { PRODUCT_CONTENT_LIMITS } from "@/commerce/product-content-admin";

const inputClassName =
  "w-full border-b border-black/30 bg-transparent px-0 py-3 text-base outline-none transition-colors placeholder:text-black/35 focus-visible:border-black focus-visible:outline-2 focus-visible:outline-offset-4";
const textareaClassName = `${inputClassName} min-h-36 resize-y leading-7`;

export type ProductEditorCollectionChoice = {
  slug: string;
  title: string;
  isPublished: boolean;
  checked: boolean;
  missing: boolean;
};

type ProductEditorContent = {
  status: "DRAFT" | "REVIEWED" | "PUBLISHED";
  editorialDescription: string | null;
  careInstructions: string | null;
  sizeGuide: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
};

type ProductEditorialFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  content: ProductEditorContent | null;
  collectionChoices: ProductEditorCollectionChoice[];
};

export function ProductEditorialForm({
  action,
  content,
  collectionChoices,
}: ProductEditorialFormProps) {
  return (
    <form action={action} className="mt-8 grid gap-12 lg:grid-cols-[1.35fr_0.65fr]">
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
                defaultValue={content?.editorialDescription ?? ""}
                maxLength={PRODUCT_CONTENT_LIMITS.editorialField}
                name="editorialDescription"
                rows={7}
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.13em]">Hướng dẫn bảo quản</span>
              <textarea
                className={textareaClassName}
                defaultValue={content?.careInstructions ?? ""}
                maxLength={PRODUCT_CONTENT_LIMITS.editorialField}
                name="careInstructions"
                rows={5}
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.13em]">Size guide</span>
              <textarea
                className={textareaClassName}
                defaultValue={content?.sizeGuide ?? ""}
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
              defaultValue={content?.status ?? "DRAFT"}
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
            Bộ sưu tập
          </h2>
          {collectionChoices.length === 0 ? (
            <p className="mt-8 max-w-2xl text-sm leading-6 text-black/65">
              Chưa có collection nào để gán.{" "}
              <Link
                className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
                href="/admin/collections"
              >
                Tạo collection
              </Link>{" "}
              trước, sau đó quay lại gán sản phẩm.
            </p>
          ) : (
            <fieldset className="mt-8">
              <legend className="text-xs font-semibold uppercase tracking-[0.13em]">
                Thuộc collection
              </legend>
              <div className="mt-4 grid gap-x-8 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                {collectionChoices.map((choice) => (
                  <label
                    className="flex min-h-11 items-center gap-3 border-b border-black/10 py-2 text-sm"
                    key={choice.slug}
                  >
                    <input
                      className="size-5 shrink-0 accent-black focus-visible:outline-2 focus-visible:outline-offset-4"
                      defaultChecked={choice.checked}
                      name="collectionSlugs"
                      type="checkbox"
                      value={choice.slug}
                    />
                    <span className="min-w-0">
                      <span className="block truncate">{choice.title}</span>
                      <span className="block truncate text-xs text-black/50">
                        /{choice.slug}
                        {choice.isPublished ? "" : " · draft"}
                        {choice.missing ? " · không còn định nghĩa" : ""}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-4 max-w-2xl text-xs leading-5 text-black/55">
                Tối đa {PRODUCT_CONTENT_LIMITS.collectionCount} collection. Membership do website
                quản lý; bỏ chọn không xóa collection, chỉ gỡ sản phẩm khỏi collection đó.
              </p>
            </fieldset>
          )}
        </section>

        <section aria-labelledby="seo-heading" className="border-t border-black/20 pt-10">
          <p className="eyebrow">Tìm kiếm</p>
          <h2 id="seo-heading" className="mt-2 font-serif text-3xl tracking-[-0.03em]">
            SEO
          </h2>
          <div className="mt-8 space-y-8">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.13em]">SEO title</span>
              <input
                className={inputClassName}
                defaultValue={content?.seoTitle ?? ""}
                maxLength={PRODUCT_CONTENT_LIMITS.seoTitle}
                name="seoTitle"
                type="text"
              />
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.13em]">SEO description</span>
              <textarea
                className={textareaClassName}
                defaultValue={content?.seoDescription ?? ""}
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
  );
}
