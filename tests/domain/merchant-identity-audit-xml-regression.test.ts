import assert from "node:assert/strict";
import test from "node:test";

import { classifyMerchantText } from "../../src/commerce/merchant-identity-audit.ts";

function withCode(code: number): string {
  return `Ao${String.fromCharCode(code)}so mi`;
}

test("M1 XML text legality follows the XML 1.0 Char production", () => {
  assert.equal(
    classifyMerchantText(withCode(0x7f)),
    "READY",
    "U+007F is XML-legal even though XML discourages it",
  );
  assert.equal(
    classifyMerchantText(withCode(0xfffe)),
    "MALFORMED",
    "U+FFFE is excluded from XML 1.0 Char",
  );
  assert.equal(
    classifyMerchantText(withCode(0xffff)),
    "MALFORMED",
    "U+FFFF is excluded from XML 1.0 Char",
  );
});
