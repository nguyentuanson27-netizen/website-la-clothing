import assert from "node:assert/strict";
import test from "node:test";

import { parseGuestCheckoutInput } from "../../src/commerce/guest-checkout-input.ts";

test("guest checkout accepts only the approved COD contact/address fields", () => {
  const result = parseGuestCheckoutInput({
    name: "  Nguyễn Văn A  ",
    phone: "  0901234567  ",
    provinceRef: "  province-01  ",
    districtRef: "  district-001  ",
    communeRef: "  commune-0001  ",
    detail: "  12 Đường A, căn hộ 3B  ",
    note: "  Gọi trước khi giao  ",
    price: 1,
    stock: 999,
    discount: 100,
    shippingFee: 0,
    pancakeOrderId: "browser-controlled",
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      name: "Nguyễn Văn A",
      phone: "0901234567",
      provinceRef: "province-01",
      districtRef: "district-001",
      communeRef: "commune-0001",
      detail: "12 Đường A, căn hộ 3B",
      note: "Gọi trước khi giao",
    },
  });
});

test("guest checkout normalizes a blank optional note to null", () => {
  assert.deepEqual(
    parseGuestCheckoutInput({
      name: "Nguyễn Văn A",
      phone: "0901234567",
      provinceRef: "province-01",
      districtRef: "district-001",
      communeRef: "commune-0001",
      detail: "12 Đường A",
      note: "   ",
    }),
    {
      ok: true,
      value: {
        name: "Nguyễn Văn A",
        phone: "0901234567",
        provinceRef: "province-01",
        districtRef: "district-001",
        communeRef: "commune-0001",
        detail: "12 Đường A",
        note: null,
      },
    },
  );
});

test("guest checkout fails closed for malformed, missing, blank, or unbounded fields", () => {
  const valid = {
    name: "Nguyễn Văn A",
    phone: "0901234567",
    provinceRef: "province-01",
    districtRef: "district-001",
    communeRef: "commune-0001",
    detail: "12 Đường A",
  };

  for (const input of [
    null,
    [],
    {},
    { ...valid, name: "" },
    { ...valid, phone: 901234567 },
    { ...valid, provinceRef: "   " },
    { ...valid, districtRef: null },
    { ...valid, communeRef: undefined },
    { ...valid, detail: "x".repeat(2_049) },
    { ...valid, note: "x".repeat(2_049) },
  ]) {
    assert.deepEqual(parseGuestCheckoutInput(input), { ok: false, reason: "INVALID_INPUT" });
  }
});
