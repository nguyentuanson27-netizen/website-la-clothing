import assert from "node:assert/strict";
import test from "node:test";

import { AuthorizationError } from "../../src/auth/authorization.ts";
import {
  createBootstrapProductSlug,
  createProductSlugAdminService,
  normalizeProductSlug,
  PRODUCT_SLUG_LIMITS,
} from "../../src/commerce/product-slug.ts";

const adminSession = {
  user: { id: "admin-1", role: "ADMIN" },
  session: { id: "session-admin" },
} as const;

const customerSession = {
  user: { id: "customer-1", role: "CUSTOMER" },
  session: { id: "session-customer" },
} as const;

test("product slug normalization is Vietnamese-friendly, lowercase, and hyphenated", () => {
  assert.equal(normalizeProductSlug("  Áo Sơ Mi Đen / Form Rộng  "), "ao-so-mi-den-form-rong");
  assert.equal(normalizeProductSlug("QUẦN--TÂY___ỐNG ĐỨNG"), "quan-tay-ong-dung");
  assert.equal(normalizeProductSlug("Đầm hè"), "dam-he");
  assert.equal(normalizeProductSlug("___ / ???"), null);
});

test("bootstrap product slugs are readable, bounded, deterministic, and identity-stable for collisions", () => {
  const first = createBootstrapProductSlug({
    shopId: 910_060,
    pancakeProductId: "product-a",
    name: "Áo Sơ Mi Oxford",
  });
  const repeated = createBootstrapProductSlug({
    shopId: 910_060,
    pancakeProductId: "product-a",
    name: "Áo Sơ Mi Oxford",
  });
  const collision = createBootstrapProductSlug({
    shopId: 910_060,
    pancakeProductId: "product-b",
    name: "Áo Sơ Mi Oxford",
  });

  assert.equal(first, repeated);
  assert.match(first, /^ao-so-mi-oxford-[a-f0-9]{20}$/);
  assert.notEqual(first, collision);
  assert.ok(first.length <= PRODUCT_SLUG_LIMITS.slug);
});

test("bootstrap product slug stays bounded for very long source names", () => {
  const slug = createBootstrapProductSlug({
    shopId: 910_060,
    pancakeProductId: "product-long",
    name: `Áo ${"rất dài ".repeat(100)}`,
  });

  assert.ok(slug.length <= PRODUCT_SLUG_LIMITS.slug);
  assert.match(slug, /-[a-f0-9]{20}$/);
});

test("product slug updates require ADMIN before parsing or persistence", async () => {
  let dependencyCalls = 0;
  const service = createProductSlugAdminService({
    async changeSlug() {
      dependencyCalls += 1;
      throw new Error("must not write");
    },
  });

  await assert.rejects(
    () =>
      service.update(customerSession, {
        productId: "product-1",
        slug: "Áo Sơ Mi Oxford",
      }),
    (error: unknown) => {
      assert.ok(error instanceof AuthorizationError);
      assert.equal(error.code, "FORBIDDEN");
      return true;
    },
  );
  assert.equal(dependencyCalls, 0);
});

test("product slug updates reject malformed browser input before persistence", async () => {
  let dependencyCalls = 0;
  const service = createProductSlugAdminService({
    async changeSlug() {
      dependencyCalls += 1;
      throw new Error("must not write");
    },
  });

  for (const input of [
    null,
    {},
    { productId: " product-1", slug: "ao-so-mi" },
    { productId: "product-1", slug: 123 },
    { productId: "product-1", slug: "___ / ???" },
    { productId: "product-1", slug: "x".repeat(PRODUCT_SLUG_LIMITS.rawInput + 1) },
  ]) {
    assert.deepEqual(await service.update(adminSession, input), {
      ok: false,
      reason: "INVALID_INPUT",
    });
  }
  assert.equal(dependencyCalls, 0);
});

test("product slug updates normalize explicit website-owned input before repository mutation", async () => {
  const writes: Array<{ productId: string; slug: string }> = [];
  const service = createProductSlugAdminService({
    async changeSlug(input) {
      writes.push(input);
      return {
        ok: true,
        productId: input.productId,
        previousSlug: "ao-so-mi-old",
        slug: input.slug,
        changed: true,
      } as const;
    },
  });

  const result = await service.update(adminSession, {
    productId: "product-1",
    slug: "  Áo Sơ Mi Oxford Đen  ",
  });

  assert.deepEqual(writes, [{ productId: "product-1", slug: "ao-so-mi-oxford-den" }]);
  assert.deepEqual(result, {
    ok: true,
    productId: "product-1",
    previousSlug: "ao-so-mi-old",
    slug: "ao-so-mi-oxford-den",
    changed: true,
  });
});

test("product slug updates preserve fail-closed repository outcomes", async () => {
  const service = createProductSlugAdminService({
    async changeSlug() {
      return { ok: false, reason: "SLUG_UNAVAILABLE" } as const;
    },
  });

  assert.deepEqual(
    await service.update(adminSession, { productId: "product-1", slug: "reserved-slug" }),
    { ok: false, reason: "SLUG_UNAVAILABLE" },
  );
});
