import type { GuestCheckoutSubmitResult } from "./guest-checkout-submit.ts";

export type CheckoutSubmitFeedback = Readonly<{
  tone: "success" | "error" | "warning";
  title: string;
  message: string;
  mayRetry: boolean;
}>;

export function checkoutSubmitFeedback(
  result: GuestCheckoutSubmitResult,
): CheckoutSubmitFeedback {
  if (result.ok) {
    return {
      tone: "success",
      title: "Đặt hàng thành công",
      message: `Mã đơn ${result.orderCode}. LA Clothing sẽ liên hệ để xác nhận đơn COD.`,
      mayRetry: false,
    };
  }

  if (result.status === "PROCESSING") {
    return {
      tone: "warning",
      title: "Đơn hàng đang được xử lý",
      message: `Mã đơn ${result.orderCode} đang được xử lý. Vui lòng không gửi lại đơn để tránh tạo yêu cầu trùng.`,
      mayRetry: false,
    };
  }

  if (result.status === "SYNC_UNKNOWN") {
    return {
      tone: "warning",
      title: "Chưa xác định trạng thái đồng bộ",
      message: `Mã đơn ${result.orderCode} đã được tiếp nhận nhưng chưa xác định trạng thái tại Pancake. Vui lòng không gửi lại đơn; LA Clothing sẽ kiểm tra và liên hệ xác nhận.`,
      mayRetry: false,
    };
  }

  switch (result.reason) {
    case "INVALID_INPUT":
      return {
        tone: "error",
        title: "Kiểm tra lại thông tin",
        message:
          "Địa chỉ hoặc thông tin nhận hàng chưa hợp lệ. Hãy chọn lại đầy đủ tỉnh/thành, quận/huyện và phường/xã.",
        mayRetry: true,
      };
    case "CART_CHANGED":
      return {
        tone: "warning",
        title: "Giỏ hàng đã thay đổi",
        message:
          "Giá hoặc tồn kho đã thay đổi. Hãy quay lại giỏ hàng để kiểm tra trước khi đặt lại.",
        mayRetry: false,
      };
    case "CART_UNAVAILABLE":
      return {
        tone: "warning",
        title: "Giỏ hàng không còn sẵn sàng",
        message: "Giỏ hàng hiện không thể thanh toán. Hãy quay lại giỏ hàng và kiểm tra sản phẩm.",
        mayRetry: false,
      };
    case "SERVICE_UNAVAILABLE":
    case "CHECKOUT_UNAVAILABLE":
      return {
        tone: "error",
        title: "Chưa thể đặt hàng",
        message: "Hệ thống thanh toán đang tạm thời không sẵn sàng. Bạn có thể thử lại sau.",
        mayRetry: true,
      };
  }
}
