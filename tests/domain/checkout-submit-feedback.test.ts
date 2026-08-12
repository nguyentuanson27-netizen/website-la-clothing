import assert from "node:assert/strict";
import test from "node:test";

import { checkoutSubmitFeedback } from "../../src/commerce/checkout-submit-feedback.ts";

test("confirmed checkout feedback surfaces the order code", () => {
  assert.deepEqual(
    checkoutSubmitFeedback({ ok: true, status: "CONFIRMED", orderCode: "LA-123" }),
    {
      tone: "success",
      title: "Đặt hàng thành công",
      message: "Mã đơn LA-123. LA Clothing sẽ liên hệ để xác nhận đơn COD.",
      mayRetry: false,
    },
  );
});

test("processing and sync-unknown feedback never suggests a blind resubmit", () => {
  for (const result of [
    { ok: false as const, status: "PROCESSING" as const, orderCode: "LA-456" },
    { ok: false as const, status: "SYNC_UNKNOWN" as const, orderCode: "LA-789" },
  ]) {
    const feedback = checkoutSubmitFeedback(result);
    assert.equal(feedback.mayRetry, false);
    assert.match(feedback.message, /không gửi lại/i);
    assert.match(feedback.message, new RegExp(result.orderCode));
  }
});

test("retryable checkout feedback distinguishes invalid input, cart drift and temporary service failures", () => {
  assert.deepEqual(
    checkoutSubmitFeedback({ ok: false, status: "RETRYABLE", reason: "INVALID_INPUT" }),
    {
      tone: "error",
      title: "Kiểm tra lại thông tin",
      message: "Địa chỉ hoặc thông tin nhận hàng chưa hợp lệ. Hãy chọn lại đầy đủ tỉnh/thành, quận/huyện và phường/xã.",
      mayRetry: true,
    },
  );
  assert.equal(
    checkoutSubmitFeedback({ ok: false, status: "RETRYABLE", reason: "CART_CHANGED" }).mayRetry,
    false,
  );
  assert.equal(
    checkoutSubmitFeedback({ ok: false, status: "RETRYABLE", reason: "CHECKOUT_UNAVAILABLE" }).mayRetry,
    true,
  );
});
