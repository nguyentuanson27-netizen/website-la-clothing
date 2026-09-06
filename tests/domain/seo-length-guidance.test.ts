import assert from "node:assert/strict";
import test from "node:test";

import { PRODUCT_CONTENT_LIMITS } from "../../src/commerce/product-content-admin.ts";
import { SEO_LENGTH_GUIDANCE } from "../../src/commerce/seo-length-guidance.ts";

/**
 * U34a / W16. The editor advises on SEO length; it does not enforce it. What makes that true
 * structurally, rather than by intention, is that every advisory target sits strictly below the
 * bound the server actually enforces - so a value the counter warns about is still a value the
 * repository accepts. If these ever met, the advice would have quietly become a gate.
 */
test("U34a every SEO length target is advisory, strictly below the enforced limit", () => {
  assert.ok(
    SEO_LENGTH_GUIDANCE.seoTitle < PRODUCT_CONTENT_LIMITS.seoTitle,
    `advisory title length ${SEO_LENGTH_GUIDANCE.seoTitle} must leave room under the enforced ${PRODUCT_CONTENT_LIMITS.seoTitle}`,
  );
  assert.ok(
    SEO_LENGTH_GUIDANCE.seoDescription < PRODUCT_CONTENT_LIMITS.seoDescription,
    `advisory description length ${SEO_LENGTH_GUIDANCE.seoDescription} must leave room under the enforced ${PRODUCT_CONTENT_LIMITS.seoDescription}`,
  );
});

test("U34a the advisory targets are the reviewed search-display numbers", () => {
  assert.equal(SEO_LENGTH_GUIDANCE.seoTitle, 60);
  assert.equal(SEO_LENGTH_GUIDANCE.seoDescription, 155);
});
