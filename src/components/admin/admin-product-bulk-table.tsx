"use client";

import Image from "next/image";
import Link from "next/link";
import { type FormEvent, useEffect, useRef, useState } from "react";

import {
  bulkUpdateProductStatusAction,
  type BulkProductStatusActionState,
} from "@/app/admin/actions";
import type { ProductContentStatus } from "@/commerce/product-content-admin";

const statusLabels: Record<ProductContentStatus, string> = {
  DRAFT: "Nháp",
  REVIEWED: "Đã duyệt",
  PUBLISHED: "Đã xuất bản",
};

const statusStyles: Record<ProductContentStatus, string> = {
  DRAFT: "bg-black/10 text-black/70",
  REVIEWED: "bg-amber-100 text-amber-900",
  PUBLISHED: "bg-emerald-100 text-emerald-900",
};

const initialActionState: BulkProductStatusActionState = { kind: "idle" };
const genericBulkStatusError =
  "Không thể cập nhật trạng thái lúc này. Danh sách đã chọn được giữ nguyên để bạn thử lại.";

type AdminProductBulkTableRow = {
  id: string;
  name: string;
  slug: string;
  primaryImageUrl: string | null;
  isActive: boolean;
  status: ProductContentStatus;
  collections: Array<{
    slug: string;
    label: string;
    href: string;
  }>;
  price: string | null;
  variantCount: number;
};

type AdminProductBulkTableProps = {
  products: AdminProductBulkTableRow[];
};

