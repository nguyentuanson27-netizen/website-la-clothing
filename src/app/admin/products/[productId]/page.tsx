import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { requireCurrentAdmin, requireCurrentAdminPage } from "@/auth/current-admin";
import { createCollectionDefinitionRepository } from "@/commerce/collection-definition-repository";
import {
  createCompositeComponentAdminService,
  createCompositeParentVariantAdminService,
} from "@/commerce/composite-component-admin";
import { createCompositeComponentRepository } from "@/commerce/composite-component-repository";
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
const compositeRepository = createCompositeComponentRepository(prisma);
const compositeAdminService = createCompositeComponentAdminService({
  setLinkedVariantActivation: compositeRepository.setLinkedVariantActivation,
});
const compositeParentAdminService = createCompositeParentVariantAdminService({
  setParentVariantActivation: compositeRepository.setParentVariantActivation,
});
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
    componentSaved?: string | string[];
    componentError?: string | string[];
    parentVariantSaved?: string | string[];
    parentVariantError?: string | string[];
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
  const persistedProductSlug = product.slug;
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
      // Checkbox group: the domain parser takes the same comma-separated contract as before.
      collectionSlugs: formData
        .getAll("collectionSlugs")
        .filter((value): value is string => typeof value === "string")
        .join(", "),
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

  async function setCompositeVariantActivation(formData: FormData) {
    "use server";

    const adminSession = await requireCurrentAdmin();
    const rawState = formData.get("isActive");
    const isActive =
      rawState === "true" ? true : rawState === "false" ? false : rawState;

    const result = await compositeAdminService.setActivation(adminSession, {
      // Product identity is server-owned by the current editor route. Never trust a hidden
      // product/parent id to authorize this mutation.
      productId: persistedProductId,
      variantId: formData.get("variantId"),
      isActive,
    });

    if (!result.ok) {
      redirect(
        `${editorPath}?componentError=${
          result.reason === "COMPONENT_NOT_AVAILABLE" ? "unavailable" : "invalid"
        }`,
      );
    }

    revalidatePath(editorPath);
    revalidatePath("/admin");
    redirect(`${editorPath}?componentSaved=1`);
  }

  async function setCompositeParentVariantActivation(formData: FormData) {
    "use server";

    const adminSession = await requireCurrentAdmin();
    const rawState = formData.get("isActive");
    const isActive =
      rawState === "true" ? true : rawState === "false" ? false : rawState;

    const result = await compositeParentAdminService.setActivation(adminSession, {
      // The current editor owns the parent product identity. Hidden form fields are never allowed
      // to select another product or authorize a non-parent variant.
      productId: persistedProductId,
      variantId: formData.get("variantId"),
      isActive,
    });

    if (!result.ok) {
      redirect(
        `${editorPath}?parentVariantError=${
          result.reason === "PARENT_VARIANT_NOT_AVAILABLE" ? "unavailable" : "invalid"
        }`,
      );
    }

    revalidatePath(editorPath);
    revalidatePath("/admin");
    revalidatePath("/shop");
    revalidatePath(`/shop/${persistedProductSlug}`);
    redirect(`${editorPath}?parentVariantSaved=1`);
  }

  // Parent variants that actually carry persisted composite edges. Standalone products and
  // parents without edges produce an empty list, so the section below is not rendered at all.
  const compositeParents = product.variants
    .filter((variant) => variant.compositeComponents.length > 0)
    .map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      color: variant.color,
      size: variant.size,
      isPresent: variant.isPresent,
      isActive: variant.isActive,
      components: variant.compositeComponents.map((edge) => ({
        quantity: edge.quantity,
        variant: edge.componentVariant,
        stock: edge.componentVariant.warehouseStocks.reduce((acc, ws) => acc + ws.quantity, 0),
      })),
    }));

  // The activation owner is the child VariantMirror itself. Incoming persisted edges only decide
  // whether this website-owned global state is manageable from this child editor.
  const compositeChildren = product.variants.filter(
    (variant) => variant.compositeParents.length > 0,
  );

  const definedCollections = await collectionRepository.listForAdmin(100);
  const assignedSlugs = new Set(product.content?.collectionSlugs ?? []);
  const definedSlugs = new Set(definedCollections.map((collection) => collection.slug));
  const collectionChoices = [
    ...definedCollections.map((collection) => ({
      slug: collection.slug,
      title: collection.title,
      isPublished: collection.isPublished,
      checked: assignedSlugs.has(collection.slug),
      missing: false,
    })),
    // A slug saved earlier whose definition is gone stays visible and checked, so it is removed
    // deliberately rather than silently dropped on the next save.
    ...[...assignedSlugs]
      .filter((slug) => !definedSlugs.has(slug))
      .map((slug) => ({ slug, title: slug, isPublished: false, checked: true, missing: true })),
  ];

  const query = await searchParams;
  const saved = queryValue(query.saved) === "1";
  const invalid = queryValue(query.error) === "invalid";
  const formStatus = invalid ? "error" : saved ? "success" : null;
  const slugSaved = queryValue(query.slugSaved) === "1";
  const rawSlugError = queryValue(query.slugError);
  const slugError =
    rawSlugError === "invalid" || rawSlugError === "unavailable" ? rawSlugError : null;

  const componentSaved = queryValue(query.componentSaved) === "1";
  const rawComponentError = queryValue(query.componentError);
  const componentError =
    rawComponentError === "invalid" || rawComponentError === "unavailable"
      ? rawComponentError
      : null;
  const componentStatus = componentError ? "error" : componentSaved ? "success" : null;
  const componentErrorMessage =
    componentError === "unavailable"
      ? "Không thể cập nhật. Biến thể không còn là thành phần composite khả dụng."
      : "Không thể cập nhật. Dữ liệu biến thể không hợp lệ.";

  const parentVariantSaved = queryValue(query.parentVariantSaved) === "1";
  const rawParentVariantError = queryValue(query.parentVariantError);
  const parentVariantError =
    rawParentVariantError === "invalid" || rawParentVariantError === "unavailable"
      ? rawParentVariantError
      : null;
  const parentVariantStatus = parentVariantError
    ? "error"
    : parentVariantSaved
      ? "success"
      : null;
  const parentVariantErrorMessage =
    parentVariantError === "unavailable"
      ? "Không thể cập nhật. Biến thể cha không còn là parent composite khả dụng."
      : "Không thể cập nhật. Dữ liệu biến thể cha không hợp lệ.";

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
      <AdminFormStatus
        kind={componentStatus}
        successMessage="Đã cập nhật trạng thái biến thể composite."
        errorMessage={componentErrorMessage}
      />
      <AdminFormStatus
        kind={parentVariantStatus}
        successMessage="Đã cập nhật trạng thái biến thể cha composite."
        errorMessage={parentVariantErrorMessage}
      />

      <ProductSlugEditor
        productId={persistedProductId}
        currentSlug={product.slug}
        editorPath={editorPath}
        saved={slugSaved}
        error={slugError}
      />

      {compositeParents.length > 0 ? (
        <section
          aria-labelledby="composite-parent-activation-heading"
          className="mt-8 border border-black/20 bg-white p-6 md:p-8"
        >
          <p className="eyebrow">Website commerce</p>
          <h2
            id="composite-parent-activation-heading"
            className="mt-1 font-serif text-3xl tracking-[-0.03em]"
          >
            Kích hoạt biến thể set
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-black/70">
            Storefront chỉ đọc quan hệ composite từ các biến thể cha đang hoạt động. Kích hoạt từng biến thể set sau khi đã kiểm tra cấu thành bên dưới.
          </p>
          {!product.isActive ? (
            <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-rose-800">
              Catalog sản phẩm cha đang tắt. Bật biến thể chưa đủ để sản phẩm xuất hiện trên storefront.
            </p>
          ) : null}

          <div className="mt-6 space-y-4">
            {compositeParents.map((variant) => {
              const variantLabel =
                variant.sku ||
                [variant.color, variant.size].filter(Boolean).join(" / ") ||
                variant.id;
              const statusLabel = !variant.isPresent
                ? "Không còn đồng bộ"
                : variant.isActive
                  ? "Đã kích hoạt"
                  : "Chưa kích hoạt";

              return (
                <div
                  key={variant.id}
                  className="grid gap-4 border-t border-black/15 pt-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
                >
                  <div>
                    <p className="font-mono text-xs font-semibold">{variantLabel}</p>
                    <p className="mt-1 text-xs text-black/60">
                      {[variant.color, variant.size].filter(Boolean).join(" / ") || "Không có Màu / Size"}
                      {" · "}
                      {statusLabel}
                    </p>
                  </div>
                  <form action={setCompositeParentVariantActivation}>
                    <input name="variantId" type="hidden" value={variant.id} />
                    <input
                      name="isActive"
                      type="hidden"
                      value={String(!variant.isActive)}
                    />
                    <button
                      className="inline-flex min-h-11 items-center justify-center border border-black px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] transition-colors hover:bg-black hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!variant.isPresent}
                      type="submit"
                    >
                      {variant.isActive ? "Tắt" : "Kích hoạt"} biến thể set {variantLabel}
                    </button>
                  </form>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {compositeChildren.length > 0 ? (
        <section
          aria-labelledby="composite-activation-heading"
          className="mt-8 border border-black/20 bg-white p-6 md:p-8"
        >
          <p className="eyebrow">Website commerce</p>
          <h2
            id="composite-activation-heading"
            className="mt-1 font-serif text-3xl tracking-[-0.03em]"
          >
            Kích hoạt biến thể bán qua set
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-black/70">
            Trạng thái này thuộc biến thể trên website và áp dụng cho tất cả quan hệ composite đã đồng bộ.
          </p>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-black/70">
            Kích hoạt biến thể không làm sản phẩm con được công khai riêng.
          </p>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-black/70">
            Nếu sản phẩm con được bật bán riêng sau này, trạng thái của biến thể này vẫn được dùng cho sản phẩm đó.
          </p>

          <div className="mt-6 space-y-4">
            {compositeChildren.map((variant) => {
              const variantLabel =
                variant.sku ||
                [variant.color, variant.size].filter(Boolean).join(" / ") ||
                variant.id;
              const statusLabel = !variant.isPresent
                ? "Không còn đồng bộ"
                : variant.isActive
                  ? "Đã kích hoạt"
                  : "Chưa kích hoạt";

              return (
                <div
                  key={variant.id}
                  className="grid gap-4 border-t border-black/15 pt-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
                >
                  <div>
                    <p className="font-mono text-xs font-semibold">{variantLabel}</p>
                    <p className="mt-1 text-xs text-black/60">
                      {[variant.color, variant.size].filter(Boolean).join(" / ") || "Không có Màu / Size"}
                      {" · "}
                      {statusLabel}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
                      {variant.compositeParents.map(({ parentVariant }) => (
                        <Link
                          key={parentVariant.id}
                          className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
                          href={`/admin/products/${parentVariant.product.id}`}
                        >
                          {parentVariant.product.name}
                          {" · "}
                          {parentVariant.sku ||
                            [parentVariant.color, parentVariant.size]
                              .filter(Boolean)
                              .join(" / ") ||
                            parentVariant.id}
                        </Link>
                      ))}
                    </div>
                  </div>
                  <form action={setCompositeVariantActivation}>
                    <input name="variantId" type="hidden" value={variant.id} />
                    <input
                      name="isActive"
                      type="hidden"
                      value={String(!variant.isActive)}
                    />
                    <button
                      className="inline-flex min-h-11 items-center justify-center border border-black px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] transition-colors hover:bg-black hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={!variant.isPresent}
                      type="submit"
                    >
                      {variant.isActive ? "Tắt" : "Kích hoạt"} biến thể {variantLabel}
                    </button>
                  </form>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

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
              <span className="text-black/70">Giá bán: </span>
              <span className="text-black">{priceDisplay}</span>
            </div>
            <div className="border border-black/20 bg-white px-4 py-2">
              <span className="text-black/70">Biến thể: </span>
              <span className="text-black">{product.variants.length} phân loại</span>
            </div>
            <div className="border border-black/20 bg-white px-4 py-2">
              <span className="text-black/70">Tổng tồn kho: </span>
              <span className="text-black">{totalStock} cái</span>
            </div>
          </div>
        </div>

        {/* SOURCE DESCRIPTION */}
        <div className="mt-6">
          {product.sourceDescription ? (
            <p className="whitespace-pre-wrap text-sm leading-7 text-black/80">
              {product.sourceDescription}
            </p>
          ) : (
            <p className="text-sm leading-7 text-black/70">Chưa có mô tả nguồn từ Pancake.</p>
          )}
          <p className="mt-3 max-w-3xl text-xs leading-5 text-black/70">
            Dữ liệu này chỉ dùng làm ngữ cảnh đối chiếu. Đồng bộ Pancake không tự xuất bản và không ghi đè nội dung editorial hoặc SEO do website sở hữu.
          </p>
        </div>

        {/* IMAGE GALLERY */}
        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-black/80">
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
            <p className="mt-2 text-sm text-black/70 italic">
              Chưa có hình ảnh nào được tải lên Pancake cho sản phẩm này.
            </p>
          )}
        </div>

        {/* VARIANTS BREAKDOWN TABLE */}
        <div className="mt-8">
          <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-black/80">
            Chi tiết các biến thể (Màu / Size / Giá / Kho)
          </h3>
          {product.variants.length > 0 ? (
            <div
              aria-label="Bảng biến thể sản phẩm, cuộn ngang khi cần"
              className="mt-3 overflow-x-auto"
              tabIndex={0}
            >
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-black/20 bg-black/5 uppercase tracking-[0.1em] text-black/80">
                    <th scope="col" className="px-3 py-2.5">SKU</th>
                    <th scope="col" className="px-3 py-2.5">Màu sắc</th>
                    <th scope="col" className="px-3 py-2.5">Kích cỡ</th>
                    <th scope="col" className="px-3 py-2.5">Giá niêm yết</th>
                    <th scope="col" className="px-3 py-2.5">Giá sau giảm</th>
                    <th scope="col" className="px-3 py-2.5">Tồn kho</th>
                    <th scope="col" className="px-3 py-2.5">Trạng thái</th>
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
                            <span className="text-emerald-800">{stock}</span>
                          ) : (
                            <span className="text-rose-700">Hết hàng</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider ${
                              v.isActive ? "bg-emerald-100 text-emerald-900" : "bg-black/10 text-black/80"
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
            <p className="mt-2 text-sm text-black/70 italic">Chưa có biến thể nào.</p>
          )}
        </div>
      </section>

      {compositeParents.length > 0 ? (
        <section
          aria-labelledby="composite-components-heading"
          className="mt-8 border border-black/20 bg-black/[0.02] p-6 md:p-8"
        >
          <p className="eyebrow">Pancake composite</p>
          <h2 id="composite-components-heading" className="mt-1 font-serif text-3xl tracking-[-0.03em]">
            Thành phần sản phẩm / Sản phẩm con
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-black/70">
            Quan hệ dưới đây đọc trực tiếp từ composite mirror đã đồng bộ, không suy luận theo tên,
            SKU hay category. Chỉ để kiểm tra; chỉnh sửa cấu thành vẫn thuộc Pancake.
          </p>

          <div className="mt-6 space-y-8">
            {compositeParents.map((parent) => (
              <div key={parent.id}>
                <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-black/80">
                  Biến thể cha: {parent.sku || "—"}
                  {parent.color || parent.size
                    ? ` · ${[parent.color, parent.size].filter(Boolean).join(" / ")}`
                    : ""}
                </h3>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[48rem] text-left text-xs">
                    <caption className="sr-only">
                      Sản phẩm con cấu thành biến thể {parent.sku || parent.id}
                    </caption>
                    <thead>
                      <tr className="border-b border-black/20 bg-black/5 uppercase tracking-[0.1em] text-black/80">
                        <th className="px-3 py-2.5" scope="col">
                          Sản phẩm con
                        </th>
                        <th className="px-3 py-2.5" scope="col">
                          SKU
                        </th>
                        <th className="px-3 py-2.5" scope="col">
                          Màu / Size
                        </th>
                        <th className="px-3 py-2.5" scope="col">
                          Số lượng cấu thành
                        </th>
                        <th className="px-3 py-2.5" scope="col">
                          Tồn kho
                        </th>
                        <th className="px-3 py-2.5" scope="col">
                          Trạng thái
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/10">
                      {parent.components.map((component) => {
                        const child = component.variant;
                        const statusLabel = !child.product.isPresent
                          ? "Sản phẩm con không còn đồng bộ"
                          : !child.isPresent
                            ? "Biến thể không còn đồng bộ"
                            : child.isActive
                              ? "Đã kích hoạt biến thể"
                              : "Chưa kích hoạt biến thể";
                        const variantReady =
                          child.product.isPresent && child.isPresent && child.isActive;

                        return (
                          <tr className="hover:bg-black/[0.02]" key={`${parent.id}-${child.id}`}>
                            <td className="px-3 py-2.5">
                              <Link
                                className="font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
                                href={`/admin/products/${child.product.id}`}
                              >
                                {child.product.name}
                              </Link>
                              <span className="mt-0.5 block text-black/50">
                                /{child.product.slug}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 font-mono">{child.sku || "—"}</td>
                            <td className="px-3 py-2.5 font-medium">
                              {[child.color, child.size].filter(Boolean).join(" / ") || "—"}
                            </td>
                            <td className="px-3 py-2.5 font-semibold">×{component.quantity}</td>
                            <td className="px-3 py-2.5 font-semibold">
                              {component.stock > 0 ? (
                                <span className="text-emerald-800">{component.stock}</span>
                              ) : (
                                <span className="text-rose-700">Hết hàng</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              <span
                                className={`inline-block rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider ${
                                  variantReady
                                    ? "bg-emerald-100 text-emerald-900"
                                    : "bg-black/10 text-black/80"
                                }`}
                              >
                                {statusLabel}
                              </span>
                              <span className="mt-1 block text-[0.65rem] text-black/55">
                                Catalog riêng: {child.product.isActive ? "đang hoạt động" : "tắt"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

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
