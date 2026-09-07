import assert from "node:assert/strict";
import test from "node:test";

import { describeGuestShippingPromotion } from "../../src/commerce/guest-shipping-policy.ts";
import {
  buildPublicBrandFacts,
  PUBLIC_CONTACT_FACTS,
} from "../../src/content/public-brand-facts.ts";

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

/**
 * U32b / B2. These are the contact facts the owner approved in
 * `docs/specs/la-clothing-owner-approved-facts-and-decisions.md` §2, transcribed exactly. The test
 * is a transcription check, not a formatting preference: the Organization entity and, later, the
 * Contact page both read this constant, so a typo here would publish a wrong phone number on the
 * storefront and in structured data at once.
 */
test("U32b public contact facts transcribe the approved B2 source exactly", () => {
  assert.deepEqual(PUBLIC_CONTACT_FACTS, {
    telephone: "0923159666",
    email: "laclothing2025@gmail.com",
    fanpageUrl: "https://www.facebook.com/LAclothing.vn",
    streetAddress: "212 Nguyễn Trãi, Đại Mỗ",
    addressLocality: "Hà Nội",
    supportHours: {
      opens: "08:00:00+07:00",
      closes: "22:00:00+07:00",
    },
  });

  assert.equal(Object.isFrozen(PUBLIC_CONTACT_FACTS), true);
  assert.equal(Object.isFrozen(PUBLIC_CONTACT_FACTS.supportHours), true);
});

test("U32b carries no owner fact B2 did not approve", () => {
  // B6 leaves the registered entity name, tax code and founding facts unapproved for publication,
  // and no source states a logo asset or a postal country. None may appear here by inference.
  for (const unapproved of [
    "logo",
    "legalEntity",
    "taxCode",
    "vatID",
    "foundingDate",
    "founder",
    "addressCountry",
    "postalCode",
    "zaloUrl",
  ]) {
    assert.equal(unapproved in PUBLIC_CONTACT_FACTS, false, unapproved);
  }
});