export function AdminProductBulkTable({ products }: AdminProductBulkTableProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [targetStatus, setTargetStatus] = useState<ProductContentStatus>("REVIEWED");
  const [confirming, setConfirming] = useState(false);
  const [actionState, setActionState] = useState<BulkProductStatusActionState>(initialActionState);
  const [isPending, setIsPending] = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);

  const selectedCount = selectedIds.size;
  const allSelected = products.length > 0 && selectedCount === products.length;
  const partlySelected = selectedCount > 0 && selectedCount < products.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = partlySelected;
    }
  }, [partlySelected]);

  function toggleProduct(productId: string, checked: boolean) {
    setConfirming(false);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(productId);
      else next.delete(productId);
      return next;
    });
  }

  function toggleCurrentPage(checked: boolean) {
    setConfirming(false);
    setSelectedIds(checked ? new Set(products.map((product) => product.id)) : new Set());
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setConfirming(false);
  }

  async function submitBulkStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedCount === 0 || isPending) return;

    const formData = new FormData(event.currentTarget);
    setIsPending(true);
    try {
      const result = await bulkUpdateProductStatusAction(initialActionState, formData);
      setActionState(result);
      if (result.kind === "success") {
        setSelectedIds(new Set());
        setConfirming(false);
      }
    } catch {
      setActionState({ kind: "error", message: genericBulkStatusError });
    } finally {
      setIsPending(false);
      requestAnimationFrame(() => feedbackRef.current?.focus());
    }
  }

  const feedback =
    actionState.kind === "success"
      ? `Đã cập nhật ${actionState.updatedCount} sản phẩm sang ${statusLabels[actionState.status]}.`
      : actionState.kind === "error"
        ? actionState.message
        : null;

  return (
    <form onSubmit={submitBulkStatus}>
      <div
        ref={feedbackRef}
        aria-atomic={feedback ? "true" : undefined}
        className="min-h-0 focus-visible:outline-2 focus-visible:outline-offset-4"
        role={actionState.kind === "error" ? "alert" : actionState.kind === "success" ? "status" : undefined}
        tabIndex={-1}
      >
        {feedback ? (
          <p className="mb-4 border-l-2 border-black pl-4 text-sm font-semibold">{feedback}</p>
        ) : null}
      </div>

      {selectedCount > 0 ? (
        <div className="sticky top-0 z-20 mb-3 border border-black bg-[var(--background)] p-3 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <p className="text-sm font-semibold" aria-live="polite">
              Đã chọn {selectedCount} sản phẩm
            </p>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="block min-w-44">
                <span className="text-[0.65rem] font-semibold uppercase tracking-[0.13em]">
                  Trạng thái mới
                </span>
                <select
                  className="mt-1 min-h-11 w-full border border-black/25 bg-white px-3 py-2 text-sm outline-none focus-visible:border-black focus-visible:outline-2 focus-visible:outline-offset-2"
                  disabled={isPending}
                  name="status"
                  onChange={(event) => {
                    setTargetStatus(event.target.value as ProductContentStatus);
                    setConfirming(false);
                  }}
                  value={targetStatus}
                >
                  <option value="DRAFT">{statusLabels.DRAFT}</option>
                  <option value="REVIEWED">{statusLabels.REVIEWED}</option>
                  <option value="PUBLISHED">{statusLabels.PUBLISHED}</option>
                </select>
              </label>

              {!confirming ? (
                <button
                  className="inline-flex min-h-11 items-center justify-center border border-black bg-black px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white transition-colors hover:bg-white hover:text-black focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isPending}
                  onClick={() => setConfirming(true)}
                  type="button"
                >
                  Cập nhật {selectedCount} sản phẩm
                </button>
              ) : (
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Xác nhận cập nhật hàng loạt">
                  <span className="text-sm">
                    Cập nhật {selectedCount} sản phẩm sang {statusLabels[targetStatus]}?
                  </span>
                  <button
                    className="inline-flex min-h-11 items-center justify-center border border-black bg-black px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-white focus-visible:outline-2 focus-visible:outline-offset-4 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isPending}
                    type="submit"
                  >
                    {isPending ? "Đang cập nhật…" : "Xác nhận"}
                  </button>
                  <button
                    className="inline-flex min-h-11 items-center justify-center px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
                    disabled={isPending}
                    onClick={() => setConfirming(false)}
                    type="button"
                  >
                    Hủy
                  </button>
                </div>
              )}

              <button
                className="inline-flex min-h-11 items-center justify-center px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-50"
                disabled={isPending}
                onClick={clearSelection}
                type="button"
              >
                Bỏ chọn
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto border-y border-black/20">
        <table className="w-full min-w-[68rem] border-collapse text-left">
          <caption className="sr-only">
            Danh sách sản phẩm với lựa chọn hàng loạt, trạng thái nội dung, collection và giá tham chiếu
          </caption>
          <thead>
            <tr className="border-b border-black/20 text-[0.65rem] uppercase tracking-[0.14em] text-black/60">
              <th className="w-12 py-2 pr-3 font-semibold" scope="col">
                <input
                  ref={selectAllRef}
                  aria-label="Chọn tất cả sản phẩm trên trang này"
                  checked={allSelected}
                  className="h-5 w-5 accent-black focus-visible:outline-2 focus-visible:outline-offset-2"
                  onChange={(event) => toggleCurrentPage(event.target.checked)}
                  type="checkbox"
                />
              </th>
              <th className="py-3 pr-4 font-semibold" scope="col">
                <span className="sr-only">Ảnh</span>
              </th>
              <th className="py-3 pr-4 font-semibold" scope="col">Sản phẩm</th>
              <th className="py-3 pr-4 font-semibold" scope="col">Trạng thái</th>
              <th className="py-3 pr-4 font-semibold" scope="col">Collection</th>
              <th className="py-3 pr-4 font-semibold" scope="col">Giá</th>
              <th className="py-3 pr-4 font-semibold" scope="col">Biến thể</th>
              <th className="py-3 font-semibold" scope="col">
                <span className="sr-only">Hành động</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/12">
            {products.map((product) => (
              <tr className="align-middle transition-colors hover:bg-black/[0.03]" key={product.id}>
                <td className="py-2 pr-3">
                  <input
                    aria-label={`Chọn ${product.name}`}
                    checked={selectedIds.has(product.id)}
                    className="h-5 w-5 accent-black focus-visible:outline-2 focus-visible:outline-offset-2"
                    name="productId"
                    onChange={(event) => toggleProduct(product.id, event.target.checked)}
                    type="checkbox"
                    value={product.id}
                  />
                </td>
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
                    <div className="flex aspect-[3/4] w-12 items-center justify-center border border-black/15 bg-black/5 text-[0.55rem] uppercase tracking-wider text-black/70">
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
                  <span className={`inline-block rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider ${statusStyles[product.status]}`}>
                    {statusLabels[product.status]}
                  </span>
                </td>
                <td className="py-3 pr-4">
                  {product.collections.length === 0 ? (
                    <span className="text-xs text-black/45">Chưa phân loại</span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {product.collections.map((collection) => (
                        <Link
                          className="inline-flex min-h-7 items-center border border-black/20 px-2 py-0.5 text-xs transition-colors hover:border-black focus-visible:outline-2 focus-visible:outline-offset-2"
                          href={collection.href}
                          key={collection.slug}
                        >
                          {collection.label}
                        </Link>
                      ))}
                    </span>
                  )}
                </td>
                <td className="py-3 pr-4 text-sm font-semibold">{product.price ?? "—"}</td>
                <td className="py-3 pr-4 text-sm text-black/60">{product.variantCount}</td>
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
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}
