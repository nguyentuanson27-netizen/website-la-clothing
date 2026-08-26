import assert from "node:assert/strict";
import test from "node:test";

import { describeGuestShippingPromotion } from "../../src/commerce/guest-shipping-policy.ts";
import { buildPublicBrandFacts } from "../../src/content/public-brand-facts.ts";

test("P16A public brand facts expose only approved identity and commerce facts", () => {
  const policy = {
    feeVnd: 25_000,
    freeShippingSubtotalVnd: 750_000,
    freeShippingMinQuantity: 4,
  } as const;

  const facts = buildPublicBrandFacts(policy);

  assert.deepEqual(facts, {
    brandName: "LA Clothing",
    brandSummary: "Minimal, modern menswear by LA Clothing.",
    paymentMethod: "Thanh toán khi nhận hàng (COD).",
    checkoutAccount: "Không cần tài khoản để thanh toán.",
    shipping: describeGuestShippingPromotion(policy),
    orderTracking: {
      title: "Tra cứu đơn hàng",
      detail:
        "Tra cứu trạng thái đơn COD bằng mã đơn và số điện thoại đã dùng khi đặt hàng.",
    },
    serverVerification:
      "Giá, tồn kho và phí vận chuyển được máy chủ kiểm tra lại khi bạn đặt hàng.",
  });

  for (const unsupportedClaim of ["material", "fit", "origin", "returnPolicy"]) {
    assert.equal(unsupportedClaim in facts, false, unsupportedClaim);
  }
});
