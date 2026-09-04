import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyExternalIdentifier,
  classifyMerchantMedia,
  MERCHANT_ID_MAX_LENGTH,
  MERCHANT_MPN_MAX_LENGTH,
} from "../../src/commerce/merchant-identity-audit.ts";

test("M1 Merchant identifiers reject supplementary-plane code points represented by surrogate pairs", () => {
  const astralCharacter = "🧥";
  assert.equal(astralCharacter.length, 2, "fixture must exercise a UTF-16 surrogate pair");

  assert.equal(
    classifyExternalIdentifier(astralCharacter, {
      maxLength: MERCHANT_ID_MAX_LENGTH,
      allowWhitespace: false,
    }),
    "INVALID_FORMAT",
    "Google Merchant ID guidance lists surrogate pairs among invalid Unicode examples",
  );
  assert.equal(
    classifyExternalIdentifier(astralCharacter.repeat(MERCHANT_ID_MAX_LENGTH), {
      maxLength: MERCHANT_ID_MAX_LENGTH,
      allowWhitespace: false,
    }),
    "INVALID_FORMAT",
    "a value within the numeric length bound is still invalid when it contains surrogate pairs",
  );
  assert.equal(
    classifyExternalIdentifier(`MPN-${astralCharacter}`, {
      maxLength: MERCHANT_MPN_MAX_LENGTH,
      allowWhitespace: true,
    }),
    "INVALID_FORMAT",
    "LA Clothing applies the same conservative Unicode safety boundary to MPN candidates",
  );
});

test("M1 accepted BMP Unicode still obeys Merchant character-count boundaries", () => {
  const bmpCharacter = "đ";
  assert.equal(bmpCharacter.length, 1);

  assert.equal(
    classifyExternalIdentifier(bmpCharacter.repeat(MERCHANT_ID_MAX_LENGTH), {
      maxLength: MERCHANT_ID_MAX_LENGTH,
      allowWhitespace: false,
    }),
    "PRESENT",
  );
  assert.equal(
    classifyExternalIdentifier(bmpCharacter.repeat(MERCHANT_ID_MAX_LENGTH + 1), {
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
