import assert from "node:assert/strict";
import test from "node:test";

import {
  PUBLIC_DELIVERY_FACTS,
  PUBLIC_RETURNS_POLICY,
} from "../../src/content/public-brand-facts.ts";

test("M5 public return authority exposes the owner-approved Merchant-compatible facts", () => {
  const policy = PUBLIC_RETURNS_POLICY as unknown as Record<string, unknown>;

  assert.deepEqual(policy.returnMethods, {
    inStore: "Trả trực tiếp tại cửa hàng / địa điểm kinh doanh.",
    byMail: "Gửi trả qua đường vận chuyển / bưu gửi.",
    byMailResponsibility: "Khách hàng tự chịu trách nhiệm gửi hàng và nhãn/phiếu gửi trả.",
  });
  assert.equal(policy.restockingFeeVnd, 0);
  assert.equal(policy.restockingFeeNote, "Không thu phí restocking.");

  // The existing customer-initiated exchange fee remains a different business fact.
  assert.equal(policy.customerInitiatedExchangeFeeVnd, 50_000);
});

test("M5 public delivery authority names the owner-approved Hanoi scopes explicitly", () => {
  const delivery = PUBLIC_DELIVERY_FACTS as unknown as Record<string, unknown>;

  assert.deepEqual(delivery.estimateLabels, {
    innerCity: "Nội thành Hà Nội",
    otherProvince: "Ngoài nội thành Hà Nội / các tỉnh, thành khác",
  });

  assert.deepEqual(PUBLIC_DELIVERY_FACTS.estimateDays, {
    innerCity: { minimum: 1, maximum: 3 },
    otherProvince: { minimum: 3, maximum: 15 },
  });
});
