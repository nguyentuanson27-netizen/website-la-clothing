import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyExternalIdentifier,
  classifyMerchantMedia,
  MERCHANT_ID_MAX_LENGTH,
} from "../../src/commerce/merchant-identity-audit.ts";

test("M1 Merchant identifier length counts Unicode code points rather than UTF-16 code units", () => {
  const astralCharacter = "🧥";
  assert.equal(astralCharacter.length, 2, "fixture must exercise a surrogate pair");

  assert.equal(
    classifyExternalIdentifier(astralCharacter.repeat(MERCHANT_ID_MAX_LENGTH), {
      maxLength: MERCHANT_ID_MAX_LENGTH,
      allowWhitespace: false,
    }),
    "PRESENT",
  );
  assert.equal(
    classifyExternalIdentifier(astralCharacter.repeat(MERCHANT_ID_MAX_LENGTH + 1), {
      maxLength: MERCHANT_ID_MAX_LENGTH,
      allowWhitespace: false,
    }),
    "TOO_LONG",
  );
});

test("M1 media readiness delegates trusted-image selection to the storefront product resolver", () => {
  const trustedSiblingImage = "https://content.pancake.vn/catalog/1/2/3/sibling.jpg";

  assert.equal(
    classifyMerchantMedia(null, [trustedSiblingImage]),
    "READY",
    "a trusted image from the product-level variant candidate set makes storefront media available",
  );

  assert.equal(
    classifyMerchantMedia("https://attacker.example/primary.jpg", [trustedSiblingImage]),
    "READY",
    "the storefront resolver may fall through an untrusted primary to a trusted variant candidate",
  );
});
