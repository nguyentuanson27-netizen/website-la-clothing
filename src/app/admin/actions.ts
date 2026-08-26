"use server";

import { revalidatePath } from "next/cache";

import { requireCurrentAdmin } from "@/auth/current-admin";
import { AuthorizationError } from "@/auth/authorization";
import {
  createProductContentBulkStatusAdminService,
  type ProductContentStatus,
} from "@/commerce/product-content-admin";
import { createProductContentRepository } from "@/commerce/product-content-repository";
import { prisma } from "@/db/prisma";

const repository = createProductContentRepository(prisma);
const bulkStatusAdminService = createProductContentBulkStatusAdminService({
  updateStatusesAtomically: repository.updateStatusesAtomically,
});

export type BulkProductStatusActionState =
  | { kind: "idle" }
  | { kind: "success"; updatedCount: number; status: ProductContentStatus }
  | { kind: "error"; message: string };

const genericBulkStatusError =
  "Không thể cập nhật trạng thái lúc này. Danh sách đã chọn được giữ nguyên để bạn thử lại.";

export async function bulkUpdateProductStatusAction(
  _previousState: BulkProductStatusActionState,
  formData: FormData,
): Promise<BulkProductStatusActionState> {
  let adminSession: Awaited<ReturnType<typeof requireCurrentAdmin>>;
  try {
    adminSession = await requireCurrentAdmin();
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return {
        kind: "error",
        message: "Phiên quản trị không còn hợp lệ. Tải lại trang và đăng nhập lại.",
      };
    }
    return { kind: "error", message: genericBulkStatusError };
  }

  let result: Awaited<ReturnType<typeof bulkStatusAdminService.update>>;
  try {
    result = await bulkStatusAdminService.update(adminSession, {
      productIds: formData.getAll("productId"),
      status: formData.get("status"),
    });
  } catch {
    return { kind: "error", message: genericBulkStatusError };
  }

  if (!result.ok) {
    return {
      kind: "error",
      message:
        result.reason === "PRODUCT_NOT_FOUND"
          ? "Có sản phẩm không còn tồn tại. Tải lại danh sách rồi thử lại."
          : result.reason === "UNAVAILABLE"
            ? genericBulkStatusError
            : "Lựa chọn hoặc trạng thái không hợp lệ. Kiểm tra lại rồi thử lại.",
    };
  }

  const status = formData.get("status");
  if (status !== "DRAFT" && status !== "REVIEWED" && status !== "PUBLISHED") {
    return {
      kind: "error",
      message: "Trạng thái cập nhật không hợp lệ.",
    };
  }

  revalidatePath("/admin");
  return { kind: "success", updatedCount: result.updatedCount, status };
}
