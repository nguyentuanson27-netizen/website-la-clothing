import assert from "node:assert/strict";
import test from "node:test";

import { PUBLIC_DELIVERY_FACTS, PUBLIC_RETURNS_POLICY } from "../../src/content/public-brand-facts.ts";
import {
  PUBLIC_DELIVERY_SCOPE_LABELS,
  PUBLIC_RETURN_LOGISTICS_FACTS,
} from "../../src/content/public-fulfillment-facts.ts";

test("M5 public return authority exposes the owner-approved Merchant-compatible facts", () => {
  assert.deepEqual(PUBLIC_RETURN_LOGISTICS_FACTS, {
    returnMethods: {
      inStore: "Trả trực tiếp tại cửa hàng / địa điểm kinh doanh.",
      byMail: "Gửi trả qua đường vận chuyển / bưu gửi.",
      byMailResponsibility: "Khách hàng tự chịu trách nhiệm gửi hàng và nhãn/phiếu gửi trả.",
    },
    restockingFeeVnd: 0,
    restockingFeeNote: "Không thu phí restocking.",
  });

  // The existing customer-initiated exchange fee remains a different business fact.
  assert.equal(PUBLIC_RETURNS_POLICY.customerInitiatedExchangeFeeVnd, 50_000);

  const customerChangeCases = PUBLIC_RETURNS_POLICY.supportedCases.filter((supportedCase) =>
    supportedCase.startsWith("Khách hàng"),
  );
  assert.equal(customerChangeCases.length, 2);
  for (const supportedCase of customerChangeCases) {
    assert.match(supportedCase, /chỉ đổi hàng/i);
    assert.match(supportedCase, /không trả hàng để hoàn tiền/i);
  }
});

test("M5 public delivery authority names the owner-approved Hanoi scopes explicitly", () => {
  assert.deepEqual(PUBLIC_DELIVERY_SCOPE_LABELS, {
    innerCity: "Nội thành Hà Nội",
    otherProvince: "Ngoài nội thành Hà Nội / các tỉnh, thành khác",
  });

  assert.deepEqual(PUBLIC_DELIVERY_FACTS.estimateDays, {
    innerCity: { minimum: 1, maximum: 3 },
    otherProvince: { minimum: 3, maximum: 15 },
  });
});
