import assert from "node:assert/strict";
import test from "node:test";

import { describeGuestShippingPromotion } from "../../src/commerce/guest-shipping-policy.ts";
import { normalizeVietnamesePhone } from "../../src/integrations/meta/conversions-api.ts";
import {
  buildPublicBrandFacts,
  describePublicAddress,
  describePublicSupportHours,
  PUBLIC_CONTACT_FACTS,
  supportHoursSchemaTime,
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
    telephoneInternational: "+84923159666",
    email: "laclothing2025@gmail.com",
    fanpageUrl: "https://www.facebook.com/LAclothing.vn",
    streetAddress: "212 Nguyễn Trãi, Đại Mỗ",
    addressLocality: "Hà Nội",
    supportHours: {
      // "hằng ngày" is part of the approved statement, so it lives with the times rather than
      // being re-stated by each consumer. A reader of this constant gets the whole fact.
      days: [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
        "Sunday",
      ],
      opens: "08:00",
      closes: "22:00",
      utcOffset: "+07:00",
      utcOffsetLabel: "UTC+7",
    },
  });

  assert.equal(Object.isFrozen(PUBLIC_CONTACT_FACTS), true);
  assert.equal(Object.isFrozen(PUBLIC_CONTACT_FACTS.supportHours), true);
  assert.equal(Object.isFrozen(PUBLIC_CONTACT_FACTS.supportHours.days), true);
});

test("U32b the two views of the approved facts are derived from the same parts", () => {
  // Schema.org wants an ISO time carrying the offset; a reader wants a sentence. Both come from
  // the constant, so the footer and the JSON-LD cannot state different hours.
  assert.equal(supportHoursSchemaTime(PUBLIC_CONTACT_FACTS.supportHours.opens), "08:00:00+07:00");
  assert.equal(supportHoursSchemaTime(PUBLIC_CONTACT_FACTS.supportHours.closes), "22:00:00+07:00");

  assert.equal(describePublicSupportHours(), "08:00 - 22:00 hằng ngày (UTC+7)");
  assert.equal(describePublicAddress(), "212 Nguyễn Trãi, Đại Mỗ, Hà Nội");

  // The sentence is built from the parts, not typed out beside them.
  for (const part of [
    PUBLIC_CONTACT_FACTS.supportHours.opens,
    PUBLIC_CONTACT_FACTS.supportHours.closes,
    PUBLIC_CONTACT_FACTS.supportHours.utcOffsetLabel,
  ]) {
    assert.equal(describePublicSupportHours().includes(part), true, part);
  }
  for (const part of [PUBLIC_CONTACT_FACTS.streetAddress, PUBLIC_CONTACT_FACTS.addressLocality]) {
    assert.equal(describePublicAddress().includes(part), true, part);
  }
});

/**
 * The two spellings of the approved number are one fact. Google's Organization guidance wants the
 * country code on `contactPoint.telephone`, and the calling code comes from O2 — the owner decision
 * that the country/market is Việt Nam — not from the address.
 *
 * This checks the international form against the repository's existing reviewed Vietnamese phone
 * normalization rather than restating it, so a typo in either spelling fails here instead of
 * publishing a number nobody can reach. That function is imported by the test only: it exists to
 * collapse free-text buyer input for hashing, which is a different contract from rendering a
 * canonical published identifier, and the two must not become one authority by accident.
 */
test("U32b the international telephone is the approved number with the approved country code", () => {
  assert.equal(
    PUBLIC_CONTACT_FACTS.telephoneInternational,
    `+${normalizeVietnamesePhone(PUBLIC_CONTACT_FACTS.telephone)}`,
  );

  // Same subscriber digits either way: the trunk zero is replaced, nothing is invented.
  assert.equal(
    PUBLIC_CONTACT_FACTS.telephoneInternational.replace("+84", ""),
    PUBLIC_CONTACT_FACTS.telephone.replace(/^0/, ""),
  );
});

test("U32b carries no fact outside the B2 contact contract", () => {
  // `legalEntity`/`taxCode` are **not** owner-blocked — B6 approves publishing the legal entity and
  // the confirmed MST. They are simply outside the B2 contact contract this constant owns, and
  // belong to the About/legal surface U33 builds. The rest have no approved source at all: no logo
  // asset, no postal country, no Zalo profile URL, and B6 does keep founder/founding year private.
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
