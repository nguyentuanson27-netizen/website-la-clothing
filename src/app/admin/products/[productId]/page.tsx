import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { readAuthServerConfig } from "@/auth/config";
import { requireCurrentAdmin, requireCurrentAdminPage } from "@/auth/current-admin";
import { createCollectionDefinitionRepository } from "@/commerce/collection-definition-repository";
import {
  createProductContentAdminService,
  PRODUCT_CONTENT_LIMITS,
} from "@/commerce/product-content-admin";
import { createProductContentRepository } from "@/commerce/product-content-repository";
import { createProductCommerceAdminService } from "@/commerce/product-commerce-admin";
import { createProductCommerceRepository } from "@/commerce/product-commerce-repository";
import { AdminFormStatus } from "@/components/admin/admin-form-status";
import {
  initialProductCommerceActionState,
  ProductCommercePanel,
  type ProductCommerceActionState,
  type ProductCommerceVariantRow,
} from "@/components/admin/product-commerce-panel";
import { ProductSlugEditor } from "@/components/admin/product-slug-editor";
import { prisma } from "@/db/prisma";

export const metadata: Metadata = {
  title: "Biên tập nội dung sản phẩm",
};

const repository = createProductContentRepository(prisma);
const collectionRepository = createCollectionDefinitionRepository(prisma);
const productCommerceRepository = createProductCommerceRepository(prisma);
const productCommerceAdminService = createProductCommerceAdminService({
  setVariantActivation: productCommerceRepository.setVariantActivation,
  readCatalogEnableWarningState: productCommerceRepository.readCatalogEnableWarningState,
  commitCatalogEnable: productCommerceRepository.commitCatalogEnable,
  disableCatalog: productCommerceRepository.disableCatalog,
  activateProductAndStockedVariants: productCommerceRepository.activateProductAndStockedVariants,
  readConfirmationSecret: () => readAuthServerConfig().secret,
  nowMs: () => Date.now(),
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

function productCommerceError(message: string): ProductCommerceActionState {
  return { kind: "error", message };
}

type ProductEditorPageProps = {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{
    saved?: string | string[];
    error?: string | string[];
    slugSaved?: string | string[];
    slugError?: string | string[];
    variantSaved?: string | string[];
    variantError?: string | string[];
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

  async function setWebsiteVariantActivation(formData: FormData) {
    "use server";

    const adminSession = await requireCurrentAdmin();
    const activateVariantId = formData.get("activateVariantId");
    const deactivateVariantId = formData.get("deactivateVariantId");
    const bulkState = formData.get("bulkState");

    const hasActivate = typeof activateVariantId === "string";
    const hasDeactivate = typeof deactivateVariantId === "string";
    const hasBulk = bulkState === "true" || bulkState === "false";
    if (Number(hasActivate) + Number(hasDeactivate) + Number(hasBulk) !== 1) {
      redirect(`${editorPath}?variantError=invalid`);
    }

    let variantIds: unknown[];
    let isActive: boolean;
    if (hasActivate) {
      variantIds = [activateVariantId];
      isActive = true;
    } else if (hasDeactivate) {
      variantIds = [deactivateVariantId];
      isActive = false;
    } else {
      variantIds = formData.getAll("variantId");
      isActive = bulkState === "true";
    }

    const result = await productCommerceAdminService.setVariantActivation(
      adminSession,
      persistedProductId,
      { variantIds, isActive },
    );
    if (!result.ok) {
      redirect(
        `${editorPath}?variantError=${
          result.reason === "VARIANT_NOT_AVAILABLE" ? "unavailable" : "invalid"
        }`,
      );
    }

    revalidatePath(editorPath);
    revalidatePath("/admin");
    revalidatePath("/shop");
    revalidatePath(`/shop/${persistedProductSlug}`);
    redirect(`${editorPath}?variantSaved=1`);
  }

  async function manageProductCommerce(
    _previousState: ProductCommerceActionState,
    formData: FormData,
  ): Promise<ProductCommerceActionState> {
    "use server";

    const adminSession = await requireCurrentAdmin();
    const intent = formData.get("intent");

    if (intent === "catalog-prepare") {
      const result = await productCommerceAdminService.prepareCatalogEnable(
        adminSession,
        persistedProductId,
      );
      if (!result.ok) {
        return productCommerceError(
          result.reason === "PRODUCT_NOT_AVAILABLE"
            ? "Sản phẩm không còn khả dụng."
            : "Không thể chuẩn bị xác nhận bật catalog.",
        );
      }
      return {
        kind: "catalog-confirm",
        warningState: result.warningState,
        proof: result.proof,
        expiresAtMs: result.expiresAtMs,
      };
    }

    if (intent === "catalog-commit") {
      const result = await productCommerceAdminService.commitCatalogEnable(
        adminSession,
        persistedProductId,
        { proof: formData.get("proof") },
      );
      if (result.ok) {
        revalidatePath(editorPath);
        revalidatePath("/admin");
        revalidatePath("/shop");
        revalidatePath(`/shop/${persistedProductSlug}`);
        return { kind: "success", operation: "catalog-enable" };
      }
      if (result.reason === "RECONFIRM_REQUIRED") {
        revalidatePath(editorPath);
        return {
          kind: "catalog-reconfirm",
          warningState: result.warningState,
          proof: result.proof,
          expiresAtMs: result.expiresAtMs,
        };
      }
      return productCommerceError("Sản phẩm không còn khả dụng.");
    }

    if (intent === "catalog-disable") {
      const result = await productCommerceAdminService.disableCatalog(
        adminSession,
        persistedProductId,
      );
      if (!result.ok) {
        return productCommerceError(
          result.reason === "PRODUCT_NOT_AVAILABLE"
            ? "Sản phẩm không còn khả dụng."
            : "Không thể tắt catalog.",
        );
      }
      revalidatePath(editorPath);
      revalidatePath("/admin");
      revalidatePath("/shop");
      revalidatePath(`/shop/${persistedProductSlug}`);
      return { kind: "success", operation: "catalog-disable" };
    }

    if (intent === "quick-activate") {
      const result = await productCommerceAdminService.activateProductAndStockedVariants(
        adminSession,
        persistedProductId,
      );
      if (!result.ok) {
        revalidatePath(editorPath);
        return productCommerceError(
          result.reason === "COMPOSITE_CHILD"
            ? "Sản phẩm hiện là thành phần của set/composite. Thao tác đã bị hủy và không có dữ liệu nào được thay đổi."
            : "Sản phẩm không còn khả dụng.",
        );
      }
      revalidatePath(editorPath);
      revalidatePath("/admin");
      revalidatePath("/shop");
      revalidatePath(`/shop/${persistedProductSlug}`);
      return {
        kind: "success",
        operation: "quick-activate",
        activatedVariantCount: result.activatedVariantCount,
      };
    }

    return productCommerceError("Thao tác website commerce không hợp lệ.");
  }

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
    ...[...assignedSlugs]
      .filter((slug) => !definedSlugs.has(slug))
      .map((slug) => ({ slug, title: slug, isPublished: false, checked: true, missing: true })),
  ];

  const commerceVariants: ProductCommerceVariantRow[] = product.variants
    .filter((variant) => variant.isPresent)
    .map((variant) => {
      const contexts: ProductCommerceVariantRow["contexts"] = [];
      if (variant.compositeComponents.length > 0) contexts.push("Set cha");
      if (variant.compositeParents.length > 0) contexts.push("Thành phần set");
      if (contexts.length === 0) contexts.push("Thường");
      return {
        id: variant.id,
        label:
          variant.sku ||
          [variant.color, variant.size].filter(Boolean).join(" / ") ||
          variant.id,
        sku: variant.sku,
        color: variant.color,
        size: variant.size,
        stock: variant.warehouseStocks.reduce((sum, warehouse) => sum + warehouse.quantity, 0),
        isActive: variant.isActive,
        contexts,
      };
    });
  const quickActionEligible = !product.variants.some(
    (variant) => variant.compositeParents.length > 0,
  );

  const query = await searchParams;
  const saved = queryValue(query.saved) === "1";
  const invalid = queryValue(query.error) === "invalid";
  const formStatus = invalid ? "error" : saved ? "success" : null;
  const slugSaved = queryValue(query.slugSaved) === "1";
  const rawSlugError = queryValue(query.slugError);
  const slugError =
    rawSlugError === "invalid" || rawSlugError === "unavailable" ? rawSlugError : null;
  const variantSaved = queryValue(query.variantSaved) === "1";
  const rawVariantError = queryValue(query.variantError);
  const variantError =
    rawVariantError === "invalid" || rawVariantError === "unavailable" ? rawVariantError : null;
  const variantStatus = variantError ? "error" : variantSaved ? "success" : null;
  const variantErrorMessage =
    variantError === "unavailable"
      ? "Không thể cập nhật. Một hoặc nhiều biến thể không còn khả dụng cho sản phẩm này."
      : "Không thể cập nhật. Dữ liệu biến thể không hợp lệ.";

  const allImages = new Set<string>();
  if (product.primaryImageUrl) {
    allImages.add(product.primaryImageUrl);
  }
  for (const variant of product.variants) {
    if (Array.isArray(variant.pancakeImageUrls)) {
      for (const image of variant.pancakeImageUrls) {
        if (typeof image === "string" && image.startsWith("http")) {
          allImages.add(image);
        }
      }
    }
  }
  const imageUrls = Array.from(allImages);

  const prices = product.variants
    .map((variant) => variant.pancakeRetailPriceAfterDiscount ?? variant.pancakeRetailPrice)
    .filter((price): price is number => typeof price === "number" && !Number.isNaN(price));
  const minPrice = prices.length > 0 ? Math.min(...prices) : null;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : null;
  const priceDisplay =
    minPrice !== null && maxPrice !== null
      ? minPrice === maxPrice
        ? formatVnd(minPrice)
        : `${formatVnd(minPrice)} – ${formatVnd(maxPrice)}`
      : "Chưa có giá";

  const totalStock = product.variants.reduce((acc, variant) => {
    const variantStock = variant.warehouseStocks.reduce((sum, warehouse) => sum + warehouse.quantity, 0);
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
        kind={variantStatus}
        successMessage="Đã cập nhật trạng thái biến thể website."
        errorMessage={variantErrorMessage}
      />

      <ProductCommercePanel
        commerceAction={manageProductCommerce}
        collectionCount={assignedSlugs.size}
        productIsActive={product.isActive}
        productName={product.name}
        quickActionEligible={quickActionEligible}
        variantAction={setWebsiteVariantActivation}
        variants={commerceVariants}
      />

      <ProductSlugEditor
        productId={persistedProductId}
        currentSlug={product.slug}
        editorPath={editorPath}
        saved={slugSaved}
        error={slugError}
      />

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

        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-black/80">
            Hình ảnh sản phẩm ({imageUrls.length} ảnh)
          </h3>
          {imageUrls.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-4">
              {imageUrls.map((url, index) => (
                <div
                  key={url}
                  className="relative aspect-[3/4] w-24 overflow-hidden border border-black/20 bg-[var(--stone)] md:w-32"
                >
                  <Image
                    src={url}
                    alt={`${product.name} ảnh ${index + 1}`}
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
                  {product.variants.map((variant) => {
                    const stock = variant.warehouseStocks.reduce(
                      (acc, warehouse) => acc + warehouse.quantity,
                      0,
                    );
                    return (
                      <tr key={variant.id} className="hover:bg-black/[0.02]">
                        <td className="px-3 py-2.5 font-mono">{variant.sku || "—"}</td>
                        <td className="px-3 py-2.5 font-medium">{variant.color || "—"}</td>
                        <td className="px-3 py-2.5 font-medium">{variant.size || "—"}</td>
                        <td className="px-3 py-2.5">{formatVnd(variant.pancakeRetailPrice)}</td>
                        <td className="px-3 py-2.5 font-medium text-black">
                          {variant.pancakeRetailPriceAfterDiscount
                            ? formatVnd(variant.pancakeRetailPriceAfterDiscount)
                            : formatVnd(variant.pancakeRetailPrice)}
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
                              variant.isActive
                                ? "bg-emerald-100 text-emerald-900"
                                : "bg-black/10 text-black/80"
                            }`}
                          >
                            {variant.isActive ? "Hoạt động" : "Tắt"}
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
                        <th className="px-3 py-2.5" scope="col">Sản phẩm con</th>
                        <th className="px-3 py-2.5" scope="col">SKU</th>
                        <th className="px-3 py-2.5" scope="col">Màu / Size</th>
                        <th className="px-3 py-2.5" scope="col">Số lượng cấu thành</th>
                        <th className="px-3 py-2.5" scope="col">Tồn kho</th>
                        <th className="px-3 py-2.5" scope="col">Trạng thái</th>
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
                              <span className="mt-0.5 block text-black/60">
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
